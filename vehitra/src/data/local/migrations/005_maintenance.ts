import type { Migration } from '../migrate';

// Local schema v5: the maintenance data layer, local-first.
//
// Mirrors the SEMANTICS of the cloud tables in supabase/migrations/20261010000300_user_tables.sql
// without pulling in the cloud's uuid catalog (that arrives with catalog+sync later):
//   - components are stored by catalog CODE (component_code), not by component_definitions uuid;
//   - flags is a JSON TEXT array (SQLite has no array type); amounts are REAL kilometres.
//
// Append-only rules (see docs/SECURITY.md): mileage_entries and service_events can only be INSERTed
// (corrections are new `void` rows); part_installs are close-only (an open install gains removed_at,
// then is frozen); component_overrides are the only user-editable/deletable rows. The immutability is
// enforced with SQLite triggers here (the cloud uses the same idea in a trigger), so no code path can
// rewrite history by accident.
//
// FK/ownership: local tables declare no FOREIGN KEYs (the app has never enabled PRAGMA foreign_keys),
// so ownership and vehicle existence are validated in the repository layer, matching the existing
// local stores.
export const m005: Migration = {
  version: 5,
  sql: `
    -- Applied-distance ledger: the source of truth for maintenance usage (see ARCHITECTURE_NOTES §5).
    -- applied_km counts toward maintenance; it is never an odometer difference. Ordering for replay and
    -- usage is (client_created_at, id).
    CREATE TABLE mileage_entries (
      id TEXT PRIMARY KEY,
      user_vehicle_id TEXT NOT NULL,
      kind TEXT NOT NULL,                            -- initial | ride | dashboard_reading | adjustment | odometer_replacement | void
      source TEXT NOT NULL,                          -- gps | dashboard_reading | manual_adjustment | estimated | initial
      ride_id TEXT,                                  -- set for kind='ride'; also the idempotency key for a finished ride
      gps_distance_m REAL,                           -- raw GPS distance for the entry (diagnostics / provenance)
      applied_km REAL NOT NULL DEFAULT 0 CHECK (applied_km >= 0),  -- kilometres counted toward maintenance
      odo_reading_after REAL,                        -- displayed odometer after this entry; NULL only on a void
      odo_offset_delta REAL NOT NULL DEFAULT 0,      -- calibration/rollover adjustment (unused yet; stores now)
      suggested_km REAL,                             -- what the app suggested from a reading (unused yet; stores now)
      flags TEXT NOT NULL DEFAULT '[]',              -- JSON array of flags
      voids_entry_id TEXT,                           -- set on a void row: the entry it cancels
      note TEXT,
      client_created_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'pending',   -- pending | synced
      server_updated_at TEXT
    );
    CREATE INDEX idx_mileage_vehicle ON mileage_entries (user_vehicle_id, client_created_at, id);
    CREATE INDEX idx_mileage_voids ON mileage_entries (voids_entry_id);

    -- Service/inspection log for one component. Insert-only; a correction is a new row with
    -- action='void' and voids_event_id pointing at the row it cancels.
    CREATE TABLE service_events (
      id TEXT PRIMARY KEY,
      user_vehicle_id TEXT NOT NULL,
      component_code TEXT NOT NULL,                  -- component_definitions.code
      action TEXT NOT NULL,                          -- replace | clean | lubricate | inspect | service | baseline | void
      performed_at INTEGER NOT NULL,
      odo_at REAL,                                   -- displayed odometer at service time (informational)
      estimated INTEGER NOT NULL DEFAULT 0,          -- 1 when the event is an estimate/baseline, not observed
      voids_event_id TEXT,
      notes TEXT,
      client_created_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      server_updated_at TEXT
    );
    CREATE INDEX idx_service_vehicle_component ON service_events (user_vehicle_id, component_code, performed_at);

    -- Installed part for one component. Close-only: an open row (removed_at IS NULL) may be closed once,
    -- after which it is frozen. At most one open install per (vehicle, component).
    CREATE TABLE part_installs (
      id TEXT PRIMARY KEY,
      user_vehicle_id TEXT NOT NULL,
      component_code TEXT NOT NULL,
      brand TEXT,
      model TEXT,
      installed_at INTEGER NOT NULL,
      install_odo REAL,
      removed_at INTEGER,                            -- NULL = currently installed
      removal_odo REAL,
      notes TEXT,
      close_notes TEXT,
      client_updated_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      server_updated_at TEXT
    );
    CREATE UNIQUE INDEX idx_part_installs_one_open
      ON part_installs (user_vehicle_id, component_code) WHERE removed_at IS NULL;
    CREATE INDEX idx_part_installs_vehicle ON part_installs (user_vehicle_id, component_code, installed_at);

    -- Per-vehicle component overrides. The only maintenance table the user can edit and delete.
    CREATE TABLE component_overrides (
      id TEXT PRIMARY KEY,
      user_vehicle_id TEXT NOT NULL,
      component_code TEXT NOT NULL,
      interval_km REAL,                              -- NULL = no custom distance interval
      interval_days INTEGER,                         -- stored now; time-based evaluation is a later step
      enabled INTEGER NOT NULL DEFAULT 1,
      client_updated_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      server_updated_at TEXT,
      UNIQUE (user_vehicle_id, component_code)
    );

    -- Append-only enforcement (BEFORE triggers, so an UPDATE/DELETE aborts the whole statement).
    CREATE TRIGGER mileage_entries_no_update BEFORE UPDATE ON mileage_entries
      BEGIN SELECT RAISE(ABORT, 'mileage_entries is insert-only'); END;
    CREATE TRIGGER mileage_entries_no_delete BEFORE DELETE ON mileage_entries
      BEGIN SELECT RAISE(ABORT, 'mileage_entries is insert-only'); END;

    CREATE TRIGGER service_events_no_update BEFORE UPDATE ON service_events
      BEGIN SELECT RAISE(ABORT, 'service_events is insert-only'); END;
    CREATE TRIGGER service_events_no_delete BEFORE DELETE ON service_events
      BEGIN SELECT RAISE(ABORT, 'service_events is insert-only'); END;

    CREATE TRIGGER part_installs_no_delete BEFORE DELETE ON part_installs
      BEGIN SELECT RAISE(ABORT, 'part_installs are close-only'); END;
    CREATE TRIGGER part_installs_closed_immutable BEFORE UPDATE ON part_installs
      WHEN OLD.removed_at IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'a closed part install is immutable'); END;
  `,
};
