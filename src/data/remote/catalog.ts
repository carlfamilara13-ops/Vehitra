import {
  validateCatalogPack,
  type CatalogPackRow,
} from '../../domain/catalog/packs';
import {
  validateCatalogIndex,
  type CatalogIndexBrand,
  type CatalogIndexModel,
} from '../../domain/catalog/index';
import {
  remoteBrandToIndex,
  remoteModelToIndex,
  remoteRowToPackRow,
  type RemoteBrandRow,
  type RemoteIndexModelRow,
  type RemotePackRow,
} from './catalogMap';
import { getSupabase, hasSupabaseConfig } from './client';
import { fetchAllPages } from './pagination';

// One-model resource-pack download. The cloud catalog is versioned and read-only for users:
// this fetches the published pack rows for exactly one model slug and returns them as the same
// CatalogPackRow shape the local store uses, so callers can validate once and replace the local
// pack atomically (catalogStore.replaceModelPack). Provenance is recorded as 'remote' so the UI
// can say where the data came from.
//
// Boundary rules:
// - never blocks on the network: the local/bundled pack is always valid on its own;
// - a failed download is an error the caller reports, never a silent partial overwrite;
// - only published versions are visible (enforced by the cloud RLS/policy, also filtered here).

export type CatalogDownloadResult =
  | { ok: true; rows: CatalogPackRow[]; version: number; sourceNote: string | null }
  | { ok: false; reason: 'not_configured' | 'network' | 'not_found' | 'invalid_data'; message: string };

export { remoteRowToPackRow, type RemotePackRow } from './catalogMap';

export type CatalogIndexResult =
  | { ok: true; brands: CatalogIndexBrand[]; models: CatalogIndexModel[] }
  | { ok: false; reason: 'not_configured' | 'network' | 'invalid_data'; message: string };

export async function downloadCatalogIndex(): Promise<CatalogIndexResult> {
  if (!hasSupabaseConfig()) {
    return { ok: false, reason: 'not_configured', message: 'Cloud catalog is not configured.' };
  }
  try {
    const supabase = getSupabase();
    const [brandPage, modelPage] = await Promise.all([
      fetchAllPages<RemoteBrandRow>((from, to) =>
        supabase.from('brands').select('slug, name').order('slug').range(from, to),
      ),
      fetchAllPages<RemoteIndexModelRow>((from, to) =>
        supabase
          .from('vehicle_models')
          .select('slug, name, is_generic, sort_order, brand:brands(slug), vehicle_type:vehicle_types(code)')
          .eq('active', true)
          .order('slug')
          .range(from, to),
      ),
    ]);
    if (!brandPage.ok) return { ok: false, reason: 'network', message: brandPage.message };
    if (!modelPage.ok) return { ok: false, reason: 'network', message: modelPage.message };

    const brands = brandPage.rows.map(remoteBrandToIndex);
    const models = modelPage.rows.map(remoteModelToIndex);
    const problems = validateCatalogIndex(brands, models);
    if (problems.length > 0) {
      return { ok: false, reason: 'invalid_data', message: problems.join(' ') };
    }
    return { ok: true, brands, models };
  } catch (e) {
    return { ok: false, reason: 'network', message: e instanceof Error ? e.message : String(e) };
  }
}

// Downloads (or re-downloads) the published pack for one model. Never throws: the outcome is
// explicit so the screen can keep bundled data and tell the user what happened.
export async function downloadModelPack(modelSlug: string): Promise<CatalogDownloadResult> {
  if (!hasSupabaseConfig()) {
    return { ok: false, reason: 'not_configured', message: 'Cloud catalog is not configured.' };
  }
  try {
    const supabase = getSupabase();

    const model = await supabase
      .from('vehicle_models')
      .select('id, slug, current_version')
      .eq('slug', modelSlug)
      .eq('active', true)
      .maybeSingle();
    if (model.error) return { ok: false, reason: 'network', message: model.error.message };
    if (!model.data) return { ok: false, reason: 'not_found', message: `Unknown model: ${modelSlug}` };

    const version = model.data.current_version;
    const rows = await supabase
      .from('model_components')
      .select('interval_km, warn_remaining_pct, review_status, source_note, component:component_definitions(code)')
      .eq('model_id', model.data.id)
      .eq('version', version);
    if (rows.error) return { ok: false, reason: 'network', message: rows.error.message };

    const mapped = (rows.data ?? []).map((r) =>
      remoteRowToPackRow(modelSlug, version, r as unknown as RemotePackRow),
    );
    const problems = validateCatalogPack(mapped);
    if (problems.length > 0) {
      return { ok: false, reason: 'invalid_data', message: problems.join(' ') };
    }
    const sourceNote = mapped.map((r) => r.sourceNote).find((n) => !!n) ?? null;
    return { ok: true, rows: mapped, version, sourceNote };
  } catch (e) {
    return { ok: false, reason: 'network', message: e instanceof Error ? e.message : String(e) };
  }
}
