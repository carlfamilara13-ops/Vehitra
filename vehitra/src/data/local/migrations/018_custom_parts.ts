import type { Migration } from '../migrate';

// Vehicle-owned component definitions let a user track parts that are missing from the shared catalog.
export const m018: Migration = {
  version: 18,
  sql: `
    CREATE TABLE custom_parts (
      id TEXT PRIMARY KEY,
      user_vehicle_id TEXT NOT NULL,
      component_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      client_updated_at INTEGER NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      server_updated_at TEXT,
      UNIQUE (user_vehicle_id, name)
    );
    CREATE INDEX idx_custom_parts_vehicle ON custom_parts (user_vehicle_id, category, name);
  `,
};
