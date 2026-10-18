// Recovery orchestration, deliberately free of expo-location / expo-sqlite / react-native imports so it can be
// tested in Node against a real in-memory database (see nodeSqliteDb.testutil) and a fake LocationRuntime.
// tracker.ts wires the real modules into these deps.
import { PROCESS, RECOVERY } from '../../../config/tracking';
import type { Db } from '../../../data/local/types';
import type { RecoveryState, RideRow } from '../../../data/local/ridesStore';
import { decideArming, decideRecovery, isFreshFix, type ArmAction } from '../../../domain/ride/recovery';

// Injectable seam over expo-location: registration state, start and stop.
export type LocationRuntime = {
  hasStarted: () => Promise<boolean>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

// 'restart' stops a registered task before starting it, so the native consumer is re-registered from scratch
// (LocationModule.kt: hasStartedLocationUpdatesAsync is only a registry check, not proof of delivery).
export async function applyArming(loc: LocationRuntime, action: ArmAction): Promise<void> {
  if (action === 'none') return;
  if (action === 'restart' && (await loc.hasStarted())) await loc.stop();
  await loc.start();
}

// Stop + start tracking and report whether it ended up armed. Never throws.
export async function restartTracking(
  log: (type: string, detail: string) => Promise<void>,
  loc: LocationRuntime,
): Promise<boolean> {
  try {
    await applyArming(loc, 'restart');
    await log('tracking_restart', 'ok');
    return true;
  } catch (e) {
    await log('tracking_restart', `failed ${String(e)}`);
    return false;
  }
}

// The ridesStore surface recovery needs, injected so tests can drive it with a real in-memory Db.
export type ResumeStore = {
  repairOrphanRides: (db: Db, now?: number) => Promise<number>;
  findUnfinishedRide: (db: Db, now?: number) => Promise<{ ride: RideRow; sinceLastPointS: number } | null>;
  markInterrupted: (db: Db, rideId: string, sinceLastPointS: number, now?: number) => Promise<void>;
  setRecoveryState: (db: Db, rideId: string, state: RecoveryState, now?: number) => Promise<void>;
  getRide: (db: Db, rideId: string) => Promise<RideRow | null>;
  getActiveRideId: (db: Db) => Promise<string | null>;
  logEvent: (db: Db, type: string, detail?: string, now?: number) => Promise<void>;
};

export type ResumeDeps = {
  loc: LocationRuntime;
  store: ResumeStore;
  // Lifecycle-serialized re-arm: only restarts when the ride is still the active one. Injected so tests can observe it.
  restart: (db: Db, rideId: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

export type ResumeResult = {
  ride: RideRow;
  sinceLastPointS: number;
  registered: boolean;
  restarted: boolean;
  interrupted: boolean;
};

// After an interruption, do NOT trust that tracking is back: wait for SEVERAL distinct fresh fixes. One fix only
// proves the pipe is open, not that delivery is sustained. If too few arrive before the timeout, restart tracking
// once; if still too few, mark recovery as failed so the user is told the truth.
export async function superviseRecovery(
  db: Db,
  rideId: string,
  launchAt: number,
  lastTsAtLaunch: number | null,
  initialAttempts: number,
  deps: ResumeDeps,
): Promise<void> {
  let attempts = initialAttempts;
  let windowStart = launchAt;
  // Count each distinct fresh fix once: an unchanged last_ts across polls must never count twice, and a cached
  // pre-launch fix must never count at all (isFreshFix is the same boundary the decision uses).
  let freshFixCount = 0;
  let lastCountedTs = lastTsAtLaunch;
  for (;;) {
    await deps.sleep(RECOVERY.pollMs);
    const ride = await deps.store.getRide(db, rideId);
    if (!ride || ride.status !== 'recording') return; // finished in the meantime
    const ts = ride.last_ts;
    if (ts !== null && isFreshFix(ts, lastTsAtLaunch, launchAt, PROCESS.staleFixToleranceMs) &&
      (lastCountedTs === null || ts > lastCountedTs)) {
      freshFixCount += 1;
      lastCountedTs = ts;
    }
    const decision = decideRecovery({
      launchAt,
      lastTsAtLaunch,
      currentLastTs: ride.last_ts,
      freshFixCount,
      minFreshFixes: RECOVERY.confirmMinFreshFixes,
      elapsedMs: deps.now() - windowStart,
      restartAttempts: attempts,
      staleToleranceMs: PROCESS.staleFixToleranceMs,
      verifyTimeoutMs: RECOVERY.verifyTimeoutMs,
      maxRestartAttempts: RECOVERY.maxRestartAttempts,
    });
    if (decision === 'confirmed') {
      await deps.store.setRecoveryState(db, rideId, 'confirmed', deps.now());
      await deps.store.logEvent(
        db,
        'recovery_confirmed',
        `after_ms=${deps.now() - launchAt} fresh_count=${freshFixCount} window_start=${new Date(windowStart).toISOString()}`,
        deps.now(),
      );
      return;
    }
    if (decision === 'failed') {
      await deps.store.setRecoveryState(db, rideId, 'failed', deps.now());
      await deps.store.logEvent(
        db, 'recovery_failed', `no fresh fix after ${deps.now() - launchAt} ms and ${attempts} restart(s)`, deps.now(),
      );
      return;
    }
    if (decision === 'restart') {
      attempts += 1;
      windowStart = deps.now();
      // A new verification window: fixes counted before this restart must not count toward the next confirmation,
      // so start the count over and only accept timestamps newer than the one observed at restart time.
      freshFixCount = 0;
      lastCountedTs = ride.last_ts;
      await deps.store.logEvent(db, 'recovery_restart_attempt', `attempt=${attempts}`, deps.now());
      await deps.restart(db, rideId);
    }
  }
}

// On launch: repair orphans, find an unfinished ride and (re)arm tracking. An interrupted ride is re-armed even
// when the task still reports as registered, because registration does not prove fixes are arriving.
export async function resumeAfterLaunch(db: Db, deps: ResumeDeps): Promise<ResumeResult | null> {
  await deps.store.repairOrphanRides(db, deps.now());
  const found = await deps.store.findUnfinishedRide(db, deps.now());
  if (!found) {
    await deps.store.logEvent(db, 'app_launch', 'clean', deps.now());
    return null;
  }
  const launchAt = deps.now();
  const id = found.ride.id;
  const interrupted = found.sinceLastPointS > RECOVERY.minInterruptionS;
  const registered = await deps.loc.hasStarted();
  const action = decideArming({ registered, interrupted });
  let restarted = false;
  if (action === 'start') {
    try {
      await deps.loc.start();
      restarted = true;
    } catch (e) {
      await deps.store.logEvent(db, 'resume_failed', String(e), deps.now());
    }
  } else if (action === 'restart') {
    restarted = await restartTracking((type, detail) => deps.store.logEvent(db, type, detail, deps.now()), deps.loc);
  }
  if (interrupted) {
    await deps.store.markInterrupted(db, id, found.sinceLastPointS, deps.now());
    void superviseRecovery(db, id, launchAt, found.ride.last_ts, restarted ? 1 : 0, deps);
  } else if (found.ride.interrupted && found.ride.recovery_state !== 'confirmed') {
    await deps.store.setRecoveryState(db, id, 'confirmed', deps.now());
  }
  await deps.store.logEvent(
    db,
    'app_launch',
    `unfinished=${id} registered=${registered} restarted=${restarted} interrupted=${interrupted} since_last_point_s=${found.sinceLastPointS}`,
    deps.now(),
  );
  return { ...found, registered, restarted, interrupted };
}
