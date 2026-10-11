import type { Db } from './types';

export type Migration = { version: number; sql: string };

// Applies pending migrations in order. The schema version lives in PRAGMA user_version.
export async function migrate(db: Db, migrations: Migration[]): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let current = row?.user_version ?? 0;
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  for (const m of ordered) {
    if (m.version <= current) continue;
    await db.execAsync('BEGIN');
    try {
      await db.execAsync(m.sql);
      await db.execAsync(`PRAGMA user_version = ${m.version}`);
      await db.execAsync('COMMIT');
      current = m.version;
    } catch (e) {
      await db.execAsync('ROLLBACK');
      throw e;
    }
  }
  return current;
}
