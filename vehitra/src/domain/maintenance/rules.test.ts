import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WARN_REMAINING_PCT,
  ESTIMATED_INTERVAL_KM,
  estimateIntervalKm,
  resolveMaintenanceRule,
} from './rules';

describe('resolveMaintenanceRule: layer precedence', () => {
  it('uses override > usage > catalog > estimate when several layers are present', () => {
    const r = resolveMaintenanceRule({
      overrideIntervalKm: 1200,
      usageIntervalKm: 1000,
      catalogIntervalKm: 2000,
      estimateIntervalKm: 1500,
    });
    assert.equal(r.intervalKm, 1200);
    assert.equal(r.source, 'override');
  });

  it('skips absent layers so the next one wins', () => {
    const usage = resolveMaintenanceRule({ usageIntervalKm: 1600, catalogIntervalKm: 2000, estimateIntervalKm: 1500 });
    assert.equal(usage.intervalKm, 1600);
    assert.equal(usage.source, 'usage');

    const catalog = resolveMaintenanceRule({ catalogIntervalKm: 2000, estimateIntervalKm: 1500 });
    assert.equal(catalog.intervalKm, 2000);
    assert.equal(catalog.source, 'catalog');

    const estimate = resolveMaintenanceRule({ estimateIntervalKm: 1500 });
    assert.equal(estimate.intervalKm, 1500);
    assert.equal(estimate.source, 'estimate');
  });

  it('keeps a present-but-invalid value instead of silently falling back', () => {
    const r = resolveMaintenanceRule({ overrideIntervalKm: -5, catalogIntervalKm: 2000 });
    assert.equal(r.intervalKm, -5);
    assert.equal(r.source, 'override');
  });

  it('reports no interval when every layer is absent', () => {
    assert.deepEqual(resolveMaintenanceRule({}), { intervalKm: null, warnRemainingPct: 25, source: 'none' });
    assert.deepEqual(resolveMaintenanceRule(null), { intervalKm: null, warnRemainingPct: 25, source: 'none' });
    assert.deepEqual(resolveMaintenanceRule(undefined), {
      intervalKm: null,
      warnRemainingPct: DEFAULT_WARN_REMAINING_PCT,
      source: 'none',
    });
  });

  it('warn threshold: supplied value kept as-is, default only when absent', () => {
    assert.equal(resolveMaintenanceRule({ catalogIntervalKm: 2000, warnRemainingPct: 40 }).warnRemainingPct, 40);
    assert.equal(resolveMaintenanceRule({ catalogIntervalKm: 2000 }).warnRemainingPct, DEFAULT_WARN_REMAINING_PCT);
    assert.equal(resolveMaintenanceRule({ catalogIntervalKm: 2000, warnRemainingPct: null }).warnRemainingPct, 25);
    // invalid values are preserved raw here and flagged by the evaluator as 'invalid_rule'
    assert.equal(resolveMaintenanceRule({ catalogIntervalKm: 2000, warnRemainingPct: 200 }).warnRemainingPct, 200);
  });
});

describe('estimateIntervalKm: configurable estimates, never universal', () => {
  it('returns the single seed estimate for motorcycle engine oil', () => {
    assert.equal(estimateIntervalKm('motorcycle', 'engine_oil'), 1500);
  });

  it('does not leak that estimate to other vehicle types', () => {
    assert.equal(estimateIntervalKm('car', 'engine_oil'), null);
    assert.equal(estimateIntervalKm('bicycle', 'engine_oil'), null);
  });

  it('ships no estimate for chain, tires or brakes   they stay configurable inputs', () => {
    for (const code of ['drive_chain', 'front_tire', 'rear_tire', 'front_brake_pads', 'rear_brake_pads']) {
      assert.equal(estimateIntervalKm('motorcycle', code), null, code);
    }
  });

  it('only holds values that exist in the project seed', () => {
    assert.deepEqual(Object.keys(ESTIMATED_INTERVAL_KM), ['motorcycle']);
    assert.deepEqual(ESTIMATED_INTERVAL_KM.motorcycle, { engine_oil: 1500 });
  });
});
