import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideArming, decideRecovery, type RecoveryInput } from './recovery';

const LAUNCH = Date.UTC(2026, 9, 10, 2, 0, 0);
const base: RecoveryInput = {
  launchAt: LAUNCH,
  lastTsAtLaunch: LAUNCH - 300_000, // last point was 5 minutes before the relaunch
  currentLastTs: LAUNCH - 300_000,
  freshFixCount: 0,
  minFreshFixes: 3,
  elapsedMs: 0,
  restartAttempts: 0,
  staleToleranceMs: 2000,
  verifyTimeoutMs: 20_000,
  maxRestartAttempts: 1,
};
const d = (o: Partial<RecoveryInput>) => decideRecovery({ ...base, ...o });

describe('decideRecovery: sustained fresh fixes prove tracking resumed', () => {
  it('a registered task alone proves nothing: it waits, then restarts, then fails', () => {
    assert.equal(d({ elapsedMs: 5000 }), 'wait');
    assert.equal(d({ elapsedMs: 20_000 }), 'restart');
    assert.equal(d({ elapsedMs: 20_000, restartAttempts: 1 }), 'failed');
    assert.equal(d({ elapsedMs: 19_999, restartAttempts: 1 }), 'wait');
  });

  it('a single fresh fix is NOT enough: it waits for more', () => {
    assert.equal(d({ elapsedMs: 3000, currentLastTs: LAUNCH + 2500, freshFixCount: 1 }), 'wait');
    assert.equal(d({ elapsedMs: 3000, currentLastTs: LAUNCH + 2500, freshFixCount: 2 }), 'wait');
  });

  it('three distinct fresh fixes confirm recovery', () => {
    assert.equal(d({ elapsedMs: 3000, currentLastTs: LAUNCH + 2500, freshFixCount: 3 }), 'confirmed');
  });

  it('a newer-than-stored but pre-launch (cached) location does NOT confirm recovery', () => {
    assert.equal(d({ elapsedMs: 3000, currentLastTs: LAUNCH - 60_000, freshFixCount: 3 }), 'wait');
    assert.equal(d({ elapsedMs: 25_000, currentLastTs: LAUNCH - 60_000, freshFixCount: 3 }), 'restart');
  });

  it('a fix just inside the stale tolerance counts as fresh, one just outside does not', () => {
    assert.equal(d({ currentLastTs: LAUNCH - 2000, freshFixCount: 3 }), 'confirmed');
    assert.equal(d({ currentLastTs: LAUNCH - 2001, freshFixCount: 3 }), 'wait');
  });

  it('works when the ride had no stored fix at launch', () => {
    assert.equal(d({ lastTsAtLaunch: null, currentLastTs: null, elapsedMs: 1000 }), 'wait');
    assert.equal(d({ lastTsAtLaunch: null, currentLastTs: LAUNCH + 1000, freshFixCount: 3 }), 'confirmed');
  });

  it('confirmation after a restart still counts', () => {
    assert.equal(d({ elapsedMs: 4000, restartAttempts: 1, currentLastTs: LAUNCH + 22_000, freshFixCount: 3 }), 'confirmed');
  });

  it('fresh but too few fixes wait, then reuse the existing restart/attempt path at the timeout', () => {
    assert.equal(d({ elapsedMs: 5000, currentLastTs: LAUNCH + 4000, freshFixCount: 2 }), 'wait');
    assert.equal(d({ elapsedMs: 20_000, currentLastTs: LAUNCH + 4000, freshFixCount: 2 }), 'restart');
    assert.equal(d({ elapsedMs: 20_000, currentLastTs: LAUNCH + 4000, freshFixCount: 2, restartAttempts: 1 }), 'failed');
  });
});

describe('decideArming: an interrupted ride is re-armed even when the task reports as registered', () => {
  it('not registered -> start', () => {
    assert.equal(decideArming({ registered: false, interrupted: false }), 'start');
    assert.equal(decideArming({ registered: false, interrupted: true }), 'start');
  });

  it('registered and interrupted -> restart (a registered task does not prove fixes arrive)', () => {
    assert.equal(decideArming({ registered: true, interrupted: true }), 'restart');
  });

  it('registered and not interrupted -> leave it alone', () => {
    assert.equal(decideArming({ registered: true, interrupted: false }), 'none');
  });
});
