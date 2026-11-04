import type { Migration } from '../migrate';

// Local notification controls and durable state for movement and stationary ride reminders.
export const m016: Migration = {
  version: 16,
  sql: `
    ALTER TABLE app_settings ADD COLUMN movement_reminders_enabled INTEGER NOT NULL DEFAULT 0 CHECK (movement_reminders_enabled IN (0, 1));
    ALTER TABLE app_settings ADD COLUMN stationary_ride_reminders_enabled INTEGER NOT NULL DEFAULT 1 CHECK (stationary_ride_reminders_enabled IN (0, 1));

    CREATE TABLE movement_reminder_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      moving_since INTEGER,
      last_fix_at INTEGER,
      last_notice_at INTEGER,
      notification_id TEXT,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO movement_reminder_state (id, updated_at) VALUES (1, 0);

    CREATE TABLE stationary_ride_reminders (
      ride_id TEXT PRIMARY KEY,
      stationary_since INTEGER,
      last_fix_at INTEGER,
      last_lat REAL,
      last_lon REAL,
      sample_count INTEGER NOT NULL DEFAULT 0,
      snooze_until INTEGER,
      suppressed INTEGER NOT NULL DEFAULT 0 CHECK (suppressed IN (0, 1)),
      reminded_at INTEGER,
      notification_id TEXT,
      response_id TEXT,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `,
};
