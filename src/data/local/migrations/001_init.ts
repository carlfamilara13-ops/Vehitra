import type { Migration } from '../migrate';

// Local schema v1: rides, raw points, meta, event log, outbox.
// Mirrors of the cloud tables (vehicles, ledger, parts...) arrive in later steps as new migrations.
export const m001: Migration = {
  version: 1,
  sql: `
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

    CREATE TABLE rides (
      id TEXT PRIMARY KEY,
      user_vehicle_id TEXT,                         -- NULL until the garage exists; the cloud requires a vehicle
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      status TEXT NOT NULL,                         -- recording | finished | recovered
      point_count INTEGER NOT NULL DEFAULT 0,
      distance_m REAL NOT NULL DEFAULT 0,           -- filtered GPS estimate (the number the app uses)
      raw_distance_m REAL NOT NULL DEFAULT 0,       -- unfiltered, diagnostics only
      max_gap_s REAL NOT NULL DEFAULT 0,
      max_delay_ms REAL NOT NULL DEFAULT 0,
      late_batches INTEGER NOT NULL DEFAULT 0,
      untracked_gap_s REAL NOT NULL DEFAULT 0,
      untracked_gap_m REAL NOT NULL DEFAULT 0,      -- straight-line distance across untracked gaps, NOT in distance_m
      max_speed_ms REAL NOT NULL DEFAULT 0,
      last_ts INTEGER,
      last_lat REAL, last_lon REAL,
      last_raw_lat REAL, last_raw_lon REAL,
      duration_s INTEGER,
      avg_speed_ms REAL,
      polyline TEXT,                                -- simplified, encoded route (what syncs to the cloud)
      polyline_tolerance_m REAL,
      needs_review INTEGER NOT NULL DEFAULT 0,
      raw_purged_at INTEGER,                        -- set when raw points were purged (retention policy)
      sync_status TEXT NOT NULL DEFAULT 'pending',  -- pending | synced
      server_updated_at TEXT,
      client_updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_rides_started ON rides (started_at DESC);

    CREATE TABLE points (
      ride_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      lat REAL NOT NULL, lon REAL NOT NULL,
      accuracy REAL, speed REAL, altitude REAL, heading REAL,
      received_at INTEGER NOT NULL,
      PRIMARY KEY (ride_id, seq)
    );

    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      detail TEXT
    );

    -- Idempotent outbox for cloud sync (used from the sync step on).
    CREATE TABLE outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      op TEXT NOT NULL,                             -- insert_ignore | update | rpc
      record_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at INTEGER,
      last_error TEXT,
      status TEXT NOT NULL DEFAULT 'pending'        -- pending | done | failed
    );
  `,
};
