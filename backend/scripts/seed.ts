// ---------------------------------------------------------------------------
// Seed — crée les comptes de démarrage (manager + comptes de test).
// Idempotent : un email déjà présent est ignoré, jamais écrasé.
//
//   npm run seed
// ---------------------------------------------------------------------------

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db';
import type { UserRole } from '../src/types';

const BCRYPT_COST = 12;

interface SeedUser {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  department: string | null;
  /** Rattacher ce compte au manager principal (manager_id). */
  reports_to_manager?: boolean;
}

// Le manager doit rester en tête : les autres comptes s'y rattachent.
const SEED_USERS: SeedUser[] = [
  {
    email: 'manager@supherman.com',
    password: 'Suph3rm4n!',
    first_name: 'Herman',
    last_name: 'Sup',
    role: 'manager',
    department: 'Direction',
  },
  {
    email: 'employee@supherman.com',
    password: 'Test123!',
    first_name: 'Émile',
    last_name: 'Employé',
    role: 'employee',
    department: 'Opérations',
    reports_to_manager: true,
  },
  {
    email: 'hr@supherman.com',
    password: 'Test123!',
    first_name: 'Hélène',
    last_name: 'Ressource',
    role: 'hr',
    department: 'Ressources Humaines',
    reports_to_manager: true,
  },
  {
    email: 'accounting@supherman.com',
    password: 'Test123!',
    first_name: 'Camille',
    last_name: 'Compta',
    role: 'accounting',
    department: 'Comptabilité',
    reports_to_manager: true,
  },
];

// ---------------------------------------------------------------------------

async function findUserIdByEmail(email: string): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(
    'SELECT id FROM users WHERE email = $1 LIMIT 1',
    [email],
  );
  return rows[0]?.id ?? null;
}

async function seed(): Promise<void> {
  await pool.query('SELECT 1');
  console.log('[pg] connected');

  // La table doit exister : elle est créée au premier démarrage du serveur.
  const { rows: tableRows } = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass('public.users') IS NOT NULL AS exists`,
  );
  if (!tableRows[0]?.exists) {
    throw new Error(
      "Table `users` introuvable — lancez d'abord `npm run dev` pour appliquer src/database/schema.sql",
    );
  }

  let created = 0;
  let skipped = 0;
  let managerId: number | null = null;

  for (const user of SEED_USERS) {
    const email = user.email.toLowerCase();

    const existingId = await findUserIdByEmail(email);
    if (existingId !== null) {
      skipped += 1;
      console.log(`⏭️  ${email} — déjà présent (id=${existingId}), skip`);
      if (user.role === 'manager' && managerId === null) managerId = existingId;
      continue;
    }

    const password_hash = await bcrypt.hash(user.password, BCRYPT_COST);
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, manager_id, department)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        email,
        password_hash,
        user.first_name,
        user.last_name,
        user.role,
        user.reports_to_manager ? managerId : null,
        user.department,
      ],
    );

    const id = rows[0]?.id;
    created += 1;
    console.log(`✅ ${email} — créé (id=${id}, role=${user.role})`);
    if (user.role === 'manager' && managerId === null) managerId = id ?? null;
  }

  console.log(`\n✅ Seed complete — ${created} users created` + (skipped > 0 ? ` (${skipped} skipped)` : ''));
}

seed()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[fatal] seed failed', err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
