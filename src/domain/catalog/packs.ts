// Pure validation and typing for vehicle resource packs (per-model maintenance rule data).
// A pack is the minimal set of rows needed to evaluate one model's components. Bundled and
// remote packs pass through the same validation, so a bad remote row can never reach the
// maintenance evaluator. Nothing here treats a value as manufacturer-approved: `reviewStatus`
// and `sourceNote` travel with every row and the UI must surface them.

import { LOCAL_COMPONENT_DEFINITIONS } from '../maintenance/components';

export const CATALOG_REVIEW_STATUSES = ['draft', 'reviewed'] as const;
export type CatalogReviewStatus = (typeof CATALOG_REVIEW_STATUSES)[number];

export const CATALOG_PROVENANCES = ['bundled', 'remote', 'admin'] as const;
export type CatalogProvenance = (typeof CATALOG_PROVENANCES)[number];

export type CatalogPackRow = {
  modelSlug: string;
  componentCode: string;
  version: number;
  intervalKm: number | null;
  warnRemainingPct: number;
  reviewStatus: CatalogReviewStatus;
  sourceNote: string | null;
  provenance: CatalogProvenance;
};

const KNOWN_CODES = new Set(LOCAL_COMPONENT_DEFINITIONS.map((d) => d.code));

// Returns the list of problems; empty means every row is usable. Unknown component codes are
// rejected (a pack cannot introduce components the local catalog does not know), as are
// non-positive intervals, out-of-range warn percentages and bad enums.
export function validateCatalogPack(rows: readonly CatalogPackRow[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const label = `${row.modelSlug}/${row.componentCode}`;
    if (!row.modelSlug.trim()) errors.push('Pack row is missing a model slug.');
    if (!KNOWN_CODES.has(row.componentCode)) {
      errors.push(`${label}: unknown component code.`);
    }
    if (!Number.isInteger(row.version) || row.version < 1) {
      errors.push(`${label}: version must be a positive whole number.`);
    }
    if (row.intervalKm != null && (!Number.isFinite(row.intervalKm) || row.intervalKm <= 0)) {
      errors.push(`${label}: interval must be greater than zero when set.`);
    }
    if (!Number.isFinite(row.warnRemainingPct) || row.warnRemainingPct < 0 || row.warnRemainingPct > 100) {
      errors.push(`${label}: warn percentage must be between 0 and 100.`);
    }
    if (!(CATALOG_REVIEW_STATUSES as readonly string[]).includes(row.reviewStatus)) {
      errors.push(`${label}: unknown review status.`);
    }
    if (!(CATALOG_PROVENANCES as readonly string[]).includes(row.provenance)) {
      errors.push(`${label}: unknown provenance.`);
    }
    const key = `${row.modelSlug}:${row.componentCode}:${row.version}`;
    if (seen.has(key)) errors.push(`${label}: duplicate pack row.`);
    seen.add(key);
  }
  return errors;
}

// One-row lookup by component code for the evaluator; last row wins on duplicates (which
// validation already rejects, this is defence in depth for trusted local packs).
export function packByCode(rows: readonly CatalogPackRow[]): Map<string, CatalogPackRow> {
  return new Map(rows.map((r) => [r.componentCode, r]));
}
