import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BACKGROUND_EXPLANATION, evaluatePermissions, type PermissionState } from './permissionPolicy';

const all: PermissionState = {
  foreground: true, background: true, notifications: true, foregroundCanAskAgain: true, backgroundCanAskAgain: true,
};
const p = (o: Partial<PermissionState>) => ({ ...all, ...o });

describe('evaluatePermissions', () => {
  it('allows a ride only with foreground AND background location', () => {
    assert.deepEqual(evaluatePermissions(all), { canStart: true, warnings: [] });
  });

  it('blocks when background location is denied, and explains why', () => {
    const v = evaluatePermissions(p({ background: false, backgroundCanAskAgain: false }));
    assert.equal(v.canStart, false);
    if (!v.canStart) {
      assert.equal(v.reason, 'background');
      assert.equal(v.message, BACKGROUND_EXPLANATION);
      assert.equal(v.canAskAgain, false);
    }
  });

  it('blocks when foreground location is denied', () => {
    const v = evaluatePermissions(p({ foreground: false, background: false }));
    assert.equal(v.canStart, false);
    if (!v.canStart) assert.equal(v.reason, 'foreground');
  });

  it('missing notification permission is a visible warning, not a blocker', () => {
    const v = evaluatePermissions(p({ notifications: false }));
    assert.equal(v.canStart, true);
    assert.equal(v.warnings.length, 1);
  });
});
