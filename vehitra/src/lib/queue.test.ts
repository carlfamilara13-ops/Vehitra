import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from './queue';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('createQueue', () => {
  it('runs tasks in submission order, one at a time, whatever their duration', async () => {
    const q = createQueue();
    const order: number[] = [];
    let running = 0;
    let maxRunning = 0;
    const task = (n: number, ms: number) =>
      q.run(async () => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await sleep(ms);
        order.push(n);
        running -= 1;
        return n;
      });
    const results = await Promise.all([task(1, 30), task(2, 1), task(3, 15)]);
    assert.deepEqual(order, [1, 2, 3]);
    assert.deepEqual(results, [1, 2, 3]);
    assert.equal(maxRunning, 1);
  });

  it('a failing task rejects its own caller but never blocks the tasks behind it', async () => {
    const q = createQueue();
    const a = q.run(async () => {
      throw new Error('boom');
    });
    const b = q.run(async () => 'ok');
    await assert.rejects(a, /boom/);
    assert.equal(await b, 'ok');
  });
});
