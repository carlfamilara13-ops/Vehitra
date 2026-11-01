import type { Migration } from '../migrate';

// Persist the app-level color scheme without altering existing maintenance or user data.
export const m012: Migration = {
  version: 12,
  sql: `
    ALTER TABLE app_settings
      ADD COLUMN appearance TEXT NOT NULL DEFAULT 'dark' CHECK (appearance IN ('dark', 'light'));
  `,
};
