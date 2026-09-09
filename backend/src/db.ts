import { Pool, types } from 'pg';

// Les colonnes DATE (OID 1082) sont converties par défaut en `Date` JS
// interprétée dans le fuseau local, ce qui décale le jour d'une unité selon
// l'offset. On les renvoie telles quelles ('YYYY-MM-DD'), conformément aux
// types déclarés dans src/types.
types.setTypeParser(1082, (value) => value);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined in environment');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('[pg] unexpected pool error', err);
});
