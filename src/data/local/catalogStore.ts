import {
  validateCatalogPack,
  type CatalogPackRow,
  type CatalogProvenance,
  type CatalogReviewStatus,
} from '../../domain/catalog/packs';
import { serialize } from './serialize';
import type { Db } from './types';
import { MaintenanceValidationError } from './maintenanceErrors';

// Local vehicle catalog (schema v9): the brand/model index plus per-model resource packs.
// This is the offline mirror of the shared cloud catalog, keyed by the same stable slugs.
// The UI always reads from here, so catalog growth is data, not code: new models arrive via a
// one-model pack download or a catalog sync (src/data/remote/catalog.ts) — never a bundled
// full-manufacturer dump. Every row keeps its review status and provenance so draft data can
// never be mistaken for a manufacturer specification.

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
};

type CatalogComponentRow = {
  model_slug: string;
  component_code: string;
  version: number;
  interval_km: number | null;
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
    vehicleType, brandSlug,
  );
}

export async function getCatalogModel(db: Db, slug: string): Promise<CatalogModelRow | null> {
  return db.getFirstAsync<CatalogModelRow>('SELECT * FROM catalog_models WHERE slug = ?', slug);
}

// True when the type has generic ("Other …") models — the Library offers that as the last
// brand step so a user with an unlisted model can still pick a resource pack.
export async function hasGenericModels(db: Db, vehicleType: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM catalog_models WHERE vehicle_type = ? AND brand_slug IS NULL AND active = 1',
    vehicleType,
  );
  return (row?.n ?? 0) > 0;
}

const toPackRow = (r: CatalogComponentRow): CatalogPackRow => ({
  modelSlug: r.model_slug,
  componentCode: r.component_code,
  version: r.version,
  intervalKm: r.interval_km,
  warnRemainingPct: r.warn_remaining_pct,
  reviewStatus: r.review_status as CatalogReviewStatus,
  sourceNote: r.source_note,
  provenance: r.provenance as CatalogProvenance,
});

// The resource pack for one model: every stored component rule row (draft or reviewed).
export async function getModelPack(db: Db, modelSlug: string): Promise<CatalogPackRow[]> {
  const rows = await db.getAllAsync<CatalogComponentRow>(
    `SELECT * FROM catalog_model_components
      WHERE model_slug = ?
      ORDER BY component_code ASC`,
    modelSlug,
  );
  return rows.map(toPackRow);
}

// Replace a model's pack with validated rows (single transaction). Used by the one-model
// download and by catalog sync; a rejected row fails the whole pack so evaluation never sees
// a half-valid set.
export function replaceModelPack(db: Db, rows: readonly CatalogPackRow[], now = Date.now()): Promise<void> {
  return serialize(async () => {
    const errors = validateCatalogPack(rows);
    if (errors.length) throw new MaintenanceValidationError(errors);
    const modelSlug = rows[0]?.modelSlug ?? null;
    if (modelSlug == null) return;
    if (!rows.every((r) => r.modelSlug === modelSlug)) {
      throw new MaintenanceValidationError(['A pack download must cover exactly one model.']);
    }
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM catalog_model_components WHERE model_slug = ?', modelSlug);
      for (const r of rows) {
        await db.runAsync(
          `INSERT INTO catalog_model_components
             (model_slug, component_code, version, interval_km, warn_remaining_pct,
              review_status, source_note, provenance, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          r.modelSlug, r.componentCode, r.version, r.intervalKm, r.warnRemainingPct,
          r.reviewStatus, r.sourceNote, r.provenance, now,
        );
      }
    });
  });
}

// Upsert one row (used by targeted remote refresh when a full pack replacement is overkill).
export function upsertCatalogComponent(db: Db, row: CatalogPackRow, now = Date.now()): Promise<void> {
  return serialize(async () => {
    const errors = validateCatalogPack([row]);
    if (errors.length) throw new MaintenanceValidationError(errors);
    await db.runAsync(
      `INSERT INTO catalog_model_components
         (model_slug, component_code, version, interval_km, warn_remaining_pct,
          review_status, source_note, provenance, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (model_slug, component_code, version) DO UPDATE SET
         interval_km = excluded.interval_km,
         warn_remaining_pct = excluded.warn_remaining_pct,
         review_status = excluded.review_status,
         source_note = excluded.source_note,
         provenance = excluded.provenance,
         updated_at = excluded.updated_at`,
      row.modelSlug, row.componentCode, row.version, row.intervalKm, row.warnRemainingPct,
      row.reviewStatus, row.sourceNote, row.provenance, now,
    );
  });
}

// Catalog size summary for diagnostics/settings ("N brands · M models · K packs").
export async function catalogSummary(db: Db): Promise<{ brands: number; models: number; packRows: number }> {
  const [brands, models, packRows] = await Promise.all([
    db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM catalog_brands'),
    db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM catalog_models WHERE active = 1'),
    db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM catalog_model_components'),
  ]);
  return { brands: brands?.n ?? 0, models: models?.n ?? 0, packRows: packRows?.n ?? 0 };
}
