import type { Migration } from '../migrate';

// Local schema v14: optional photo displayed on the back of the driver's license card.
// Kept separate from portrait_uri, which is used for the front-side portrait.
export const m014: Migration = {
  version: 14,
  sql: `
    ALTER TABLE driver_profile
    ADD COLUMN back_photo_uri TEXT;
  `,
};