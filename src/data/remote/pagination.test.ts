import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllPages } from './pagination';

const range = (count: number) => Array.from({ length: count }, (_, i) => i);

describe('fetchAllPages', () => {
  it('reads every page until an empty page', async () => {
    const rows = range(2500);
    const calls: Array<[number, number]> = [];
    const result = await fetchAllPages(async (from, to) => {
      calls.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    });

    assert.deepEqual(result, { ok: true, rows });
    assert.deepEqual(calls, [
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [2500, 3499],
    ]);
  });

  it('continues from the actual page size when the server caps rows', async () => {
    const rows = range(1300);
    const calls: Array<[number, number]> = [];
    const result = await fetchAllPages(async (from, to) => {
      calls.push([from, to]);
      const cappedTo = Math.min(to, from + 399);
      return { data: rows.slice(from, cappedTo + 1), error: null };
    });

    assert.deepEqual(result, { ok: true, rows });
    assert.deepEqual(calls, [
      [0, 999],
      [400, 1399],
      [800, 1799],
      [1200, 2199],
      [1300, 2299],
    ]);
  });

  it('handles an empty table', async () => {
    let calls = 0;
    const result = await fetchAllPages(async () => {
      calls++;
      return { data: [], error: null };
    });

    assert.deepEqual(result, { ok: true, rows: [] });
    assert.equal(calls, 1);
  });

  it('returns an error instead of partial rows', async () => {
    let calls = 0;
    const result = await fetchAllPages(async (from, to) => {
      calls++;
      if (calls === 2) return { data: null, error: { message: 'network down' } };
      return { data: range(1000).slice(from, to + 1), error: null };
    });

    assert.deepEqual(result, { ok: false, message: 'network down' });
    assert.equal(calls, 2);
  });
});
