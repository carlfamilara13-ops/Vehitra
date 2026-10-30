import type { Migration } from '../migrate';

// Local-only reminder categories. Existing installations keep every current reminder enabled.
export const m011: Migration = {
  version: 11,
  sql: `
    ALTER TABLE app_settings ADD COLUMN maintenance_upcoming_enabled INTEGER NOT NULL DEFAULT 1 CHECK (maintenance_upcoming_enabled IN (0, 1));
    ALTER TABLE app_settings ADD COLUMN maintenance_overdue_enabled INTEGER NOT NULL DEFAULT 1 CHECK (maintenance_overdue_enabled IN (0, 1));
    ALTER TABLE app_settings ADD COLUMN document_reminders_enabled INTEGER NOT NULL DEFAULT 1 CHECK (document_reminders_enabled IN (0, 1));
    ALTER TABLE app_settings ADD COLUMN battery_reminders_enabled INTEGER NOT NULL DEFAULT 1 CHECK (battery_reminders_enabled IN (0, 1));
  `,
};
