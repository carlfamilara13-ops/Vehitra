import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PermissionState } from './permissionPolicy';
import { runStartFlow } from './startFlow';

const granted: PermissionState = {
  foreground: true, background: true, notifications: true, foregroundCanAskAgain: true, backgroundCanAskAgain: true,
};

function deps(perm: Partial<PermissionState>, start: () => Promise<string> = async () => 'ride-1') {
  const calls = { ensure: 0, start: 0 };
  return {
    calls,
    d: {
      ensurePermissions: async () => { calls.ensure += 1; return { ...granted, ...perm }; },
      startRide: async () => { calls.start += 1; return start(); },
    },
  };
}

describe('runStartFlow', () => {
  it('REGRESSION: never starts a ride when background location is denied', async () => {
    const { calls, d } = deps({ background: false });
    const out = await runStartFlow(d);
    assert.equal(out.status, 'blocked');
    assert.equal(calls.start, 0);
    if (out.status === 'blocked') {
      assert.equal(out.reason, 'background');
      assert.match(out.message, /Allow all the time/);
    }
  });

  it('passes through whether the prompt can be shown again, so the screen can offer app settings', async () => {
    const { d } = deps({ background: false, backgroundCanAskAgain: false });
    const out = await runStartFlow(d);
    assert.equal(out.status === 'blocked' && out.canAskAgain, false);
  });

  it('retry path: the same flow starts once the permission has been granted', async () => {
    const first = deps({ background: false });
    assert.equal((await runStartFlow(first.d)).status, 'blocked');
    const second = deps({});
    const out = await runStartFlow(second.d);
    assert.equal(out.status, 'started');
    assert.equal(second.calls.start, 1);
  });

  it('never starts when foreground location is denied', async () => {
    const { calls, d } = deps({ foreground: false, background: false });
    const out = await runStartFlow(d);
    assert.equal(out.status === 'blocked' && out.reason, 'foreground');
    assert.equal(calls.start, 0);
  });

  it('starts with a warning when only notifications are denied', async () => {
    const { calls, d } = deps({ notifications: false });
    const out = await runStartFlow(d);
    assert.equal(calls.start, 1);
    assert.equal(out.status === 'started' && out.warnings.length, 1);
  });

  it('reports errors from starting or from asking for permissions', async () => {
    const a = deps({}, async () => { throw new Error('already recording'); });
    assert.deepEqual(await runStartFlow(a.d), { status: 'error', message: 'already recording' });
    const out = await runStartFlow({
      ensurePermissions: async () => { throw new Error('no activity'); },
      startRide: async () => 'x',
    });
    assert.equal(out.status, 'error');
  });
});
