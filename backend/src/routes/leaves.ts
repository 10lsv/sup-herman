import { Router, type Request, type Response, type NextFunction } from 'express';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole } from '../middleware/auth';
import { DATE_RE, countBusinessDays } from '../lib/businessDays';
import {
  MAX_FILES_PER_REQUEST,
  resolveUploadPath,
  upload,
} from '../lib/uploads';
import type {
  LeaveAttachment,
  LeaveBalanceSummary,
  LeaveRequest,
  LeaveStatus,
  LeaveType,
  UserRole,
} from '../types';

export const leavesRouter = Router();

// Toutes les routes du module exigent un utilisateur authentifié.
leavesRouter.use(authenticate);

const PRIVILEGED: UserRole[] = ['manager', 'hr', 'admin'];

// ---------------------------------------------------------------------------
// Schémas de validation
// ---------------------------------------------------------------------------

const createLeaveSchema = z
  .object({
    // Le type se désigne par id ou par code — le front n'a pas toujours l'id.
    leave_type_id: z.coerce.number().int().positive().optional(),
    type: z.string().trim().min(1).max(50).optional(),
    date_start: z.string().regex(DATE_RE),
    date_end: z.string().regex(DATE_RE),
    comment: z.string().trim().max(5000).optional(),
  })
  .refine((v) => v.leave_type_id !== undefined || v.type !== undefined, {
    message: 'leave_type_id ou type est requis',
    path: ['type'],
  });

const calendarQuerySchema = z
  .object({
    from: z.string().regex(DATE_RE),
    to: z.string().regex(DATE_RE),
    // Équipe = les salariés rattachés à ce manager, plus le manager lui-même.
    team: z.coerce.number().int().positive().optional(),
  })
  .refine((v) => v.from <= v.to, { message: 'from doit précéder to', path: ['to'] });

const updateStatusSchema = z.object({
  status: z.enum(['approved', 'rejected', 'cancelled']),
  comment: z.string().trim().max(5000).optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// `req.params.x` est typé `string | string[]` sous Express 5 : on rejette le
// cas tableau plutôt que de le caster.
function parseId(raw: string | string[] | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Statuts qui immobilisent du solde : ni refusés, ni annulés. */
const ACTIVE_STATUSES = ['submitted', 'approved_manager', 'approved_hr', 'approved'];

/**
 * Traduit la décision générique { approved | rejected | cancelled } vers le
 * statut réel du workflow, qui dépend du rôle et de l'étape courante.
 *   salarié → submitted → (manager) approved_manager → (RH) approved_hr
 */
function resolveStatus(
  decision: 'approved' | 'rejected' | 'cancelled',
  role: UserRole,
  current: LeaveStatus,
): { status: LeaveStatus } | { error: string } {
  if (current === 'rejected' || current === 'cancelled') {
    return { error: `Demande déjà ${current === 'rejected' ? 'refusée' : 'annulée'}` };
  }

  if (decision === 'cancelled') return { status: 'cancelled' };
  if (decision === 'rejected') return { status: 'rejected' };

  // decision === 'approved'
  if (role === 'manager') {
    if (current !== 'submitted') {
      return { error: `Transition invalide : ${current} → approved_manager` };
    }
    return { status: 'approved_manager' };
  }
  if (role === 'hr') {
    if (current !== 'approved_manager') {
      return { error: `Transition invalide : ${current} → approved_hr` };
    }
    return { status: 'approved_hr' };
  }
  // admin : avance d'une étape selon l'état courant.
  if (current === 'submitted') return { status: 'approved_manager' };
  if (current === 'approved_manager') return { status: 'approved_hr' };
  return { error: `Transition invalide depuis ${current}` };
}

/**
 * Effet d'une transition sur le solde, en jours.
 *   pending  : jours réservés tant que la demande est en cours de validation
 *   used     : jours définitivement consommés (validation RH)
 */
function balanceDelta(
  from: LeaveStatus,
  to: LeaveStatus,
): { pending: number; used: number } {
  const wasPending = from === 'submitted' || from === 'approved_manager';
  const wasUsed = from === 'approved_hr' || from === 'approved';
  const isPending = to === 'submitted' || to === 'approved_manager';
  const isUsed = to === 'approved_hr' || to === 'approved';

  return {
    pending: (isPending ? 1 : 0) - (wasPending ? 1 : 0),
    used: (isUsed ? 1 : 0) - (wasUsed ? 1 : 0),
  };
}

/**
 * Récupère (ou crée) la ligne de solde de l'année, verrouillée pour la durée de
 * la transaction. La dotation initiale vient de leave_types.default_annual_days.
 */
async function lockBalance(
  client: PoolClient,
  userId: number,
  leaveTypeId: number,
  year: number,
): Promise<{ allocated: number; used: number; pending: number }> {
  await client.query(
    `INSERT INTO leave_balances (user_id, leave_type_id, year, allocated_days)
     SELECT $1, $2, $3, t.default_annual_days FROM leave_types t WHERE t.id = $2
     ON CONFLICT (user_id, leave_type_id, year) DO NOTHING`,
    [userId, leaveTypeId, year],
  );

  const { rows } = await client.query<{
    allocated_days: string;
    used_days: string;
    pending_days: string;
  }>(
    `SELECT allocated_days, used_days, pending_days
       FROM leave_balances
      WHERE user_id = $1 AND leave_type_id = $2 AND year = $3
      FOR UPDATE`,
    [userId, leaveTypeId, year],
  );

  const row = rows[0];
  return {
    allocated: Number(row?.allocated_days ?? 0),
    used: Number(row?.used_days ?? 0),
    pending: Number(row?.pending_days ?? 0),
  };
}

async function applyBalanceDelta(
  client: PoolClient,
  userId: number,
  leaveTypeId: number,
  year: number,
  pendingDays: number,
  usedDays: number,
): Promise<void> {
  if (pendingDays === 0 && usedDays === 0) return;
  // GREATEST(0, …) : le CHECK interdit un solde négatif, et un arrondi sur des
  // données reprises à la main ne doit pas bloquer une annulation.
  await client.query(
    `UPDATE leave_balances
        SET pending_days = GREATEST(0, pending_days + $4),
            used_days    = GREATEST(0, used_days + $5)
      WHERE user_id = $1 AND leave_type_id = $2 AND year = $3`,
    [userId, leaveTypeId, year, pendingDays, usedDays],
  );
}

/**
 * Année d'imputation du solde. Une demande à cheval sur le 31/12 est imputée
 * entièrement sur l'année de début — simplification assumée.
 */
function balanceYear(startDate: string): number {
  return Number(startDate.slice(0, 4));
}

const LEAVE_SELECT = `
  SELECT r.*,
         t.code       AS leave_type_code,
         t.label      AS leave_type_label,
         u.email      AS user_email,
         u.first_name AS user_first_name,
         u.last_name  AS user_last_name
    FROM leave_requests r
    JOIN leave_types t ON t.id = r.leave_type_id
    JOIN users u       ON u.id = r.user_id`;

// ---------------------------------------------------------------------------
// GET /api/leaves/mine — demandes de l'utilisateur connecté
// ---------------------------------------------------------------------------

leavesRouter.get('/mine', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

    const { rows } = await pool.query(
      `${LEAVE_SELECT} WHERE r.user_id = $1 ORDER BY r.start_date DESC, r.id DESC`,
      [req.user.id],
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/leaves/all — toutes les demandes (manager + RH)
//   Déclaré avant /:id pour ne pas être capté par le paramètre.
// ---------------------------------------------------------------------------

leavesRouter.get(
  '/all',
  requireRole('manager', 'hr', 'admin'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { rows } = await pool.query(
        `${LEAVE_SELECT} ORDER BY r.start_date DESC, r.id DESC`,
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/leaves/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD[&team=<manager_id>]
//   Calendrier global, ouvert à tout utilisateur connecté (sujet xFINT2).
//   Uniquement les congés validés qui chevauchent la période, et une projection
//   volontairement réduite : ni motif, ni commentaire, ni justificatif, ni email.
//   Déclaré avant /:id.
// ---------------------------------------------------------------------------

leavesRouter.get('/calendar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = calendarQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid query', details: parsed.error.flatten() });
    }
    const { from, to, team } = parsed.data;

    // `manager_id` est le manager de rattachement du salarié (users), pas le
    // valideur de la demande (leave_requests.manager_id).
    const { rows } = await pool.query(
      `SELECT r.id,
              r.user_id,
              u.first_name AS user_first_name,
              u.last_name  AS user_last_name,
              u.manager_id,
              json_build_object('code', t.code, 'label', t.label) AS leave_type,
              r.start_date AS date_start,
              r.end_date   AS date_end,
              r.days_requested,
              r.status
         FROM leave_requests r
         JOIN leave_types t ON t.id = r.leave_type_id
         JOIN users u       ON u.id = r.user_id
        WHERE r.status IN ('approved_manager', 'approved_hr', 'approved')
          AND r.start_date <= $2
          AND r.end_date   >= $1
          AND ($3::integer IS NULL OR u.manager_id = $3 OR u.id = $3)
        ORDER BY r.start_date, r.id`,
      [from, to, team ?? null],
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/leaves/balance/:user_id — soldes par type, pour l'année en cours
//   Soi-même, ou rôle privilégié. Déclaré avant /:id.
// ---------------------------------------------------------------------------

leavesRouter.get(
  '/balance/:user_id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const userId = parseId(req.params.user_id);
      if (userId === null) return res.status(400).json({ error: 'Invalid user id' });

      if (userId !== req.user.id && !PRIVILEGED.includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const year = Number(req.query.year ?? new Date().getFullYear());
      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return res.status(400).json({ error: 'Invalid year' });
      }

      // LEFT JOIN : un type sans ligne de solde remonte à 0 plutôt que d'être
      // absent — le front affiche toujours la liste complète des types.
      const { rows } = await pool.query<{
        leave_type_id: number;
        code: string;
        label: string;
        default_annual_days: string;
        allocated_days: string | null;
        used_days: string | null;
        pending_days: string | null;
      }>(
        `SELECT t.id AS leave_type_id, t.code, t.label, t.default_annual_days,
                b.allocated_days, b.used_days, b.pending_days
           FROM leave_types t
           LEFT JOIN leave_balances b
                  ON b.leave_type_id = t.id AND b.user_id = $1 AND b.year = $2
          WHERE t.is_active
          ORDER BY t.id`,
        [userId, year],
      );

      const balances: LeaveBalanceSummary[] = rows.map((r) => {
        const allocated = Number(r.allocated_days ?? r.default_annual_days);
        const used = Number(r.used_days ?? 0);
        const pending = Number(r.pending_days ?? 0);
        return {
          leave_type_id: r.leave_type_id,
          code: r.code,
          label: r.label,
          year,
          allocated_days: allocated,
          used_days: used,
          pending_days: pending,
          remaining_days: allocated - used - pending,
          is_capped: allocated > 0,
        };
      });

      res.json(balances);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/leaves — création
//   Créée directement en `submitted` (pas d'étape brouillon côté UI, cf. xFINT1).
//   Le nombre de jours est calculé serveur : jours ouvrés, week-ends et fériés
//   français exclus. Le client ne peut pas l'imposer.
// ---------------------------------------------------------------------------

leavesRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

    const parsed = createLeaveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid payload', details: parsed.error.flatten() });
    }
    const { leave_type_id, type, date_start, date_end, comment } = parsed.data;

    if (date_end < date_start) {
      return res
        .status(400)
        .json({ error: 'La date de fin doit être postérieure ou égale à la date de début' });
    }

    const typeRes = await client.query<LeaveType>(
      leave_type_id !== undefined
        ? 'SELECT * FROM leave_types WHERE id = $1 AND is_active LIMIT 1'
        : 'SELECT * FROM leave_types WHERE code = $1 AND is_active LIMIT 1',
      [leave_type_id ?? type],
    );
    const leaveType = typeRes.rows[0];
    if (!leaveType) return res.status(400).json({ error: 'Type de congé inconnu' });

    const days = countBusinessDays(date_start, date_end);
    if (days <= 0) {
      return res
        .status(400)
        .json({ error: 'La période ne contient aucun jour ouvré (week-ends et jours fériés exclus)' });
    }

    await client.query('BEGIN');

    // Chevauchement avec une demande encore active du même salarié.
    const overlap = await client.query<{ id: number }>(
      `SELECT id FROM leave_requests
        WHERE user_id = $1
          AND status = ANY($2::leave_status[])
          AND start_date <= $4::date
          AND end_date   >= $3::date
        LIMIT 1`,
      [req.user.id, ACTIVE_STATUSES, date_start, date_end],
    );
    if (overlap.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `La période chevauche la demande #${overlap.rows[0].id}`,
      });
    }

    const year = balanceYear(date_start);
    const balance = await lockBalance(client, req.user.id, leaveType.id, year);
    const remaining = balance.allocated - balance.used - balance.pending;

    // Seuls les types dotés (CP, RTT) sont plafonnés. Maladie, sans solde et
    // formation sont décomptés mais jamais bloqués.
    if (balance.allocated > 0 && days > remaining) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Solde insuffisant : ${remaining} jour(s) restant(s) sur ${leaveType.label}, ${days} demandé(s)`,
      });
    }

    const insert = await client.query<LeaveRequest>(
      `INSERT INTO leave_requests
         (user_id, leave_type_id, start_date, end_date, days_requested, reason,
          status, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'submitted', NOW())
       RETURNING *`,
      [req.user.id, leaveType.id, date_start, date_end, days, comment ?? null],
    );

    await applyBalanceDelta(client, req.user.id, leaveType.id, year, days, 0);
    await client.query('COMMIT');

    res.status(201).json(insert.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    next(err);
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// GET /api/leaves/:id — détail
// ---------------------------------------------------------------------------

leavesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });

    const { rows } = await pool.query(`${LEAVE_SELECT} WHERE r.id = $1 LIMIT 1`, [id]);
    const leave = rows[0];
    if (!leave) return res.status(404).json({ error: 'Leave request not found' });

    if (leave.user_id !== req.user.id && !PRIVILEGED.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const attachments = await pool.query<LeaveAttachment>(
      `SELECT id, leave_request_id, file_name, mime_type, file_size_bytes,
              uploaded_by, uploaded_at
         FROM leave_attachments
        WHERE leave_request_id = $1
        ORDER BY id`,
      [id],
    );

    res.json({ ...leave, attachments: attachments.rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/leaves/:id/status — validation / refus / annulation
//   approved & rejected : manager, RH, admin.
//   cancelled : également le demandeur, sur sa propre demande.
// ---------------------------------------------------------------------------

leavesRouter.patch(
  '/:id/status',
  async (req: Request, res: Response, next: NextFunction) => {
    const client = await pool.connect();
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: 'Invalid id' });

      const parsed = updateStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Invalid payload', details: parsed.error.flatten() });
      }
      const { status: decision, comment } = parsed.data;

      await client.query('BEGIN');

      const found = await client.query<LeaveRequest>(
        'SELECT * FROM leave_requests WHERE id = $1 LIMIT 1 FOR UPDATE',
        [id],
      );
      const leave = found.rows[0];
      if (!leave) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Leave request not found' });
      }

      const isOwner = leave.user_id === req.user.id;
      const isPrivileged = PRIVILEGED.includes(req.user.role);

      if (decision === 'cancelled') {
        if (!isOwner && !isPrivileged) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Insufficient permissions' });
        }
      } else {
        if (!isPrivileged) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Insufficient permissions' });
        }
        // On ne valide pas sa propre demande (même règle que xFINT1).
        if (isOwner && req.user.role !== 'admin') {
          await client.query('ROLLBACK');
          return res
            .status(403)
            .json({ error: 'Vous ne pouvez pas valider votre propre demande' });
        }
      }

      const resolved = resolveStatus(decision, req.user.role, leave.status);
      if ('error' in resolved) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: resolved.error });
      }

      // Le commentaire et l'horodatage vont dans la colonne du rôle qui agit.
      const isHrStep =
        req.user.role === 'hr' || resolved.status === 'approved_hr';

      const updated = await client.query<LeaveRequest>(
        isHrStep
          ? `UPDATE leave_requests
                SET status = $1::leave_status,
                    hr_id = $2,
                    hr_comment = COALESCE($3, hr_comment),
                    hr_action_at = NOW()
              WHERE id = $4
              RETURNING *`
          : `UPDATE leave_requests
                SET status = $1::leave_status,
                    manager_id = $2,
                    manager_comment = COALESCE($3, manager_comment),
                    manager_action_at = NOW()
              WHERE id = $4
              RETURNING *`,
        [resolved.status, req.user.id, comment ?? null, id],
      );

      const delta = balanceDelta(leave.status, resolved.status);
      if (delta.pending !== 0 || delta.used !== 0) {
        const days = Number(leave.days_requested);
        const year = balanceYear(leave.start_date);
        await lockBalance(client, leave.user_id, leave.leave_type_id, year);
        await applyBalanceDelta(
          client,
          leave.user_id,
          leave.leave_type_id,
          year,
          delta.pending * days,
          delta.used * days,
        );
      }

      await client.query('COMMIT');
      res.json(updated.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      next(err);
    } finally {
      client.release();
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/leaves/balance/:user_id — ajustement d'une dotation (RH)
//   Ne touche qu'`allocated_days` : `used` et `pending` sont dérivés des
//   demandes et ne doivent jamais être écrits à la main.
// ---------------------------------------------------------------------------

const updateBalanceSchema = z
  .object({
    leave_type_id: z.coerce.number().int().positive().optional(),
    type: z.string().trim().min(1).max(50).optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    allocated_days: z.coerce.number().min(0).max(400),
  })
  .refine((v) => v.leave_type_id !== undefined || v.type !== undefined, {
    message: 'leave_type_id ou type est requis',
    path: ['type'],
  });

leavesRouter.patch(
  '/balance/:user_id',
  requireRole('hr', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    const client = await pool.connect();
    try {
      const userId = parseId(req.params.user_id);
      if (userId === null) return res.status(400).json({ error: 'Invalid user id' });

      const parsed = updateBalanceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Invalid payload', details: parsed.error.flatten() });
      }
      const { leave_type_id, type, allocated_days } = parsed.data;
      const year = parsed.data.year ?? new Date().getFullYear();

      const userRes = await client.query('SELECT 1 FROM users WHERE id = $1', [userId]);
      if (userRes.rowCount === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const typeRes = await client.query<LeaveType>(
        leave_type_id !== undefined
          ? 'SELECT * FROM leave_types WHERE id = $1 AND is_active LIMIT 1'
          : 'SELECT * FROM leave_types WHERE code = $1 AND is_active LIMIT 1',
        [leave_type_id ?? type],
      );
      const leaveType = typeRes.rows[0];
      if (!leaveType) return res.status(400).json({ error: 'Type de congé inconnu' });

      await client.query('BEGIN');

      // Verrouille (et crée au besoin) la ligne avant de lire used/pending :
      // une décision concurrente ne peut pas s'intercaler.
      const current = await lockBalance(client, userId, leaveType.id, year);
      const committed = current.used + current.pending;
      if (allocated_days < committed) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error:
            `Dotation inférieure aux jours déjà engagés : ${committed} j ` +
            `(${current.used} pris, ${current.pending} en attente)`,
        });
      }

      await client.query(
        `UPDATE leave_balances
            SET allocated_days = $4
          WHERE user_id = $1 AND leave_type_id = $2 AND year = $3`,
        [userId, leaveType.id, year, allocated_days],
      );

      await client.query('COMMIT');

      const summary: LeaveBalanceSummary = {
        leave_type_id: leaveType.id,
        code: leaveType.code,
        label: leaveType.label,
        year,
        allocated_days,
        used_days: current.used,
        pending_days: current.pending,
        remaining_days: allocated_days - committed,
        is_capped: allocated_days > 0,
      };
      res.json(summary);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      next(err);
    } finally {
      client.release();
    }
  },
);

// ---------------------------------------------------------------------------
// Justificatifs de congé
// ---------------------------------------------------------------------------

async function findLeave(id: number): Promise<LeaveRequest | null> {
  const { rows } = await pool.query<LeaveRequest>(
    'SELECT * FROM leave_requests WHERE id = $1 LIMIT 1',
    [id],
  );
  return rows[0] ?? null;
}

/** Écriture d'une pièce jointe : le demandeur, la RH ou un admin. */
function canWriteAttachment(
  leave: LeaveRequest,
  user: { id: number; role: UserRole },
): boolean {
  return leave.user_id === user.id || user.role === 'hr' || user.role === 'admin';
}

// ---------------------------------------------------------------------------
// POST /api/leaves/:id/attachments — dépôt d'un justificatif
// ---------------------------------------------------------------------------

leavesRouter.post(
  '/:id/attachments',
  (req: Request, res: Response, next: NextFunction) => {
    upload.array('files', MAX_FILES_PER_REQUEST)(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        return res.status(400).json({ error: message });
      }
      next();
    });
  },
  async (req: Request, res: Response, next: NextFunction) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];

    // Nettoie les fichiers déjà écrits sur disque si la requête est rejetée.
    const discard = async () => {
      await Promise.all(files.map((f) => unlink(f.path).catch(() => {})));
    };

    try {
      if (!req.user) {
        await discard();
        return res.status(401).json({ error: 'Unauthenticated' });
      }

      const id = parseId(req.params.id);
      if (id === null) {
        await discard();
        return res.status(400).json({ error: 'Invalid id' });
      }

      const leave = await findLeave(id);
      if (!leave) {
        await discard();
        return res.status(404).json({ error: 'Leave request not found' });
      }
      if (!canWriteAttachment(leave, req.user)) {
        await discard();
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      if (files.length === 0) {
        return res.status(400).json({ error: 'Aucun fichier reçu (champ `files`)' });
      }

      const inserted: LeaveAttachment[] = [];
      for (const file of files) {
        const { rows } = await pool.query<LeaveAttachment>(
          `INSERT INTO leave_attachments
             (leave_request_id, file_name, file_path, mime_type, file_size_bytes, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, leave_request_id, file_name, mime_type, file_size_bytes,
                     uploaded_by, uploaded_at`,
          [
            id,
            file.originalname,
            // Seul le basename généré est stocké, jamais un chemin client.
            file.path.split('/').pop() ?? file.filename,
            file.mimetype,
            file.size,
            req.user.id,
          ],
        );
        const row = rows[0];
        if (row) inserted.push(row);
      }

      res.status(201).json(inserted);
    } catch (err) {
      await discard();
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/leaves/:id/attachments/:aid — téléchargement
//   Mêmes droits de lecture que le détail de la demande.
// ---------------------------------------------------------------------------

leavesRouter.get(
  '/:id/attachments/:aid',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const id = parseId(req.params.id);
      const attachmentId = parseId(req.params.aid);
      if (id === null || attachmentId === null) {
        return res.status(400).json({ error: 'Invalid id' });
      }

      const leave = await findLeave(id);
      if (!leave) return res.status(404).json({ error: 'Leave request not found' });
      if (leave.user_id !== req.user.id && !PRIVILEGED.includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { rows } = await pool.query<LeaveAttachment & { file_path: string }>(
        'SELECT * FROM leave_attachments WHERE id = $1 AND leave_request_id = $2 LIMIT 1',
        [attachmentId, id],
      );
      const attachment = rows[0];
      if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

      const absolute = resolveUploadPath(attachment.file_path);
      if (!absolute) return res.status(400).json({ error: 'Invalid file path' });

      res.setHeader('Content-Type', attachment.mime_type);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`,
      );

      const stream = createReadStream(absolute);
      stream.on('error', () => {
        if (!res.headersSent) res.status(404).json({ error: 'File missing on disk' });
        else res.end();
      });
      stream.pipe(res);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/leaves/:id/attachments/:aid — suppression
// ---------------------------------------------------------------------------

leavesRouter.delete(
  '/:id/attachments/:aid',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const id = parseId(req.params.id);
      const attachmentId = parseId(req.params.aid);
      if (id === null || attachmentId === null) {
        return res.status(400).json({ error: 'Invalid id' });
      }

      const leave = await findLeave(id);
      if (!leave) return res.status(404).json({ error: 'Leave request not found' });
      if (!canWriteAttachment(leave, req.user)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { rows } = await pool.query<{ file_path: string }>(
        `DELETE FROM leave_attachments
          WHERE id = $1 AND leave_request_id = $2
          RETURNING file_path`,
        [attachmentId, id],
      );
      const removed = rows[0];
      if (!removed) return res.status(404).json({ error: 'Attachment not found' });

      // La ligne est partie : un fichier orphelin sur disque n'est pas une
      // raison d'échouer la requête.
      const absolute = resolveUploadPath(removed.file_path);
      if (absolute) await unlink(absolute).catch(() => undefined);

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

export default leavesRouter;
