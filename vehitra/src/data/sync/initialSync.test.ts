import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyInitialSync } from './initialSync';

describe('initial account sync classification', () => {
  it('requires review whenever the device and account both have records', () => {
    assert.equal(classifyInitialSync(1, 1), 'review_required');
    assert.equal(classifyInitialSync(12, 4), 'review_required');
  });

  it('classifies local-only data as an explicit backup', () => {
    assert.equal(classifyInitialSync(3, 0), 'backup');
  });

  it('classifies cloud-only data as a restore', () => {
    assert.equal(classifyInitialSync(0, 5), 'restore');
  });

  it('allows connecting an empty device to an empty account', () => {
    assert.equal(classifyInitialSync(0, 0), 'empty');
  });

  it('rejects invalid record counts', () => {
    assert.throws(() => classifyInitialSync(-1, 0), RangeError);
    assert.throws(() => classifyInitialSync(0, 1.5), RangeError);
  });
});
