import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db';
import {
  authenticate,
  authenticateOptional,
  requireRole,
} from '../middleware/auth';
import { toPublicUser } from '../lib/publicUser';
import type {
  LeaveBalanceSummary,
  User,
  UserRole,
  UserWithBalances,
} from '../types';

export const usersRouter = Router();

const BCRYPT_COST = 12;
/** Durée de validité du jeton d'activation d'un compte. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Schémas de validation
// ---------------------------------------------------------------------------

const createUserSchema = z.object({
  email: z.string().email().max(255),
  role: z.enum(['employee', 'manager', 'accounting', 'hr', 'admin']),
  // Manager responsable (xFINT2 : défini par la RH). Absent ou null = aucun.
  manager_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
});

/**
 * `accounting` est inclus alors que la spec ne listait que
 * employee/manager/hr/admin : le rôle existe dans l'enum `user_role`, il est
 * proposé à la création et il porte l'étape comptable de xFINT1. L'exclure ici
 * rendrait tout compte comptable non éditable.
 */
const ASSIGNABLE_ROLES = ['employee', 'manager', 'accounting', 'hr', 'admin'] as const;

/**
 * Rôles qu'un créateur peut attribuer via POST /api/users :
 *   • manager — spec xFINT1 p. 6 (salariés, managers, comptabilité) ;
 *   • hr      — spec xFINT2 p. 7 (salariés, managers, RH) ;
 *   • admin   — tous.
 */
const CREATABLE_ROLES: Record<UserRole, readonly UserRole[]> = {
  manager: ['employee', 'manager', 'accounting'],
  hr: ['employee', 'manager', 'hr'],
  admin: ASSIGNABLE_ROLES,
  employee: [],
  accounting: [],
};

const ROLE_LABEL: Record<UserRole, string> = {
  employee: 'salarié',
  manager: 'manager',
  accounting: 'comptabilité',
  hr: 'RH',
  admin: 'admin',
};

const updateUserSchema = z
  .object({
    email: z.string().email().max(255).optional(),
    first_name: z.string().trim().max(100).optional(),
    last_name: z.string().trim().max(100).optional(),
    role: z.enum(ASSIGNABLE_ROLES).optional(),
    // `null` détache le salarié de son manager ; absent = inchangé. D'où
    // l'union plutôt qu'un `.nullable().optional()` sur un coerce, qui
    // convertirait null en 0.
    manager_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Aucun champ à mettre à jour',
  });

const updatePasswordSchema = z.object({
  password: z.string().min(8).max(200),
  /** Activation d'un compte créé par un manager (utilisateur non connecté). */
  token: z.string().min(32).max(128).optional(),
  /** Changement de son propre mot de passe par un utilisateur connecté. */
  current_password: z.string().min(1).max(200).optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseId(raw: string | string[] | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Comparaison à durée constante de deux hex de même longueur. */
function tokenMatches(candidate: string, stored: string | null): boolean {
  if (!stored) return false;
  const a = Buffer.from(hashToken(candidate), 'hex');
  const b = Buffer.from(stored, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Jeton en clair (rendu une seule fois) + hash à stocker. */
function newInviteToken(): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(32).toString('hex');
  return {
    token,
    hash: hashToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  };
}

// ---------------------------------------------------------------------------
// PATCH /api/users/:id/password
//   Trois modes, dans cet ordre de priorité :
//     1. { token, password }            — activation, sans être connecté
//     2. { current_password, password } — l'utilisateur change le sien
//     3. { password }                   — RH/admin réinitialise celui d'un autre
//   Déclaré AVANT `authenticate` : le mode 1 doit rester accessible à un
//   utilisateur qui, par construction, ne peut pas encore se connecter.
// ---------------------------------------------------------------------------

usersRouter.patch(
  '/:id/password',
  authenticateOptional,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: 'Invalid id' });

      const parsed = updatePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Invalid payload', details: parsed.error.flatten() });
      }
      const { password, token, current_password } = parsed.data;

      const { rows } = await pool.query<User>(
        'SELECT * FROM users WHERE id = $1 LIMIT 1',
        [id],
      );
      const target = rows[0];
      if (!target) return res.status(404).json({ error: 'User not found' });

      // Le porteur du jeton est traité comme l'utilisateur lui-même.
      let authorized = false;
      let consumeToken = false;

      if (token) {
        const expired =
          !target.password_token_expires_at ||
          new Date(target.password_token_expires_at).getTime() < Date.now();
        if (!tokenMatches(token, target.password_token_hash) || expired) {
          return res.status(403).json({ error: 'Jeton invalide ou expiré' });
        }
        authorized = true;
        consumeToken = true;
      } else {
        // Sans jeton, il faut être connecté.
        const actor = req.user;
        if (!actor) return res.status(401).json({ error: 'Missing bearer token' });

        if (actor.id === target.id) {
          // Un compte jamais activé n'a pas de mot de passe courant à fournir.
          if (target.password_hash) {
            if (!current_password) {
              return res
                .status(400)
                .json({ error: 'current_password est requis' });
            }
            const ok = await bcrypt.compare(current_password, target.password_hash);
            if (!ok) {
              return res.status(403).json({ error: 'Mot de passe actuel incorrect' });
            }
          }
          authorized = true;
        } else if (actor.role === 'hr' || actor.role === 'admin') {
          // Réinitialisation par la RH : pas de mot de passe courant exigé.
          authorized = true;
        }
      }

      if (!authorized) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const password_hash = await bcrypt.hash(password, BCRYPT_COST);
      await pool.query(
        `UPDATE users
            SET password_hash = $1,
                password_token_hash = NULL,
                password_token_expires_at = NULL
          WHERE id = $2`,
        [password_hash, id],
      );

      res.json({ ok: true, consumed_token: consumeToken });
    } catch (err) {
      next(err);
    }
  },
);

// Toutes les routes suivantes exigent un utilisateur authentifié.
usersRouter.use(authenticate);

// ---------------------------------------------------------------------------
// GET /api/users/managers — managers actifs, pour filtrer le calendrier par
//   équipe. Ouvert à tout utilisateur connecté : id et nom uniquement.
// ---------------------------------------------------------------------------

usersRouter.get('/managers', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query<Pick<User, 'id' | 'first_name' | 'last_name'>>(
      `SELECT id, first_name, last_name
         FROM users
        WHERE role = 'manager' AND is_active
        ORDER BY last_name, first_name, id`,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/users — annuaire + soldes de l'année (RH)
// ---------------------------------------------------------------------------

usersRouter.get(
  '/',
  requireRole('hr', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const year = Number(req.query.year ?? new Date().getFullYear());
      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return res.status(400).json({ error: 'Invalid year' });
      }

      const usersRes = await pool.query<User>(
        'SELECT * FROM users ORDER BY last_name, first_name, email',
      );

      // Un seul aller-retour pour tous les soldes, recomposés en mémoire :
      // évite une requête par utilisateur.
      const balancesRes = await pool.query<{
        user_id: number;
        leave_type_id: number;
        code: string;
        label: string;
        default_annual_days: string;
        allocated_days: string | null;
        used_days: string | null;
        pending_days: string | null;
      }>(
        `SELECT u.id AS user_id, t.id AS leave_type_id, t.code, t.label,
                t.default_annual_days,
                b.allocated_days, b.used_days, b.pending_days
           FROM users u
           CROSS JOIN leave_types t
           LEFT JOIN leave_balances b
                  ON b.user_id = u.id AND b.leave_type_id = t.id AND b.year = $1
          WHERE t.is_active
          ORDER BY u.id, t.id`,
        [year],
      );

      const byUser = new Map<number, LeaveBalanceSummary[]>();
      for (const r of balancesRes.rows) {
        const allocated = Number(r.allocated_days ?? r.default_annual_days);
        const used = Number(r.used_days ?? 0);
        const pending = Number(r.pending_days ?? 0);
        const list = byUser.get(r.user_id) ?? [];
        list.push({
          leave_type_id: r.leave_type_id,
          code: r.code,
          label: r.label,
          year,
          allocated_days: allocated,
          used_days: used,
          pending_days: pending,
          remaining_days: allocated - used - pending,
          is_capped: allocated > 0,
        });
        byUser.set(r.user_id, list);
      }

      const body: UserWithBalances[] = usersRes.rows.map((u) => ({
        ...toPublicUser(u),
        has_password: u.password_hash !== null,
        balances: byUser.get(u.id) ?? [],
      }));

      res.json(body);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/users — provisionnement d'un compte par un manager, la RH ou un admin
//   Aucun mot de passe n'est fourni : la réponse porte un jeton d'activation à
//   usage unique, affiché une seule fois, que le créateur transmet au salarié.
// ---------------------------------------------------------------------------

usersRouter.post(
  '/',
  requireRole('manager', 'hr', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Invalid payload', details: parsed.error.flatten() });
      }
      const { role } = parsed.data;
      const email = parsed.data.email.toLowerCase();

      const allowed = CREATABLE_ROLES[req.user.role];
      if (!allowed.includes(role)) {
        return res.status(403).json({
          error:
            `Un compte ${ROLE_LABEL[req.user.role]} ne peut pas créer de compte ` +
            `${ROLE_LABEL[role]}. Rôles autorisés : ` +
            `${allowed.map((r) => ROLE_LABEL[r]).join(', ')}.`,
        });
      }

      // Rattachement hiérarchique. Un manager_id explicite (y compris null)
      // l'emporte ; sinon, comme avant, seul un compte `manager` est rattaché à
      // son créateur — sauf si ce créateur est la RH, qui n'encadre personne.
      const managerId =
        parsed.data.manager_id !== undefined
          ? parsed.data.manager_id
          : role === 'manager' && req.user.role !== 'hr'
            ? req.user.id
            : null;

      if (parsed.data.manager_id != null) {
        const { rows: managers } = await pool.query<Pick<User, 'role' | 'is_active'>>(
          'SELECT role, is_active FROM users WHERE id = $1',
          [parsed.data.manager_id],
        );
        const manager = managers[0];
        const isManager = manager?.role === 'manager' || manager?.role === 'admin';
        if (!manager?.is_active || !isManager) {
          return res
            .status(400)
            .json({ error: 'Manager responsable inconnu, inactif ou sans rôle manager' });
        }
      }

      const existing = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
      if (existing.rowCount && existing.rowCount > 0) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      const invite = newInviteToken();

      const { rows } = await pool.query<User>(
        `INSERT INTO users (email, role, manager_id, created_by,
                            password_token_hash, password_token_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [email, role, managerId, req.user.id, invite.hash, invite.expiresAt],
      );

      res.status(201).json({
        ...toPublicUser(rows[0]!),
        // Montré une seule fois : seul le hash est conservé en base.
        invite_token: invite.token,
        invite_expires_at: invite.expiresAt.toISOString(),
      });
    } catch (err) {
      // Course entre le SELECT et l'INSERT : l'index unique tranche.
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
        return res.status(409).json({ error: 'Email already registered' });
      }
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/users/:id — identité, rôle, rattachement, activation (RH)
// ---------------------------------------------------------------------------

usersRouter.patch(
  '/:id',
  requireRole('hr', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: 'Invalid id' });

      const parsed = updateUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Invalid payload', details: parsed.error.flatten() });
      }
      const { first_name, last_name, role, is_active } = parsed.data;
      const email = parsed.data.email?.toLowerCase();
      // `manager_id` accepte trois états : absent, un id, ou null.
      const managerProvided = 'manager_id' in parsed.data;
      const managerId = parsed.data.manager_id ?? null;

      if (managerProvided && managerId !== null) {
        if (managerId === id) {
          return res
            .status(400)
            .json({ error: 'Un utilisateur ne peut pas être son propre manager' });
        }
        const exists = await pool.query('SELECT 1 FROM users WHERE id = $1', [managerId]);
        if (exists.rowCount === 0) {
          return res.status(400).json({ error: 'Manager inconnu' });
        }
      }

      // Se désactiver soi-même revient à se verrouiller dehors.
      if (is_active === false && req.user?.id === id) {
        return res
          .status(400)
          .json({ error: 'Vous ne pouvez pas désactiver votre propre compte' });
      }

      // COALESCE : un champ absent garde sa valeur courante. `manager_id` passe
      // par un drapeau, COALESCE ne saurait pas distinguer null de « absent ».
      const { rows } = await pool.query<User>(
        `UPDATE users
            SET email      = COALESCE($1, email),
                first_name = COALESCE($2, first_name),
                last_name  = COALESCE($3, last_name),
                role       = COALESCE($4::user_role, role),
                is_active  = COALESCE($5::boolean, is_active),
                manager_id = CASE WHEN $6::boolean THEN $7::integer ELSE manager_id END
          WHERE id = $8
          RETURNING *`,
        [
          email ?? null,
          first_name ?? null,
          last_name ?? null,
          role ?? null,
          is_active ?? null,
          managerProvided,
          managerId,
          id,
        ],
      );
      const user = rows[0];
      if (!user) return res.status(404).json({ error: 'User not found' });

      res.json(toPublicUser(user));
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === '23505') {
        return res.status(409).json({ error: 'Email already registered' });
      }
      // chk_users_not_self_manager, en garde-fou de la vérification ci-dessus.
      if (code === '23514' || code === '23503') {
        return res.status(400).json({ error: 'Rattachement hiérarchique invalide' });
      }
      next(err);
    }
  },
);
