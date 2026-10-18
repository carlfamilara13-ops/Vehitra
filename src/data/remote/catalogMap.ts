import type { CatalogPackRow } from '../../domain/catalog/packs';

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
