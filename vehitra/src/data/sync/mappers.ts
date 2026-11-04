import { parseDateOnly } from '../../domain/reminders/dates';
import {
  DEADLINE_KINDS,
  parseDeadlineOffsets,
  type DeadlineKind,
  type DeadlineRow,
} from '../local/deadlineStore';
import type { VehicleRow } from '../local/vehicleStore';
import type {
  CatalogModelInfo,
  CloudDeadlineInsert,
  CloudDeadlineRow,
  CloudVehicleInsert,
  CloudVehicleRow,
} from './types';

// Pure local<->cloud conversions. No I/O, no stores, no client   everything here is unit
// tested. Rules:
// - epoch ms <-> ISO strings convert here and nowhere else;
// - a push payload carries ONLY columns the cloud table has (vehicle_type, brand, model,
//   odometer_km and deadline `enabled` are local-only by design and stay on the device);
// - a pull patch carries only shared fields; callers keep local-only fields untouched.

export function isoFromEpoch(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export function epochFromIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

// Last-write-wins: the cloud row wins only when its server time is strictly newer than the
// local edit time. Ties go to the device (its pending row then pushes and overwrites).
export function cloudIsNewer(updatedAtIso: string, localClientUpdatedAtMs: number): boolean {
  const cloud = Date.parse(updatedAtIso);
  return Number.isFinite(cloud) && cloud > localClientUpdatedAtMs;
}

export function localVehicleToCloud(v: VehicleRow, modelId: string): CloudVehicleInsert {
  return {
    id: v.id,
    model_id: modelId,
    catalog_version: v.catalog_version ?? 1,
    nickname: v.nickname ?? null,
    plate: v.plate ?? null,
    model_year: v.model_year ?? null,
    client_updated_at: isoFromEpoch(v.client_updated_at) ?? new Date(v.client_updated_at).toISOString(),
    deleted_at: isoFromEpoch(v.deleted_at ?? null),
  };
}

export function localDeadlineToCloud(d: DeadlineRow): CloudDeadlineInsert {
  const offsets = parseDeadlineOffsets(d.reminder_offsets);
  return {
    id: d.id,
    user_vehicle_id: d.user_vehicle_id ?? null,
    kind: d.kind,
    label: d.label ?? null,
    due_date: d.due_date,
    reminder_offsets_days: offsets.length > 0 ? offsets : [30, 7, 3, 0],
    client_updated_at: isoFromEpoch(d.client_updated_at) ?? new Date(d.client_updated_at).toISOString(),
    deleted_at: isoFromEpoch(d.deleted_at ?? null),
  };
}

export type VehiclePull = {
  nickname: string | null;
  plate: string | null;
  modelYear: number | null;
  deletedAtMs: number | null;
  serverUpdatedAtMs: number;
  catalogSlug: string;
  catalogVersion: number;
  // For pull-create only: what the local NOT NULL columns should contain.
  vehicleType: string;
  brandName: string | null;
  modelName: string;
};

// Maps a cloud vehicle row onto the local row's shared fields. Returns null when the model is
// unknown to the local catalog (vehicle_type would be unset) or the server timestamp is
// unparseable   the caller skips with a reason instead of guessing.
export function cloudVehicleToLocal(
  row: CloudVehicleRow,
  model: CatalogModelInfo | null,
): VehiclePull | null {
  if (!model) return null;
  const serverUpdatedAtMs = epochFromIso(row.updated_at);
  if (serverUpdatedAtMs == null) return null;
  return {
    nickname: row.nickname ?? null,
    plate: row.plate ?? null,
    modelYear: row.model_year ?? null,
    deletedAtMs: epochFromIso(row.deleted_at),
    serverUpdatedAtMs,
    catalogSlug: model.slug,
    catalogVersion: row.catalog_version,
    vehicleType: model.vehicleType,
    brandName: model.brandName,
    modelName: model.modelName,
  };
}

export type DeadlinePull = {
  kind: DeadlineKind;
  label: string | null;
  dueDate: string;
  offsets: number[];
  deletedAtMs: number | null;
  serverUpdatedAtMs: number;
  userVehicleId: string | null;
};

// Maps a cloud deadline onto the local row's shared fields. `enabled` has no cloud counterpart
// and is intentionally absent   the device keeps its own toggle. Null for values the local
// schema cannot honestly store (unknown kind, malformed date).
export function cloudDeadlineToLocal(row: CloudDeadlineRow): DeadlinePull | null {
  if (!(DEADLINE_KINDS as readonly string[]).includes(row.kind)) return null;
  // Format AND calendar validity (rejects e.g. 2027-02-31), same rule the local store uses.
  if (parseDateOnly(row.due_date) == null) return null;
  const serverUpdatedAtMs = epochFromIso(row.updated_at);
  if (serverUpdatedAtMs == null) return null;
  const offsets = Array.isArray(row.reminder_offsets_days)
    ? row.reminder_offsets_days.filter((n) => Number.isFinite(n))
    : [];
  return {
    kind: row.kind as DeadlineKind,
    label: row.label ?? null,
    dueDate: row.due_date,
    offsets: offsets.length > 0 ? offsets : [30, 7, 3, 0],
    deletedAtMs: epochFromIso(row.deleted_at),
    serverUpdatedAtMs,
    userVehicleId: row.user_vehicle_id ?? null,
  };
}
