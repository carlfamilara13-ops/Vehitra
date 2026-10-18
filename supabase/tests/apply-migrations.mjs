// One-off helper: apply repo migrations + seed to the DEV Supabase project named in .env.test.
// Usage: node --env-file=.env.test supabase/tests/apply-migrations.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

if (process.env.VEHITRA_DB_ENV !== 'dev') {
  console.error('Refusing: set VEHITRA_DB_ENV=dev to confirm this is a DEV database.');
  process.exit(1);
}
const url = process.env.SUPABASE_DB_URL;
if (!url || url.includes('[YOUR-PASSWORD]')) {
  console.error('Set a real SUPABASE_DB_URL in .env.test first.');
  process.exit(1);
}
const prodHost = process.env.VEHITRA_PROD_DB_HOST;
if (prodHost && url.includes(prodHost)) {
  console.error('Refusing: URL points at the production host.');
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const supabaseDir = path.resolve(here, '..');
const migDir = path.join(supabaseDir, 'migrations');
const steps = [
  ...fs
    .readdirSync(migDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ['migration', path.join(migDir, f)]),
  ['seed', path.join(supabaseDir, 'seed', 'seed.sql')],
];

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  for (const [kind, file] of steps) {
    const sql = fs.readFileSync(file, 'utf8');
    process.stdout.write(`${kind.padEnd(9)} ${path.basename(file)} ... `);
    await client.query(sql);
    console.log('OK');
  }
  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_schema='public' order by table_name",
  );
  console.log('public tables:', rows.map((r) => r.table_name).join(', '));
} finally {
  await client.end();
}
