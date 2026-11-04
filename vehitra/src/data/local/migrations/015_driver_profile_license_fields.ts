import type { Migration } from '../migrate';

// Local schema v15 records the driver's license fields. They were already present in the
// original v10 table definition, so this version marker is intentionally a no-op; adding them
// again here would fail every fresh install with duplicate-column errors.
export const m015: Migration = {
  version: 15,
  sql: `SELECT 1;`,
};
