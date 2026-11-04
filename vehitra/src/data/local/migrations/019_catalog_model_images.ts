import type { Migration } from '../migrate';

export const m019: Migration = {
  version: 19,
  sql: `
    ALTER TABLE catalog_models ADD COLUMN image_storage_path TEXT;
    ALTER TABLE catalog_models ADD COLUMN image_local_uri TEXT;
    ALTER TABLE catalog_models ADD COLUMN image_cached_storage_path TEXT;
  `,
};
