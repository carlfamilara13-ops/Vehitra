import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMovementFix, MOVEMENT_REMINDER_POLICY, type MovementState } from './movementDetection';

const base: MovementState = { movingSince: null, lastFixAt: null, lastNoticeAt: null };
const fix = (timestamp: number, speed = 3, accuracy: number | null = 8) => ({ timestamp, speed, accuracy });

describe('movement reminder detection', () => {
  it('requires sustained speed above walking pace with accurate, continuous fixes', () => {
    let state = base;
    for (const t of [0, 5_000, 10_000, 15_000]) {
      const result = evaluateMovementFix(state, fix(t), false);
      assert.equal(result.shouldNotify, false);
      state = result.state;
    }
    const result = evaluateMovementFix(state, fix(20_000), false);
    assert.equal(result.shouldNotify, true);
    assert.equal(result.state.lastNoticeAt, 20_000);
  });

  it('does not trigger during a ride, at walking speed, with poor accuracy, or across a fix gap', () => {
    assert.equal(evaluateMovementFix(base, fix(0), true).state.movingSince, null);
    assert.equal(evaluateMovementFix(base, fix(0, MOVEMENT_REMINDER_POLICY.speedThresholdMps - 0.1), false).state.movingSince, null);
    assert.equal(evaluateMovementFix(base, fix(0, 4, 40), false).state.movingSince, null);
    const first = evaluateMovementFix(base, fix(0), false).state;
    assert.equal(evaluateMovementFix(first, fix(30_000), false).state.movingSince, 30_000);
  });

  it('enforces a cooldown and resets the streak when movement stops', () => {
    const afterNotice = { movingSince: null, lastFixAt: 20_000, lastNoticeAt: 20_000 };
    const next = evaluateMovementFix(afterNotice, fix(25_000), false);
    assert.equal(next.shouldNotify, false);
    assert.equal(next.state.movingSince, 25_000);
    const stopped = evaluateMovementFix(next.state, fix(30_000, 0.2), false);
    assert.equal(stopped.state.movingSince, null);
  });
});
