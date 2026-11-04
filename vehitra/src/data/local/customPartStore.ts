import { getComponentDefinition } from '../../domain/maintenance/components';
import { serialize } from './serialize';
import type { Db } from './types';
import { getVehicle } from './vehicleStore';
import { MaintenanceNotFoundError, MaintenanceValidationError } from './maintenanceErrors';

export const CUSTOM_PART_CATEGORIES = [
  'engine', 'fluids', 'brakes', 'wheels_tires', 'electrical', 'transmission', 'other',
] as const;
export type CustomPartCategory = (typeof CUSTOM_PART_CATEGORIES)[number];

export type CustomPartRow = {
  id: string;
  user_vehicle_id: string;
  component_code: string;
  name: string;
  category: string;
  created_at: number;
  updated_at: number;
  client_updated_at: number;
  sync_status: string;
  server_updated_at: string | null;
};

export type CustomPartInput = {
  id: string;
  user_vehicle_id: string;
  component_code: string;
  name: string;
  category: string;
};

export function validateCustomPartInput(input: CustomPartInput): string[] {
  const errors: string[] = [];
  const name = input.name.trim();
  if (!name) errors.push('Enter a part name.');
  else if (name.length > 80) errors.push('Part name must be 80 characters or fewer.');
  if (!(CUSTOM_PART_CATEGORIES as readonly string[]).includes(input.category)) errors.push('Choose a category.');
  if (!input.component_code.startsWith('custom_')) errors.push('Custom part code is invalid.');
  return errors;
}

export function getCustomPart(db: Db, userVehicleId: string, componentCode: string): Promise<CustomPartRow | null> {
  return db.getFirstAsync<CustomPartRow>(
    'SELECT * FROM custom_parts WHERE user_vehicle_id = ? AND component_code = ?',
    userVehicleId, componentCode,
  );
}

export function listCustomParts(db: Db, userVehicleId: string): Promise<CustomPartRow[]> {
  return db.getAllAsync<CustomPartRow>(
    'SELECT * FROM custom_parts WHERE user_vehicle_id = ? ORDER BY category ASC, name COLLATE NOCASE ASC',
    userVehicleId,
  );
}

export function createCustomPart(db: Db, input: CustomPartInput, now = Date.now()): Promise<CustomPartRow> {
  return serialize(async () => {
    const errors = validateCustomPartInput(input);
    if (errors.length) throw new MaintenanceValidationError(errors);
    if (getComponentDefinition(input.component_code)) {
      throw new MaintenanceValidationError(['A catalog component already uses this code.']);
    }
    if (!await getVehicle(db, input.user_vehicle_id)) throw new MaintenanceNotFoundError(input.user_vehicle_id);
    const duplicate = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM custom_parts WHERE user_vehicle_id = ? AND name = ? COLLATE NOCASE',
      input.user_vehicle_id, input.name.trim(),
    );
    if (duplicate) throw new MaintenanceValidationError(['A part with this name already exists for this vehicle.']);
    await db.runAsync(
      `INSERT INTO custom_parts
        (id, user_vehicle_id, component_code, name, category, created_at, updated_at, client_updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      input.id, input.user_vehicle_id, input.component_code, input.name.trim(), input.category, now, now, now,
    );
    const row = await getCustomPart(db, input.user_vehicle_id, input.component_code);
    if (!row) throw new MaintenanceNotFoundError(input.id);
    return row;
  });
}

