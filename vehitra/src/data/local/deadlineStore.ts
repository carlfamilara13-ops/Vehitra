import {
  parseDateOnly,
  REMINDER_OFFSET_CHOICES,
} from '../../domain/reminders/dates';
import { serialize } from './serialize';
import type { Db } from './types';
import { getVehicle } from './vehicleStore';
import { MaintenanceNotFoundError, MaintenanceValidationError } from './maintenanceErrors';

// Deadline reminders (schema v8): registration, driver's licence, insurance, inspection and
// custom dates. Mirrors the cloud `deadlines` table minus user_id. due_date is a local calendar
// string ('YYYY-MM-DD'); reminder offsets use the same whitelist as the cloud schema. Vehicle
// registration rows always reference their vehicle; licence/custom may be user-level.

export const DEADLINE_KINDS = ['registration', 'license', 'insurance', 'inspection', 'custom'] as const;
export type DeadlineKind = (typeof DEADLINE_KINDS)[number];

export const DEADLINE_KIND_LABELS: Record<DeadlineKind, string> = {
  registration: 'Registration',
  license: "Driver's licence",
  insurance: 'Insurance',
  inspection: 'Inspection',
  custom: 'Custom reminder',
};

// Kinds that must be attached to a vehicle (mirrors the migration trigger + cloud check).
const VEHICLE_BOUND_KINDS: readonly DeadlineKind[] = ['registration', 'insurance', 'inspection'];

const MAX_LABEL = 80;

export type DeadlineRow = {
  id: string;
  user_vehicle_id: string | null;
  kind: string;
  label: string | null;
  due_date: string;
  reminder_offsets: string; // JSON int array
  enabled: number;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
  client_updated_at: number;
  sync_status: string;
  server_updated_at: string | null;
};

export type DeadlineInput = {
  id: string;
  kind: DeadlineKind;
  user_vehicle_id?: string | null;
  label?: string | null;
  due_date: string;
  reminder_offsets?: readonly number[];
  enabled?: boolean;
};

export function parseDeadlineOffsets(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is number => Number.isInteger(n));
  } catch {
    return [];
  }
}

export function validateDeadlineInput(input: DeadlineInput): string[] {
  const errors: string[] = [];
  if (!(DEADLINE_KINDS as readonly string[]).includes(input.kind)) {
    errors.push('Choose a reminder type.');
  }
  if (VEHICLE_BOUND_KINDS.includes(input.kind) && !input.user_vehicle_id) {
    errors.push('This reminder must be attached to a vehicle.');
  }
  if (parseDateOnly(input.due_date) == null) {
    errors.push('Enter the due date as YYYY-MM-DD.');
  }
  const label = input.label?.trim();
  if (label && label.length > MAX_LABEL) errors.push(`Label must be ${MAX_LABEL} characters or fewer.`);
  const offsets = input.reminder_offsets;
  if (offsets != null) {
    if (offsets.length === 0) errors.push('Keep at least one reminder notice.');
    for (const o of offsets) {
      if (!(REMINDER_OFFSET_CHOICES as readonly number[]).includes(o)) {
        errors.push(`Notice must be one of: ${REMINDER_OFFSET_CHOICES.join(', ')} days.`);
        break;
      }
    }
  }
  return errors;
}

// Live rows (not soft-deleted), soonest first; ties broken by kind and id for stable order.
export async function listDeadlines(db: Db, opts?: { vehicleId?: string }): Promise<DeadlineRow[]> {
  const where = opts?.vehicleId
    ? 'WHERE deleted_at IS NULL AND user_vehicle_id = ?'
    : 'WHERE deleted_at IS NULL';
  const params = opts?.vehicleId ? [opts.vehicleId] : [];
  return db.getAllAsync<DeadlineRow>(
    `SELECT * FROM deadlines ${where} ORDER BY due_date ASC, kind ASC, id ASC`,
    ...params,
  );
}

// All rows including disabled and soft-deleted ones — sync and diagnostics need full state.
export async function listAllDeadlines(db: Db): Promise<DeadlineRow[]> {
  return db.getAllAsync<DeadlineRow>('SELECT * FROM deadlines ORDER BY due_date ASC, id ASC');
}

export async function getDeadline(db: Db, id: string): Promise<DeadlineRow | null> {
  return db.getFirstAsync<DeadlineRow>('SELECT * FROM deadlines WHERE id = ?', id);
}

export async function getVehicleRegistration(db: Db, userVehicleId: string): Promise<DeadlineRow | null> {
  return db.getFirstAsync<DeadlineRow>(
    `SELECT * FROM deadlines
      WHERE user_vehicle_id = ? AND kind = 'registration' AND deleted_at IS NULL
      ORDER BY due_date ASC LIMIT 1`,
    userVehicleId,
  );
}

export function upsertDeadline(db: Db, input: DeadlineInput, now = Date.now()): Promise<DeadlineRow> {
  return serialize(async () => {
    const errors = validateDeadlineInput(input);
    if (errors.length) throw new MaintenanceValidationError(errors);
    if (input.user_vehicle_id) {
      const vehicle = await getVehicle(db, input.user_vehicle_id);
      if (!vehicle) throw new MaintenanceNotFoundError(input.user_vehicle_id);
    }
    const offsets = input.reminder_offsets ?? [30, 7, 3, 0];
    const enabled = input.enabled === false ? 0 : 1;
    const label = input.label?.trim() || null;
    const existing = await getDeadline(db, input.id);
    if (existing) {
      // Re-enabling on edit keeps the record; a soft-deleted row stays history, so editing a
      // deleted reminder creates nothing — callers pass a fresh id for that case.
      if (existing.deleted_at != null) throw new MaintenanceValidationError(['That reminder was removed.']);
      await db.runAsync(
        `UPDATE deadlines
            SET kind = ?, user_vehicle_id = ?, label = ?, due_date = ?, reminder_offsets = ?,
                enabled = ?, updated_at = ?, client_updated_at = ?, sync_status = 'pending'
          WHERE id = ?`,
        input.kind, input.user_vehicle_id ?? null, label, input.due_date,
        JSON.stringify(offsets), enabled, now, now, input.id,
      );
      return (await getDeadline(db, input.id))!;
    }
    await db.runAsync(
      `INSERT INTO deadlines
         (id, user_vehicle_id, kind, label, due_date, reminder_offsets, enabled,
          created_at, updated_at, client_updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      input.id, input.user_vehicle_id ?? null, input.kind, label, input.due_date,
      JSON.stringify(offsets), enabled, now, now, now,
    );
    const row = await getDeadline(db, input.id);
    if (!row) throw new MaintenanceNotFoundError(input.id);
    return row;
  });
}

// Enable/disable without touching the stored date — used by the "pause reminders" control.
export function setDeadlineEnabled(db: Db, id: string, enabled: boolean, now = Date.now()): Promise<boolean> {
  return serialize(async () => {
    const existing = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM deadlines WHERE id = ? AND deleted_at IS NULL',
      id,
    );
    if (!existing) return false;
    await db.runAsync(
      `UPDATE deadlines SET enabled = ?, updated_at = ?, client_updated_at = ?, sync_status = 'pending'
        WHERE id = ? AND deleted_at IS NULL`,
      enabled ? 1 : 0, now, now, id,
    );
    return true;
  });
}

export function softDeleteDeadline(db: Db, id: string, now = Date.now()): Promise<boolean> {
  return serialize(async () => {
    const existing = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM deadlines WHERE id = ? AND deleted_at IS NULL',
      id,
    );
    if (!existing) return false;
    await db.runAsync(
      `UPDATE deadlines SET deleted_at = ?, enabled = 0, updated_at = ?, client_updated_at = ?, sync_status = 'pending'
        WHERE id = ? AND deleted_at IS NULL`,
      now, now, now, id,
    );
    return true;
  });
}
