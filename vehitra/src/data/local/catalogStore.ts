
import {
  validateCatalogPack,
  type CatalogPackRow,
  type CatalogProvenance,
  type CatalogReviewStatus,
} from '../../domain/catalog/packs';
import {
  validateCatalogIndex,
  type CatalogIndexBrand,
  type CatalogIndexModel,
} from '../../domain/catalog/index';
import { serialize } from './serialize';
import type { Db } from './types';
import { MaintenanceValidationError } from './maintenanceErrors';

// Local vehicle catalog: brand/model index plus per-model, versioned resource packs.
// Older pack versions are retained so vehicles can continue using their assigned version.

export type CatalogBrandRow = {
  slug: string;
  name: string;
  sort_order: number;
};

export type CatalogModelRow = {
  slug: string;
  brand_slug: string | null;
  vehicle_type: string;
  name: string;
  is_generic: number;
  sort_order: number;
  active: number;
  image_storage_path: string | null;
  image_local_uri: string | null;
  image_cached_storage_path: string | null;
};

type CatalogComponentRow = {
  model_slug: string;
  component_code: string;
  version: number;
  interval_km: number | null;
  interval_days: number | null;
  warn_remaining_pct: number;
  review_status: string;
  source_note: string | null;
  provenance: string;
  updated_at: number;
};

// Brands that have at least one active model of the given vehicle type, soonest first.
export function listCatalogBrands(db: Db, vehicleType: string): Promise<CatalogBrandRow[]> {
  return db.getAllAsync<CatalogBrandRow>(
    `SELECT DISTINCT b.slug, b.name, b.sort_order
       FROM catalog_brands b
       JOIN catalog_models m ON m.brand_slug = b.slug
      WHERE m.vehicle_type = ? AND m.active = 1
      ORDER BY b.sort_order ASC, b.name ASC`,
    vehicleType,
  );
}

export function listCatalogModels(
  db: Db,
  vehicleType: string,
  brandSlug: string | null,
): Promise<CatalogModelRow[]> {
  if (brandSlug == null) {
    return db.getAllAsync<CatalogModelRow>(
      `SELECT * FROM catalog_models
        WHERE vehicle_type = ? AND active = 1 AND brand_slug IS NULL
        ORDER BY sort_order ASC, name ASC`,
      vehicleType,
    );
  }

  return db.getAllAsync<CatalogModelRow>(
    `SELECT * FROM catalog_models
      WHERE vehicle_type = ? AND active = 1 AND brand_slug = ?
      ORDER BY sort_order ASC, name ASC`,
    vehicleType,
    brandSlug,
  );
}

export async function getCatalogModel(db: Db, slug: string): Promise<CatalogModelRow | null> {
  return db.getFirstAsync<CatalogModelRow>(
    'SELECT * FROM catalog_models WHERE slug = ?',
    slug,
  );
}

// True when the type has generic ("Other …") models.
export async function hasGenericModels(db: Db, vehicleType: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n
       FROM catalog_models
      WHERE vehicle_type = ?
        AND brand_slug IS NULL
        AND active = 1`,
    vehicleType,
  );

  return (row?.n ?? 0) > 0;
}

export async function replaceCatalogIndex(
  db: Db,
  brands: readonly CatalogIndexBrand[],
  models: readonly CatalogIndexModel[],
): Promise<{ brands: number; models: number }> {
  const errors = validateCatalogIndex(brands, models);
  if (errors.length) throw new MaintenanceValidationError(errors);

  return serialize(async () => {
    await db.withTransactionAsync(async () => {
      for (const brand of brands) {
        await db.runAsync(
          `INSERT INTO catalog_brands (slug, name)
           VALUES (?, ?)
           ON CONFLICT (slug) DO UPDATE SET name = excluded.name`,
          brand.slug,
          brand.name,
        );
      }

      await db.runAsync('UPDATE catalog_models SET active = 0');

      for (const model of models) {
        await db.runAsync(
          `INSERT INTO catalog_models
             (slug, brand_slug, vehicle_type, name, is_generic, sort_order, active, image_storage_path)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT (slug) DO UPDATE SET
             brand_slug = excluded.brand_slug,
             vehicle_type = excluded.vehicle_type,
             name = excluded.name,
             is_generic = excluded.is_generic,
             image_local_uri = CASE
               WHEN catalog_models.image_storage_path = excluded.image_storage_path
               THEN catalog_models.image_local_uri ELSE NULL END,
             image_cached_storage_path = CASE
               WHEN catalog_models.image_storage_path = excluded.image_storage_path
               THEN catalog_models.image_cached_storage_path ELSE NULL END,
             image_storage_path = excluded.image_storage_path,
             sort_order = excluded.sort_order,
             active = 1`,
          model.slug,
          model.brandSlug,
          model.vehicleType,
          model.name,
          model.isGeneric ? 1 : 0,
          model.sortOrder,
          model.imageStoragePath,
        );
      }
    });

    return { brands: brands.length, models: models.length };
  });
}

export async function getCatalogModelImage(
  db: Db,
  modelSlug: string,
): Promise<{
  storagePath: string | null;
  localUri: string | null;
}> {
  const row = await db.getFirstAsync<{
    image_storage_path: string | null;
    image_local_uri: string | null;
  }>(
    'SELECT image_storage_path, image_local_uri FROM catalog_models WHERE slug = ?',
    modelSlug,
  );

  return {
    storagePath: row?.image_storage_path ?? null,
    localUri: row?.image_local_uri ?? null,
  };
}

export async function saveCatalogModelImage(
  db: Db,
  modelSlug: string,
  storagePath: string,
  localUri: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE catalog_models
        SET image_local_uri = ?, image_cached_storage_path = ?
      WHERE slug = ? AND image_storage_path = ?`,
    localUri,
    storagePath,
    modelSlug,
    storagePath,
  );
}

export async function setCatalogModelImageStoragePath(
  db: Db,
  modelSlug: string,
  storagePath: string | null,
): Promise<void> {
  await db.runAsync(
    `UPDATE catalog_models SET
       image_local_uri = CASE
         WHEN image_storage_path = ? THEN image_local_uri ELSE NULL END,
       image_cached_storage_path = CASE
         WHEN image_storage_path = ? THEN image_cached_storage_path ELSE NULL END,
       image_storage_path = ?
     WHERE slug = ?`,
    storagePath,
    storagePath,
    storagePath,
    modelSlug,
  );
}

const toPackRow = (r: CatalogComponentRow): CatalogPackRow => ({
  modelSlug: r.model_slug,
  componentCode: r.component_code,
  version: r.version,
  intervalKm: r.interval_km,
  intervalDays: r.interval_days,
  warnRemainingPct: r.warn_remaining_pct,
  reviewStatus: r.review_status as CatalogReviewStatus,
  sourceNote: r.source_note,
  provenance: r.provenance as CatalogProvenance,
});

/**
 * Get a model's resource pack.
 *
 * When version is provided, only that exact version is returned.
 * When omitted, the latest stored version is returned.
 *
 * This allows existing catalog-library callers to keep using the latest
 * version while vehicle maintenance uses the version assigned to that vehicle.
 */
export async function getModelPack(
  db: Db,
  modelSlug: string,
  version?: number,
): Promise<CatalogPackRow[]> {
  let rows: CatalogComponentRow[];

  if (version != null) {
    rows = await db.getAllAsync<CatalogComponentRow>(
      `SELECT *
         FROM catalog_model_components
        WHERE model_slug = ?
          AND version = ?
        ORDER BY component_code ASC`,
      modelSlug,
      version,
    );
  } else {
    rows = await db.getAllAsync<CatalogComponentRow>(
      `SELECT *
         FROM catalog_model_components
        WHERE model_slug = ?
          AND version = (
            SELECT MAX(version)
              FROM catalog_model_components
             WHERE model_slug = ?
          )
        ORDER BY component_code ASC`,
      modelSlug,
      modelSlug,
    );
  }

  return rows.map(toPackRow);
}

/**
 * Replace one model/version pack with validated rows.
 *
 * Previous versions are deliberately retained because existing vehicles
 * may still be assigned to them.
 */
export function replaceModelPack(
  db: Db,
  rows: readonly CatalogPackRow[],
  now = Date.now(),
): Promise<void> {
  return serialize(async () => {
    const errors = validateCatalogPack(rows);
    if (errors.length) throw new MaintenanceValidationError(errors);

    const firstRow = rows[0];
    if (!firstRow) return;

    const modelSlug = firstRow.modelSlug;
    const version = firstRow.version;

    if (!rows.every((row) => row.modelSlug === modelSlug)) {
      throw new MaintenanceValidationError([
        'A pack download must cover exactly one model.',
      ]);
    }

    if (!rows.every((row) => row.version === version)) {
      throw new MaintenanceValidationError([
        'A pack download must cover exactly one version.',
      ]);
    }

    await db.withTransactionAsync(async () => {
      // Replace only this exact version. Do not delete older versions.
      await db.runAsync(
        `DELETE FROM catalog_model_components
          WHERE model_slug = ?
            AND version = ?`,
        modelSlug,
        version,
      );

      for (const row of rows) {
        await db.runAsync(
          `INSERT INTO catalog_model_components
             (model_slug, component_code, version, interval_km, interval_days,
              warn_remaining_pct, review_status, source_note, provenance, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          row.modelSlug,
          row.componentCode,
          row.version,
          row.intervalKm,
          row.intervalDays ?? null,
          row.warnRemainingPct,
          row.reviewStatus,
          row.sourceNote,
          row.provenance,
          now,
        );
      }
    });
  });
}

// Upsert one row (used by targeted remote refresh).
export function upsertCatalogComponent(
  db: Db,
  row: CatalogPackRow,
  now = Date.now(),
): Promise<void> {
  return serialize(async () => {
    const errors = validateCatalogPack([row]);
    if (errors.length) throw new MaintenanceValidationError(errors);

    await db.runAsync(
      `INSERT INTO catalog_model_components
         (model_slug, component_code, version, interval_km, interval_days,
          warn_remaining_pct, review_status, source_note, provenance, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (model_slug, component_code, version) DO UPDATE SET
         interval_km = excluded.interval_km,
         interval_days = excluded.interval_days,
         warn_remaining_pct = excluded.warn_remaining_pct,
         review_status = excluded.review_status,
         source_note = excluded.source_note,
         provenance = excluded.provenance,
         updated_at = excluded.updated_at`,
      row.modelSlug,
      row.componentCode,
      row.version,
      row.intervalKm,
      row.intervalDays ?? null,
      row.warnRemainingPct,
      row.reviewStatus,
      row.sourceNote,
      row.provenance,
      now,
    );
  });
}

// Catalog size summary for diagnostics/settings.
export async function catalogSummary(
  db: Db,
): Promise<{ brands: number; models: number; packRows: number }> {
  const [brands, models, packRows] = await Promise.all([
    db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM catalog_brands',
    ),
    db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM catalog_models WHERE active = 1',
    ),
    db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM catalog_model_components',
    ),
  ]);

  return {
    brands: brands?.n ?? 0,
    models: models?.n ?? 0,
    packRows: packRows?.n ?? 0,
  };
}
