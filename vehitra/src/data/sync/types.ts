// Cloud shapes for the two user tables Vehitra syncs in v1: `user_vehicles` and `deadlines`.
// user_id is never sent   the cloud derives it from auth.uid(). All timestamps are ISO strings
// (timestamptz); local stores use ms epoch, so every conversion happens in the mappers.

export type CloudVehicleRow = {
  id: string;
  model_id: string;
  catalog_version: number;
  nickname: string | null;
  plate: string | null;
  model_year: number | null;
  client_updated_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type CloudVehicleInsert = {
  id: string;
  model_id: string;
  catalog_version: number;
  nickname: string | null;
  plate: string | null;
  model_year: number | null;
  client_updated_at: string;
  deleted_at: string | null;
};

export type CloudDeadlineRow = {
  id: string;
  user_vehicle_id: string | null;
  kind: string;
  label: string | null;
  due_date: string;
  reminder_offsets_days: number[] | null;
  client_updated_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type CloudDeadlineInsert = {
  id: string;
  user_vehicle_id: string | null;
  kind: string;
  label: string | null;
  due_date: string;
  reminder_offsets_days: number[];
  client_updated_at: string;
  deleted_at: string | null;
};

export type SyncResolution = 'local' | 'account';
export type SyncResolutions = {
  vehicles?: Record<string, SyncResolution>;
  deadlines?: Record<string, SyncResolution>;
};

export type SyncConflict = {
  table: 'vehicles' | 'deadlines';
  id: string;
  fields: string[];
};

// Catalog model as the push/pull mapping needs it: cloud id + the local-compatible fields
// (vehicle type code and display names) the local `vehicles` columns require on pull-create.
export type CatalogModelInfo = {
  id: string;
  slug: string;
  vehicleType: string;
  brandName: string | null;
  modelName: string;
};

// The narrow slice of Supabase the sync engine uses. Keeping it an interface (instead of
// `getSupabase()` everywhere) makes the engine unit-testable with a fake remote   no network
// in tests.
export interface SyncRemote {
  // Null when signed out; the engine refuses to sync without a session.
  getUserId(): Promise<string | null>;
  listCatalogModels(): Promise<CatalogModelInfo[]>;
  listUserVehicles(): Promise<CloudVehicleRow[]>;
  // Batch upsert idempotent by UUID. Resolves to null on success or an error message.
  upsertUserVehicles(rows: CloudVehicleInsert[]): Promise<string | null>;
  listUserDeadlines(): Promise<CloudDeadlineRow[]>;
  upsertUserDeadlines(rows: CloudDeadlineInsert[]): Promise<string | null>;
}

export type SyncSkip = { table: 'vehicles' | 'deadlines'; id: string; reason: string };

export type SyncReport = {
  ok: boolean;
  reason: 'not_configured' | 'signed_out' | 'remote_error' | 'review_required' | null;
  vehicles: { pushed: number; pulled: number };
  deadlines: { pushed: number; pulled: number };
  skipped: SyncSkip[];
  conflicts: SyncConflict[];
  errors: string[];
  ranAt: number;
};

export function emptyReport(now: number): SyncReport {
  return {
    ok: true,
    reason: null,
    vehicles: { pushed: 0, pulled: 0 },
    deadlines: { pushed: 0, pulled: 0 },
    skipped: [],
    conflicts: [],
    errors: [],
    ranAt: now,
  };
}
