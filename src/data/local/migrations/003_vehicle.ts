import type { Migration } from '../migrate';

// Local schema v3: vehicle profiles for the garage, local-first.
// The sync columns (client_updated_at, sync_status, server_updated_at, deleted_at) are written now but
// only consumed by the cloud sync step later, so a phone that already has v1/v2 upgrades in place
// without touching its rides.
export const m003: Migration = {
  version: 3,
  sql: `
    CREATE TABLE vehicles (
      id TEXT PRIMARY KEY,
      vehicle_type TEXT NOT NULL,
      brand TEXT,
      model TEXT,
      nickname TEXT,
      model_year INTEGER,
      plate TEXT,
      odometer_km REAL,                             -- user-entered reading; the maintenance ledger arrives later
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      client_updated_at INTEGER NOT NULL,
      deleted_at INTEGER,                           -- soft delete, so removals can sync as tombstones
      sync_status TEXT NOT NULL DEFAULT 'pending',
      server_updated_at TEXT
    );

    CREATE INDEX idx_vehicles_updated ON vehicles (deleted_at, updated_at DESC);
  `,
};
