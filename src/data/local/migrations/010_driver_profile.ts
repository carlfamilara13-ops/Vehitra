import type { Migration } from '../migrate';

// Local schema v10: the optional personal driver profile shown on the dashboard card.
//
// This is a single-row, device-only record. It intentionally has no sync columns and is never
// sent to the cloud: portrait files live in the app's document directory and the details can
// include an address. The table is additive, so existing rides, vehicles, maintenance rows and
// document reminders are untouched.
export const m010: Migration = {
  version: 10,
  sql: `
    CREATE TABLE driver_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      full_name TEXT NOT NULL,
      nationality TEXT,
      sex TEXT,
      date_of_birth TEXT,                            -- 'YYYY-MM-DD', optional
      weight_kg REAL,
      height_m REAL,
      address TEXT,
      license_number TEXT,
      expiration_date TEXT,                          -- 'YYYY-MM-DD', optional
      agency_code TEXT,
      blood_type TEXT,
      eye_color TEXT,
      license_codes TEXT,
      conditions TEXT,
      portrait_uri TEXT,                             -- stable file:// URI in app documents
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `,
};
