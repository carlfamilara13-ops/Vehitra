import type { RideState } from './types';

export const MIN_TRACKED_S_FOR_SPEED = 5;

export type RideSummary = {
  durationS: number; // wall clock: ride start to ride end
  trackedS: number; // time covered by usable fixes (see below)
  avgSpeedMs: number | null; // null when there is not enough tracked time to say
};

// Tracked-time semantics:
//   trackedS = (last usable fix - first usable fix) - untracked gaps
// so time before the first usable fix, after the last usable fix, and inside untracked gaps is NOT tracked.
// Average speed = filtered distance / trackedS, or null when trackedS < MIN_TRACKED_S_FOR_SPEED.
// GPS speed readings are unvalidated at vehicle speeds (Phase 0 only tested walking).
export function summarizeRide(
  state: RideState,
  endedAtMs: number,
  minTrackedS = MIN_TRACKED_S_FOR_SPEED,
): RideSummary {
  const durationS = Math.max(0, Math.round((endedAtMs - state.startedAt) / 1000));
  const span =
    state.firstUsableTs !== null && state.lastUsableTs !== null
      ? (state.lastUsableTs - state.firstUsableTs) / 1000
      : 0;
  const trackedS = Math.max(0, span - state.untrackedGapS);
  const avgSpeedMs = trackedS >= minTrackedS ? state.distanceM / trackedS : null;
  return { durationS, trackedS, avgSpeedMs };
}
