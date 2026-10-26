import type { CatalogPackRow } from '../../domain/catalog/packs';
import type { CatalogIndexBrand, CatalogIndexModel } from '../../domain/catalog/index';

// Pure mapping between cloud catalog rows and the local pack shape. Kept free of any
// network/RN imports so it runs in unit tests and stays a dumb, explicit translation.

// Row shape returned by PostgREST for the one-model pack query.
export type RemotePackRow = {
  interval_km: number | null;
  warn_remaining_pct: number | string | null;
  review_status: string;
  source_note: string | null;
  component: { code: string } | null;
};

export type RemoteBrandRow = {
  slug: string;
  name: string;
};

export type RemoteIndexModelRow = {
  slug: string;
  name: string;
  is_generic: boolean;
  sort_order: number | string | null;
  brand: { slug: string } | null;
  vehicle_type: { code: string } | null;
};

export function remoteBrandToIndex(row: RemoteBrandRow): CatalogIndexBrand {
  return { slug: row.slug, name: row.name };
}

export function remoteModelToIndex(row: RemoteIndexModelRow): CatalogIndexModel {
  const brandSlug = row.brand?.slug ?? null;
  const rawSort = row.sort_order == null ? 100 : Number(row.sort_order);
  return {
    slug: row.slug,
    brandSlug,
    vehicleType: row.vehicle_type?.code ?? '',
    name: row.name,
    isGeneric: row.is_generic,
    sortOrder: Number.isFinite(rawSort) ? rawSort : Number.NaN,
  };
}

// Maps one fetched cloud row to the local pack row. Unknown review statuses collapse to
// 'draft' (never trust a value we do not know), and provenance records the origin so the UI
// can say where the rule came from. An empty component code will be rejected by
// validateCatalogPack, which fails the whole download rather than storing a junk row.
export function remoteRowToPackRow(modelSlug: string, version: number, row: RemotePackRow): CatalogPackRow {
  return {
    modelSlug,
    componentCode: row.component?.code ?? '',
    version,
    intervalKm: row.interval_km ?? null,
    warnRemainingPct: Number(row.warn_remaining_pct ?? 25),
    reviewStatus: row.review_status === 'reviewed' ? 'reviewed' : 'draft',
    sourceNote: row.source_note,
    provenance: 'remote',
  };
}
