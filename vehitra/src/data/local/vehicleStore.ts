import { getMeta, setMeta } from './metaStore';
import { serialize } from './serialize';
import type { Db } from './types';

// Local vehicle profiles for the garage. Local-first: everything is written here and read back
// offline. The sync columns exist for the future cloud step but are not used yet. The active
// vehicle is a device preference, kept in `meta` the same way the active ride is.

export const VEHICLE_TYPES = ['motorcycle', 'car', 'bicycle', 'truck', 'bus', 'van', 'other'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  motorcycle: 'Motorcycle',
  car: 'Car',
  bicycle: 'Bicycle',
  truck: 'Truck',
  bus: 'Bus',
  van: 'Van',
  other: 'Other',
};

export type VehicleRow = {
  id: string;
  vehicle_type: string;
  brand: string | null;
  model: string | null;
  nickname: string | null;
  model_year: number | null;
  plate: string | null;
  odometer_km: number | null;
  // Catalog linkage (schema v9): set when the vehicle was chosen through the vehicle library,
  // null for hand-entered vehicles. The pair identifies the exact resource-pack version whose
  // rules this vehicle reads. Never changed by a plain profile edit.
  catalog_model_slug: string | null;
  catalog_version: number | null;
  created_at: number;
  updated_at: number;
  client_updated_at: number;
  deleted_at: number | null;
  sync_status: string;
  server_updated_at: string | null;
};

export type VehicleInput = {
  vehicle_type: string;
  brand?: string | null;
  model?: string | null;
  nickname?: string | null;
  model_year?: number | null;
  plate?: string | null;
  odometer_km?: number | null;
  catalog_model_slug?: string | null;
  catalog_version?: number | null;
};

export class VehicleValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors[0] ?? 'Invalid vehicle');
    this.name = 'VehicleValidationError';
  }
}

export class VehicleNotFoundError extends Error {
  constructor(public readonly vehicleId: string) {
    super(`Vehicle not found (${vehicleId})`);
    this.name = 'VehicleNotFoundError';
  }
}

const MAX_TEXT = 60;
const MAX_PLATE = 20;
const MIN_YEAR = 1885;
const MAX_YEAR = 2100;

const isVehicleType = (v: string): v is VehicleType => (VEHICLE_TYPES as readonly string[]).includes(v);

// Human-readable vehicle name: nickname, else "brand model" (trimmed), else the type label.
// This is the name snapshotted onto a ride at start, so it must stay simple and stable, and it is
// mirrored by the SQL backfill in migration 004; change both together if the rule ever changes.
export function vehicleDisplayName(v: VehicleRow): string {
  const label = (VEHICLE_TYPE_LABELS as Record<string, string>)[v.vehicle_type] ?? v.vehicle_type;
  return v.nickname || [v.brand, v.model].filter(Boolean).join(' ').trim() || label;
}

// Empty / whitespace-only optional fields are stored as NULL so a generic vehicle has no blank strings.
const text = (v: string | null | undefined): string | null => {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
};

// Shared by the form (to show messages) and the store (defense in depth before writing).
export function validateVehicleInput(input: VehicleInput): string[] {
  const errors: string[] = [];
  if (!isVehicleType(input.vehicle_type)) errors.push('Choose a vehicle type.');

  const nickname = text(input.nickname);
  if (nickname && nickname.length > MAX_TEXT) errors.push(`Nickname must be ${MAX_TEXT} characters or fewer.`);
  const brand = text(input.brand);
  if (brand && brand.length > MAX_TEXT) errors.push(`Brand must be ${MAX_TEXT} characters or fewer.`);
  const model = text(input.model);
  if (model && model.length > MAX_TEXT) errors.push(`Model must be ${MAX_TEXT} characters or fewer.`);
  const plate = text(input.plate);
  if (plate && plate.length > MAX_PLATE) errors.push(`Plate must be ${MAX_PLATE} characters or fewer.`);

  if (input.model_year != null) {
    if (!Number.isInteger(input.model_year) || input.model_year < MIN_YEAR || input.model_year > MAX_YEAR) {
      errors.push(`Year must be a whole number between ${MIN_YEAR} and ${MAX_YEAR}.`);
    }
  }
  if (input.odometer_km != null) {
    if (!Number.isFinite(input.odometer_km) || input.odometer_km < 0) {
      errors.push('Odometer must be zero or greater.');
    }
  }
  if (input.catalog_model_slug != null) {
    if (!input.catalog_model_slug.trim()) errors.push('Catalog model is invalid.');
    if (!Number.isInteger(input.catalog_version) || (input.catalog_version ?? 0) < 1) {
      errors.push('Catalog version must be a positive whole number.');
    }
  }
  return errors;
}

// ---------------------------------------------------------------- reads
export async function listVehicles(db: Db): Promise<VehicleRow[]> {
  return db.getAllAsync<VehicleRow>(
    'SELECT * FROM vehicles WHERE deleted_at IS NULL ORDER BY created_at ASC, id ASC',
  );
}

export async function getVehicle(db: Db, id: string): Promise<VehicleRow | null> {
  return db.getFirstAsync<VehicleRow>('SELECT * FROM vehicles WHERE id = ? AND deleted_at IS NULL', id);
}

// ---------------------------------------------------------------- writes
export function createVehicle(
  db: Db,
  input: VehicleInput & { id: string },
  now = Date.now(),
): Promise<VehicleRow> {
  return serialize(async () => {
    const errors = validateVehicleInput(input);
    if (errors.length) throw new VehicleValidationError(errors);
    await db.runAsync(
      `INSERT INTO vehicles
         (id, vehicle_type, brand, model, nickname, model_year, plate, odometer_km,
          catalog_model_slug, catalog_version,
          created_at, updated_at, client_updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      input.id, input.vehicle_type, text(input.brand), text(input.model), text(input.nickname),
      input.model_year ?? null, text(input.plate), input.odometer_km ?? null,
      input.catalog_model_slug ?? null, input.catalog_version ?? null,
      now, now, now,
    );
    const row = await getVehicle(db, input.id);
    if (!row) throw new VehicleNotFoundError(input.id);
    return row;
  });
}

export function updateVehicle(
  db: Db,
  id: string,
  input: VehicleInput,
  now = Date.now(),
): Promise<VehicleRow | null> {
  return serialize(async () => {
    const errors = validateVehicleInput(input);
    if (errors.length) throw new VehicleValidationError(errors);
    const existing = await getVehicle(db, id);
    if (!existing) return null;
    await db.runAsync(
      `UPDATE vehicles
          SET vehicle_type = ?, brand = ?, model = ?, nickname = ?, model_year = ?, plate = ?,
              odometer_km = ?, updated_at = ?, client_updated_at = ?, sync_status = 'pending'
        WHERE id = ?`,
      input.vehicle_type, text(input.brand), text(input.model), text(input.nickname),
      input.model_year ?? null, text(input.plate), input.odometer_km ?? null, now, now, id,
    );
    return getVehicle(db, id);
  });
}

// Update only the current odometer reading. Kept separate from updateVehicle so a reading update
// never resends (and cannot clobber) the rest of the profile. This records the dashboard number the
// user is looking at; it deliberately writes NO maintenance ledger row and never establishes a
// baseline. Maintenance uses this reading against a recorded component baseline when available,
// otherwise it continues to use applied_km from the mileage ledger.
export function setVehicleOdometer(
  db: Db,
  id: string,
  odometerKm: number,
  now = Date.now(),
): Promise<VehicleRow | null> {
  return serialize(async () => {
    if (!Number.isFinite(odometerKm) || odometerKm < 0) {
      throw new VehicleValidationError(['Odometer must be zero or greater.']);
    }
    const existing = await getVehicle(db, id);
    if (!existing) return null;
    await db.runAsync(
      `UPDATE vehicles
          SET odometer_km = ?, updated_at = ?, client_updated_at = ?, sync_status = 'pending'
        WHERE id = ?`,
      odometerKm, now, now, id,
    );
    return getVehicle(db, id);
  });
}

// Attach (or move) the vehicle's catalog resource pack. Used only by the vehicle library when
// the user picks a model; plain profile edits never touch these columns, and removing the link
// (slug = null) returns the vehicle to hand-entered status without touching any history.
export function setVehicleCatalog(
  db: Db,
  id: string,
  catalogModelSlug: string | null,
  catalogVersion: number | null,
  now = Date.now(),
): Promise<VehicleRow | null> {
  return serialize(async () => {
    if (catalogModelSlug != null) {
      if (!catalogModelSlug.trim() || !Number.isInteger(catalogVersion) || (catalogVersion ?? 0) < 1) {
        throw new VehicleValidationError(['Catalog model or version is invalid.']);
      }
    }
    const existing = await getVehicle(db, id);
    if (!existing) return null;
    await db.runAsync(
      `UPDATE vehicles
          SET catalog_model_slug = ?, catalog_version = ?, updated_at = ?, client_updated_at = ?,
              sync_status = 'pending'
        WHERE id = ?`,
      catalogModelSlug, catalogVersion, now, now, id,
    );
    return getVehicle(db, id);
  });
}

export function softDeleteVehicle(db: Db, id: string, now = Date.now()): Promise<boolean> {
  return serialize(async () => {
    const existing = await getVehicle(db, id);
    if (!existing) return false;
    await db.runAsync(
      `UPDATE vehicles
          SET deleted_at = ?, updated_at = ?, client_updated_at = ?, sync_status = 'pending'
        WHERE id = ?`,
      now, now, now, id,
    );
    // Never leave the active pointer pointing at a removed vehicle.
    if ((await getMeta(db, 'active_vehicle')) === id) await setMeta(db, 'active_vehicle', null);
    return true;
  });
}

// ---------------------------------------------------------------- active vehicle
export async function getActiveVehicleId(db: Db): Promise<string | null> {
  return getMeta(db, 'active_vehicle');
}

export async function getActiveVehicle(db: Db): Promise<VehicleRow | null> {
  const id = await getActiveVehicleId(db);
  return id ? getVehicle(db, id) : null;
}

export function setActiveVehicle(db: Db, id: string | null): Promise<void> {
  return serialize(async () => {
    if (id === null) {
      await setMeta(db, 'active_vehicle', null);
      return;
    }
    const existing = await getVehicle(db, id);
    if (!existing) throw new VehicleNotFoundError(id);
    await setMeta(db, 'active_vehicle', id);
  });
}
