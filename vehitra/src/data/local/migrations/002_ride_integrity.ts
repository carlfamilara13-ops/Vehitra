import type { Migration } from '../migrate';

// Local schema v2: persisted recovery state, usable-fix tracking, tracked time, route segments, integrity flag.
// Separate migration (not an edit of 001) so a phone that already has the v1 database upgrades in place.
export const m002: Migration = {
  version: 2,
  sql: `
    ALTER TABLE rides ADD COLUMN first_usable_ts INTEGER;
    ALTER TABLE rides ADD COLUMN last_usable_ts INTEGER;
    ALTER TABLE rides ADD COLUMN last_usable_lat REAL;
    ALTER TABLE rides ADD COLUMN last_usable_lon REAL;
    ALTER TABLE rides ADD COLUMN tracked_s REAL;                        -- time covered by usable fixes (see summary.ts)
    ALTER TABLE rides ADD COLUMN route_segments TEXT;                   -- JSON: separate route pieces, never joined across gaps
    ALTER TABLE rides ADD COLUMN interrupted INTEGER NOT NULL DEFAULT 0;      -- persisted: the app was closed/killed mid-ride
    ALTER TABLE rides ADD COLUMN interruption_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE rides ADD COLUMN interruption_s REAL NOT NULL DEFAULT 0;
    ALTER TABLE rides ADD COLUMN recovery_state TEXT NOT NULL DEFAULT 'none';  -- none | verifying | confirmed | failed
    ALTER TABLE rides ADD COLUMN integrity_issue TEXT;                  -- set when stored data had a problem; always needs_review
  `,
};
