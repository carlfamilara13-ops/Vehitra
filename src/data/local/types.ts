// Minimal database interface (the subset of expo-sqlite's SQLiteDatabase that we use).
// Keeping it here lets the stores run on a plain Node SQLite in unit tests.
export type SqlParam = string | number | null;

export interface Db {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: SqlParam[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, ...params: SqlParam[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SqlParam[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}
