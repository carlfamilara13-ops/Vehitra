import type { DeadlineRow } from '../local/deadlineStore';
import type { VehicleRow } from '../local/vehicleStore';
import { cloudDeadlineToLocal, cloudVehicleToLocal } from './mappers';
import type {
  CatalogModelInfo,
  CloudDeadlineRow,
  CloudVehicleRow,
  SyncConflict,
} from './types';

export type PossibleDuplicateVehicle = {
  localId: string;
  accountId: string;
  localLabel: string;
  accountLabel: string;
};

export function findSyncConflicts(
  localVehicles: VehicleRow[],
  accountVehicles: CloudVehicleRow[],
  models: CatalogModelInfo[],
  localDeadlines: DeadlineRow[],
  accountDeadlines: CloudDeadlineRow[],
): SyncConflict[] {
  const modelById = new Map(models.map((model) => [model.id, model]));
  const localVehicleById = new Map(localVehicles.map((vehicle) => [vehicle.id, vehicle]));
  const conflicts: SyncConflict[] = [];

  for (const cloud of accountVehicles) {
    const local = localVehicleById.get(cloud.id);
    const model = modelById.get(cloud.model_id) ?? null;
    const pull = cloudVehicleToLocal(cloud, model);
    if (!local || !pull) continue;

    const fields: string[] = [];
    if (local.nickname !== pull.nickname) fields.push('nickname');
    if (local.plate !== pull.plate) fields.push('plate');
    if (local.model_year !== pull.modelYear) fields.push('model year');
    if (local.catalog_model_slug !== pull.catalogSlug) fields.push('catalog model');
    if ((local.catalog_version ?? null) !== pull.catalogVersion) fields.push('catalog version');
    if ((local.deleted_at === null) !== (pull.deletedAtMs === null)) fields.push('deleted status');
    if (fields.length > 0) conflicts.push({ table: 'vehicles', id: cloud.id, fields });
  }

  const localDeadlineById = new Map(localDeadlines.map((deadline) => [deadline.id, deadline]));
  for (const cloud of accountDeadlines) {
    const local = localDeadlineById.get(cloud.id);
    const pull = cloudDeadlineToLocal(cloud);
    if (!local || !pull) continue;

    const fields: string[] = [];
    if (local.kind !== pull.kind) fields.push('reminder type');
    if ((local.label ?? null) !== pull.label) fields.push('label');
    if (local.due_date !== pull.dueDate) fields.push('due date');
    if (JSON.stringify(readOffsets(local.reminder_offsets)) !== JSON.stringify(pull.offsets)) {
      fields.push('reminder schedule');
    }
    if ((local.user_vehicle_id ?? null) !== pull.userVehicleId) fields.push('vehicle');
    if ((local.deleted_at === null) !== (pull.deletedAtMs === null)) fields.push('deleted status');
    if (fields.length > 0) conflicts.push({ table: 'deadlines', id: cloud.id, fields });
  }
  return conflicts;
}

// A plate match alone is insufficient. Surface a candidate only when the registered plate,
// catalog model, and known model year all match. Vehicle names and nicknames are never keys.
export function findPossibleDuplicateVehicles(
  localVehicles: VehicleRow[],
  accountVehicles: CloudVehicleRow[],
  models: CatalogModelInfo[],
): PossibleDuplicateVehicle[] {
  const modelById = new Map(models.map((model) => [model.id, model]));
  const accountByIdentity = new Map<string, CloudVehicleRow>();
  for (const account of accountVehicles) {
    if (account.deleted_at) continue;
    const model = modelById.get(account.model_id);
    const plate = normalizePlate(account.plate);
    if (!model || !plate || account.model_year === null) continue;
    accountByIdentity.set([plate, model.slug, account.model_year].join('|'), account);
  }

  const result: PossibleDuplicateVehicle[] = [];
  for (const local of localVehicles) {
    if (local.deleted_at !== null || !local.catalog_model_slug || !local.model_year) continue;
    const plate = normalizePlate(local.plate);
    if (!plate) continue;
    const cloud = accountByIdentity.get([plate, local.catalog_model_slug, local.model_year].join('|'));
    if (!cloud || cloud.id === local.id) continue;
    result.push({
      localId: local.id,
      accountId: cloud.id,
      localLabel: vehicleLabel(local.nickname, local.brand, local.model, local.model_year),
      accountLabel: vehicleLabel(
        cloud.nickname,
        modelById.get(cloud.model_id)?.brandName ?? null,
        modelById.get(cloud.model_id)?.modelName ?? null,
        cloud.model_year,
      ),
    });
  }
  return result;
}

function normalizePlate(value: string | null): string {
  return (value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '');
}

function vehicleLabel(
  nickname: string | null,
  brand: string | null,
  model: string | null,
  year: number | null,
): string {
  const name = nickname?.trim() || [brand, model].filter(Boolean).join(' ') || 'Vehicle';
  return year ? name + ' (' + year + ')' : name;
}

function readOffsets(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value) => Number.isFinite(value)) : [];
  } catch {
    return [];
  }
}
