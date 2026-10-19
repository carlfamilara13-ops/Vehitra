import { getSupabase } from '../remote/client';
import type {
  CatalogModelInfo,
  CloudDeadlineInsert,
  CloudDeadlineRow,
  CloudVehicleInsert,
  CloudVehicleRow,
  SyncRemote,
} from './types';

// Supabase implementation of the sync engine's narrow remote interface.
//
// v1 boundaries:
// - user_id is never selected or sent: RLS scopes every row to the signed-in session
//   (user_vehicles/deadlines policies default to auth.uid()).
// - The catalog model list is fetched on every run: pushing resolves local model slugs to
//   cloud uuids, pulling resolves cloud uuids back to local catalog fields.
// - Lists are full pulls, not cursor pulls — per-user tables are small in v1 and the engine's
//   last-write-wins compare turns an already-applied row into a no-op, so re-pulling is cheap
//   and idempotent.
// - Any query error throws; the engine catches it, marks the run a remote error, and leaves
//   every local row pending for the next attempt.

type ModelJoinRow = {
  id: string;
  slug: string;
  name: string;
  type: { code: string } | null;
  brand: { name: string } | null;
};

const VEHICLE_COLUMNS =
  'id, model_id, catalog_version, nickname, plate, model_year, client_updated_at, updated_at, deleted_at';
const DEADLINE_COLUMNS =
  'id, user_vehicle_id, kind, label, due_date, reminder_offsets_days, client_updated_at, updated_at, deleted_at';

export function createSupabaseSyncRemote(): SyncRemote {
  return {
    async getUserId(): Promise<string | null> {
      const supabase = getSupabase();
      const { data, error } = await supabase.auth.getSession();
      if (error) throw new Error(error.message);
      return data.session?.user?.id ?? null;
    },

    async listCatalogModels(): Promise<CatalogModelInfo[]> {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('vehicle_models')
        .select('id, slug, name, type:type_id(code), brand:brand_id(name)')
        .eq('active', true);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as ModelJoinRow[];
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        // type_id is NOT NULL cloud-side; the fallback only guards a broken join shape.
        vehicleType: r.type?.code ?? 'other',
        brandName: r.brand?.name ?? null,
        modelName: r.name,
      }));
    },

    async listUserVehicles(): Promise<CloudVehicleRow[]> {
      const supabase = getSupabase();
      const { data, error } = await supabase.from('user_vehicles').select(VEHICLE_COLUMNS);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as CloudVehicleRow[];
    },

    async upsertUserVehicles(rows: CloudVehicleInsert[]): Promise<string | null> {
      const supabase = getSupabase();
      const { error } = await supabase.from('user_vehicles').upsert(rows, { onConflict: 'id' });
      return error ? error.message : null;
    },

    async listUserDeadlines(): Promise<CloudDeadlineRow[]> {
      const supabase = getSupabase();
      const { data, error } = await supabase.from('deadlines').select(DEADLINE_COLUMNS);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as CloudDeadlineRow[];
    },

    async upsertUserDeadlines(rows: CloudDeadlineInsert[]): Promise<string | null> {
      const supabase = getSupabase();
      const { error } = await supabase.from('deadlines').upsert(rows, { onConflict: 'id' });
      return error ? error.message : null;
    },
  };
}
