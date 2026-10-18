import type { Migration } from '../migrate';

// Local schema v8: deadline reminders (registration, driver's licence, etc.) and app settings.
//
// deadlines mirrors supabase deadlines (kinds, date-only due_date, reminder offset whitelist,
// soft delete) minus user_id, which the cloud derives from auth. due_date is a 'YYYY-MM-DD'
// string so a calendar date never shifts with timezone. license/custom need no vehicle;
// vehicle-bound kinds must carry user_vehicle_id (enforced by trigger, matching the cloud check).
//
// app_settings is a single row (id = 1) holding device preferences. units only affects display
// formatting; every stored distance remains kilometres so ledgers and intervals never convert.
export const m008: Migration = {
  version: 8,
  sql: `
    CREATE TABLE deadlines (
      id TEXT PRIMARY KEY,
      user_vehicle_id TEXT,                        -- NULL for licence / custom (user-level)
      kind TEXT NOT NULL CHECK (kind IN ('registration','license','insurance','inspection','custom')),
      label TEXT,
      due_date TEXT NOT NULL,                      -- 'YYYY-MM-DD' (local calendar date, no timezone)
      reminder_offsets TEXT NOT NULL DEFAULT '[30,7,3,0]',  -- JSON int array, same whitelist as cloud
      enabled INTEGER NOT NULL DEFAULT 1,
      deleted_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      client_updated_at INTEGER NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      server_updated_at TEXT
    );

    CREATE INDEX idx_deadlines_due ON deadlines (due_date, kind);
    CREATE INDEX idx_deadlines_vehicle ON deadlines (user_vehicle_id, deleted_at);

    -- Mirrors the cloud check: registration/insurance/inspection must be vehicle-bound;
    -- license and custom may be user-level. Enforced here so a bad insert cannot rely on the UI.
    CREATE TRIGGER deadlines_vehicle_bound
      BEFORE INSERT ON deadlines
      BEGIN
        SELECT CASE
          WHEN NEW.kind IN ('registration','insurance','inspection') AND NEW.user_vehicle_id IS NULL
          THEN RAISE(ABORT, 'deadline kind requires a vehicle')
        END;
      END;

    CREATE TABLE app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      units TEXT NOT NULL DEFAULT 'metric' CHECK (units IN ('metric','imperial')),
      ui_mode TEXT NOT NULL DEFAULT 'standard' CHECK (ui_mode IN ('standard','easy')),
      notifications_enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      client_updated_at INTEGER NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'pending'
    );

    INSERT INTO app_settings (id, created_at, updated_at, client_updated_at)
      VALUES (1, 0, 0, 0);
  `,
};
