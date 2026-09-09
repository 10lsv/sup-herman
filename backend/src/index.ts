import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool } from './db';
import { authRouter } from './routes/auth';
import { expensesRouter } from './routes/expenses';
import { usersRouter } from './routes/users';
import { leavesRouter } from './routes/leaves';

const PORT = Number(process.env.PORT ?? 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

// ---------------------------------------------------------------------------
// Schema bootstrap : si la table `users` n'existe pas, on joue schema.sql
// ---------------------------------------------------------------------------

async function ensureSchema(): Promise<void> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass('public.users') IS NOT NULL AS exists`,
  );
  if (rows[0]?.exists) {
    console.log('[schema] tables already present, skipping seed');
  } else {
    const schemaPath = path.resolve(__dirname, 'database/schema.sql');
    console.log(`[schema] applying ${schemaPath}`);
    const sql = await readFile(schemaPath, 'utf8');
    await pool.query(sql);
    console.log('[schema] applied successfully');
  }

  await runMigrations();
}

/**
 * Rejoue les migrations à chaque démarrage : elles sont écrites idempotentes
 * (IF NOT EXISTS / DROP NOT NULL), ce qui évite d'avoir à tenir une table de
 * versions pour un projet de cette taille. Ordre alphabétique du nom de
 * fichier — d'où le préfixe numérique.
 */
async function runMigrations(): Promise<void> {
  const dir = path.resolve(__dirname, 'database/migrations');
  const entries = await readdir(dir).catch(() => [] as string[]);
  const files = entries.filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = await readFile(path.join(dir, file), 'utf8');
    await pool.query(sql);
    console.log(`[schema] migration ${file} applied`);
  }
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.use('/api/auth', authRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/users', usersRouter);
app.use('/api/leaves', leavesRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Error handler global — signature à 4 args obligatoire pour qu'Express le reconnaisse.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[error]', err);
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({ error: message });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await pool.query('SELECT 1');
  console.log('[pg] connected');
  await ensureSchema();

  app.listen(PORT, () => {
    console.log(`[http] listening on http://localhost:${PORT}`);
    console.log(`[http] CORS origin: ${CORS_ORIGIN}`);
  });
}

main().catch((err) => {
  console.error('[fatal] startup failed', err);
  process.exit(1);
});

async function shutdown(signal: string) {
  console.log(`[shutdown] received ${signal}, closing pool`);
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
