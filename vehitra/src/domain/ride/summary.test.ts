import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { newRideState } from './processFixes';
import { MIN_TRACKED_S_FOR_SPEED, summarizeRide } from './summary';
import type { RideState } from './types';

const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);
const state = (over: Partial<RideState>): RideState => ({ ...newRideState(T0), ...over });

describe('summarizeRide: tracked-time semantics', () => {
  it('time before the first usable fix and after the last usable fix is not tracked', () => {
    // no usable fix for 120 s, 60 s of movement at 5 m/s, then 120 s without a usable fix before Stop
    const s = state({ firstUsableTs: T0 + 120_000, lastUsableTs: T0 + 180_000, distanceM: 300 });
    const r = summarizeRide(s, T0 + 300_000);
    assert.equal(r.durationS, 300); // wall clock stays the full ride
    assert.equal(r.trackedS, 60);
    assert.equal(r.avgSpeedMs, 5);
  });

  it('untracked gaps inside the span are excluded as well', () => {
    const s = state({ firstUsableTs: T0, lastUsableTs: T0 + 200_000, untrackedGapS: 100, distanceM: 500 });
    const r = summarizeRide(s, T0 + 200_000);
    assert.equal(r.trackedS, 100);
    assert.equal(r.avgSpeedMs, 5);
  });

  it('no usable fix, or a single one, means zero tracked time and no average speed', () => {
    assert.deepEqual(summarizeRide(state({}), T0 + 60_000), { durationS: 60, trackedS: 0, avgSpeedMs: null });
    const one = summarizeRide(state({ firstUsableTs: T0 + 5000, lastUsableTs: T0 + 5000 }), T0 + 60_000);
    assert.equal(one.trackedS, 0);
    assert.equal(one.avgSpeedMs, null);
  });

  it('average speed needs a minimum of tracked time', () => {
    const below = summarizeRide(state({ firstUsableTs: T0, lastUsableTs: T0 + (MIN_TRACKED_S_FOR_SPEED - 1) * 1000, distanceM: 20 }), T0 + 10_000);
    assert.equal(below.avgSpeedMs, null);
    const at = summarizeRide(state({ firstUsableTs: T0, lastUsableTs: T0 + MIN_TRACKED_S_FOR_SPEED * 1000, distanceM: 20 }), T0 + 10_000);
    assert.equal(at.avgSpeedMs, 4);
  });

  it('never goes negative when untracked time exceeds the span', () => {
    const r = summarizeRide(state({ firstUsableTs: T0, lastUsableTs: T0 + 10_000, untrackedGapS: 50 }), T0 + 20_000);
    assert.equal(r.trackedS, 0);
    assert.equal(r.avgSpeedMs, null);
  });
});
