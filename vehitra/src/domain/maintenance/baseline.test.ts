import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { actionResetsInterval, establishUsageBaseline } from './baseline';

describe('maintenance baseline policy', () => {
  it('only replace and baseline reset the usage interval', () => {
    assert.equal(actionResetsInterval('replace'), true);
    assert.equal(actionResetsInterval('baseline'), true);
    for (const action of ['service', 'inspect', 'clean', 'lubricate', 'void']) {
      assert.equal(actionResetsInterval(action), false);
    }
  });

  it('picks the later candidate by (at, id) and ignores empties', () => {
    assert.equal(establishUsageBaseline([]), null);
    assert.equal(establishUsageBaseline([null, undefined]), null);
    assert.deepEqual(
      establishUsageBaseline([{ at: 10, id: 'a' }, { at: 20, id: 'b' }]),
      { at: 20, id: 'b' },
    );
    assert.deepEqual(
      establishUsageBaseline([{ at: 3000, id: 'b' }, { at: 2000, id: 'a' }, null]),
      { at: 3000, id: 'b' },
    );
  });

  it('breaks ties by the greater id so the choice is stable', () => {
    assert.deepEqual(
      establishUsageBaseline([{ at: 100, id: 'a' }, { at: 100, id: 'b' }]),
      { at: 100, id: 'b' },
    );
  });
});
