import { getComponentDefinition, isActionAllowedForComponent } from '../../domain/maintenance/components';
import { serialize } from './serialize';
import type { Db } from './types';
import { getVehicle } from './vehicleStore';
import { MaintenanceNotFoundError, MaintenanceValidationError } from './maintenanceErrors';

// Service / inspection log (schema v5). Insert-only: a correction is a new row with action='void'
// and voids_event_id pointing at the row it cancels. `performed_at` is the wall-clock time the
// service happened and is the baseline used to count applied_km for that component.

export const SERVICE_ACTIONS = ['replace', 'clean', 'lubricate', 'inspect', 'service', 'baseline', 'void'] as const;
export type ServiceAction = (typeof SERVICE_ACTIONS)[number];

export type ServiceEventRow = {
  id: string;
  user_vehicle_id: string;
  component_code: string;
  action: string;
  performed_at: number;
  odo_at: number | null;
  estimated: number;
  voids_event_id: string | null;
  notes: string | null;
  client_created_at: number;
  created_at: number;
  sync_status: string;
  server_updated_at: string | null;
};

export type ServiceEventInput = {
  id: string;
  user_vehicle_id: string;
  component_code: string;
  action: ServiceAction;
  performed_at: number;
  odo_at?: number | null;
  estimated?: boolean;
  voids_event_id?: string | null;
  notes?: string | null;
};

const MAX_NOTE = 500;

const text = (v: string | null | undefined): string | null => {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
};

const isAction = (v: string): v is ServiceAction => (SERVICE_ACTIONS as readonly string[]).includes(v);

export function validateServiceEventInput(input: ServiceEventInput): string[] {
  const errors: string[] = [];
  const known = getComponentDefinition(input.component_code);
  if (!known) errors.push('Unknown component.');
  if (!isAction(input.action)) errors.push('Unknown service action.');
  // The action must be one this component supports (generic service/baseline/void always qualify).
  if (known && isAction(input.action) && !isActionAllowedForComponent(input.action, input.component_code)) {
    errors.push(`Action '${input.action}' is not valid for ${input.component_code}.`);
  }
  if (!Number.isFinite(input.performed_at)) errors.push('Service time is required.');
  if (input.odo_at != null && (!Number.isFinite(input.odo_at) || input.odo_at < 0)) {
    errors.push('Odometer must be zero or greater.');
  }
  // An explicit baseline is an estimate of past usage, never an observed event.
  if (input.action === 'baseline' && !input.estimated) {
    errors.push('A baseline event must be estimated.');
  }
  if (input.action === 'void') {
    if (!input.voids_event_id) errors.push('A void event must reference the event it cancels.');
  } else if (input.voids_event_id) {
    errors.push('Only a void event may reference another event.');
  }
  const notes = text(input.notes);
  if (notes && notes.length > MAX_NOTE) errors.push(`Notes must be ${MAX_NOTE} characters or fewer.`);
  return errors;
}

export function getServiceEvent(db: Db, id: string): Promise<ServiceEventRow | null> {
  return db.getFirstAsync<ServiceEventRow>('SELECT * FROM service_events WHERE id = ?', id);
}

export function listServiceEvents(db: Db, userVehicleId: string, componentCode?: string): Promise<ServiceEventRow[]> {
  if (componentCode) {
    return db.getAllAsync<ServiceEventRow>(
      'SELECT * FROM service_events WHERE user_vehicle_id = ? AND component_code = ? ORDER BY performed_at ASC, id ASC',
      userVehicleId, componentCode,
    );
  }
  return db.getAllAsync<ServiceEventRow>(
    'SELECT * FROM service_events WHERE user_vehicle_id = ? ORDER BY performed_at ASC, id ASC',
    userVehicleId,
  );
}

// Latest effective (non-void, not itself voided) event for a component — the usage baseline.
export function latestServiceEvent(db: Db, userVehicleId: string, componentCode: string): Promise<ServiceEventRow | null> {
  return db.getFirstAsync<ServiceEventRow>(
    `SELECT * FROM service_events s
      WHERE s.user_vehicle_id = ? AND s.component_code = ?
        AND s.action <> 'void'
        AND NOT EXISTS (SELECT 1 FROM service_events v WHERE v.voids_event_id = s.id)
      ORDER BY s.performed_at DESC, s.id DESC LIMIT 1`,
    userVehicleId, componentCode,
  );
}

// Latest effective event that actually RESETS the component's usage interval (action 'replace' or an
// explicit 'baseline'). A generic 'service' or an 'inspect'/'clean'/'lubricate' note does not reset
// usage, so it is not a baseline; see domain/maintenance/baseline.ts. Used to count applied_km.
export function latestBaselineServiceEvent(db: Db, userVehicleId: string, componentCode: string): Promise<ServiceEventRow | null> {
  return db.getFirstAsync<ServiceEventRow>(
    `SELECT * FROM service_events s
      WHERE s.user_vehicle_id = ? AND s.component_code = ?
        AND s.action IN ('replace', 'baseline')
        AND NOT EXISTS (SELECT 1 FROM service_events v WHERE v.voids_event_id = s.id)
      ORDER BY s.performed_at DESC, s.id DESC LIMIT 1`,
    userVehicleId, componentCode,
  );
}

export function insertServiceEvent(db: Db, input: ServiceEventInput, now = Date.now()): Promise<ServiceEventRow> {
  return serialize(() => insertServiceRow(db, input, now));
}

async function insertServiceRow(db: Db, input: ServiceEventInput, now: number): Promise<ServiceEventRow> {
  const errors = validateServiceEventInput(input);
  if (errors.length) throw new MaintenanceValidationError(errors);
  // A service event cannot be dated in the future: it would be ignored by usage sums until that
  // time, letting a future-dated baseline hide overdue wear. `now` is the write time.
  if (input.performed_at > now) throw new MaintenanceValidationError(['Service date cannot be in the future.']);
  const vehicle = await getVehicle(db, input.user_vehicle_id);
  if (!vehicle) throw new MaintenanceNotFoundError(input.user_vehicle_id);
  await db.runAsync(
    `INSERT INTO service_events
       (id, user_vehicle_id, component_code, action, performed_at, odo_at, estimated, voids_event_id,
        notes, client_created_at, created_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    input.id, input.user_vehicle_id, input.component_code, input.action, input.performed_at,
    input.odo_at ?? null, input.estimated ? 1 : 0, input.voids_event_id ?? null, text(input.notes), now, now,
  );
  const row = await getServiceEvent(db, input.id);
  if (!row) throw new MaintenanceNotFoundError(input.id);
  return row;
}

// Correction: insert a void event cancelling an existing event. The original is never modified.
export function voidServiceEvent(db: Db, originalId: string, voidId: string, now = Date.now()): Promise<ServiceEventRow> {
  return serialize(async () => {
    const original = await getServiceEvent(db, originalId);
    if (!original) throw new MaintenanceNotFoundError(originalId);
    if (original.action === 'void') throw new MaintenanceValidationError(['A void event cannot be voided.']);
    const existingVoid = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM service_events WHERE voids_event_id = ?', originalId,
    );
    if (existingVoid) throw new MaintenanceValidationError(['Event is already voided.']);
    return insertServiceRow(
      db,
      {
        id: voidId,
        user_vehicle_id: original.user_vehicle_id,
        component_code: original.component_code,
        action: 'void',
        performed_at: now,
        voids_event_id: originalId,
        notes: `void ${originalId}`,
      },
      now,
    );
  });
}
