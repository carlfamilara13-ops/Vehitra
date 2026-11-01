// Ride tracking settings. Values proven in the Phase 0 GPS proof-of-concept (see docs/decisions/0001-gps-architecture.md).
import type { ProcessConfig } from '../domain/ride/types';

export const TASK_NAME = 'vehitra-location-task';

export const TRACKING = {
  accuracy: 'BestForNavigation' as 'BestForNavigation' | 'High' | 'Balanced', // try 'High' for a battery comparison
  timeInterval: 1000, // ms (Android)
  distanceInterval: 0, // metres; 0 = time-based only
  // false: the foreground service keeps running when the app is swiped from recents (verified on a POCO phone).
  killServiceOnDestroy: false,
  notificationTitle: 'Vehitra',
  notificationBody: 'Recording your ride',
  notificationColor: '#1E6BFF',
};

export const PROCESS: ProcessConfig = {
  maxAccuracyM: 25, // fixes worse than this never add to the filtered distance
  minMoveM: 3, // ignore moves smaller than this
  standstillSpeedMs: 0.5, // below this reported speed, ignore moves smaller than the fix accuracy
  staleFixToleranceMs: 2000, // fixes older than ride start minus this are dropped (cached start fix)
  gapLogThresholdS: 10, // log a `gap` event above this
  untrackedGapS: 30, // a gap longer than this is "untracked": its distance is NOT added
  lateBatchMs: 2000, // counted as a late batch above this delay
  lateBatchLogMs: 5000, // logged as an event above this delay
};

// Route sent to the cloud: simplified, then encoded. Raw points stay on the device.
export const POLYLINE = { toleranceM: 5, precision: 5 };

// Recovery after the app was closed or killed while a ride was recording.
export const RECOVERY = {
  minInterruptionS: 10, // an unfinished ride with no new point for longer than this at launch counts as interrupted
  verifyTimeoutMs: 20000, // wait this long for ENOUGH fresh fixes before restarting tracking / giving up
  maxRestartAttempts: 1,
  pollMs: 1000,
  confirmMinFreshFixes: 3, // distinct fresh fixes that must arrive before recovery is called confirmed (one is not proof)
};

// Rides at least this long (seconds) with no usable route are flagged for review.
export const MIN_REVIEW_RIDE_S = 30;
