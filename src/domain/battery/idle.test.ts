import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTERY_IDLE_LEVEL_LABELS,
  batteryIdleDays,
  batteryIdleLevel,
  IDLE_WATCH_DAYS,
  IDLE_WARN_DAYS,
} from './idle';

const DAY = 86_400_000;

describe('battery idle domain', () => {
  it('counts whole elapsed days from the last active timestamp', () => {
    const t0 = Date.UTC(2026, 9, 1, 12, 0, 0);
    assert.equal(batteryIdleDays(t0, t0), 0);
    assert.equal(batteryIdleDays(t0, t0 + DAY - 1), 0);
    assert.equal(batteryIdleDays(t0, t0 + DAY), 1);
    assert.equal(batteryIdleDays(t0, t0 + 6 * DAY + 5), 6);
    assert.equal(batteryIdleDays(t0, t0 + 7 * DAY), 7);
  });

  it('clamps clock skew to zero and treats unknown timestamps as unknown', () => {
    const t0 = Date.UTC(2026, 9, 1);
    assert.equal(batteryIdleDays(t0 + DAY, t0), 0); // "used in the future" = just used
    assert.equal(batteryIdleDays(Number.NaN, t0), null);
    assert.equal(batteryIdleDays(t0, Number.POSITIVE_INFINITY), null);
  });

  it('maps idle days to the agreed 3-day check and 7-day warning thresholds', () => {
    assert.equal(IDLE_WATCH_DAYS, 3);
    assert.equal(IDLE_WARN_DAYS, 7);
    assert.equal(batteryIdleLevel(0), 'ok');
    assert.equal(batteryIdleLevel(2), 'ok');
    assert.equal(batteryIdleLevel(3), 'watch');
    assert.equal(batteryIdleLevel(6), 'watch');
    assert.equal(batteryIdleLevel(7), 'warn');
    assert.equal(batteryIdleLevel(30), 'warn');
    assert.equal(batteryIdleLevel(null), 'ok');
    assert.equal(batteryIdleLevel(Number.NaN), 'ok');
  });

  it('exposes labels for every level', () => {
    for (const level of ['ok', 'watch', 'warn'] as const) {
      assert.ok(BATTERY_IDLE_LEVEL_LABELS[level].length > 0);
    }
  });
});
