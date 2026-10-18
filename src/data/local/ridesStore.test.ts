import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { decodePolyline } from '../../domain/ride/polyline';
import type { RideRow } from './ridesStore';
import type { Fix } from '../../domain/ride/types';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import {
  abortRide, applyBatch, createRide, findUnfinishedRide, finishRide, getActiveRideId, getRide, getRoute,
  markInterrupted, repairOrphanRides, RideAlreadyActiveError, setRecoveryState,
} from './ridesStore';
import type { Db } from './types';

const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);
const LAT = 14.6;
const LON = 121.0;
const M_PER_DEG_LON = 111320 * Math.cos((LAT * Math.PI) / 180);

function walk(n: number, startMs: number, startM = 0, speed = 1.4): Fix[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: startMs + i * 1000,
    lat: LAT + Math.sin(i / 15) * 0.00002,
    lon: LON + (startM + i * speed) / M_PER_DEG_LON,
    accuracy: 8,
    speed,
    altitude: null,
    heading: null,
  }));
}

const count = async (db: Db, sql: string, ...p: (string | number)[]) =>
  (await db.getFirstAsync<{ n: number }>(sql, ...p))?.n ?? -1;

describe('local ride store (Node SQLite)', { skip: !hasNodeSqlite() && 'node:sqlite not available (needs Node 22.5+)' }, () => {
  let db: Db;
  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
  });

  it('migrations are idempotent and set the schema version', async () => {
    const latest = Math.max(...MIGRATIONS.map((m) => m.version));
    assert.equal((await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version, latest);
    assert.equal(await migrate(db, MIGRATIONS), latest);
    for (const t of ['rides', 'points', 'meta', 'events', 'outbox']) {
      assert.equal(await count(db, `SELECT COUNT(*) AS n FROM sqlite_master WHERE name = '${t}'`), 1, t);
    }
  });

  it('records a ride end to end: stale fix dropped, totals stored, route simplified', async () => {
    await createRide(db, 'r1', T0);
    assert.equal(await getActiveRideId(db), 'r1');
    const stale: Fix = { ...walk(1, T0 - 200_000)[0] };
    await applyBatch(db, [stale], T0 + 100);
    const fixes = walk(300, T0);
    for (let i = 0; i < fixes.length; i += 25) await applyBatch(db, fixes.slice(i, i + 25), T0 + i * 1000 + 100);
    const ride = await finishRide(db, 'r1', 'finished', T0 + 301_000);
    assert.ok(ride);
    assert.equal(ride.status, 'finished');
    assert.equal(ride.point_count, 300);
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM points WHERE ride_id = ?', 'r1'), 300);
    assert.ok(Math.abs(ride.distance_m - 299 * 1.4) < 6, `distance ${ride.distance_m}`);
    assert.equal(ride.duration_s, 301);
    assert.equal(ride.needs_review, 0);
    assert.equal(ride.sync_status, 'pending');
    assert.equal(ride.max_gap_s, 1);
    assert.equal(await getActiveRideId(db), null);
    assert.equal(await findUnfinishedRide(db), null);
    const poly = decodePolyline(ride.polyline ?? '');
    const route = await getRoute(db, 'r1');
    assert.ok(poly.length >= 2 && poly.length < route.length / 2, `polyline points ${poly.length} of ${route.length}`);
    assert.ok(Math.abs(poly[0].lon - route[0].lon) < 2e-5);
    assert.ok(Math.abs(poly[poly.length - 1].lon - route[route.length - 1].lon) < 2e-5);
    const ev = await db.getAllAsync<{ type: string }>('SELECT type FROM events');
    assert.ok(ev.some((e) => e.type === 'stale_fix_dropped'));
    assert.ok(ev.some((e) => e.type === 'ride_start') && ev.some((e) => e.type === 'ride_stop'));
  });

  it('an interrupted ride is found on relaunch, resumes with an untracked gap, and is flagged for review', async () => {
    await createRide(db, 'r2', T0);
    await applyBatch(db, walk(60, T0), T0 + 60_000);
    // app force-stopped; reopened 150 s later
    const found = await findUnfinishedRide(db, T0 + 59_000 + 150_000);
    assert.ok(found);
    assert.equal(found.ride.id, 'r2');
    assert.equal(found.sinceLastPointS, 150);
    await applyBatch(db, walk(40, T0 + 59_000 + 150_000, 59 * 1.4 + 500), T0 + 260_000);
    const ride = await finishRide(db, 'r2', 'recovered', T0 + 300_000);
    assert.ok(ride);
    assert.equal(ride.status, 'recovered');
    assert.equal(ride.needs_review, 1);
    assert.ok(Math.abs(ride.untracked_gap_s - 150) < 1);
    assert.ok(Math.abs(ride.untracked_gap_m - 500) < 15, `untracked ${ride.untracked_gap_m}`);
    // the 500 m crossed during the gap is NOT in the distance (59 + 39 steps of 1.4 m only)
    assert.ok(ride.distance_m < 98 * 1.4 + 6, `distance ${ride.distance_m}`);
    assert.ok((await db.getAllAsync<{ type: string }>('SELECT type FROM events')).some((e) => e.type === 'untracked_gap'));
  });

  it('overlapping batches (late delivery on app resume) never collide', async () => {
    await createRide(db, 'r3', T0);
    const fixes = walk(50, T0);
    await Promise.all(Array.from({ length: 10 }, (_, i) => applyBatch(db, fixes.slice(i * 5, i * 5 + 5), T0 + 60_000)));
    const ride = await getRide(db, 'r3');
    assert.equal(ride?.point_count, 50);
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM points'), 50);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM events WHERE type LIKE '%error%'"), 0);
  });

  it('a batch that arrives after the ride ended is ignored', async () => {
    await createRide(db, 'r4', T0);
    await applyBatch(db, walk(5, T0), T0 + 5000);
    await finishRide(db, 'r4', 'finished', T0 + 6000);
    assert.equal(await applyBatch(db, walk(5, T0 + 10_000), T0 + 20_000), null);
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM points'), 5);
  });

  it('finishing detects lost points and repairs the counter', async () => {
    await createRide(db, 'r5', T0);
    await applyBatch(db, walk(20, T0), T0 + 20_000);
    await db.runAsync('DELETE FROM points WHERE ride_id = ? AND seq = 7', 'r5');
    const ride = await finishRide(db, 'r5', 'finished', T0 + 21_000);
    assert.equal(ride?.point_count, 19);
    const ev = await db.getAllAsync<{ type: string; detail: string }>("SELECT type, detail FROM events WHERE type = 'integrity_mismatch'");
    assert.equal(ev.length, 1);
    assert.match(ev[0].detail, /rows=19 counter=20/);
  });

  it('finishing twice is harmless', async () => {
    await createRide(db, 'r6', T0);
    await applyBatch(db, walk(5, T0), T0 + 5000);
    const a = await finishRide(db, 'r6', 'finished', T0 + 6000);
    const b = await finishRide(db, 'r6', 'recovered', T0 + 9000);
    assert.equal(a?.ended_at, b?.ended_at);
    assert.equal(b?.status, 'finished');
  });

  it('aborting a ride that never started tracking leaves no ghost ride', async () => {
    await createRide(db, 'r7', T0);
    assert.equal(await abortRide(db, 'r7', 'permission revoked'), true);
    assert.equal(await getActiveRideId(db), null);
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM rides'), 0);
    // a ride that already has points is never discarded
    await createRide(db, 'r8', T0);
    await applyBatch(db, walk(3, T0), T0 + 3000);
    assert.equal(await abortRide(db, 'r8', 'x'), false);
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM rides'), 1);
  });

  // ---- regressions for the Step 4 review
  const fixAt = (tSec: number, xM: number, acc = 8, dLat = 0): Fix => ({
    timestamp: T0 + tSec * 1000, lat: LAT + dLat, lon: LON + xM / M_PER_DEG_LON, accuracy: acc, speed: 1.4, altitude: null, heading: null,
  });
  const line = (n: number, t0: number, x0: number, step = 1.4) => Array.from({ length: n }, (_, i) => fixAt(t0 + i, x0 + i * step));
  const xOf = (lon: number) => (lon - LON) * M_PER_DEG_LON;

  it('migration 2 upgrades a version-1 database in place and keeps its rides', async () => {
    const old = createNodeSqliteDb();
    await migrate(old, [MIGRATIONS[0]]);
    await old.runAsync(
      `INSERT INTO rides (id, started_at, status, point_count, distance_m, client_updated_at) VALUES ('v1', ?, 'finished', 7, 123, ?)`, T0, T0);
    // Scoped to the first two migrations: this test asserts the v1 -> v2 upgrade specifically.
    assert.equal(await migrate(old, MIGRATIONS.slice(0, 2)), 2);
    const r = await getRide(old, 'v1');
    assert.equal(r?.distance_m, 123);
    assert.equal(r?.interrupted, 0);
    assert.equal(r?.recovery_state, 'none');
    assert.equal(r?.integrity_issue, null);
    assert.equal(r?.route_segments, null);
  });

  it('createRide persists the provided user_vehicle_id', async () => {
    await createRide(db, 'linked', T0, 'veh-1');
    assert.equal((await getRide(db, 'linked'))?.user_vehicle_id, 'veh-1');
  });

  it('createRide stores NULL when no vehicle id is provided', async () => {
    await createRide(db, 'unlinked', T0);
    assert.equal((await getRide(db, 'unlinked'))?.user_vehicle_id, null);
  });

  it('REGRESSION: an interruption is persisted, so Stop still saves a recovered ride flagged for review', async () => {
    await createRide(db, 'i1', T0);
    await applyBatch(db, line(30, 0, 0), T0 + 30_000);
    // app killed, reopened 20 s later: shorter than the untracked threshold, so only the persisted flag records it
    await markInterrupted(db, 'i1', 20, T0 + 50_000);
    await applyBatch(db, line(30, 49, 49 * 1.4), T0 + 80_000);
    const found = await findUnfinishedRide(db, T0 + 80_000);
    assert.equal(found?.ride.interrupted, 1); // state lives in the database, not in the screen
    assert.equal(found?.ride.recovery_state, 'verifying');
    const ride = await finishRide(db, 'i1', 'finished', T0 + 90_000); // the normal Stop button
    assert.equal(ride?.status, 'recovered');
    assert.equal(ride?.needs_review, 1);
    assert.equal(ride?.interruption_count, 1);
    assert.equal(ride?.interruption_s, 20);
  });

  it('a ride that was never interrupted still finishes as finished, without review', async () => {
    await createRide(db, 'n1', T0);
    await applyBatch(db, line(30, 0, 0), T0 + 30_000);
    const ride = await finishRide(db, 'n1', 'finished', T0 + 31_000);
    assert.equal(ride?.status, 'finished');
    assert.equal(ride?.needs_review, 0);
    assert.equal(ride?.recovery_state, 'none');
  });

  it('recovery state is stored and only applies to a recording ride', async () => {
    await createRide(db, 's1', T0);
    await markInterrupted(db, 's1', 15);
    await setRecoveryState(db, 's1', 'failed');
    assert.equal((await getRide(db, 's1'))?.recovery_state, 'failed');
    await applyBatch(db, line(5, 0, 0), T0 + 5000);
    await finishRide(db, 's1', 'finished', T0 + 6000);
    await setRecoveryState(db, 's1', 'confirmed');
    assert.equal((await getRide(db, 's1'))?.recovery_state, 'failed'); // finished rides are not touched
  });

  it('REGRESSION: the route keeps untracked gaps as separate pieces and ignores low-accuracy fixes', async () => {
    await createRide(db, 'g1', T0);
    await applyBatch(db, line(40, 0, 0), T0 + 40_000);
    await applyBatch(db, [fixAt(41, 41 * 1.4, 90, 0.003)], T0 + 41_000); // 90 m accuracy, ~330 m off the road
    await applyBatch(db, line(40, 200, 500), T0 + 240_000); // 160 s later, 500 m further
    const ride = await finishRide(db, 'g1', 'finished', T0 + 241_000);
    assert.ok(ride);
    const route = JSON.parse(ride.route_segments ?? '{}') as { segments: { polyline: string }[]; droppedSegments: number };
    assert.equal(route.segments.length, 2);
    assert.equal(ride.polyline, null, 'a gapped route must not be stored as one joined line');
    const a = decodePolyline(route.segments[0].polyline);
    const b = decodePolyline(route.segments[1].polyline);
    assert.ok(Math.max(...a.map((p) => xOf(p.lon))) < 60);
    assert.ok(Math.min(...b.map((p) => xOf(p.lon))) > 499);
    [...a, ...b].forEach((p) => assert.ok(Math.abs(p.lat - LAT) < 1e-4, 'low-accuracy spike leaked into the route'));
    assert.equal(ride.needs_review, 1);
    assert.ok(ride.untracked_gap_s > 150);
  });

  it('a complete one-piece route is stored both as route_segments and as the single polyline', async () => {
    await createRide(db, 'p1', T0);
    await applyBatch(db, line(100, 0, 0), T0 + 100_000);
    const ride = await finishRide(db, 'p1', 'finished', T0 + 101_000);
    const route = JSON.parse(ride?.route_segments ?? '{}') as { segments: { polyline: string }[] };
    assert.equal(route.segments.length, 1);
    assert.equal(ride?.polyline, route.segments[0].polyline);
  });

  it('a ride with no usable fix has no route, no average speed, and is flagged when it was long enough', async () => {
    await createRide(db, 'u1', T0);
    await applyBatch(db, line(60, 0, 0, 1.4).map((f) => ({ ...f, accuracy: 70 })), T0 + 60_000);
    const ride = await finishRide(db, 'u1', 'finished', T0 + 61_000);
    assert.deepEqual(JSON.parse(ride?.route_segments ?? '{}').segments, []);
    assert.equal(ride?.polyline, null);
    assert.equal(ride?.tracked_s, 0);
    assert.equal(ride?.avg_speed_ms, null);
    assert.equal(ride?.needs_review, 1);
  });

  it('REGRESSION: after lost points, every total is rebuilt from the stored rows and the ride is flagged', async () => {
    await createRide(db, 'l1', T0);
    await applyBatch(db, line(60, 0, 0, 5), T0 + 60_000); // 5 m/s, 60 points
    const before = (await getRide(db, 'l1')) as RideRow;
    await db.runAsync('DELETE FROM points WHERE ride_id = ? AND seq BETWEEN 10 AND 50', 'l1');
    const ride = (await finishRide(db, 'l1', 'finished', T0 + 61_000)) as RideRow;
    assert.equal(ride.point_count, 19);
    assert.ok(before.distance_m > 280 && ride.distance_m < 120, `distance ${before.distance_m} -> ${ride.distance_m}`);
    assert.ok(Math.abs(ride.untracked_gap_s - 42) < 1, `untracked ${ride.untracked_gap_s}`);
    assert.ok(Math.abs(ride.max_gap_s - 42) < 1, `max gap ${ride.max_gap_s}`);
    assert.equal(ride.needs_review, 1);
    assert.match(ride.integrity_issue ?? '', /rows=19 counter=60/);
    const types = (await db.getAllAsync<{ type: string }>('SELECT type FROM events')).map((e) => e.type);
    assert.ok(types.includes('integrity_mismatch') && types.includes('integrity_repaired'));
  });

  it('extra stored rows (more rows than the counter) are also detected, counted and flagged', async () => {
    await createRide(db, 'x1', T0);
    await applyBatch(db, line(20, 0, 0), T0 + 20_000);
    await db.runAsync(
      `INSERT INTO points (ride_id, seq, ts, lat, lon, accuracy, speed, received_at) VALUES ('x1', 999, ?, ?, ?, 8, 1.4, ?)`,
      T0 + 21_000, LAT, LON + 30 / M_PER_DEG_LON, T0 + 21_000);
    const ride = await finishRide(db, 'x1', 'finished', T0 + 22_000);
    assert.equal(ride?.point_count, 21);
    assert.equal(ride?.needs_review, 1);
    assert.match(ride?.integrity_issue ?? '', /rows=21 counter=20/);
  });

  it('REGRESSION: tracked time and average speed ignore time before the first and after the last usable fix', async () => {
    await createRide(db, 't1', T0);
    await applyBatch(db, line(60, 120, 0, 5), T0 + 181_000); // nothing for 120 s, then 60 s at 5 m/s
    const ride = await finishRide(db, 't1', 'finished', T0 + 300_000); // 120 s with no fix before Stop
    assert.equal(ride?.duration_s, 300);
    assert.ok(Math.abs((ride?.tracked_s ?? 0) - 59) < 0.5, `tracked ${ride?.tracked_s}`);
    assert.ok(Math.abs((ride?.avg_speed_ms ?? 0) - 5) < 0.25, `avg ${ride?.avg_speed_ms}`);
  });

  it('REGRESSION: two concurrent starts create exactly one ride', async () => {
    const results = await Promise.allSettled([createRide(db, 'c1', T0), createRide(db, 'c2', T0 + 5)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.ok(rejected.reason instanceof RideAlreadyActiveError);
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM rides'), 1);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM rides WHERE status = 'recording'"), 1);
    const active = await getActiveRideId(db);
    assert.ok(active === 'c1' || active === 'c2');
  });

  it('a second start while recording is rejected; a new ride is allowed after finishing; a dangling pointer is ignored', async () => {
    await createRide(db, 'd1', T0);
    await assert.rejects(createRide(db, 'd2', T0 + 1), RideAlreadyActiveError);
    await finishRide(db, 'd1', 'finished', T0 + 5000);
    await createRide(db, 'd3', T0 + 6000);
    assert.equal(await getActiveRideId(db), 'd3');
    await db.runAsync('DELETE FROM rides WHERE id = ?', 'd3'); // meta now points at a ride that no longer exists
    await createRide(db, 'd4', T0 + 7000);
    assert.equal(await getActiveRideId(db), 'd4');
  });

  it('orphaned recording rides are closed as recovered and flagged, and the active ride is left alone', async () => {
    await db.runAsync(
      `INSERT INTO rides (id, started_at, status, client_updated_at) VALUES ('orphan', ?, 'recording', ?)`, T0, T0);
    await createRide(db, 'live', T0 + 100_000);
    await applyBatch(db, line(5, 100, 0), T0 + 105_000);
    assert.equal(await repairOrphanRides(db), 1);
    const o = await getRide(db, 'orphan');
    assert.equal(o?.status, 'recovered');
    assert.equal(o?.needs_review, 1);
    assert.match(o?.integrity_issue ?? '', /orphan_recording_ride/);
    assert.equal((await getRide(db, 'live'))?.status, 'recording');
    assert.equal(await getActiveRideId(db), 'live');
    assert.equal(await repairOrphanRides(db), 0);
  });

  it('REGRESSION: an unsorted batch is stored in chronological order', async () => {
    await createRide(db, 'o1', T0);
    const f = line(5, 0, 0);
    await applyBatch(db, [f[3], f[1], f[4], f[0], f[2]], T0 + 6000);
    assert.equal((await getRide(db, 'o1'))?.point_count, 5);
    const ts = (await db.getAllAsync<{ ts: number }>('SELECT ts FROM points ORDER BY seq')).map((r) => r.ts);
    assert.deepEqual(ts, f.map((x) => x.timestamp));
  });

  it('Stop waits for batches already queued, and a batch after the ride ended is ignored', async () => {
    await createRide(db, 'q1', T0);
    const pending = applyBatch(db, line(10, 0, 0), T0 + 10_000); // not awaited yet
    const finished = finishRide(db, 'q1', 'finished', T0 + 11_000);
    await Promise.all([pending, finished]);
    assert.equal((await getRide(db, 'q1'))?.point_count, 10);
    assert.equal(await applyBatch(db, line(3, 20, 30), T0 + 30_000), null);
  });

  it('a late batch that is older than stored data is not merged (documented limit)', async () => {
    await createRide(db, 'a1', T0);
    await applyBatch(db, line(10, 10, 14), T0 + 20_000);
    await applyBatch(db, line(5, 0, 0), T0 + 21_000);
    assert.equal((await getRide(db, 'a1'))?.point_count, 10);
    assert.ok((await db.getAllAsync<{ type: string }>('SELECT type FROM events')).some((e) => e.type === 'old_fix_dropped'));
  });

  // ---- Stage 3.2B: vehicle-name snapshot

  it('migration 4 adds vehicle_name and backfills existing rides from the vehicles table', async () => {
    const old = createNodeSqliteDb();
    await migrate(old, MIGRATIONS.slice(0, 3)); // v3 already has the vehicles table

    const vehicle = async (id: string, type: string, nickname: string | null, brand: string | null, model: string | null, deletedAt: number | null) =>
      old.runAsync(
        `INSERT INTO vehicles (id, vehicle_type, nickname, brand, model, created_at, updated_at, client_updated_at, deleted_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        id, type, nickname, brand, model, T0, T0, T0, deletedAt,
      );
    await vehicle('v-nick', 'car', 'Daily', 'Toyota', 'Vios', null);
    await vehicle('v-brand', 'car', null, 'Honda', 'Beat', null);
    await vehicle('v-type', 'bicycle', null, null, null, null);
    await vehicle('v-del', 'car', 'Old Bike', null, null, T0 + 1); // soft-deleted, row still present

    const ride = async (id: string, vehicleId: string | null) =>
      old.runAsync(
        `INSERT INTO rides (id, user_vehicle_id, started_at, status, distance_m, client_updated_at)
         VALUES (?, ?, ?, 'finished', 10, ?)`,
        id, vehicleId, T0, T0,
      );
    await ride('r-nick', 'v-nick');
    await ride('r-brand', 'v-brand');
    await ride('r-type', 'v-type');
    await ride('r-del', 'v-del');
    await ride('r-null', null);
    await ride('r-ghost', 'ghost'); // id points at no vehicle row
    const latestM = Math.max(...MIGRATIONS.map((m) => m.version));
    assert.equal(await migrate(old, MIGRATIONS), latestM);

    assert.equal((await getRide(old, 'r-nick'))?.vehicle_name, 'Daily');
    assert.equal((await getRide(old, 'r-brand'))?.vehicle_name, 'Honda Beat');
    assert.equal((await getRide(old, 'r-type'))?.vehicle_name, 'Bicycle');
    // a soft-deleted vehicle still names the historical ride (best effort)
    assert.equal((await getRide(old, 'r-del'))?.vehicle_name, 'Old Bike');
    assert.equal((await getRide(old, 'r-null'))?.vehicle_name, null);
    assert.equal((await getRide(old, 'r-ghost'))?.vehicle_name, null);
    // existing ride data is untouched
    assert.equal((await getRide(old, 'r-nick'))?.distance_m, 10);
  });

  it('migration 4 upgrades a phone that already has rides, leaving their totals intact', async () => {
    const old = createNodeSqliteDb();
    await migrate(old, MIGRATIONS.slice(0, 3));
    await old.runAsync(
      `INSERT INTO rides (id, started_at, status, point_count, distance_m, client_updated_at)
       VALUES ('legacy', ?, 'finished', 7, 123, ?)`,
      T0, T0,
    );
    const latestM = Math.max(...MIGRATIONS.map((m) => m.version));
    assert.equal(await migrate(old, MIGRATIONS), latestM);
    const r = await getRide(old, 'legacy');
    assert.equal(r?.distance_m, 123);
    assert.equal(r?.point_count, 7);
    assert.equal(r?.vehicle_name, null);
  });

  it('createRide snapshots the provided vehicle name', async () => {
    await createRide(db, 'named', T0, 'veh-1', 'Daily');
    const r = await getRide(db, 'named');
    assert.equal(r?.user_vehicle_id, 'veh-1');
    assert.equal(r?.vehicle_name, 'Daily');
  });

  it('createRide stores a NULL vehicle name when none is provided (Diagnostics / unassigned)', async () => {
    await createRide(db, 'anon', T0);
    assert.equal((await getRide(db, 'anon'))?.vehicle_name, null);
  });

  it('recovery preserves the snapshotted vehicle name and never replaces it', async () => {
    await createRide(db, 'rec', T0, 'veh-A', 'Daily');
    await applyBatch(db, line(30, 0, 0), T0 + 30_000);
    // app killed and reopened; a different vehicle is now the active one
    await markInterrupted(db, 'rec', 20, T0 + 50_000);
    await applyBatch(db, line(30, 49, 49 * 1.4), T0 + 80_000);
    const ride = await finishRide(db, 'rec', 'finished', T0 + 90_000);
    assert.equal(ride?.status, 'recovered');
    assert.equal(ride?.user_vehicle_id, 'veh-A');
    assert.equal(ride?.vehicle_name, 'Daily');
  });
});
