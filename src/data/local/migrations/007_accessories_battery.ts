import type { Migration } from '../migrate';

// Local schema v7: per-vehicle accessories and battery idle state.
//
// accessories are editable descriptive records (unlike the append-only maintenance tables):
// they hold no interval or usage numbers, so correcting them cannot corrupt maintenance. They
// soft-delete (deleted_at) so removals stay honest history and can later sync as tombstones.
//
// battery_state tracks the last time the user confirmed the battery was in use/active. It is a
// user-entered timestamp only — the app cannot measure battery health — and idle time is always
// derived from this value against the current clock, never stored as a computed counter.
export const m007: Migration = {
  version: 7,
  sql: `
    CREATE TABLE accessories (
      id TEXT PRIMARY KEY,
      user_vehicle_id TEXT NOT NULL,
      name TEXT NOT NULL,
      brand TEXT,
      model TEXT,
      installed_at INTEGER,                        -- ms epoch; nullable (unknown install date)
      notes TEXT,
      deleted_at INTEGER,                          -- soft delete; keeps history and sync tombstones
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      client_updated_at INTEGER NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      server_updated_at TEXT
    );

    CREATE INDEX idx_accessories_vehicle ON accessories (user_vehicle_id, deleted_at, name);

    CREATE TABLE battery_state (
      user_vehicle_id TEXT PRIMARY KEY,            -- one idle-tracking row per vehicle
      last_active_at INTEGER NOT NULL,             -- ms epoch; the last confirmed in-use date
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      client_updated_at INTEGER NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      server_updated_at TEXT
    );
  `,
};
