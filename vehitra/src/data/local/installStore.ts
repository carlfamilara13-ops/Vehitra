import { getComponentDefinition } from '../../domain/maintenance/components';
import { serialize } from './serialize';
import type { Db } from './types';
import { getVehicle } from './vehicleStore';
import { MaintenanceNotFoundError, MaintenanceValidationError } from './maintenanceErrors';
import { getCustomPart } from './customPartStore';

// Installed-part records (schema v5). Close-only: an open row (removed_at IS NULL) may be closed
// once and is then frozen; rows are never deleted. At most one open install per (vehicle, component),
// enforced by a partial unique index. A replacement = close the open install + open a new one, done in
// one transaction (the local equivalent of the cloud's replace_part_install RPC).
// `installed_at` is the usage baseline for the component.

export type PartInstallRow = {
  id: string;
  user_vehicle_id: string;
  component_code: string;
  brand: string | null;
  model: string | null;
  installed_at: number;
  install_odo: number | null;
  removed_at: number | null;
  removal_odo: number | null;
  notes: string | null;
  close_notes: string | null;
  client_updated_at: number;
  created_at: number;
  updated_at: number;
  sync_status: string;
  server_updated_at: string | null;
};

export type PartInstallInput = {
  id: string;
  user_vehicle_id: string;
  component_code: string;
  installed_at: number;
  brand?: string | null;
  model?: string | null;
  install_odo?: number | null;
  notes?: string | null;
};

export type CloseInstallInput = {
  removed_at: number;
  removal_odo?: number | null;
  close_notes?: string | null;
};

const MAX_TEXT = 60;
const MAX_NOTE = 500;

const text = (v: string | null | undefined): string | null => {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
};

export function validatePartInstallInput(input: PartInstallInput, allowCustom = false): string[] {
  const errors: string[] = [];
  if (!getComponentDefinition(input.component_code) && !allowCustom) errors.push('Unknown component.');
  if (!Number.isFinite(input.installed_at)) errors.push('Install time is required.');
  if (input.install_odo != null && (!Number.isFinite(input.install_odo) || input.install_odo < 0)) {
    errors.push('Odometer must be zero or greater.');
  }
  const brand = text(input.brand);
  if (brand && brand.length > MAX_TEXT) errors.push(`Brand must be ${MAX_TEXT} characters or fewer.`);
  const model = text(input.model);
  if (model && model.length > MAX_TEXT) errors.push(`Model must be ${MAX_TEXT} characters or fewer.`);
  const notes = text(input.notes);
  if (notes && notes.length > MAX_NOTE) errors.push(`Notes must be ${MAX_NOTE} characters or fewer.`);
  return errors;
}

export function getInstall(db: Db, id: string): Promise<PartInstallRow | null> {
  return db.getFirstAsync<PartInstallRow>('SELECT * FROM part_installs WHERE id = ?', id);
}

export function getOpenInstall(db: Db, userVehicleId: string, componentCode: string): Promise<PartInstallRow | null> {
  return db.getFirstAsync<PartInstallRow>(
    'SELECT * FROM part_installs WHERE user_vehicle_id = ? AND component_code = ? AND removed_at IS NULL',
    userVehicleId, componentCode,
  );
}

export function listInstalls(db: Db, userVehicleId: string, componentCode?: string): Promise<PartInstallRow[]> {
  if (componentCode) {
    return db.getAllAsync<PartInstallRow>(
      'SELECT * FROM part_installs WHERE user_vehicle_id = ? AND component_code = ? ORDER BY installed_at ASC, id ASC',
      userVehicleId, componentCode,
    );
  }
  return db.getAllAsync<PartInstallRow>(
    'SELECT * FROM part_installs WHERE user_vehicle_id = ? ORDER BY installed_at ASC, id ASC',
    userVehicleId,
  );
}

// Most recent install (open or closed) for a component   the usage baseline.
export function latestInstall(db: Db, userVehicleId: string, componentCode: string): Promise<PartInstallRow | null> {
  return db.getFirstAsync<PartInstallRow>(
    'SELECT * FROM part_installs WHERE user_vehicle_id = ? AND component_code = ? ORDER BY installed_at DESC, id DESC LIMIT 1',
    userVehicleId, componentCode,
  );
}

export function openInstall(db: Db, input: PartInstallInput, now = Date.now()): Promise<PartInstallRow> {
  return serialize(async () => {
    const errors = validatePartInstallInput(input, !!await getCustomPart(db, input.user_vehicle_id, input.component_code));
    if (errors.length) throw new MaintenanceValidationError(errors);
    const vehicle = await getVehicle(db, input.user_vehicle_id);
    if (!vehicle) throw new MaintenanceNotFoundError(input.user_vehicle_id);
    if (input.installed_at > now) throw new MaintenanceValidationError(['Install date cannot be in the future.']);
    const open = await getOpenInstall(db, input.user_vehicle_id, input.component_code);
    if (open) throw new MaintenanceValidationError([`A part is already installed for ${input.component_code}.`]);
    return insertInstallRow(db, input, now);
  });
}

// Validation for closing/removing an install: a reason must be sane and the removal must not precede
// the install. Shared by closeInstall and replaceInstall.
export function validateCloseInstall(input: CloseInstallInput, installedAt: number): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(input.removed_at)) errors.push('Removal time is required.');
  if (input.removed_at < installedAt) {
    errors.push('Removal time must be after install time.');
  }
  if (input.removal_odo != null && (!Number.isFinite(input.removal_odo) || input.removal_odo < 0)) {
    errors.push('Odometer must be zero or greater.');
  }
  const closeNotes = text(input.close_notes);
  if (closeNotes && closeNotes.length > MAX_NOTE) errors.push(`Close notes must be ${MAX_NOTE} characters or fewer.`);
  return errors;
}

// Close an open install (sets removed_at, freezes it). Returns null for an unknown id.
export function closeInstall(db: Db, installId: string, close: CloseInstallInput, now = Date.now()): Promise<PartInstallRow | null> {
  return serialize(async () => {
    const existing = await getInstall(db, installId);
    if (!existing) return null;
    if (existing.removed_at !== null) throw new MaintenanceValidationError(['Part install is already closed.']);
    const errs = validateCloseInstall(close, existing.installed_at);
    if (errs.length) throw new MaintenanceValidationError(errs);
    await db.runAsync(
      `UPDATE part_installs
          SET removed_at = ?, removal_odo = ?, close_notes = ?, updated_at = ?, client_updated_at = ?, sync_status = 'pending'
        WHERE id = ?`,
      close.removed_at, close.removal_odo ?? null, text(close.close_notes), now, now, installId,
    );
    return getInstall(db, installId);
  });
}

// Replacement: close the current open install (if any) and open a new one, atomically.
export function replaceInstall(db: Db, input: PartInstallInput, now = Date.now()): Promise<PartInstallRow> {
  return serialize(async () => {
    const errors = validatePartInstallInput(input, !!await getCustomPart(db, input.user_vehicle_id, input.component_code));
    if (errors.length) throw new MaintenanceValidationError(errors);
    // Reject a future install before closing the current one so a rejected write leaves nothing
    // behind. A future-dated install is the usage baseline and would hide present wear.
    if (input.installed_at > now) throw new MaintenanceValidationError(['Install date cannot be in the future.']);
    const vehicle = await getVehicle(db, input.user_vehicle_id);
    if (!vehicle) throw new MaintenanceNotFoundError(input.user_vehicle_id);
    let created: PartInstallRow | null = null;
    await db.withTransactionAsync(async () => {
      const open = await getOpenInstall(db, input.user_vehicle_id, input.component_code);
      if (open) {
        const errs = validateCloseInstall({ removed_at: input.installed_at, removal_odo: input.install_odo ?? null }, open.installed_at);
        if (errs.length) throw new MaintenanceValidationError(errs);
        await db.runAsync(
          `UPDATE part_installs
              SET removed_at = ?, removal_odo = ?, close_notes = 'replaced', updated_at = ?, client_updated_at = ?, sync_status = 'pending'
            WHERE id = ?`,
          input.installed_at, input.install_odo ?? null, now, now, open.id,
        );
      }
      created = await insertInstallRow(db, input, now);
    });
    if (!created) throw new MaintenanceNotFoundError(input.id);
    return created;
  });
}

async function insertInstallRow(db: Db, input: PartInstallInput, now: number): Promise<PartInstallRow> {
  await db.runAsync(
    `INSERT INTO part_installs
       (id, user_vehicle_id, component_code, brand, model, installed_at, install_odo, notes,
        client_updated_at, created_at, updated_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    input.id, input.user_vehicle_id, input.component_code, text(input.brand), text(input.model),
    input.installed_at, input.install_odo ?? null, text(input.notes), now, now, now,
  );
  const row = await getInstall(db, input.id);
  if (!row) throw new MaintenanceNotFoundError(input.id);
  return row;
}
