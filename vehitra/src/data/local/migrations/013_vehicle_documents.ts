import type { Migration } from '../migrate';

// Local schema v13: one OR/CR photo record per vehicle and document kind.
//
// Device-only, like the driver profile: the files live in the app's document directory and are
// never uploaded. The unique pair prevents duplicate records, so saving a photo replaces that
// vehicle's existing OR or CR without touching the other. Existing vehicles, rides, maintenance,
// reminders and driver-profile data are untouched.
export const m013: Migration = {
  version: 13,
  sql: `
    CREATE TABLE vehicle_documents (
      id TEXT PRIMARY KEY,
      user_vehicle_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('or', 'cr')),
      image_uri TEXT NOT NULL,                       -- stable file:// URI in app documents
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (user_vehicle_id, kind)
    );
  `,
};
