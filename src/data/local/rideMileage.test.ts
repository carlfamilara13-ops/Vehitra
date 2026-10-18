import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import { createVehicle } from './vehicleStore';
import { applyBatch, createRide, finishRide, markInterrupted, type RideRow } from './ridesStore';
import {
  ensureRideMileageEntry, listMileageEntries, rideAppliedKm, rideMileageEntryId,
} from './mileageStore';
import { insertServiceEvent } from './serviceStore';
import { evaluateVehicleMaintenance } from './maintenanceQuery';
import type { Fix } from '../../domain/ride/types';
import type { Db } from './types';

const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);
const LAT = 14.6;
const LON = 121.0;
const M_PER_DEG_LON = 111320 * Math.cos((LAT * Math.PI) / 180);

// tSec is seconds after T0; xM is metres east of LON. steady 5 m/s, accurate fixes.
const fixAt = (tSec: number, xM: number): Fix => ({
  timestamp: T0 + tSec * 1000,
  lat: LAT,
  lon: LON + xM / M_PER_DEG_LON,
  accuracy: 8,
  speed: 5,
  altitude: null,
  heading: null,
});
const line = (n: number, t0: number, x0: number, step = 5): Fix[] =>
  Array.from({ length: n }, (_, i) => fixAt(t0 + i, x0 + i * step));

const countEntries = async (db: Db): Promise<number> =>
  (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM mileage_entries'))?.n ?? -1;

// Simulates a ride finalized before this feature existed (no ledger entry).
const insertFinalizedRide = (
  db: Db, id: string, vehicleId: string | null, distanceM: number, endedAt: number,
): Promise<unknown> =>
  db.runAsync(
    `INSERT INTO rides (id, user_vehicle_id, started_at, ended_at, status, point_count, distance_m, client_updated_at)
     VALUES (?, ?, ?, ?, 'finished', 0, ?, ?)`,
    id, vehicleId, T0, endedAt, distanceM, endedAt,
  );

describe('rideAppliedKm: metres to kilometres, at most 3 decimals', () => {
  it('keeps sub-kilometre precision and never rounds to whole kilometres', () => {
    assert.equal(rideAppliedKm(24600), 24.6);
    assert.equal(rideAppliedKm(24654), 24.654);
    assert.equal(rideAppliedKm(24650), 24.65);
    assert.equal(rideAppliedKm(999), 0.999);
    assert.equal(rideAppliedKm(0), 0);
  });

  it('returns null for a negative or non-finite distance', () => {
    assert.equal(rideAppliedKm(-1), null);
    assert.equal(rideAppliedKm(Number.NaN), null);
    assert.equal(rideAppliedKm(Number.POSITIVE_INFINITY), null);
    assert.equal(rideAppliedKm(Number.NEGATIVE_INFINITY), null);
  });
});

describe('ride -> mileage ledger hook (Stage 4B-4)', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
    await createVehicle(db, { id: 'v1', vehicle_type: 'motorcycle' }, T0);
  });

  it('writes exactly one ride entry on finalization, from the persisted distance', async () => {
    await createRide(db, 'r1', T0, 'v1', 'Daily');
    await applyBatch(db, line(60, 0, 0), T0 + 60_000);
    const ride = await finishRide(db, 'r1', 'finished', T0 + 61_000);
    assert.ok(ride);
    assert.ok(ride.distance_m > 0);

    const entries = await listMileageEntries(db, 'v1');
    assert.equal(entries.length, 1);
    const e = entries[0];
    assert.equal(e.id, rideMileageEntryId('r1'));
    assert.equal(e.kind, 'ride');
    assert.equal(e.source, 'gps'); // distinguishable from a manual dashboard reading
    assert.equal(e.ride_id, 'r1');
    assert.equal(e.user_vehicle_id, 'v1');
    assert.equal(e.applied_km, rideAppliedKm(ride.distance_m));
    assert.equal(e.gps_distance_m, ride.distance_m);
    assert.equal(e.odo_reading_after, null);
    assert.equal(e.client_created_at, T0 + 61_000); // ordered by the actual end of the ride
  });

  it('repeated finalization never duplicates the effective mileage', async () => {
    await createRide(db, 'r1', T0, 'v1');
    await applyBatch(db, line(30, 0, 0), T0 + 30_000);
    await finishRide(db, 'r1', 'finished', T0 + 31_000);
    const first = (await listMileageEntries(db, 'v1'))[0];
    assert.equal(await countEntries(db), 1);

    await finishRide(db, 'r1', 'finished', T0 + 32_000);
    await finishRide(db, 'r1', 'recovered', T0 + 33_000);
    assert.equal(await countEntries(db), 1);
    assert.deepEqual((await listMileageEntries(db, 'v1'))[0], first); // unchanged, no second entry
  });

  it('a recovered (interrupted) ride still writes exactly one entry', async () => {
    await createRide(db, 'r1', T0, 'v1');
    await applyBatch(db, line(30, 0, 0), T0 + 30_000);
    await markInterrupted(db, 'r1', 15, T0 + 45_000);
    const ride = await finishRide(db, 'r1', 'finished', T0 + 60_000);
    assert.equal(ride?.status, 'recovered');
    assert.equal(await countEntries(db), 1);
  });

  it('repairs an already-finalized ride whose ledger entry is missing, and stays at one on retry', async () => {
    await insertFinalizedRide(db, 'legacy', 'v1', 12345, T0 + 60_000);
    assert.equal(await countEntries(db), 0);

    const ride = await finishRide(db, 'legacy', 'finished', T0 + 70_000);
    assert.equal(ride?.status, 'finished');
    const entries = await listMileageEntries(db, 'v1');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].applied_km, 12.345);
    assert.equal(entries[0].ride_id, 'legacy');

    await finishRide(db, 'legacy', 'finished', T0 + 80_000); // retry
    assert.equal(await countEntries(db), 1);
  });

  it('ensureRideMileageEntry is idempotent and reports the existing entry', async () => {
    await createRide(db, 'r1', T0, 'v1');
    await applyBatch(db, line(20, 0, 0), T0 + 20_000);
    const ride = (await finishRide(db, 'r1', 'finished', T0 + 21_000)) as RideRow;

    const again = await ensureRideMileageEntry(db, {
      id: 'r1', user_vehicle_id: 'v1', distance_m: ride.distance_m, ended_at: ride.ended_at,
    });
    assert.deepEqual(again, { created: false, reason: 'exists' });
    assert.equal(await countEntries(db), 1);
  });

  it('a zero-distance ride still records exactly one 0 km entry', async () => {
    await insertFinalizedRide(db, 'zer', 'v1', 0, T0 + 5_000);
    const outcome = await ensureRideMileageEntry(db, {
      id: 'zer', user_vehicle_id: 'v1', distance_m: 0, ended_at: T0 + 5_000,
    });
    assert.equal(outcome.created, true);
    const entries = await listMileageEntries(db, 'v1');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].applied_km, 0);
  });

  it('reports an invalid distance instead of inserting it', async () => {
    const outcome = await ensureRideMileageEntry(db, {
      id: 'bad', user_vehicle_id: 'v1', distance_m: -1, ended_at: T0,
    });
    assert.deepEqual(outcome, { created: false, reason: 'invalid_distance' });
    assert.equal(await countEntries(db), 0);
  });

  it('still finalizes a ride when its persisted distance is invalid, without an entry', async () => {
    await db.runAsync(
      `INSERT INTO rides (id, user_vehicle_id, started_at, status, point_count, distance_m, client_updated_at)
       VALUES ('neg', 'v1', ?, 'recording', 0, -3, ?)`,
      T0, T0,
    );
    const ride = await finishRide(db, 'neg', 'finished', T0 + 1_000);
    assert.equal(ride?.status, 'finished'); // the ride itself is never lost
    assert.equal(await countEntries(db), 0);
  });

  it('finalizes a ride with no vehicle without a ledger entry', async () => {
    await createRide(db, 'r1', T0); // no vehicle id
    await applyBatch(db, line(20, 0, 0), T0 + 20_000);
    const ride = await finishRide(db, 'r1', 'finished', T0 + 21_000);
    assert.equal(ride?.status, 'finished');
    assert.equal(await countEntries(db), 0);
  });

  it('the ride entry counts toward maintenance usage from the ledger', async () => {
    await insertServiceEvent(db, {
      id: 's1', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'replace', performed_at: T0 - 1_000,
    });
    await createRide(db, 'r1', T0, 'v1');
    await applyBatch(db, line(60, 0, 0), T0 + 60_000);
    const ride = (await finishRide(db, 'r1', 'finished', T0 + 61_000)) as RideRow;

    const maintenance = await evaluateVehicleMaintenance(db, 'v1');
    const oil = maintenance?.items.find((i) => i.componentCode === 'engine_oil');
    assert.ok(oil);
    assert.equal(oil.evaluation.status, 'good');
    assert.equal(oil.evaluation.progress?.usedKm, rideAppliedKm(ride.distance_m));
  });
});
