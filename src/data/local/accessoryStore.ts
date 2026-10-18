import { serialize } from './serialize';
import type { Db } from './types';
import { getVehicle } from './vehicleStore';
import { MaintenanceNotFoundError, MaintenanceValidationError } from './maintenanceErrors';

// Per-vehicle accessory records (schema v7). Descriptive only: no interval, usage or status
// numbers live here, so editing an accessory can never affect maintenance evaluation. Rows
// soft-delete so removals keep history and can later sync as tombstones.

export type AccessoryRow = {
  id: string;
  user_vehicle_id: string;
  name: string;
  brand: string | null;
  model: string | null;
  installed_at: number | null;
  notes: string | null;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
  client_updated_at: number;
  sync_status: string;
  server_updated_at: string | null;
};

export type AccessoryInput = {
  id: string;
  user_vehicle_id: string;
  name: string;
  brand?: string | null;
  model?: string | null;
  installed_at?: number | null;
  notes?: string | null;
};

const MAX_NAME = 60;
const MAX_TEXT = 80;
const MAX_NOTES = 500;

const text = (v: string | null | undefined): string | null => {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
};

export function validateAccessoryInput(input: AccessoryInput): string[] {
  const errors: string[] = [];
  const name = text(input.name);
  if (!name) errors.push('Accessory name is required.');
  else if (name.length > MAX_NAME) errors.push(`Name must be ${MAX_NAME} characters or fewer.`);
  const brand = text(input.brand);
  if (brand && brand.length > MAX_TEXT) errors.push(`Brand must be ${MAX_TEXT} characters or fewer.`);
  const model = text(input.model);
  if (model && model.length > MAX_TEXT) errors.push(`Model must be ${MAX_TEXT} characters or fewer.`);
  const notes = text(input.notes);
  if (notes && notes.length > MAX_NOTES) errors.push(`Notes must be ${MAX_NOTES} characters or fewer.`);
  if (input.installed_at != null && !Number.isFinite(input.installed_at)) {
    errors.push('Installation date is invalid.');
  }
  if (input.installed_at != null && input.installed_at > Date.now() + 86_400_000) {
    errors.push('Installation date cannot be in the future.');
  }
  return errors;
}

export async function listAccessories(db: Db, userVehicleId: string): Promise<AccessoryRow[]> {
  return db.getAllAsync<AccessoryRow>(
    `SELECT * FROM accessories
      WHERE user_vehicle_id = ? AND deleted_at IS NULL
      ORDER BY name ASC, id ASC`,
    userVehicleId,
  );
}

export async function getAccessory(db: Db, id: string): Promise<AccessoryRow | null> {
  return db.getFirstAsync<AccessoryRow>(
    'SELECT * FROM accessories WHERE id = ? AND deleted_at IS NULL',
    id,
  );
}

export function createAccessory(db: Db, input: AccessoryInput, now = Date.now()): Promise<AccessoryRow> {
  return serialize(async () => {
    const errors = validateAccessoryInput(input);
    if (errors.length) throw new MaintenanceValidationError(errors);
    const vehicle = await getVehicle(db, input.user_vehicle_id);
    if (!vehicle) throw new MaintenanceNotFoundError(input.user_vehicle_id);
    await db.runAsync(
      `INSERT INTO accessories
         (id, user_vehicle_id, name, brand, model, installed_at, notes,
          created_at, updated_at, client_updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      input.id, input.user_vehicle_id, text(input.name), text(input.brand), text(input.model),
      input.installed_at ?? null, text(input.notes), now, now, now,
    );
    const row = await getAccessory(db, input.id);
    if (!row) throw new MaintenanceNotFoundError(input.id);
    return row;
  });
}

// Full edit of an open accessory record. Keeps created_at; bumps sync markers.
export function updateAccessory(db: Db, id: string, input: AccessoryInput, now = Date.now()): Promise<AccessoryRow | null> {
  return serialize(async () => {
    const errors = validateAccessoryInput(input);
    if (errors.length) throw new MaintenanceValidationError(errors);
    const existing = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM accessories WHERE id = ? AND deleted_at IS NULL',
      id,
    );
    if (!existing) return null;
    const vehicle = await getVehicle(db, input.user_vehicle_id);
    if (!vehicle) throw new MaintenanceNotFoundError(input.user_vehicle_id);
    await db.runAsync(
      `UPDATE accessories
          SET user_vehicle_id = ?, name = ?, brand = ?, model = ?, installed_at = ?, notes = ?,
              updated_at = ?, client_updated_at = ?, sync_status = 'pending'
        WHERE id = ? AND deleted_at IS NULL`,
      input.user_vehicle_id, text(input.name), text(input.brand), text(input.model),
      input.installed_at ?? null, text(input.notes), now, now, id,
    );
    return getAccessory(db, id);
  });
}

export function softDeleteAccessory(db: Db, id: string, now = Date.now()): Promise<boolean> {
  return serialize(async () => {
    const existing = await getAccessory(db, id);
    if (!existing) return false;
    await db.runAsync(
      `UPDATE accessories SET deleted_at = ?, updated_at = ?, client_updated_at = ?, sync_status = 'pending'
        WHERE id = ? AND deleted_at IS NULL`,
      now, now, now, id,
    );
    return true;
  });
}
