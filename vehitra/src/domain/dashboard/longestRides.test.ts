import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rankLongestRides, type RankableRide } from './longestRides';

const ride = (startedAt: number, distanceM: number, overrides: Partial<RankableRide> = {}): RankableRide => ({
  startedAt,
  status: 'finished',
  distanceM,
  durationS: 600,
  ...overrides,
});

describe('rankLongestRides', () => {
  it('orders longest first and assigns 1-based ranks', () => {
    const out = rankLongestRides(
      [ride(1, 1000), ride(2, 5000), ride(3, 3000)],
      3,
    );
    assert.deepEqual(out.map((r) => r.distanceM), [5000, 3000, 1000]);
    assert.deepEqual(out.map((r) => r.rank), [1, 2, 3]);
  });

  it('keeps only the requested number of rides', () => {
    const out = rankLongestRides([ride(1, 100), ride(2, 200), ride(3, 300)], 2);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((r) => r.distanceM), [300, 200]);
  });

  it('returns nothing for a non-positive limit', () => {
    assert.deepEqual(rankLongestRides([ride(1, 100)], 0), []);
    assert.deepEqual(rankLongestRides([ride(1, 100)], -3), []);
  });

  it('excludes rides still recording', () => {
    const out = rankLongestRides(
      [ride(1, 9000, { status: 'recording' }), ride(2, 2000)],
      5,
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].distanceM, 2000);
  });

  it('includes recovered rides, which are saved records', () => {
    const out = rankLongestRides([ride(1, 4000, { status: 'recovered' })], 5);
    assert.equal(out.length, 1);
    assert.equal(out[0].distanceM, 4000);
  });

  it('breaks distance ties by most recent first', () => {
    const out = rankLongestRides(
      [ride(100, 2000), ride(300, 2000), ride(200, 2000)],
      3,
    );
    assert.deepEqual(out.map((r) => r.startedAt), [300, 200, 100]);
  });

  it('is stable across repeated calls for identical input', () => {
    const input = [ride(100, 2000), ride(300, 2000)];
    assert.deepEqual(rankLongestRides(input, 2), rankLongestRides(input, 2));
  });

  it('carries the original object through so the caller keeps every field', () => {
    const original = { ...ride(1, 1234), id: 'abc', vehicle_name: 'Yamaha' };
    const out = rankLongestRides([original], 1);
    assert.equal(out[0].id, 'abc');
    assert.equal(out[0].vehicle_name, 'Yamaha');
  });

  it('drops rows with a non-finite distance rather than ranking them as zero', () => {
    const out = rankLongestRides([ride(1, Number.NaN), ride(2, 500)], 5);
    assert.equal(out.length, 1);
    assert.equal(out[0].distanceM, 500);
  });

  it('handles an empty input', () => {
    assert.deepEqual(rankLongestRides([], 3), []);
  });
});
