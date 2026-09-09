import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole } from '../middleware/auth';
import type {
  Attachment,
  ExpenseNote,
  ExpenseStatus,
  UserRole,
} from '../types';

export const expensesRouter = Router();

// Toutes les routes du module exigent un utilisateur authentifié.
expensesRouter.use(authenticate);

// ---------------------------------------------------------------------------
// Upload : stockage disque sous backend/uploads/
// ---------------------------------------------------------------------------

const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 Mo
const MAX_FILES_PER_REQUEST = 10;

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      void mkdir(UPLOAD_DIR, { recursive: true })
        .then(() => cb(null, UPLOAD_DIR))
        .catch((err: Error) => cb(err, UPLOAD_DIR));
    },
    // Nom disque aléatoire : on ne fait jamais confiance au nom fourni par le
    // client (traversée de chemin, collisions). Le vrai nom va en base.
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 10);
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_REQUEST },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error(`Type de fichier non autorisé : ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

// ---------------------------------------------------------------------------
// Schémas de validation
// ---------------------------------------------------------------------------

const CATEGORIES = ['travel', 'meal', 'accommodation', 'supplies', 'other'] as const;

const createExpenseSchema = z.object({
  title: z.string().trim().min(1).max(255),
  // Le front envoie `comment` ; en base la colonne s'appelle `description`.
  comment: z.string().trim().max(5000).optional(),
  category: z.enum(CATEGORIES),
  // Le schéma SQL impose amount et expense_date NOT NULL : on accepte des
  // valeurs optionnelles avec repli (0 / aujourd'hui) pour rester compatible
  // avec un payload minimal { title, comment, category }.
  amount: z.coerce.number().nonnegative().max(1_000_000).optional(),
  currency: z.string().length(3).optional(),
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(['approved', 'rejected', 'reimbursed']),
  comment: z.string().trim().max(5000).optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PRIVILEGED: UserRole[] = ['manager', 'accounting', 'admin'];

/** Date du jour dans le fuseau du serveur (toISOString donnerait l'UTC). */
function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

async function findNote(id: number): Promise<ExpenseNote | null> {
  const { rows } = await pool.query<ExpenseNote>(
    'SELECT * FROM expense_notes WHERE id = $1 LIMIT 1',
    [id],
  );
  return rows[0] ?? null;
}

// `req.params.x` est typé `string | string[]` sous Express 5 : on rejette le
// cas tableau plutôt que de le caster (même helper que routes/leaves.ts).
function parseId(raw: string | string[] | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** L'utilisateur peut-il consulter cette note ? Propriétaire ou rôle privilégié. */
function canRead(note: ExpenseNote, user: { id: number; role: UserRole }): boolean {
  return note.user_id === user.id || PRIVILEGED.includes(user.role);
}

/**
 * Traduit la décision générique { approved | rejected | reimbursed } vers le
 * statut réel du workflow, qui dépend du rôle et de l'étape courante.
 *   employé → submitted → (manager) approved_manager
 *           → (comptabilité) approved_accounting → reimbursed
 */
function resolveStatus(
  decision: 'approved' | 'rejected' | 'reimbursed',
  role: UserRole,
  current: ExpenseStatus,
): { status: ExpenseStatus } | { error: string } {
  if (decision === 'rejected') {
    if (current === 'reimbursed') {
      return { error: 'Une note déjà remboursée ne peut plus être refusée' };
    }
    return { status: 'rejected' };
  }

  if (decision === 'reimbursed') {
    if (role !== 'accounting' && role !== 'admin') {
      return { error: 'Seule la comptabilité peut marquer une note remboursée' };
    }
    if (current !== 'approved_accounting') {
      return { error: `Transition invalide : ${current} → reimbursed` };
    }
    return { status: 'reimbursed' };
  }

  // decision === 'approved'
  if (role === 'manager') {
    if (current !== 'submitted') {
      return { error: `Transition invalide : ${current} → approved_manager` };
    }
    return { status: 'approved_manager' };
  }
  if (role === 'accounting') {
    if (current !== 'approved_manager') {
      return { error: `Transition invalide : ${current} → approved_accounting` };
    }
    return { status: 'approved_accounting' };
  }
  // admin : avance d'une étape selon l'état courant.
  if (current === 'submitted') return { status: 'approved_manager' };
  if (current === 'approved_manager') return { status: 'approved_accounting' };
  return { error: `Transition invalide depuis ${current}` };
}

// ---------------------------------------------------------------------------
// GET /api/expenses/mine — notes de l'utilisateur connecté
// ---------------------------------------------------------------------------

expensesRouter.get('/mine', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

    const { rows } = await pool.query<ExpenseNote>(
      `SELECT * FROM expense_notes
        WHERE user_id = $1
        ORDER BY expense_date DESC, id DESC`,
      [req.user.id],
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/expenses/all — toutes les notes (manager + comptabilité)
//   Déclaré avant /:id pour ne pas être capté par le paramètre.
// ---------------------------------------------------------------------------

expensesRouter.get(
  '/all',
  requireRole('manager', 'accounting', 'admin'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { rows } = await pool.query(
        `SELECT n.*,
                u.email      AS user_email,
                u.first_name AS user_first_name,
                u.last_name  AS user_last_name
           FROM expense_notes n
           JOIN users u ON u.id = n.user_id
          ORDER BY n.expense_date DESC, n.id DESC`,
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/expenses — création
//   Créée directement en `submitted` : le workflow n'expose pas d'étape
//   brouillon côté UI, la note part donc immédiatement chez le manager.
// ---------------------------------------------------------------------------

expensesRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

    const parsed = createExpenseSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    }
    const { title, comment, category, amount, currency, expense_date } = parsed.data;

    // Rattache la note au manager de l'employé pour l'étape de validation.
    const { rows: mgrRows } = await pool.query<{ manager_id: number | null }>(
      'SELECT manager_id FROM users WHERE id = $1',
      [req.user.id],
    );

    const { rows } = await pool.query<ExpenseNote>(
      `INSERT INTO expense_notes
         (user_id, title, description, category, amount, currency, expense_date,
          status, manager_id, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'submitted', $8, NOW())
       RETURNING *`,
      [
        req.user.id,
        title,
        comment ?? null,
        category,
        amount ?? 0,
        currency ?? 'EUR',
        expense_date ?? todayISO(),
        mgrRows[0]?.manager_id ?? null,
      ],
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/expenses/:id — détail + pièces jointes
// ---------------------------------------------------------------------------

expensesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });

    const note = await findNote(id);
    if (!note) return res.status(404).json({ error: 'Expense note not found' });
    if (!canRead(note, req.user)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const [{ rows: attachments }, { rows: owner }] = await Promise.all([
      pool.query<Attachment>(
        `SELECT id, expense_note_id, file_name, mime_type, file_size_bytes,
                uploaded_by, uploaded_at
           FROM attachments
          WHERE expense_note_id = $1
          ORDER BY id`,
        [id],
      ),
      pool.query<{ email: string; first_name: string; last_name: string }>(
        'SELECT email, first_name, last_name FROM users WHERE id = $1',
        [note.user_id],
      ),
    ]);

    res.json({
      ...note,
      user_email: owner[0]?.email ?? null,
      user_first_name: owner[0]?.first_name ?? null,
      user_last_name: owner[0]?.last_name ?? null,
      attachments,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/expenses/:id/status — validation / refus
// ---------------------------------------------------------------------------

expensesRouter.patch(
  '/:id/status',
  requireRole('manager', 'accounting', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: 'Invalid id' });

      const parsed = updateStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
      }
      const { status: decision, comment } = parsed.data;

      const note = await findNote(id);
      if (!note) return res.status(404).json({ error: 'Expense note not found' });

      // On ne valide pas ses propres notes.
      if (note.user_id === req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Vous ne pouvez pas valider votre propre note' });
      }

      const resolved = resolveStatus(decision, req.user.role, note.status);
      if ('error' in resolved) {
        return res.status(409).json({ error: resolved.error });
      }

      // Le commentaire et l'horodatage vont dans la colonne du rôle qui agit.
      const isAccountingStep =
        req.user.role === 'accounting' ||
        resolved.status === 'approved_accounting' ||
        resolved.status === 'reimbursed';

      const { rows } = await pool.query<ExpenseNote>(
        isAccountingStep
          ? `UPDATE expense_notes
                SET status = $1::expense_status,
                    accountant_id = $2,
                    accountant_comment = COALESCE($3, accountant_comment),
                    accountant_action_at = NOW(),
                    reimbursed_at = CASE WHEN $1::expense_status = 'reimbursed'
                                         THEN NOW() ELSE reimbursed_at END
              WHERE id = $4
              RETURNING *`
          : `UPDATE expense_notes
                SET status = $1::expense_status,
                    manager_id = $2,
                    manager_comment = COALESCE($3, manager_comment),
                    manager_action_at = NOW()
              WHERE id = $4
              RETURNING *`,
        [resolved.status, req.user.id, comment ?? null, id],
      );

      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/expenses/:id/attachments — upload (propriétaire uniquement)
// ---------------------------------------------------------------------------

expensesRouter.post(
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

      const note = await findNote(id);
      if (!note) {
        await discard();
        return res.status(404).json({ error: 'Expense note not found' });
      }
      if (note.user_id !== req.user.id && req.user.role !== 'admin') {
        await discard();
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      if (files.length === 0) {
        return res.status(400).json({ error: 'Aucun fichier reçu (champ `files`)' });
      }

      const inserted: Attachment[] = [];
      for (const file of files) {
        const { rows } = await pool.query<Attachment>(
          `INSERT INTO attachments
             (expense_note_id, file_name, file_path, mime_type, file_size_bytes, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, expense_note_id, file_name, mime_type, file_size_bytes,
                     uploaded_by, uploaded_at`,
          [
            id,
            file.originalname,
            path.basename(file.path),
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
// GET /api/expenses/:id/attachments/:attachmentId — téléchargement
// ---------------------------------------------------------------------------

expensesRouter.get(
  '/:id/attachments/:attachmentId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const id = parseId(req.params.id);
      const attachmentId = parseId(req.params.attachmentId);
      if (id === null || attachmentId === null) {
        return res.status(400).json({ error: 'Invalid id' });
      }

      const note = await findNote(id);
      if (!note) return res.status(404).json({ error: 'Expense note not found' });
      if (!canRead(note, req.user)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { rows } = await pool.query<Attachment>(
        'SELECT * FROM attachments WHERE id = $1 AND expense_note_id = $2 LIMIT 1',
        [attachmentId, id],
      );
      const attachment = rows[0];
      if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

      // file_path ne contient qu'un basename généré côté serveur ; on le
      // renormalise pour écarter toute tentative de traversée de chemin.
      const absolute = path.join(UPLOAD_DIR, path.basename(attachment.file_path));
      if (!absolute.startsWith(UPLOAD_DIR + path.sep)) {
        return res.status(400).json({ error: 'Invalid file path' });
      }

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

export default expensesRouter;
