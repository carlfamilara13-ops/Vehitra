import type { Migration } from '../migrate';

// Local schema v9: vehicle catalog (brands, models, per-model resource packs), reminder
// scheduling state, and catalog linkage columns on vehicles.
//
// The catalog is the local mirror of the shared cloud catalog (supabase catalog tables). Rows
// are keyed by the SAME stable slugs the cloud seed uses, so a later sync can map by slug
// without inventing identifiers. Only the small brand/model index is bundled; the per-model
// resource pack (catalog_model_components) holds maintenance rule candidates with explicit
// provenance — every bundled row is draft/estimate data, never a manufacturer specification.
// New models arrive either via a remote pack download (one model at a time) or a catalog sync;
// UI always reads from these tables, so the catalog can grow without code changes.
//
// reminder_schedule is the idempotency ledger for scheduled local notifications: one row per
// deterministic reminder key, holding the platform notification id so a reschedule cancels the
// previous notification instead of stacking duplicates.
export const m009: Migration = {
  version: 9,
  sql: `
    CREATE TABLE catalog_brands (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 100
    );

    CREATE TABLE catalog_models (
      slug TEXT PRIMARY KEY,
      brand_slug TEXT,                             -- NULL exactly when is_generic = 1
      vehicle_type TEXT NOT NULL,
      name TEXT NOT NULL,
      is_generic INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 100,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TRIGGER catalog_models_generic_brand
      BEFORE INSERT ON catalog_models
      BEGIN
        SELECT CASE
          WHEN (NEW.is_generic = 1) <> (NEW.brand_slug IS NULL)
          THEN RAISE(ABORT, 'generic models have no brand; branded models require a brand')
        END;
      END;

    CREATE INDEX idx_catalog_models_type ON catalog_models (vehicle_type, brand_slug, sort_order);

    CREATE TABLE catalog_model_components (
      model_slug TEXT NOT NULL,
      component_code TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      interval_km INTEGER,                         -- NULL = not set, pending review
      warn_remaining_pct REAL NOT NULL DEFAULT 25,
      review_status TEXT NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft','reviewed')),
      source_note TEXT,
      provenance TEXT NOT NULL DEFAULT 'bundled',  -- bundled | remote | admin
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (model_slug, component_code, version),
      CHECK (interval_km IS NULL OR interval_km > 0),
      CHECK (warn_remaining_pct >= 0 AND warn_remaining_pct <= 100)
    );

    CREATE TABLE reminder_schedule (
      reminder_key TEXT PRIMARY KEY,               -- deterministic per (kind, subject, fire day)
      kind TEXT NOT NULL,                          -- deadline | battery_idle | maintenance
      user_vehicle_id TEXT,
      fire_at INTEGER NOT NULL,                    -- ms epoch when the reminder becomes relevant
      notification_id TEXT,                        -- platform id of the scheduled notification
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sent','cancelled')),
      updated_at INTEGER NOT NULL
    );

    ALTER TABLE vehicles ADD COLUMN catalog_model_slug TEXT;
    ALTER TABLE vehicles ADD COLUMN catalog_version INTEGER;

    -- Bundled seed, aligned with supabase/seed/seed.sql slugs so remote sync can match by slug.
    -- Every maintenance value is DRAFT (project-spec estimate), never manufacturer data.
    INSERT INTO catalog_brands (slug, name, sort_order) VALUES
      ('honda','Honda',10),
      ('yamaha','Yamaha',20),
      ('suzuki','Suzuki',30),
      ('kawasaki','Kawasaki',40),
      ('toyota','Toyota',50);

    INSERT INTO catalog_models (slug, brand_slug, vehicle_type, name, is_generic, sort_order) VALUES
      ('honda-click-125','honda','motorcycle','Click 125',0,100),
      ('honda-beat','honda','motorcycle','Beat',0,100),
      ('honda-tmx-125','honda','motorcycle','TMX 125',0,100),
      ('honda-xrm-125','honda','motorcycle','XRM 125',0,100),
      ('honda-adv-160','honda','motorcycle','ADV 160',0,100),
      ('yamaha-sniper-155','yamaha','motorcycle','Sniper 155',0,99),
      ('yamaha-mio-i-125','yamaha','motorcycle','Mio i 125',0,100),
      ('yamaha-nmax','yamaha','motorcycle','NMAX',0,100),
      ('yamaha-aerox','yamaha','motorcycle','Aerox',0,100),
      ('yamaha-mt-15','yamaha','motorcycle','MT-15',0,100),
      ('suzuki-raider-r150','suzuki','motorcycle','Raider R150',0,100),
      ('kawasaki-ninja-400','kawasaki','motorcycle','Ninja 400',0,100),
      ('toyota-vios','toyota','car','Vios',0,100),
      ('toyota-wigo','toyota','car','Wigo',0,100),
      ('generic-motorcycle',NULL,'motorcycle','Other motorcycle',1,900),
      ('generic-car',NULL,'car','Other car',1,900),
      ('generic-bicycle',NULL,'bicycle','Other bicycle',1,900),
      ('generic-truck',NULL,'truck','Other truck',1,900),
      ('generic-bus',NULL,'bus','Other bus',1,900),
      ('generic-van',NULL,'van','Other van',1,900),
      ('generic-other',NULL,'other','Other vehicle',1,900);

    -- The only interval that exists in this project today: motorcycle engine oil at 1,500 km,
    -- labelled draft (project-spec estimate). Every other component has no catalog interval yet.
    INSERT INTO catalog_model_components
      (model_slug, component_code, version, interval_km, warn_remaining_pct, review_status, source_note, provenance, updated_at)
    SELECT m.slug, 'engine_oil', 1, 1500, 25, 'draft',
           'Project spec default (1,500 km). Unverified — not a manufacturer recommendation.', 'bundled', 0
    FROM catalog_models m WHERE m.vehicle_type = 'motorcycle';
  `,
};
