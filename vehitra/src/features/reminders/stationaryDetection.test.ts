import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  indicatesMovement,
  isReliableStationaryFix,
  shouldSendStationaryReminder,
  STATIONARY_REMINDER_POLICY,
} from './stationaryDetection';

const at = (timestamp: number, over: Record<string, unknown> = {}) => ({
  timestamp, accuracy: 7, speed: 0.2, lat: 14.6, lon: 121.0, ...over,
});

describe('stationary ride reminder detection', () => {
  it('rejects low-quality fixes and treats speed or meaningful displacement as movement', () => {
    assert.equal(isReliableStationaryFix(at(0, { accuracy: 40 })), false);
    assert.equal(indicatesMovement(at(0, { speed: 2 }), null), true);
    assert.equal(indicatesMovement(at(0, { lat: 14.601 }), at(0)), true);
    assert.equal(indicatesMovement(at(0), at(0)), false);
  });

  it('waits five sustained minutes and enough samples before reminding', () => {
    const input = { now: STATIONARY_REMINDER_POLICY.stationaryMs - 1, stationarySince: 0, sampleCount: 4, snoozeUntil: null, alreadyReminded: false };
    assert.equal(shouldSendStationaryReminder(input), false);
    assert.equal(shouldSendStationaryReminder({ ...input, now: STATIONARY_REMINDER_POLICY.stationaryMs }), true);
    assert.equal(shouldSendStationaryReminder({ ...input, now: 400_000, sampleCount: 2 }), false);
  });

  it('respects snooze and one notification per stop', () => {
    const input = { now: 1_000_000, stationarySince: 0, sampleCount: 8, snoozeUntil: 1_000_001, alreadyReminded: false };
    assert.equal(shouldSendStationaryReminder(input), false);
    assert.equal(shouldSendStationaryReminder({ ...input, snoozeUntil: 999_999 }), true);
    assert.equal(shouldSendStationaryReminder({ ...input, alreadyReminded: true }), false);
  });
});
