import * as SQLite from 'expo-sqlite';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import type { Db } from './types';

let dbPromise: Promise<Db> | null = null;

// One shared connection per JS runtime (the UI and the background task each get their own runtime).
export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('vehitra.db');
      await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
      await migrate(db, MIGRATIONS);
      return db;
    })().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}
