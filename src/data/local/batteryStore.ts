import { serialize } from './serialize';
import type { Db } from './types';
import { getVehicle } from './vehicleStore';
import { MaintenanceNotFoundError, MaintenanceValidationError } from './maintenanceErrors';

// Battery idle state (schema v7): one row per vehicle holding the last date the user confirmed
// the battery was in use. This is a user-entered timestamp only — the app never infers battery
// use from GPS activity and cannot measure battery condition. Idle time is always derived at
// read time (domain/battery/idle), never stored as a counter, so a corrected timestamp cannot
// leave a stale computed value behind.

export type BatteryStateRow = {
  user_vehicle_id: string;
  last_active_at: number;
  note: string | null;
  created_at: number;
  updated_at: number;
  client_updated_at: number;
  sync_status: string;
  server_updated_at: string | null;
};

const MAX_NOTE = 200;

export async function getBatteryState(db: Db, userVehicleId: string): Promise<BatteryStateRow | null> {
  return db.getFirstAsync<BatteryStateRow>(
    'SELECT * FROM battery_state WHERE user_vehicle_id = ?',
    userVehicleId,
  );
}

export async function listBatteryStates(db: Db): Promise<BatteryStateRow[]> {
  return db.getAllAsync<BatteryStateRow>('SELECT * FROM battery_state ORDER BY user_vehicle_id ASC');
}

// Record (or correct) the last time the battery was confirmed in use. Validates the vehicle
// exists so state can never dangle after a garage cleanup.
export function recordBatteryUse(
  db: Db,
  userVehicleId: string,
  lastActiveAt = Date.now(),
  note?: string | null,
  now = Date.now(),
): Promise<BatteryStateRow> {
  return serialize(async () => {
    if (!Number.isFinite(lastActiveAt) || lastActiveAt > now + 86_400_000) {
      throw new MaintenanceValidationError(['Battery use date cannot be in the future.']);
    }
    const trimmedNote = note?.trim() || null;
    if (trimmedNote && trimmedNote.length > MAX_NOTE) {
      throw new MaintenanceValidationError([`Note must be ${MAX_NOTE} characters or fewer.`]);
    }
    const vehicle = await getVehicle(db, userVehicleId);
    if (!vehicle) throw new MaintenanceNotFoundError(userVehicleId);
    await db.runAsync(
      `INSERT INTO battery_state
         (user_vehicle_id, last_active_at, note, created_at, updated_at, client_updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')
       ON CONFLICT (user_vehicle_id) DO UPDATE SET
         last_active_at = excluded.last_active_at,
         note = excluded.note,
         updated_at = excluded.updated_at,
         client_updated_at = excluded.client_updated_at,
         sync_status = 'pending'`,
      userVehicleId, lastActiveAt, trimmedNote, now, now, now,
    );
    const row = await getBatteryState(db, userVehicleId);
    if (!row) throw new MaintenanceNotFoundError(userVehicleId);
    return row;
  });
}
