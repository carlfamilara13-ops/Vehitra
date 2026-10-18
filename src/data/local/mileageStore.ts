import { serialize } from './serialize';
import type { Db } from './types';
import { getVehicle } from './vehicleStore';
import { MaintenanceNotFoundError, MaintenanceValidationError } from './maintenanceErrors';

// The applied-distance ledger (schema v5). Insert-only: a correction is a new row with kind='void'
// pointing at the entry it cancels (see maintenanceSchema / docs/SECURITY.md). `applied_km` counts
// toward maintenance and is never an odometer difference, so odometer resets cannot corrupt usage.
// Entries are ordered for replay/usage by (client_created_at, id).

export const MILEAGE_KINDS = ['initial', 'ride', 'dashboard_reading', 'adjustment', 'odometer_replacement', 'void'] as const;
export type MileageKind = (typeof MILEAGE_KINDS)[number];

export const MILEAGE_SOURCES = ['gps', 'dashboard_reading', 'manual_adjustment', 'estimated', 'initial'] as const;
export type MileageSource = (typeof MILEAGE_SOURCES)[number];

export type MileageEntryRow = {
  id: string;
  user_vehicle_id: string;
  kind: string;
  source: string;
  ride_id: string | null;
  gps_distance_m: number | null;
  applied_km: number;
  odo_reading_after: number | null;
  odo_offset_delta: number;
  suggested_km: number | null;
  flags: string; // JSON array
  voids_entry_id: string | null;
  note: string | null;
  client_created_at: number;
  created_at: number;
  sync_status: string;
  server_updated_at: string | null;
};

export type MileageEntryInput = {
  id: string;
  user_vehicle_id: string;
  kind: MileageKind;
  source: MileageSource;
  applied_km: number;
  ride_id?: string | null;
  gps_distance_m?: number | null;
  odo_reading_after?: number | null;
  odo_offset_delta?: number;
  suggested_km?: number | null;
  flags?: readonly string[];
  voids_entry_id?: string | null;
  note?: string | null;
};

// Where a baseline sits in ledger order: the timestamp and id of the event that reset usage.
export type LedgerBaseline = { at: number; id: string };

export const MILEAGE_FLAGS = ['calibration', 'large_jump', 'rollover', 'reading_lowered', 'needs_review'] as const;
export type MileageFlag = (typeof MILEAGE_FLAGS)[number];

const MAX_NOTE = 500;

const text = (v: string | null | undefined): string | null => {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
};

const isKind = (v: string): v is MileageKind => (MILEAGE_KINDS as readonly string[]).includes(v);
const isSource = (v: string): v is MileageSource => (MILEAGE_SOURCES as readonly string[]).includes(v);
const isFlag = (v: string): v is MileageFlag => (MILEAGE_FLAGS as readonly string[]).includes(v);

export function validateMileageEntryInput(input: MileageEntryInput): string[] {
  const errors: string[] = [];
  if (!isKind(input.kind)) errors.push('Unknown mileage entry kind.');
  if (!isSource(input.source)) errors.push('Unknown mileage entry source.');
  if (!Number.isFinite(input.applied_km) || input.applied_km < 0) errors.push('Applied distance must be zero or greater.');

  if (input.kind === 'void') {
    if (!input.voids_entry_id) errors.push('A void entry must reference the entry it cancels.');
    if (input.applied_km !== 0) errors.push('A void entry must not apply distance.');
  } else if (input.voids_entry_id) {
    errors.push('Only a void entry may reference another entry.');
  }

  if (input.gps_distance_m != null && (!Number.isFinite(input.gps_distance_m) || input.gps_distance_m < 0)) {
    errors.push('GPS distance must be zero or greater.');
  }
  if (input.odo_reading_after != null && (!Number.isFinite(input.odo_reading_after) || input.odo_reading_after < 0)) {
    errors.push('Odometer reading must be zero or greater.');
  }
  if (input.odo_offset_delta != null && !Number.isFinite(input.odo_offset_delta)) {
    errors.push('Odometer offset must be a number.');
  }
  if (input.suggested_km != null && (!Number.isFinite(input.suggested_km) || input.suggested_km < 0)) {
    errors.push('Suggested distance must be zero or greater.');
  }
  if (input.flags && input.flags.length) {
    for (const f of input.flags) {
      if (!isFlag(f)) errors.push(`Unknown mileage flag: ${f}.`);
    }
  }
  const note = text(input.note);
  if (note && note.length > MAX_NOTE) errors.push(`Note must be ${MAX_NOTE} characters or fewer.`);
  return errors;
}

export function getMileageEntry(db: Db, id: string): Promise<MileageEntryRow | null> {
  return db.getFirstAsync<MileageEntryRow>('SELECT * FROM mileage_entries WHERE id = ?', id);
}

export function listMileageEntries(db: Db, userVehicleId: string): Promise<MileageEntryRow[]> {
  return db.getAllAsync<MileageEntryRow>(
    'SELECT * FROM mileage_entries WHERE user_vehicle_id = ? ORDER BY client_created_at ASC, id ASC',
    userVehicleId,
  );
}

export function insertMileageEntry(db: Db, input: MileageEntryInput, now = Date.now()): Promise<MileageEntryRow> {
  return serialize(() => insertMileageRow(db, input, now));
}

// The un-serialized core, so callers that already hold the write queue (voidMileageEntry) never
// nest serialize() — the queue is strictly FIFO and a nested run would deadlock.
async function insertMileageRow(db: Db, input: MileageEntryInput, now: number): Promise<MileageEntryRow> {
  const errors = validateMileageEntryInput(input);
  if (errors.length) throw new MaintenanceValidationError(errors);
  const vehicle = await getVehicle(db, input.user_vehicle_id);
  if (!vehicle) throw new MaintenanceNotFoundError(input.user_vehicle_id);
  await db.runAsync(
    `INSERT INTO mileage_entries
       (id, user_vehicle_id, kind, source, ride_id, gps_distance_m, applied_km, odo_reading_after,
        odo_offset_delta, suggested_km, flags, voids_entry_id, note, client_created_at, created_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    input.id, input.user_vehicle_id, input.kind, input.source, input.ride_id ?? null,
    input.gps_distance_m ?? null, input.applied_km, input.odo_reading_after ?? null,
    input.odo_offset_delta ?? 0, input.suggested_km ?? null, JSON.stringify(input.flags ?? []),
    input.voids_entry_id ?? null, text(input.note), now, now,
  );
  const row = await getMileageEntry(db, input.id);
  if (!row) throw new MaintenanceNotFoundError(input.id);
  return row;
}

// Correction: insert a void row that cancels an existing entry. The original is never modified.
export function voidMileageEntry(db: Db, originalId: string, voidId: string, now = Date.now()): Promise<MileageEntryRow> {
  return serialize(async () => {
    const original = await getMileageEntry(db, originalId);
    if (!original) throw new MaintenanceNotFoundError(originalId);
    if (original.kind === 'void') throw new MaintenanceValidationError(['A void entry cannot be voided.']);
    const existingVoid = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM mileage_entries WHERE voids_entry_id = ?', originalId,
    );
    if (existingVoid) throw new MaintenanceValidationError(['Entry is already voided.']);
    return insertMileageRow(
      db,
      {
        id: voidId,
        user_vehicle_id: original.user_vehicle_id,
        kind: 'void',
        source: original.source as MileageSource,
        applied_km: 0,
        voids_entry_id: originalId,
        note: `void ${originalId}`,
      },
      now,
    );
  });
}

// ---------------------------------------------------------------- ride-finalization hook

// Kilometres counted for a finalized ride: the persisted distance in metres, converted with at most
// 3 decimal places (nearest metre) and never rounded to whole kilometres. Returns null when the
// distance is not a finite, non-negative number, so a corrupt value is skipped rather than failing
// the ride finalization or violating the applied_km >= 0 rule.
export function rideAppliedKm(distanceM: number): number | null {
  if (!Number.isFinite(distanceM) || distanceM < 0) return null;
  return Math.round(distanceM) / 1000;
}

// Deterministic entry id: the same ride always maps to the same ledger row, so a retry cannot add a
// second one. NOTE for the sync step: the cloud `mileage_entries.id` is a uuid, so syncing must
// reconcile this id (this local id is not a uuid).
export const rideMileageEntryId = (rideId: string): string => `ride:${rideId}`;

export type RideLedgerInput = {
  id: string;
  user_vehicle_id: string | null;
  distance_m: number;
  ended_at: number | null;
};

export type RideLedgerOutcome =
  | { created: true; entry: MileageEntryRow }
  | { created: false; reason: 'exists' | 'no_vehicle' | 'invalid_distance' };

// Non-serialized core: use only while already holding the write queue (i.e. inside a transaction), so
// the ledger write can share the ride-finalization transaction. Idempotent: it first looks for an
// existing ride entry and, failing that, inserts with the deterministic id above. `client_created_at`
// is the ride's end time, which is the moment the distance is applied to maintenance.
export async function ensureRideMileageRowInTx(
  db: Db,
  ride: RideLedgerInput,
  now = Date.now(),
): Promise<RideLedgerOutcome> {
  if (!ride.user_vehicle_id) return { created: false, reason: 'no_vehicle' };

  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM mileage_entries WHERE ride_id = ? AND kind = 'ride' LIMIT 1`, ride.id,
  );
  if (existing) return { created: false, reason: 'exists' };

  const appliedKm = rideAppliedKm(ride.distance_m);
  if (appliedKm === null) return { created: false, reason: 'invalid_distance' };

  // The ledger belongs to a vehicle; a ride whose vehicle has since been removed cannot carry one.
  if (!(await getVehicle(db, ride.user_vehicle_id))) return { created: false, reason: 'no_vehicle' };

  const entry = await insertMileageRow(
    db,
    {
      id: rideMileageEntryId(ride.id),
      user_vehicle_id: ride.user_vehicle_id,
      kind: 'ride',
      source: 'gps',
      applied_km: appliedKm,
      ride_id: ride.id,
      gps_distance_m: ride.distance_m,
      odo_reading_after: null,
    },
    ride.ended_at ?? now,
  );
  return { created: true, entry };
}

// Serialized entry point for a standalone retry/repair (a ride finalized before this hook existed,
// or a previous attempt that did not reach the ledger). Never duplicates because it shares the same
// idempotent core.
export function ensureRideMileageEntry(
  db: Db,
  ride: RideLedgerInput,
  now = Date.now(),
): Promise<RideLedgerOutcome> {
  return serialize(async () => {
    let outcome: RideLedgerOutcome = { created: false, reason: 'no_vehicle' };
    await db.withTransactionAsync(async () => {
      outcome = await ensureRideMileageRowInTx(db, ride, now);
    });
    return outcome;
  });
}

// Sum of applied_km since a baseline, excluding void rows and entries cancelled by a void.
// `since` is the baseline's ledger position (last service event or part install); null means "from
// the start of the ledger". Callers treat a null baseline as unknown history and do not sum at all.
export async function sumAppliedKmSince(db: Db, userVehicleId: string, since: LedgerBaseline | null): Promise<number> {
  const base = `
    SELECT COALESCE(SUM(m.applied_km), 0) AS km
    FROM mileage_entries m
    WHERE m.user_vehicle_id = ?
      AND m.kind <> 'void'
      AND NOT EXISTS (SELECT 1 FROM mileage_entries v WHERE v.voids_entry_id = m.id)`;
  const row = since
    ? await db.getFirstAsync<{ km: number }>(
        base + ` AND (m.client_created_at > ? OR (m.client_created_at = ? AND m.id > ?))`,
        userVehicleId, since.at, since.at, since.id,
      )
    : await db.getFirstAsync<{ km: number }>(base, userVehicleId);
  return row?.km ?? 0;
}
