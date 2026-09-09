import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, signAuthToken } from '../middleware/auth';
import type { LoginResponse, PublicUser, User, UserRole } from '../types';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  // Cet endpoint ne permet de créer QUE des managers ou admins.
  // Les employés sont provisionnés via un autre flux (RH/Admin).
  role: z.enum(['manager', 'admin']),
  department: z.string().optional(),
});

function toPublicUser(row: User): PublicUser {
  const { password_hash: _p, ...rest } = row;
  return rest;
}

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;

    const { rows } = await pool.query<User>(
      'SELECT * FROM users WHERE email = $1 LIMIT 1',
      [email.toLowerCase()],
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Compte provisionné par un manager (POST /api/users) : le mot de passe
    // n'est pas encore défini, la connexion classique ne peut pas aboutir.
    if (!user.password_hash) {
      return res.status(403).json({ error: 'Mot de passe non défini, contactez votre manager' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signAuthToken({ id: user.id, email: user.email, role: user.role });

    const body: LoginResponse = { token, user: toPublicUser(user) };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/register
//   Restreint : role ∈ { manager, admin } uniquement.
//   ⚠  À protéger derrière requireAdmin en prod — laissé public pour bootstrap.
// ---------------------------------------------------------------------------

authRouter.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    }
    const { email, password, first_name, last_name, role, department } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    const existing = await pool.query('SELECT 1 FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rowCount && existing.rowCount > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const password_hash = await bcrypt.hash(password, 12);

    const insert = await pool.query<User>(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, department)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [normalizedEmail, password_hash, first_name, last_name, role satisfies UserRole, department ?? null],
    );
    // RETURNING * sur un INSERT réussi renvoie toujours une ligne, mais
    // noUncheckedIndexedAccess ne le sait pas : on lève explicitement plutôt
    // que de masquer le cas par une assertion.
    const user = insert.rows[0];
    if (!user) throw new Error('Insertion utilisateur sans ligne retournée');

    const token = signAuthToken({ id: user.id, email: user.email, role: user.role });
    const body: LoginResponse = { token, user: toPublicUser(user) };
    res.status(201).json(body);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
//   Prend un token encore valide (mais bientôt expiré) et en émet un nouveau.
//   On revérifie que l'utilisateur existe toujours et est actif.
// ---------------------------------------------------------------------------

authRouter.post('/refresh', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

    const { rows } = await pool.query<User>(
      'SELECT * FROM users WHERE id = $1 LIMIT 1',
      [req.user.id],
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User no longer active' });
    }

    const token = signAuthToken({ id: user.id, email: user.email, role: user.role });
    const body: LoginResponse = { token, user: toPublicUser(user) };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
