import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';
import { TASK_NAME, TRACKING } from '../../../config/tracking';
import { getDb } from '../../../data/local/db';
import {
  abortRide, createRide, findUnfinishedRide, finishRide, getActiveRideId, getRide, logEvent, markInterrupted,
  repairOrphanRides, setRecoveryState, type RideRow,
} from '../../../data/local/ridesStore';
import type { Db } from '../../../data/local/types';
import { createQueue } from '../../../lib/queue';
import { evaluatePermissions } from './permissionPolicy';
import { readLocationPermissions } from './permissions';
import {
  restartTracking as restartTrackingCore, resumeAfterLaunch, superviseRecovery,
  type LocationRuntime, type ResumeDeps, type ResumeStore,
} from './resume';

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
// `vehicleName` is the snapshot of the selected vehicle's name (null when none is selected); it is passed straight
// through to the ride and never derived again, so recovery can never attach a different vehicle's name.
export function startRide(userVehicleId: string | null = null, vehicleName: string | null = null): Promise<string> {
  return lifecycle.run(async () => {
    const db = await getDb();
    const perm = await readLocationPermissions();
    const verdict = evaluatePermissions({
      ...perm, notifications: true, foregroundCanAskAgain: true, backgroundCanAskAgain: true,
    });
    if (!verdict.canStart) throw new StartBlockedError(verdict.message);
    const id = Crypto.randomUUID();
    await createRide(db, id, Date.now(), userVehicleId, vehicleName); // throws RideAlreadyActiveError on a double start
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

// Real expo-location runtime. `hasStarted` is only a registration check; delivery is never assumed (see resume.ts).
const expoLocationRuntime: LocationRuntime = {
  hasStarted: () => Location.hasStartedLocationUpdatesAsync(TASK_NAME),
  start: () => Location.startLocationUpdatesAsync(TASK_NAME, locationOptions()),
  stop: () => Location.stopLocationUpdatesAsync(TASK_NAME),
};

const resumeStore: ResumeStore = {
  repairOrphanRides, findUnfinishedRide, markInterrupted, setRecoveryState, getRide, getActiveRideId, logEvent,
};

// Stop + start tracking, bound to this database for logging.
function restartTracking(db: Db): Promise<boolean> {
  return restartTrackingCore((type, detail) => logEvent(db, type, detail), expoLocationRuntime);
}

const resumeDeps: ResumeDeps = {
  loc: expoLocationRuntime,
  store: resumeStore,
  restart: (db, rideId) => lifecycle.run(async () => {
    if ((await getActiveRideId(db)) === rideId) await restartTracking(db);
  }),
  sleep,
  now: Date.now,
};

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
    void superviseRecovery(db, id, Date.now(), ride.last_ts, 1, resumeDeps);
  });
}

async function doResume() {
  const db = await getDb();
  return resumeAfterLaunch(db, resumeDeps);
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
