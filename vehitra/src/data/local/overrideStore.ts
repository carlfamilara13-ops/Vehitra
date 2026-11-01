import { getComponentDefinition } from '../../domain/maintenance/components';
import { serialize } from './serialize';
import type { Db } from './types';
import { getVehicle } from './vehicleStore';
import { MaintenanceNotFoundError, MaintenanceValidationError } from './maintenanceErrors';

// Per-vehicle component overrides (schema v5). The only maintenance table the user can edit and
// delete: it holds a custom distance interval, an optional day interval (stored, not yet evaluated)
// and an enable/disable flag. Keyed by (user_vehicle_id, component_code) — the local stand-in for the
// cloud's component_definitions uuid.

export type ComponentOverrideRow = {
  id: string;
  user_vehicle_id: string;
  component_code: string;
  interval_km: number | null;
  interval_days: number | null;
  enabled: number;
  client_updated_at: number;
  created_at: number;
  updated_at: number;
  sync_status: string;
  server_updated_at: string | null;
};

export type ComponentOverrideInput = {
  id: string;
  user_vehicle_id: string;
  component_code: string;
  interval_km?: number | null;
  interval_days?: number | null;
  enabled?: boolean;
};

export function validateComponentOverrideInput(input: ComponentOverrideInput): string[] {
  const errors: string[] = [];
  if (!getComponentDefinition(input.component_code)) errors.push('Unknown component.');
  if (input.interval_km != null && (!Number.isFinite(input.interval_km) || input.interval_km <= 0)) {
    errors.push('Interval must be greater than zero.');
  }
  if (input.interval_days != null && (!Number.isInteger(input.interval_days) || input.interval_days <= 0)) {
    errors.push('Day interval must be a whole number greater than zero.');
  }
  return errors;
}

export function getOverride(db: Db, userVehicleId: string, componentCode: string): Promise<ComponentOverrideRow | null> {
  return db.getFirstAsync<ComponentOverrideRow>(
    'SELECT * FROM component_overrides WHERE user_vehicle_id = ? AND component_code = ?',
    userVehicleId, componentCode,
  );
}

export function listOverrides(db: Db, userVehicleId: string): Promise<ComponentOverrideRow[]> {
  return db.getAllAsync<ComponentOverrideRow>(
    'SELECT * FROM component_overrides WHERE user_vehicle_id = ? ORDER BY component_code ASC',
    userVehicleId,
  );
}

// Create or update the override for a (vehicle, component). The existing row's id is preserved.
export function upsertOverride(db: Db, input: ComponentOverrideInput, now = Date.now()): Promise<ComponentOverrideRow> {
  return serialize(async () => {
    const errors = validateComponentOverrideInput(input);
    if (errors.length) throw new MaintenanceValidationError(errors);
    const vehicle = await getVehicle(db, input.user_vehicle_id);
    if (!vehicle) throw new MaintenanceNotFoundError(input.user_vehicle_id);
    await db.runAsync(
      `INSERT INTO component_overrides
         (id, user_vehicle_id, component_code, interval_km, interval_days, enabled, client_updated_at, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
       ON CONFLICT (user_vehicle_id, component_code) DO UPDATE SET
         interval_km = excluded.interval_km,
         interval_days = excluded.interval_days,
         enabled = excluded.enabled,
         client_updated_at = excluded.client_updated_at,
         updated_at = excluded.updated_at,
         sync_status = 'pending'`,
      input.id, input.user_vehicle_id, input.component_code, input.interval_km ?? null,
      input.interval_days ?? null, input.enabled === false ? 0 : 1, now, now, now,
    );
    const row = await getOverride(db, input.user_vehicle_id, input.component_code);
    if (!row) throw new MaintenanceNotFoundError(input.id);
    return row;
  });
}

export function deleteOverride(db: Db, userVehicleId: string, componentCode: string): Promise<boolean> {
  return serialize(async () => {
    const existing = await getOverride(db, userVehicleId, componentCode);
    if (!existing) return false;
    await db.runAsync('DELETE FROM component_overrides WHERE user_vehicle_id = ? AND component_code = ?', userVehicleId, componentCode);
    return true;
  });
}
