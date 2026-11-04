import type { Migration } from '../migrate';

// Published catalog packs already carry interval_days in Supabase. Store that field locally so
// offline maintenance reminders can use the same versioned rule snapshot.
export const m017: Migration = {
  version: 17,
  sql: `ALTER TABLE catalog_model_components ADD COLUMN interval_days INTEGER CHECK (interval_days IS NULL OR interval_days > 0);`,
};
