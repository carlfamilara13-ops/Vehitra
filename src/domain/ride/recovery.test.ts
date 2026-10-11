import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideRecovery, type RecoveryInput } from './recovery';

const LAUNCH = Date.UTC(2026, 9, 10, 2, 0, 0);
const base: RecoveryInput = {
  launchAt: LAUNCH,
  lastTsAtLaunch: LAUNCH - 300_000, // last point was 5 minutes before the relaunch
  currentLastTs: LAUNCH - 300_000,
  elapsedMs: 0,
  restartAttempts: 0,
  staleToleranceMs: 2000,
  verifyTimeoutMs: 20_000,
  maxRestartAttempts: 1,
};
const d = (o: Partial<RecoveryInput>) => decideRecovery({ ...base, ...o });

describe('decideRecovery: only a fresh fix proves tracking resumed', () => {
  it('a registered task alone proves nothing: it waits, then restarts, then fails', () => {
    assert.equal(d({ elapsedMs: 5000 }), 'wait');
    assert.equal(d({ elapsedMs: 20_000 }), 'restart');
    assert.equal(d({ elapsedMs: 20_000, restartAttempts: 1 }), 'failed');
    assert.equal(d({ elapsedMs: 19_999, restartAttempts: 1 }), 'wait');
  });

  it('a fix produced after the relaunch confirms recovery', () => {
    assert.equal(d({ elapsedMs: 3000, currentLastTs: LAUNCH + 2500 }), 'confirmed');
  });

  it('a newer-than-stored but pre-launch (cached) location does NOT confirm recovery', () => {
    assert.equal(d({ elapsedMs: 3000, currentLastTs: LAUNCH - 60_000 }), 'wait');
    assert.equal(d({ elapsedMs: 25_000, currentLastTs: LAUNCH - 60_000 }), 'restart');
  });

  it('a fix just inside the stale tolerance counts as fresh, one just outside does not', () => {
    assert.equal(d({ currentLastTs: LAUNCH - 2000 }), 'confirmed');
    assert.equal(d({ currentLastTs: LAUNCH - 2001 }), 'wait');
  });

  it('works when the ride had no stored fix at launch', () => {
    assert.equal(d({ lastTsAtLaunch: null, currentLastTs: null, elapsedMs: 1000 }), 'wait');
    assert.equal(d({ lastTsAtLaunch: null, currentLastTs: LAUNCH + 1000 }), 'confirmed');
  });

  it('confirmation after a restart still counts', () => {
    assert.equal(d({ elapsedMs: 4000, restartAttempts: 1, currentLastTs: LAUNCH + 22_000 }), 'confirmed');
  });
});
