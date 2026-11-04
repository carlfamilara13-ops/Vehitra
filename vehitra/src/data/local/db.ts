
import * as SQLite from 'expo-sqlite';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import type { Db } from './types';

let dbPromise: Promise<Db> | null = null;
let nativeDb: SQLite.SQLiteDatabase | null = null;

// One shared connection per JS runtime (the UI and the background task each get their own runtime).
export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('vehitra.db');
      nativeDb = db;

      await db.execAsync(
        'PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;'
      );

      await migrate(db, MIGRATIONS);

      // TEMPORARY DIAGNOSTIC: inspect the actual driver_profile columns.
      const columns = await db.getAllAsync<{ name: string }>(
        'PRAGMA table_info(driver_profile)'
      );

      console.log(
        '[Vehitra] driver_profile columns:',
        columns.map((column) => column.name)
      );

      return db;
    })().catch((e) => {
      dbPromise = null;
      nativeDb = null;
      throw e;
    });
  }

  return dbPromise;
}

export function getNativeDb(): SQLite.SQLiteDatabase {
  if (!nativeDb) throw new Error('The local database is not open.');
  return nativeDb;
}

export async function closeAndResetDbConnection(): Promise<void> {
  const current = nativeDb;
  nativeDb = null;
  dbPromise = null;
  if (current) await current.closeAsync();
}
