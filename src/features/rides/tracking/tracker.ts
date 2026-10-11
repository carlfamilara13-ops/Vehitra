import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';
import { PROCESS, RECOVERY, TASK_NAME, TRACKING } from '../../../config/tracking';
import { getDb } from '../../../data/local/db';
import {
  abortRide, createRide, findUnfinishedRide, finishRide, getActiveRideId, getRide, logEvent, markInterrupted,
  repairOrphanRides, setRecoveryState, type RideRow,
} from '../../../data/local/ridesStore';
import type { Db } from '../../../data/local/types';
import { decideRecovery } from '../../../domain/ride/recovery';
import { createQueue } from '../../../lib/queue';
import { evaluatePermissions } from './permissionPolicy';
import { readLocationPermissions } from './permissions';

// start / stop / resume / restart run strictly one at a time, so a Stop can never overtake a Start
// (which would leave tracking running with no ride) and two Starts can never overlap.
const lifecycle = createQueue();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class StartBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StartBlockedError';
  }
}

function locationOptions(): Location.LocationTaskOptions {
  return {
    accuracy: Location.Accuracy[TRACKING.accuracy],
    timeInterval: TRACKING.timeInterval,
    distanceInterval: TRACKING.distanceInterval,
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: TRACKING.notificationTitle,
      notificationBody: TRACKING.notificationBody,
      notificationColor: TRACKING.notificationColor,
      killServiceOnDestroy: TRACKING.killServiceOnDestroy,
    },
  };
}

// Starts recording. Refuses unless BOTH foreground and background location are already granted (defence in depth:
// the screen asks first, but this must hold for every caller). A second start while recording is rejected.
export function startRide(userVehicleId: string | null = null): Promise<string> {
  return lifecycle.run(async () => {
    const db = await getDb();
    const perm = await readLocationPermissions();
    const verdict = evaluatePermissions({
      ...perm, notifications: true, foregroundCanAskAgain: true, backgroundCanAskAgain: true,
    });
    if (!verdict.canStart) throw new StartBlockedError(verdict.message);
    const id = Crypto.randomUUID();
    await createRide(db, id, Date.now(), userVehicleId); // throws RideAlreadyActiveError on a double start
    try {
      await Location.startLocationUpdatesAsync(TASK_NAME, locationOptions());
    } catch (e) {
      await abortRide(db, id, String(e));
      throw e;
    }
    return id;
  });
}

// Stops recording and finalizes the ride. A ride that was interrupted is finished as 'recovered' whatever is passed.
export function stopRide(status: 'finished' | 'recovered' = 'finished'): Promise<RideRow | null> {
  return lifecycle.run(async () => {
    const db = await getDb();
    const id = await getActiveRideId(db);
    try {
      if (await Location.hasStartedLocationUpdatesAsync(TASK_NAME)) {
        await Location.stopLocationUpdatesAsync(TASK_NAME);
      }
    } catch (e) {
      // Still finalize the ride. If the service keeps running, the task stops it when it sees no active ride.
      await logEvent(db, 'stop_failed', String(e));
    }
    if (!id) return null;
    return finishRide(db, id, status);
  });
}

async function restartTracking(db: Db): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK_NAME)) {
      await Location.stopLocationUpdatesAsync(TASK_NAME);
    }
    await Location.startLocationUpdatesAsync(TASK_NAME, locationOptions());
    await logEvent(db, 'tracking_restart', 'ok');
  } catch (e) {
    await logEvent(db, 'tracking_restart', `failed ${String(e)}`);
  }
}

// After an interruption, do NOT trust that tracking is back: wait for a FRESH fix to be stored. If none arrives,
// restart tracking once; if still nothing, mark recovery as failed so the user is told the truth.
async function superviseRecovery(
  rideId: string,
  launchAt: number,
  lastTsAtLaunch: number | null,
  initialAttempts: number,
): Promise<void> {
  const db = await getDb();
  let attempts = initialAttempts;
  let windowStart = launchAt;
  for (;;) {
    await sleep(RECOVERY.pollMs);
    const ride = await getRide(db, rideId);
    if (!ride || ride.status !== 'recording') return; // finished in the meantime
    const decision = decideRecovery({
      launchAt,
      lastTsAtLaunch,
      currentLastTs: ride.last_ts,
      elapsedMs: Date.now() - windowStart,
      restartAttempts: attempts,
      staleToleranceMs: PROCESS.staleFixToleranceMs,
      verifyTimeoutMs: RECOVERY.verifyTimeoutMs,
      maxRestartAttempts: RECOVERY.maxRestartAttempts,
    });
    if (decision === 'confirmed') {
      await setRecoveryState(db, rideId, 'confirmed');
      await logEvent(db, 'recovery_confirmed', `after_ms=${Date.now() - launchAt}`);
      return;
    }
    if (decision === 'failed') {
      await setRecoveryState(db, rideId, 'failed');
      await logEvent(db, 'recovery_failed', `no fresh fix after ${Date.now() - launchAt} ms and ${attempts} restart(s)`);
      return;
    }
    if (decision === 'restart') {
      attempts += 1;
      windowStart = Date.now();
      await logEvent(db, 'recovery_restart_attempt', `attempt=${attempts}`);
      await lifecycle.run(async () => {
        if ((await getActiveRideId(db)) === rideId) await restartTracking(db);
      });
    }
  }
}

// User action when recovery failed: restart tracking and verify again.
export function retryTracking(): Promise<void> {
  return lifecycle.run(async () => {
    const db = await getDb();
    const id = await getActiveRideId(db);
    if (!id) return;
    const ride = await getRide(db, id);
    if (!ride || ride.status !== 'recording') return;
    await restartTracking(db);
    await setRecoveryState(db, id, 'verifying');
    void superviseRecovery(id, Date.now(), ride.last_ts, 1);
  });
}

async function doResume() {
  const db = await getDb();
  await repairOrphanRides(db);
  const found = await findUnfinishedRide(db);
  if (!found) {
    await logEvent(db, 'app_launch', 'clean');
    return null;
  }
  const launchAt = Date.now();
  const id = found.ride.id;
  const interrupted = found.sinceLastPointS > RECOVERY.minInterruptionS;
  // `registered` means the tracking task is registered. It does NOT mean fixes are arriving.
  const registered = await Location.hasStartedLocationUpdatesAsync(TASK_NAME);
  let restarted = false;
  if (!registered) {
    try {
      await Location.startLocationUpdatesAsync(TASK_NAME, locationOptions());
      restarted = true;
    } catch (e) {
      await logEvent(db, 'resume_failed', String(e));
    }
  }
  if (interrupted) {
    await markInterrupted(db, id, found.sinceLastPointS);
    void superviseRecovery(id, launchAt, found.ride.last_ts, restarted ? 1 : 0);
  } else if (found.ride.interrupted && found.ride.recovery_state !== 'confirmed') {
    await setRecoveryState(db, id, 'confirmed'); // fresh points were arriving right up to this launch
  }
  await logEvent(
    db,
    'app_launch',
    `unfinished=${id} registered=${registered} restarted=${restarted} interrupted=${interrupted} since_last_point_s=${found.sinceLastPointS}`,
  );
  return { ...found, registered, restarted, interrupted };
}

// Call on app launch. Runs once per app process (React may call effects twice in development).
// Phase 0 observed on one phone: after a FORCE-STOP and reopen, fixes started arriving again. That does not cover a
// PHONE RESTART, so nothing here assumes recovery: the outcome is whatever superviseRecovery observes.
let resumeOnce: Promise<Awaited<ReturnType<typeof doResume>>> | null = null;
export function resumeIfInterrupted() {
  if (!resumeOnce) {
    resumeOnce = lifecycle.run(doResume).catch((e) => {
      resumeOnce = null;
      throw e;
    });
  }
  return resumeOnce;
}
