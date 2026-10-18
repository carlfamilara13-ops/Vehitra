import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from '../../../data/local/types';
import { migrate } from '../../../data/local/migrate';
import { MIGRATIONS } from '../../../data/local/migrations';
import { createNodeSqliteDb, hasNodeSqlite } from '../../../data/local/nodeSqliteDb.testutil';
import type { Fix } from '../../../domain/ride/types';
import {
  applyBatch, createRide, findUnfinishedRide, finishRide, getActiveRideId, getRide, logEvent, markInterrupted,
  repairOrphanRides, setRecoveryState,
} from '../../../data/local/ridesStore';
import {
  applyArming, restartTracking, resumeAfterLaunch, superviseRecovery,
  type LocationRuntime, type ResumeDeps, type ResumeStore,
} from './resume';

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

const store: ResumeStore = {
  repairOrphanRides, findUnfinishedRide, markInterrupted, setRecoveryState, getRide, getActiveRideId, logEvent,
};

// A fake expo-location runtime that records the exact sequence of start/stop calls.
function fakeLoc(opts: { started?: boolean; failStart?: boolean } = {}) {
  const calls: string[] = [];
  let started = opts.started ?? false;
  const loc: LocationRuntime = {
    hasStarted: async () => started,
    start: async () => {
      calls.push('start');
      if (opts.failStart) throw new Error('ForegroundServiceStartNotAllowedException');
      started = true;
    },
    stop: async () => {
      calls.push('stop');
      started = false;
    },
  };
  return { loc, calls };
}

// A never-resolving sleep freezes superviseRecovery so resumeAfterLaunch tests can assert the synchronous part.
function deps(loc: LocationRuntime, over: Partial<ResumeDeps> = {}): ResumeDeps {
  return {
    loc,
    store,
    restart: async () => {},
    sleep: () => new Promise<void>(() => {}),
    now: Date.now,
    ...over,
  };
}

async function waitFor(pred: () => Promise<boolean>, tries = 2000): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error('waitFor timed out');
}

const eventTypes = async (db: Db) =>
  (await db.getAllAsync<{ type: string; detail: string }>('SELECT type, detail FROM events')).map((e) => e.type);
const launchDetail = async (db: Db) =>
  (await db.getFirstAsync<{ detail: string }>("SELECT detail FROM events WHERE type='app_launch' ORDER BY id DESC LIMIT 1"))?.detail ?? '';

describe('applyArming', () => {
  it('none: does nothing', async () => {
    const { loc, calls } = fakeLoc({ started: true });
    await applyArming(loc, 'none');
    assert.deepEqual(calls, []);
  });

  it('start: starts without stopping', async () => {
    const { loc, calls } = fakeLoc({ started: false });
    await applyArming(loc, 'start');
    assert.deepEqual(calls, ['start']);
  });

  it('restart: stops a registered task then starts it again', async () => {
    const { loc, calls } = fakeLoc({ started: true });
    await applyArming(loc, 'restart');
    assert.deepEqual(calls, ['stop', 'start']);
  });

  it('restart: starts without stopping when the task is not registered', async () => {
    const { loc, calls } = fakeLoc({ started: false });
    await applyArming(loc, 'restart');
    assert.deepEqual(calls, ['start']);
  });
});

describe('restartTracking', () => {
  it('reports armed and logs ok on success', async () => {
    const events: string[] = [];
    const { loc } = fakeLoc({ started: true });
    const armed = await restartTracking(async (type, detail) => { events.push(`${type}:${detail}`); }, loc);
    assert.equal(armed, true);
    assert.deepEqual(events, ['tracking_restart:ok']);
  });

  it('reports armed=false and logs the failure when start throws', async () => {
    const events: string[] = [];
    const { loc } = fakeLoc({ started: true, failStart: true });
    const armed = await restartTracking(async (type, detail) => { events.push(`${type}:${detail}`); }, loc);
    assert.equal(armed, false);
    assert.equal(events.length, 1);
    assert.match(events[0], /^tracking_restart:failed /);
  });
});

describe('resumeAfterLaunch', { skip: !hasNodeSqlite() && 'node:sqlite not available (needs Node 22.5+)' }, () => {
  let db: Db;
  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
  });

  it('REGRESSION: an interrupted ride with a registered task is restarted (stop + start), not left alone', async () => {
    await createRide(db, 'r1', T0);
    await applyBatch(db, walk(60, T0), T0 + 60_000); // last point at T0+59 s
    const { loc, calls } = fakeLoc({ started: true });
    const now = T0 + 59_000 + 150_000; // opened 150 s after the last point
    const out = await resumeAfterLaunch(db, deps(loc, { now: () => now }));

    assert.ok(out);
    assert.equal(out.registered, true);
    assert.equal(out.restarted, true);
    assert.equal(out.interrupted, true);
    assert.deepEqual(calls, ['stop', 'start']); // the task reported registered but was re-armed anyway

    const ride = await getRide(db, 'r1');
    assert.equal(ride?.interrupted, 1);
    assert.equal(ride?.recovery_state, 'verifying');
    assert.match(await launchDetail(db), /registered=true restarted=true interrupted=true/);
    assert.ok((await eventTypes(db)).includes('ride_interrupted'));
  });

  it('an interrupted ride with no registered task is started once, not stopped', async () => {
    await createRide(db, 'r2', T0);
    await applyBatch(db, walk(30, T0), T0 + 30_000);
    const { loc, calls } = fakeLoc({ started: false });
    const now = T0 + 29_000 + 100_000;
    const out = await resumeAfterLaunch(db, deps(loc, { now: () => now }));

    assert.equal(out?.registered, false);
    assert.equal(out?.restarted, true);
    assert.equal(out?.interrupted, true);
    assert.deepEqual(calls, ['start']);
  });

  it('a ride with recent points is left alone even when the task is registered', async () => {
    await createRide(db, 'r3', T0);
    await applyBatch(db, walk(30, T0), T0 + 30_000); // last point at T0+29 s
    const { loc, calls } = fakeLoc({ started: true });
    const now = T0 + 29_000 + 5_000; // 5 s without a point: not interrupted
    const out = await resumeAfterLaunch(db, deps(loc, { now: () => now }));

    assert.equal(out?.interrupted, false);
    assert.equal(out?.restarted, false);
    assert.deepEqual(calls, []);
    assert.match(await launchDetail(db), /registered=true restarted=false interrupted=false/);
  });

  it('a failed inline restart is reported as not armed but the interruption is still persisted', async () => {
    await createRide(db, 'r4', T0);
    await applyBatch(db, walk(30, T0), T0 + 30_000);
    const { loc, calls } = fakeLoc({ started: true, failStart: true });
    const now = T0 + 29_000 + 100_000;
    const out = await resumeAfterLaunch(db, deps(loc, { now: () => now }));

    assert.equal(out?.restarted, false);
    assert.deepEqual(calls, ['stop', 'start']);
    assert.match(await launchDetail(db), /restarted=false interrupted=true/);
    assert.ok((await eventTypes(db)).includes('tracking_restart'));
    assert.equal((await getRide(db, 'r4'))?.recovery_state, 'verifying');
  });

  it('seeds the supervisor with one attempt already used when the inline restart succeeded', async () => {
    await createRide(db, 'r5', T0);
    await applyBatch(db, walk(30, T0), T0 + 30_000);
    let t = T0 + 29_000 + 100_000;
    const restarts: number[] = [];
    const d = deps(fakeLoc({ started: true }).loc, {
      now: () => t, sleep: async (ms) => { t += ms; }, restart: async () => { restarts.push(t); },
    });
    const out = await resumeAfterLaunch(db, d);
    assert.equal(out?.restarted, true);
    await waitFor(async () => (await getRide(db, 'r5'))?.recovery_state === 'failed');
    assert.deepEqual(restarts, []); // attempts seeded 1 -> no supervisor restart
  });

  it('seeds the supervisor with zero attempts when the inline restart failed', async () => {
    await createRide(db, 'r6', T0);
    await applyBatch(db, walk(30, T0), T0 + 30_000);
    let t = T0 + 29_000 + 100_000;
    const restarts: number[] = [];
    const d = deps(fakeLoc({ started: true, failStart: true }).loc, {
      now: () => t, sleep: async (ms) => { t += ms; }, restart: async () => { restarts.push(t); },
    });
    const out = await resumeAfterLaunch(db, d);
    assert.equal(out?.restarted, false);
    await waitFor(async () => (await getRide(db, 'r6'))?.recovery_state === 'failed');
    assert.equal(restarts.length, 1); // attempts seeded 0 -> the supervisor gets its one restart
  });

  it('REGRESSION: arming on resume does not change the untracked-gap accounting', async () => {
    await createRide(db, 'u1', T0);
    await applyBatch(db, walk(40, T0), T0 + 40_000); // last point at T0+39 s
    const { loc } = fakeLoc({ started: true });
    const now = T0 + 39_000 + 150_000;
    await resumeAfterLaunch(db, deps(loc, { now: () => now }));
    // fixes resume 150 s after the last stored point
    await applyBatch(db, walk(40, T0 + 39_000 + 150_000, 39 * 1.4), T0 + 200_000);
    const ride = await finishRide(db, 'u1', 'finished', T0 + 210_000);

    assert.equal(ride?.status, 'recovered');
    assert.equal(ride?.needs_review, 1);
    assert.ok(Math.abs((ride?.untracked_gap_s ?? 0) - 150) < 1, `untracked ${ride?.untracked_gap_s}`);
  });
});

describe('superviseRecovery', { skip: !hasNodeSqlite() && 'node:sqlite not available (needs Node 22.5+)' }, () => {
  let db: Db;
  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
  });

  it('confirms recovery only after three distinct fresh fixes, not one', async () => {
    await createRide(db, 'c1', T0);
    await applyBatch(db, walk(5, T0), T0 + 5_000);
    const launchAt = T0 + 100_000;
    const fresh = [launchAt + 1_000, launchAt + 2_000, launchAt + 3_000]; // a new fix arrives each poll
    let t = launchAt;
    let i = 0;
    const d = deps(fakeLoc({ started: true }).loc, {
      now: () => t,
      sleep: async (ms) => {
        t += ms;
        if (i < fresh.length) { await db.runAsync('UPDATE rides SET last_ts = ? WHERE id = ?', fresh[i], 'c1'); i += 1; }
      },
      restart: async () => { throw new Error('must not restart'); },
    });
    await superviseRecovery(db, 'c1', launchAt, T0 + 5_000, 0, d);

    assert.equal((await getRide(db, 'c1'))?.recovery_state, 'confirmed');
    assert.ok((await eventTypes(db)).includes('recovery_confirmed'));
  });

  it('a single fresh fix followed by silence does not confirm: it fails at the timeout', async () => {
    await createRide(db, 'c3', T0);
    await applyBatch(db, walk(5, T0), T0 + 5_000);
    const launchAt = T0 + 100_000;
    let t = launchAt;
    let set = false;
    const d = deps(fakeLoc({ started: true }).loc, {
      now: () => t,
      // exactly one fresh fix, then no newer last_ts for the rest of the window
      sleep: async (ms) => { t += ms; if (!set) { await db.runAsync('UPDATE rides SET last_ts = ? WHERE id = ?', launchAt + 1_000, 'c3'); set = true; } },
      restart: async () => { throw new Error('must not restart'); },
    });
    await superviseRecovery(db, 'c3', launchAt, T0 + 5_000, 1, d); // attempts seeded -> no restart budget

    assert.equal((await getRide(db, 'c3'))?.recovery_state, 'failed');
    assert.ok(!(await eventTypes(db)).includes('recovery_confirmed'));
  });

  it('a repeated last_ts across polls counts once and never confirms', async () => {
    await createRide(db, 'c2', T0);
    await applyBatch(db, walk(5, T0), T0 + 5_000);
    const launchAt = T0 + 100_000;
    const same = launchAt + 1_000;
    let t = launchAt;
    const restarts: number[] = [];
    const d = deps(fakeLoc({ started: true }).loc, {
      now: () => t,
      sleep: async (ms) => { t += ms; await db.runAsync('UPDATE rides SET last_ts = ? WHERE id = ?', same, 'c2'); },
      restart: async () => { restarts.push(t); },
    });
    await superviseRecovery(db, 'c2', launchAt, T0 + 5_000, 1, d); // attempts seeded -> no restart budget

    assert.equal((await getRide(db, 'c2'))?.recovery_state, 'failed'); // one distinct fix can never reach three
    assert.ok(!(await eventTypes(db)).includes('recovery_confirmed'));
    assert.deepEqual(restarts, []);
  });

  it('a cached pre-launch fix is never counted as fresh', async () => {
    await createRide(db, 'c4', T0);
    await applyBatch(db, walk(5, T0), T0 + 5_000);
    const launchAt = T0 + 100_000;
    const stale = launchAt - 5_000; // newer than the stored fix, but produced before the relaunch
    let t = launchAt;
    const d = deps(fakeLoc({ started: true }).loc, {
      now: () => t,
      sleep: async (ms) => { t += ms; await db.runAsync('UPDATE rides SET last_ts = ? WHERE id = ?', stale, 'c4'); },
      restart: async () => { throw new Error('must not restart'); },
    });
    await superviseRecovery(db, 'c4', launchAt, T0 + 5_000, 1, d);

    assert.equal((await getRide(db, 'c4'))?.recovery_state, 'failed');
    assert.ok(!(await eventTypes(db)).includes('recovery_confirmed'));
  });

  it('restarts once then fails when no fresh fix arrives', async () => {
    await createRide(db, 'f1', T0);
    await applyBatch(db, walk(5, T0), T0 + 5_000); // last point far before launch
    const launchAt = T0 + 100_000;
    let t = launchAt;
    const restarts: number[] = [];
    const d = deps(fakeLoc({ started: true }).loc, {
      now: () => t, sleep: async (ms) => { t += ms; }, restart: async () => { restarts.push(t); },
    });
    await superviseRecovery(db, 'f1', launchAt, T0 + 5_000, 0, d);

    assert.equal(restarts.length, 1);
    assert.equal((await getRide(db, 'f1'))?.recovery_state, 'failed');
    const types = await eventTypes(db);
    assert.ok(types.includes('recovery_restart_attempt') && types.includes('recovery_failed'));
  });

  it('REGRESSION: fixes counted before a restart never count toward the next window', async () => {
    await createRide(db, 'w1', T0);
    await applyBatch(db, walk(5, T0), T0 + 5_000);
    const launchAt = T0 + 100_000;
    // Poll k happens at t = launchAt + k*1000; sleeps run before the ride is read.
    // First window: two distinct fresh fixes (polls 1 and 2), then silence until the timeout at poll 20 -> restart.
    // New window: exactly one distinct fresh fix (poll 21), then silence.
    // With the bug this carries over (2 + 1 = 3) and confirms; the fix must instead fail.
    const schedule: Record<number, number> = { 1: launchAt + 1_000, 2: launchAt + 2_000, 21: launchAt + 21_000 };
    let t = launchAt;
    const restarts: number[] = [];
    const d = deps(fakeLoc({ started: true }).loc, {
      now: () => t,
      sleep: async (ms) => {
        t += ms;
        const k = Math.round((t - launchAt) / 1_000);
        if (schedule[k] !== undefined) await db.runAsync('UPDATE rides SET last_ts = ? WHERE id = ?', schedule[k], 'w1');
      },
      restart: async () => { restarts.push(t); },
    });
    await superviseRecovery(db, 'w1', launchAt, T0 + 5_000, 0, d);

    assert.equal(restarts.length, 1); // the first window timed out and restarted once
    assert.equal((await getRide(db, 'w1'))?.recovery_state, 'failed'); // one post-restart fix is not three
    assert.ok(!(await eventTypes(db)).includes('recovery_confirmed'));
  });

  it('after a restart, confirmation needs three distinct fresh fixes newer than the restart baseline', async () => {
    await createRide(db, 'w2', T0);
    await applyBatch(db, walk(5, T0), T0 + 5_000);
    const launchAt = T0 + 100_000;
    const baseline = launchAt + 2_000; // last fresh fix of the first window, and the restart baseline
    const schedule: Record<number, number> = {
      1: launchAt + 1_000,
      2: baseline,
      21: baseline, // replaying the restart-time timestamp must NOT count toward the new window
      22: launchAt + 22_000,
      23: launchAt + 23_000,
      24: launchAt + 24_000, // third distinct newer fix -> confirmed
    };
    let t = launchAt;
    const restarts: number[] = [];
    let confirmedAt: number | null = null;
    const d = deps(fakeLoc({ started: true }).loc, {
      now: () => t,
      sleep: async (ms) => {
        t += ms;
        const k = Math.round((t - launchAt) / 1_000);
        if (schedule[k] !== undefined) await db.runAsync('UPDATE rides SET last_ts = ? WHERE id = ?', schedule[k], 'w2');
      },
      restart: async () => { restarts.push(t); },
      store: {
        ...store,
        logEvent: async (db, type, detail, now) => {
          if (type === 'recovery_confirmed') confirmedAt = now ?? t;
          await store.logEvent(db, type, detail, now);
        },
      },
    });
    await superviseRecovery(db, 'w2', launchAt, T0 + 5_000, 0, d);

    assert.equal(restarts.length, 1);
    assert.equal((await getRide(db, 'w2'))?.recovery_state, 'confirmed');
    assert.equal(confirmedAt, launchAt + 24_000); // exactly the third distinct fix after the restart window began
  });

  it('does not restart again when the attempt budget is already used', async () => {
    await createRide(db, 'f2', T0);
    await applyBatch(db, walk(5, T0), T0 + 5_000);
    const launchAt = T0 + 100_000;
    let t = launchAt;
    const restarts: number[] = [];
    const d = deps(fakeLoc({ started: true }).loc, {
      now: () => t, sleep: async (ms) => { t += ms; }, restart: async () => { restarts.push(t); },
    });
    await superviseRecovery(db, 'f2', launchAt, T0 + 5_000, 1, d);

    assert.equal(restarts.length, 0);
    assert.equal((await getRide(db, 'f2'))?.recovery_state, 'failed');
  });

  it('stops without touching state once the ride is finished', async () => {
    await createRide(db, 'a1', T0);
    await applyBatch(db, walk(5, T0), T0 + 5_000);
    await finishRide(db, 'a1', 'finished', T0 + 6_000);
    const launchAt = T0 + 100_000;
    let t = launchAt;
    const d = deps(fakeLoc({ started: true }).loc, {
      now: () => t, sleep: async (ms) => { t += ms; }, restart: async () => { throw new Error('must not restart'); },
    });
    await superviseRecovery(db, 'a1', launchAt, T0 + 5_000, 0, d);

    const ride = await getRide(db, 'a1');
    assert.equal(ride?.status, 'finished');
    assert.equal(ride?.recovery_state, 'none');
  });
});
