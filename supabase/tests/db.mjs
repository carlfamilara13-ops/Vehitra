// Test database adapter. target 'local' = in-process Postgres (PGlite, no Docker, no cloud).
// target 'cloud' = a DEV Supabase project over a direct Postgres connection (never production).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const supabaseDir = path.resolve(here, '..');

function readSql(...p) {
  return fs.readFileSync(path.join(supabaseDir, ...p), 'utf8');
}

export async function connect(target) {
  if (target === 'cloud') {
    if (process.env.VEHITRA_DB_ENV !== 'dev') {
      throw new Error('Refusing to run: set VEHITRA_DB_ENV=dev to confirm this is a DEV database.');
    }
    const url = process.env.SUPABASE_DB_URL;
    if (!url) throw new Error('SUPABASE_DB_URL is not set (use the DEV project connection string).');
    const prodHost = process.env.VEHITRA_PROD_DB_HOST;
    if (prodHost && url.includes(prodHost)) throw new Error('Refusing to run against the production host.');
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    await client.connect();
    return {
      target,
      exec: async (sql) => { await client.query(sql); },
      query: async (sql, params = []) => {
        const r = await client.query(sql, params);
        return { rows: r.rows, count: r.rowCount ?? 0 };
      },
      close: async () => client.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(readSql('tests', 'pglite', 'auth_stub.sql'));
  const files = fs.readdirSync(path.join(supabaseDir, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) await db.exec(readSql('migrations', f));
  await db.exec(readSql('seed', 'seed.sql'));
  return {
    target,
    exec: async (sql) => { await db.exec(sql); },
    query: async (sql, params = []) => {
      const r = await db.query(sql, params);
      return { rows: r.rows, count: r.affectedRows ?? r.rows.length };
    },
    close: async () => db.close(),
  };
}
