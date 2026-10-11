// TEST ONLY: a Db backed by Node's built-in SQLite (Node 22.5+), so the stores can be tested without a phone.
// Never imported by app code.
import type { Db, SqlParam } from './types';

type NodeSqlite = typeof import('node:sqlite');

export function hasNodeSqlite(): boolean {
  try {
    return !!process.getBuiltinModule?.('node:sqlite');
  } catch {
    return false;
  }
}

export function createNodeSqliteDb(): Db {
  const sqlite = process.getBuiltinModule('node:sqlite') as NodeSqlite;
  const d = new sqlite.DatabaseSync(':memory:');
  const bind = (p: SqlParam[]) => p as (string | number | null)[];
  return {
    execAsync: async (sql) => {
      d.exec(sql);
    },
    runAsync: async (sql, ...p) => d.prepare(sql).run(...bind(p)),
    getFirstAsync: async <T>(sql: string, ...p: SqlParam[]) => (d.prepare(sql).get(...bind(p)) as T | undefined) ?? null,
    getAllAsync: async <T>(sql: string, ...p: SqlParam[]) => d.prepare(sql).all(...bind(p)) as T[],
    withTransactionAsync: async (task) => {
      d.exec('BEGIN');
      try {
        await task();
        d.exec('COMMIT');
      } catch (e) {
        d.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
