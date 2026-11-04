import { MIN_REVIEW_RIDE_S, POLYLINE, PROCESS } from '../../config/tracking';
import { newRideState, processFixes } from '../../domain/ride/processFixes';
import { buildRoute, singlePolyline } from '../../domain/ride/route';
import { summarizeRide } from '../../domain/ride/summary';
import type { DomainEvent, Fix, ProcessConfig, ProcessResult, RideState } from '../../domain/ride/types';
import { ensureRideMileageRowInTx } from './mileageStore';
import { getMeta, setMeta } from './metaStore';
import { serialize } from './serialize';
import type { Db } from './types';

export type RecoveryState = 'none' | 'verifying' | 'confirmed' | 'failed';

export type RideRow = {
  id: string;
  user_vehicle_id: string | null;
  vehicle_name: string | null;
  started_at: number;
  ended_at: number | null;
  status: 'recording' | 'finished' | 'recovered';
  point_count: number;
  distance_m: number;
  raw_distance_m: number;
  max_gap_s: number;
  max_delay_ms: number;
  late_batches: number;
  untracked_gap_s: number;
  untracked_gap_m: number;
  max_speed_ms: number;
  last_ts: number | null;
  last_lat: number | null;
  last_lon: number | null;
  last_raw_lat: number | null;
  last_raw_lon: number | null;
  duration_s: number | null;
  avg_speed_ms: number | null;
  polyline: string | null;
  polyline_tolerance_m: number | null;
  needs_review: number;
  raw_purged_at: number | null;
  sync_status: string;
  first_usable_ts: number | null;
  last_usable_ts: number | null;
  last_usable_lat: number | null;
  last_usable_lon: number | null;
  tracked_s: number | null;
  route_segments: string | null;
  interrupted: number;
  interruption_count: number;
  interruption_s: number;
  recovery_state: RecoveryState;
  integrity_issue: string | null;
};

type PointRow = {
  seq: number; ts: number; lat: number; lon: number;
  accuracy: number | null; speed: number | null; altitude: number | null; heading: number | null;
};

export class RideAlreadyActiveError extends Error {
  constructor(public readonly rideId: string) {
    super(`A ride is already recording (${rideId})`);
    this.name = 'RideAlreadyActiveError';
  }
}

// ---------------------------------------------------------------- meta + events
export { getMeta, setMeta } from './metaStore';

// Logging must never break tracking.
export async function logEvent(db: Db, type: string, detail = '', now = Date.now()): Promise<void> {
  try {
    await db.runAsync('INSERT INTO events (ts, type, detail) VALUES (?, ?, ?)', now, type, detail);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- state mapping
function rowToState(r: RideRow): RideState {
  return {
    startedAt: r.started_at,
    lastTs: r.last_ts,
    lastLat: r.last_lat,
    lastLon: r.last_lon,
    lastRawLat: r.last_raw_lat,
    lastRawLon: r.last_raw_lon,
    pointCount: r.point_count,
    distanceM: r.distance_m,
    rawDistanceM: r.raw_distance_m,
    maxGapS: r.max_gap_s,
    maxDelayMs: r.max_delay_ms,
    lateBatches: r.late_batches,
    untrackedGapS: r.untracked_gap_s,
    untrackedGapM: r.untracked_gap_m,
    maxSpeedMs: r.max_speed_ms,
    firstUsableTs: r.first_usable_ts,
    lastUsableTs: r.last_usable_ts,
    lastUsableLat: r.last_usable_lat,
    lastUsableLon: r.last_usable_lon,
  };
}

async function updateRideFromState(db: Db, id: string, s: RideState, now: number): Promise<void> {
  await db.runAsync(
    `UPDATE rides SET point_count=?, distance_m=?, raw_distance_m=?, max_gap_s=?, max_delay_ms=?, late_batches=?,
       untracked_gap_s=?, untracked_gap_m=?, max_speed_ms=?, last_ts=?, last_lat=?, last_lon=?,
       last_raw_lat=?, last_raw_lon=?, first_usable_ts=?, last_usable_ts=?, last_usable_lat=?, last_usable_lon=?,
       client_updated_at=? WHERE id=?`,
    s.pointCount, s.distanceM, s.rawDistanceM, s.maxGapS, s.maxDelayMs, s.lateBatches,
    s.untrackedGapS, s.untrackedGapM, s.maxSpeedMs, s.lastTs, s.lastLat, s.lastLon,
    s.lastRawLat, s.lastRawLon, s.firstUsableTs, s.lastUsableTs, s.lastUsableLat, s.lastUsableLon,
    now, id,
  );
}

const pointToFix = (p: PointRow): Fix => ({
  timestamp: p.ts, lat: p.lat, lon: p.lon, accuracy: p.accuracy, speed: p.speed, altitude: p.altitude, heading: p.heading,
});

// ---------------------------------------------------------------- ride lifecycle
export async function getActiveRideId(db: Db): Promise<string | null> {
  return getMeta(db, 'active_ride');
}

// Atomic check-and-create: a second start while a ride is recording is rejected, so two concurrent starts can
// never leave an orphaned `recording` ride behind.
// `vehicleName` is the name snapshot taken at start; it is stored once and never rewritten, so a later rename or
// removal of that vehicle cannot change what history shows for this ride.
export function createRide(
  db: Db,
  id: string,
  startedAt: number,
  userVehicleId: string | null = null,
  vehicleName: string | null = null,
): Promise<void> {
  return serialize(async () => {
    await db.withTransactionAsync(async () => {
      const activeId = await getMeta(db, 'active_ride');
      if (activeId) {
        const a = await db.getFirstAsync<{ status: string }>('SELECT status FROM rides WHERE id = ?', activeId);
        if (a && a.status === 'recording') throw new RideAlreadyActiveError(activeId);
      }
      await db.runAsync(
        `INSERT INTO rides (id, user_vehicle_id, vehicle_name, started_at, status, client_updated_at)
         VALUES (?, ?, ?, ?, 'recording', ?)`,
        id, userVehicleId, vehicleName, startedAt, startedAt,
      );
      await setMeta(db, 'active_ride', id);
    });
    await logEvent(db, 'ride_start', id, startedAt);
  });
}

// Stores one batch of GPS fixes for the active ride. Returns null if no ride is recording.
// Batches are applied in the order applyBatch is called (FIFO queue); fixes inside a batch are sorted by time.
export function applyBatch(
  db: Db,
  fixes: Fix[],
  now = Date.now(),
  cfg: ProcessConfig = PROCESS,
): Promise<ProcessResult | null> {
  return serialize(async () => {
    const rideId = await getActiveRideId(db);
    if (!rideId) return null; // a late batch arrived after the ride ended
    let result: ProcessResult | null = null;
    await db.withTransactionAsync(async () => {
      const row = await db.getFirstAsync<RideRow>('SELECT * FROM rides WHERE id = ?', rideId);
      if (!row || row.status !== 'recording') return;
      result = processFixes(rowToState(row), fixes, now, cfg);
      for (const f of result.accepted) {
        await db.runAsync(
          `INSERT OR IGNORE INTO points (ride_id, seq, ts, lat, lon, accuracy, speed, altitude, heading, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          rideId, f.seq, f.timestamp, f.lat, f.lon, f.accuracy, f.speed, f.altitude, f.heading, now,
        );
      }
      await updateRideFromState(db, rideId, result.state, now);
    });
    // Logged after the transaction so a rollback can never swallow them.
    const res = result as ProcessResult | null;
    if (res) for (const e of res.events) await logEvent(db, e.type, e.detail, now);
    return res;
  });
}

// Finalizes a recording ride INSIDE an open transaction. Returns events to log afterwards.
async function finalizeInTx(
  db: Db,
  rideId: string,
  requested: 'finished' | 'recovered',
  endedAt: number,
  extraIssue: string | null,
): Promise<DomainEvent[]> {
  const events: DomainEvent[] = [];
  const row = await db.getFirstAsync<RideRow>('SELECT * FROM rides WHERE id = ?', rideId);
  if (!row || row.status !== 'recording') return events;

  const pts = await db.getAllAsync<PointRow>(
    'SELECT seq, ts, lat, lon, accuracy, speed, altitude, heading FROM points WHERE ride_id = ? ORDER BY seq', rideId);
  let state = rowToState(row);
  const issues: string[] = extraIssue ? [extraIssue] : [];

  // Integrity: stored rows must match the counter. On a mismatch points were lost (or added) outside the normal
  // path. Rebuild EVERY total from the rows that really exist so the numbers describe the stored data, and flag it.
  if (pts.length !== state.pointCount) {
    const detail = `rows=${pts.length} counter=${state.pointCount}`;
    issues.push(detail);
    events.push({ type: 'integrity_mismatch', detail });
    const rebuilt = processFixes(newRideState(row.started_at), pts.map(pointToFix), endedAt, PROCESS).state;
    rebuilt.maxDelayMs = state.maxDelayMs; // delivery delays cannot be rebuilt from points
    rebuilt.lateBatches = state.lateBatches;
    rebuilt.pointCount = pts.length;
    events.push({
      type: 'integrity_repaired',
      detail: `distance_m ${Math.round(state.distanceM)}->${Math.round(rebuilt.distanceM)} untracked_s ${Math.round(state.untrackedGapS)}->${Math.round(rebuilt.untrackedGapS)}`,
    });
    state = rebuilt;
  }

  const summary = summarizeRide(state, endedAt);
  const route = buildRoute(pts, {
    maxAccuracyM: PROCESS.maxAccuracyM,
    breakGapS: PROCESS.untrackedGapS,
    toleranceM: POLYLINE.toleranceM,
    precision: POLYLINE.precision,
    minSegmentPoints: 2,
  });
  // A ride that was interrupted is ALWAYS finished as 'recovered', whichever button the user pressed.
  const status = requested === 'finished' && row.interrupted ? 'recovered' : requested;
  const noRoute = route.segments.length === 0 && summary.durationS >= MIN_REVIEW_RIDE_S;
  const needsReview =
    status === 'recovered' || row.interrupted || state.untrackedGapS > 0 || issues.length > 0 || noRoute ? 1 : 0;

  await db.runAsync(
    `UPDATE rides SET status=?, ended_at=?, point_count=?, distance_m=?, raw_distance_m=?, max_gap_s=?, max_delay_ms=?,
       late_batches=?, untracked_gap_s=?, untracked_gap_m=?, max_speed_ms=?, last_ts=?, last_lat=?, last_lon=?,
       last_raw_lat=?, last_raw_lon=?, first_usable_ts=?, last_usable_ts=?, last_usable_lat=?, last_usable_lon=?,
       duration_s=?, tracked_s=?, avg_speed_ms=?, polyline=?, route_segments=?, polyline_tolerance_m=?,
       integrity_issue=?, needs_review=?, sync_status='pending', client_updated_at=? WHERE id=?`,
    status, endedAt, state.pointCount, state.distanceM, state.rawDistanceM, state.maxGapS, state.maxDelayMs,
    state.lateBatches, state.untrackedGapS, state.untrackedGapM, state.maxSpeedMs, state.lastTs, state.lastLat, state.lastLon,
    state.lastRawLat, state.lastRawLon, state.firstUsableTs, state.lastUsableTs, state.lastUsableLat, state.lastUsableLon,
    summary.durationS, summary.trackedS, summary.avgSpeedMs, singlePolyline(route), JSON.stringify(route), POLYLINE.toleranceM,
    issues.length > 0 ? issues.join('; ') : null, needsReview, endedAt, rideId,
  );
  if ((await getMeta(db, 'active_ride')) === rideId) await setMeta(db, 'active_ride', null);

  // Applied mileage: one ledger entry per finalized ride, in the SAME transaction as the ride update,
  // from the persisted distance   never from the odometer or the raw GPS points again. Idempotent by
  // ride_id, so it is harmless if a caller ever finalizes twice. Rides with no vehicle, or with an
  // unusable distance, are finalized without an entry (see ensureRideMileageRowInTx).
  const ledger = await ensureRideMileageRowInTx(
    db,
    { id: rideId, user_vehicle_id: row.user_vehicle_id, distance_m: state.distanceM, ended_at: endedAt },
    endedAt,
  );
  if (ledger.created) {
    events.push({ type: 'ride_ledger_applied', detail: `${rideId} ${ledger.entry.applied_km}km` });
  }

  events.push({ type: 'ride_stop', detail: `${rideId} ${status}` });
  return events;
}

// `status` is the REQUESTED status. A ride marked interrupted is upgraded to 'recovered'; never downgraded.
export function finishRide(
  db: Db,
  rideId: string,
  status: 'finished' | 'recovered' = 'finished',
  endedAt = Date.now(),
): Promise<RideRow | null> {
  return serialize(async () => {
    let events: DomainEvent[] = [];
    await db.withTransactionAsync(async () => {
      events = await finalizeInTx(db, rideId, status, endedAt, null);
    });
    // Repair path. finalizeInTx only writes the ledger on the recording -> finalized transition, so a
    // ride that was already finalized (e.g. before this hook existed) or a retry after an interrupted
    // close is finished here. The ensure is idempotent by ride_id, so it is a no-op on the normal path
    // and can never create a duplicate.
    await db.withTransactionAsync(async () => {
      const r = await db.getFirstAsync<RideRow>('SELECT * FROM rides WHERE id = ?', rideId);
      if (r && r.status !== 'recording') {
        await ensureRideMileageRowInTx(
          db,
          { id: r.id, user_vehicle_id: r.user_vehicle_id, distance_m: r.distance_m, ended_at: r.ended_at },
          endedAt,
        );
      }
    });
    for (const e of events) await logEvent(db, e.type, e.detail, endedAt);
    return db.getFirstAsync<RideRow>('SELECT * FROM rides WHERE id = ?', rideId);
  });
}

// Rides left in `recording` that are NOT the active ride (should not happen; defensive). They are closed as
// 'recovered', flagged `orphan_recording_ride`, and always need review.
export function repairOrphanRides(db: Db, now = Date.now()): Promise<number> {
  return serialize(async () => {
    const active = await getActiveRideId(db);
    const orphans = await db.getAllAsync<{ id: string; started_at: number; last_ts: number | null }>(
      "SELECT id, started_at, last_ts FROM rides WHERE status = 'recording' AND id != ?", active ?? '');
    const all: DomainEvent[] = [];
    await db.withTransactionAsync(async () => {
      for (const o of orphans) {
        all.push(...(await finalizeInTx(db, o.id, 'recovered', o.last_ts ?? o.started_at, 'orphan_recording_ride')));
      }
    });
    for (const e of all) await logEvent(db, e.type, e.detail, now);
    return orphans.length;
  });
}

// ---------------------------------------------------------------- recovery state (persisted)
export function markInterrupted(db: Db, rideId: string, sinceLastPointS: number, now = Date.now()): Promise<void> {
  return serialize(async () => {
    await db.runAsync(
      `UPDATE rides SET interrupted=1, interruption_count=interruption_count+1, interruption_s=interruption_s+?,
         recovery_state='verifying', client_updated_at=? WHERE id=? AND status='recording'`,
      sinceLastPointS, now, rideId,
    );
    await logEvent(db, 'ride_interrupted', `${rideId} since_last_point_s=${sinceLastPointS}`, now);
  });
}

export function setRecoveryState(db: Db, rideId: string, state: RecoveryState, now = Date.now()): Promise<void> {
  return serialize(async () => {
    await db.runAsync(
      "UPDATE rides SET recovery_state=?, client_updated_at=? WHERE id=? AND status='recording'", state, now, rideId);
    await logEvent(db, 'recovery_state', `${rideId} ${state}`, now);
  });
}

// A ride that was recording when the app last died. `sinceLastPointS` is how long no point has arrived.
export async function findUnfinishedRide(db: Db, now = Date.now()) {
  const rideId = await getActiveRideId(db);
  if (!rideId) return null;
  const r = await db.getFirstAsync<RideRow>('SELECT * FROM rides WHERE id = ?', rideId);
  if (!r || r.status !== 'recording') return null;
  const last = r.last_ts ?? r.started_at;
  return { ride: r, sinceLastPointS: Math.max(0, Math.round((now - last) / 1000)) };
}

export function listRides(db: Db, limit = 10): Promise<RideRow[]> {
  return db.getAllAsync<RideRow>('SELECT * FROM rides ORDER BY started_at DESC LIMIT ?', limit);
}

export function getRoute(db: Db, rideId: string): Promise<{ lat: number; lon: number }[]> {
  return db.getAllAsync('SELECT lat, lon FROM points WHERE ride_id = ? ORDER BY seq', rideId);
}

export function getRide(db: Db, rideId: string): Promise<RideRow | null> {
  return db.getFirstAsync<RideRow>('SELECT * FROM rides WHERE id = ?', rideId);
}

export function getLatestUsableSpeed(
  db: Db,
  rideId: string,
): Promise<{ speed_ms: number | null; timestamp: number } | null> {
  return db.getFirstAsync(
    `SELECT speed AS speed_ms, ts AS timestamp
     FROM points
     WHERE ride_id = ?
       AND accuracy IS NOT NULL
       AND accuracy <= ?
     ORDER BY seq DESC
     LIMIT 1`,
    rideId,
    PROCESS.maxAccuracyM,
  );
}

// Used when tracking could not start (e.g. permission revoked): removes the empty ride so no ghost ride remains.
export function abortRide(db: Db, rideId: string, reason: string): Promise<boolean> {
  return serialize(async () => {
    let removed = false;
    await db.withTransactionAsync(async () => {
      const row = await db.getFirstAsync<RideRow>('SELECT * FROM rides WHERE id = ?', rideId);
      if (!row || row.status !== 'recording' || row.point_count > 0) return;
      await db.runAsync('DELETE FROM rides WHERE id = ?', rideId);
      await setMeta(db, 'active_ride', null);
      removed = true;
    });
    await logEvent(db, 'ride_start_failed', `${rideId} ${reason}`);
    return removed;
  });
}

export { newRideState };
