import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROCESS } from '../../config/tracking';
import { newRideState, processFixes } from './processFixes';
import type { Fix, RideState } from './types';

const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);
const LAT = 14.6;
const LON = 121.0;
const M_PER_DEG_LON = 111320 * Math.cos((LAT * Math.PI) / 180);

function walk(n: number, speedMs: number, opts: { startMs?: number; acc?: number; speed?: number | null; startM?: number } = {}): Fix[] {
  const start = opts.startMs ?? T0;
  const startM = opts.startM ?? 0;
  return Array.from({ length: n }, (_, i) => ({
    timestamp: start + i * 1000,
    lat: LAT,
    lon: LON + (startM + i * speedMs) / M_PER_DEG_LON,
    accuracy: opts.acc ?? 8,
    speed: opts.speed === undefined ? speedMs : opts.speed,
    altitude: null,
    heading: null,
  }));
}

function jitter(n: number, startMs: number): Fix[] {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  return Array.from({ length: n }, (_, i) => ({
    timestamp: startMs + i * 1000,
    lat: LAT + (rnd() * 4) / 111320,
    lon: LON + (rnd() * 4) / M_PER_DEG_LON,
    accuracy: 8,
    speed: 0.1,
    altitude: null,
    heading: null,
  }));
}

const run = (state: RideState, fixes: Fix[], now = T0 + 600_000) => processFixes(state, fixes, now, PROCESS);

describe('processFixes', () => {
  it('adds filtered distance for steady movement', () => {
    const r = run(newRideState(T0), walk(120, 1.4));
    assert.ok(Math.abs(r.state.distanceM - 119 * 1.4) < 4, `got ${r.state.distanceM}`);
    assert.equal(r.state.pointCount, 120);
    assert.equal(r.accepted.length, 120);
    assert.equal(r.accepted[0].seq, 1);
    assert.equal(r.accepted[119].seq, 120);
  });

  it('standstill jitter inflates raw distance but not the filtered distance', () => {
    const r = run(newRideState(T0), jitter(120, T0));
    assert.equal(r.state.distanceM, 0);
    assert.ok(r.state.rawDistanceM > 20, `raw should drift, got ${r.state.rawDistanceM}`);
  });

  it('low-accuracy fixes are stored but never add filtered distance', () => {
    const r = run(newRideState(T0), walk(60, 1.4, { acc: 40 }));
    assert.equal(r.state.pointCount, 60);
    assert.equal(r.state.distanceM, 0);
    assert.ok(r.state.rawDistanceM > 50);
  });

  it('drops cached fixes from before the ride started', () => {
    const fixes = [...walk(1, 0, { startMs: T0 - 5000 }), ...walk(1, 0, { startMs: T0 - 1000 }), ...walk(3, 1.4, { startMs: T0 })];
    const r = run(newRideState(T0), fixes);
    assert.equal(r.state.pointCount, 4);
    const ev = r.events.find((e) => e.type === 'stale_fix_dropped');
    assert.match(ev?.detail ?? '', /dropped=1 oldest_age_s=5/);
    assert.equal(r.state.maxGapS, 1); // no fake gap from the stale fix
  });

  it('drops fixes that are not newer than the last accepted one (also inside one batch)', () => {
    const first = run(newRideState(T0), walk(5, 1.4));
    const replay = run(first.state, [...walk(3, 1.4, { startMs: T0 }), ...walk(1, 1.4, { startMs: T0 + 4000 })]);
    assert.equal(replay.accepted.length, 0);
    assert.equal(replay.state.pointCount, 5);
    assert.ok(replay.events.some((e) => e.type === 'old_fix_dropped' && e.detail === 'dropped=4'));
    const dup = run(newRideState(T0), [...walk(2, 1.4), ...walk(1, 1.4, { startMs: T0 + 1000 })]);
    assert.equal(dup.state.pointCount, 2);
  });

  it('logs gaps over 10 s but still adds distance up to 30 s', () => {
    const a = run(newRideState(T0), walk(10, 5));
    const b = run(a.state, walk(5, 5, { startMs: T0 + 9000 + 20_000, startM: 9 * 5 + 20 * 5 }));
    assert.ok(b.events.some((e) => e.type === 'gap' && /gap=20s/.test(e.detail)));
    assert.ok(!b.events.some((e) => e.type === 'untracked_gap'));
    assert.equal(b.state.untrackedGapS, 0);
    // 9 fixes*5 m + 20 s gap*5 m/s + 4 fixes*5 m = about 165 m; the gap distance IS included below 30 s
    assert.ok(Math.abs(b.state.distanceM - 165) < 10, `distance should span the gap, got ${b.state.distanceM}`);
  });

  it('an untracked gap (> 30 s) is recorded and its distance is NOT added', () => {
    const a = run(newRideState(T0), walk(20, 5));
    const before = a.state.distanceM;
    const gapStart = T0 + 19_000;
    const b = run(a.state, walk(20, 5, { startMs: gapStart + 60_000, startM: 19 * 5 + 300 }));
    assert.ok(b.events.some((e) => e.type === 'untracked_gap'));
    assert.ok(Math.abs(b.state.untrackedGapS - 60) < 1);
    assert.ok(Math.abs(b.state.untrackedGapM - 300) < 10, `straight-line gap ${b.state.untrackedGapM}`);
    // only the 19 m travelled after the gap counts, plus nothing across it
    assert.ok(b.state.distanceM - before < 19 * 5 + 5, `added ${b.state.distanceM - before}`);
    assert.ok(b.state.distanceM - before > 15 * 5, 'normal movement after the gap still counts');
    assert.equal(b.state.maxGapS, 60);
  });

  it('tracks late batches and the maximum speed from accurate fixes only', () => {
    const fixes = walk(5, 3);
    fixes[2] = { ...fixes[2], speed: 40, accuracy: 60 }; // inaccurate spike ignored
    fixes[4] = { ...fixes[4], speed: 12 };
    const r = processFixes(newRideState(T0), fixes, T0 + 4000 + 6500, PROCESS);
    assert.equal(r.state.maxSpeedMs, 12);
    assert.equal(r.state.lateBatches, 1);
    assert.equal(r.state.maxDelayMs, 6500);
    assert.ok(r.events.some((e) => e.type === 'late_batch'));
  });

  it('does not mutate its input and gives the same result for one batch or many', () => {
    const fixes = [...walk(40, 1.4), ...jitter(20, T0 + 40_000)];
    const s0 = newRideState(T0);
    const snapshot = JSON.stringify(s0);
    const one = run(s0, fixes);
    assert.equal(JSON.stringify(s0), snapshot);
    let st = newRideState(T0);
    for (let i = 0; i < fixes.length; i += 7) st = run(st, fixes.slice(i, i + 7)).state;
    const strip = (s: RideState) => ({ ...s, maxDelayMs: 0, lateBatches: 0 });
    assert.deepEqual(strip(st), strip(one.state));
  });

  // ---- regressions for the Step 4 review
  it('REGRESSION: an unsorted batch is sorted by time instead of losing its older fixes', () => {
    const f = walk(5, 1.4);
    const r = run(newRideState(T0), [f[3], f[1], f[4], f[0], f[2]]);
    assert.equal(r.accepted.length, 5);
    assert.deepEqual(r.accepted.map((x) => x.timestamp), f.map((x) => x.timestamp));
    assert.deepEqual(r.accepted.map((x) => x.seq), [1, 2, 3, 4, 5]);
    assert.ok(r.events.some((e) => e.type === 'unsorted_batch'));
    assert.equal(run(newRideState(T0), f).events.some((e) => e.type === 'unsorted_batch'), false);
  });

  it('a later batch that is OLDER than already-stored data is dropped and logged, not merged (documented limit)', () => {
    const stored = run(newRideState(T0), walk(10, 1.4, { startMs: T0 + 10_000 }));
    const late = run(stored.state, walk(5, 1.4, { startMs: T0 }));
    assert.equal(late.accepted.length, 0);
    assert.equal(late.state.pointCount, 10);
    assert.ok(late.events.some((e) => e.type === 'old_fix_dropped'));
  });

  it('REGRESSION: a long stretch with only poor-accuracy fixes is untracked and adds no distance', () => {
    const good1 = walk(10, 5);
    const poor = walk(50, 5, { startMs: T0 + 10_000, startM: 50, acc: 80 });
    const good2 = walk(10, 5, { startMs: T0 + 60_000, startM: 300 });
    const r = run(newRideState(T0), [...good1, ...poor, ...good2]);
    assert.equal(r.state.pointCount, 70); // poor fixes are still stored
    assert.ok(Math.abs(r.state.untrackedGapS - 51) < 1, `untracked ${r.state.untrackedGapS}`);
    assert.ok(Math.abs(r.state.untrackedGapM - 255) < 10, `untracked m ${r.state.untrackedGapM}`);
    assert.ok(r.state.distanceM < 9 * 5 + 9 * 5 + 5, `distance ${r.state.distanceM}`);
    assert.ok(r.events.some((e) => e.type === 'untracked_gap'));
  });

  it('a short poor-accuracy stretch (under 30 s) is bridged by a straight line', () => {
    const good1 = walk(10, 5);
    const poor = walk(15, 5, { startMs: T0 + 10_000, startM: 50, acc: 80 });
    const good2 = walk(10, 5, { startMs: T0 + 25_000, startM: 125 });
    const r = run(newRideState(T0), [...good1, ...poor, ...good2]);
    assert.equal(r.state.untrackedGapS, 0);
    assert.ok(Math.abs(r.state.distanceM - 170) < 12, `distance ${r.state.distanceM}`);
  });

  it('records the first and last usable fix (unusable fixes never count)', () => {
    const lead = walk(5, 1.4, { acc: 90 });
    const usable = walk(10, 1.4, { startMs: T0 + 5000, startM: 7 });
    const tail = walk(5, 1.4, { startMs: T0 + 15_000, startM: 21, acc: 90 });
    const r = run(newRideState(T0), [...lead, ...usable, ...tail]);
    assert.equal(r.state.firstUsableTs, T0 + 5000);
    assert.equal(r.state.lastUsableTs, T0 + 14_000);
  });
});
