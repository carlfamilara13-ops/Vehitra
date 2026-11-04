import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateComponent, evaluateUsage } from './status';
import { DEFAULT_WARN_REMAINING_PCT } from './rules';
import type { ComponentUsageInput, VehicleType } from './types';

// applies_to_types exactly as seeded in supabase/seed.sql
const ENGINE_OIL_TYPES = ['motorcycle', 'car', 'truck', 'bus', 'van', 'other'] as const;
const CHAIN_TYPES = ['motorcycle', 'bicycle', 'other'] as const;

const base = (over: Partial<ComponentUsageInput> = {}): ComponentUsageInput => ({
  componentCode: 'engine_oil',
  vehicleType: 'motorcycle',
  appliesToVehicleTypes: ENGINE_OIL_TYPES,
  intervalCandidates: { catalogIntervalKm: 2000, warnRemainingPct: 25 },
  usedKm: 1593,
  ...over,
});

const approx = (actual: number, expected: number): void =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} ≈ ${expected}`);

describe('evaluateUsage: ledger-based distance progress', () => {
  it('normal progress: 1,593 / 2,000 km applied since the baseline', () => {
    const r = evaluateUsage(base());
    assert.equal(r.status, 'due_soon'); // 407 km = 20.35% remaining <= 25% warn threshold
    assert.equal(r.reason, null);
    assert.ok(r.progress);
    assert.equal(r.progress.usedKm, 1593);
    assert.equal(r.progress.intervalKm, 2000);
    assert.equal(r.progress.remainingKm, 407);
    approx(r.progress.remainingPercent, 20.35);
    assert.equal(r.rule?.source, 'catalog');
  });

  it('zero applied km is good, not unknown (a real baseline with no usage yet)', () => {
    const r = evaluateUsage(base({ usedKm: 0 }));
    assert.equal(r.status, 'good');
    assert.equal(r.reason, null);
    assert.ok(r.progress);
    assert.equal(r.progress.usedKm, 0);
    assert.equal(r.progress.remainingPercent, 100);
  });

  it('a fractional applied-km sum is kept exact, not rounded', () => {
    const r = evaluateUsage(base({ usedKm: 1593.5 }));
    assert.equal(r.status, 'due_soon');
    assert.ok(r.progress);
    assert.equal(r.progress.usedKm, 1593.5);
  });
});

// interval 2,000 km, warn 25% -> due-soon threshold = 500 km remaining
describe('evaluateUsage: status boundaries match evaluateComponent', () => {
  it('good / due soon / overdue line up exactly at the documented boundaries', () => {
    assert.equal(evaluateUsage(base({ usedKm: 1499 })).status, 'good'); // 501 km remaining
    assert.equal(evaluateUsage(base({ usedKm: 1500 })).status, 'due_soon'); // exactly 500 km (25%) remaining
    assert.equal(evaluateUsage(base({ usedKm: 1500 })).status, evaluateComponent({
      componentCode: 'engine_oil', vehicleType: 'motorcycle', appliesToVehicleTypes: ENGINE_OIL_TYPES,
      intervalCandidates: { catalogIntervalKm: 2000, warnRemainingPct: 25 },
      lastServiceOdometerKm: 10_000, currentOdometerKm: 11_500,
    }).status);
    assert.equal(evaluateUsage(base({ usedKm: 2000 })).status, 'overdue'); // exactly at the interval
    assert.equal(evaluateUsage(base({ usedKm: 2500 })).status, 'overdue');
    assert.ok(evaluateUsage(base({ usedKm: 2500 })).progress);
    assert.equal(evaluateUsage(base({ usedKm: 2500 })).progress?.remainingKm, -500);
  });

  it('warn 0 disables due soon; warn 100 makes every not-yet-overdue part due soon', () => {
    assert.equal(evaluateUsage(base({ intervalCandidates: { catalogIntervalKm: 2000, warnRemainingPct: 0 }, usedKm: 1999 })).status, 'good');
    assert.equal(evaluateUsage(base({ intervalCandidates: { catalogIntervalKm: 2000, warnRemainingPct: 0 }, usedKm: 2000 })).status, 'overdue');
    assert.equal(evaluateUsage(base({ intervalCandidates: { catalogIntervalKm: 2000, warnRemainingPct: 100 }, usedKm: 0 })).status, 'due_soon');
  });

  it('falls back to the shared 25% default when no threshold is supplied', () => {
    const r = evaluateUsage(base({ intervalCandidates: { catalogIntervalKm: 2000, warnRemainingPct: null }, usedKm: 1500 }));
    assert.equal(r.rule?.warnRemainingPct, DEFAULT_WARN_REMAINING_PCT);
    assert.equal(r.status, 'due_soon');
  });
});

describe('evaluateUsage: unknown history without a baseline', () => {
  it('an absent applied-km sum is unknown   never assumed good or overdue', () => {
    for (const usedKm of [null, undefined]) {
      const r = evaluateUsage(base({ usedKm }));
      assert.equal(r.status, 'unknown', String(usedKm));
      assert.equal(r.reason, 'no_service_history');
      assert.equal(r.progress, null);
      assert.equal(r.rule?.intervalKm, 2000); // rule kept so callers can still show the interval
    }
  });

  it('a negative or non-finite applied-km sum is invalid usage, not a negative progress', () => {
    for (const usedKm of [-0.5, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '1593']) {
      const r = evaluateUsage(base({ usedKm: usedKm as unknown as number }));
      assert.equal(r.status, 'unknown', String(usedKm));
      assert.equal(r.reason, 'invalid_usage', String(usedKm));
      assert.equal(r.progress, null);
    }
  });
});

describe('evaluateUsage: interval resolution and applicability', () => {
  it('an applicable part with no interval anywhere is unknown, not good', () => {
    const r = evaluateUsage(base({ componentCode: 'drive_chain', appliesToVehicleTypes: CHAIN_TYPES, intervalCandidates: {}, usedKm: 100 }));
    assert.equal(r.status, 'unknown');
    assert.equal(r.reason, 'no_interval');
    assert.equal(r.rule?.source, 'none');
  });

  it('the motorcycle estimate fills in only where the project ships one', () => {
    const moto = evaluateUsage(base({ intervalCandidates: {}, usedKm: 1000 }));
    assert.equal(moto.status, 'good');
    assert.deepEqual(moto.rule, { intervalKm: 1500, warnRemainingPct: 25, source: 'estimate' });

    const car = evaluateUsage(base({ vehicleType: 'car', intervalCandidates: {}, usedKm: 1000 }));
    assert.equal(car.status, 'unknown');
    assert.equal(car.reason, 'no_interval');
  });

  it('a configured-but-invalid interval is reported, never silently replaced', () => {
    const r = evaluateUsage(base({ intervalCandidates: { overrideIntervalKm: -5, catalogIntervalKm: 2000 }, usedKm: 100 }));
    assert.equal(r.status, 'unknown');
    assert.equal(r.reason, 'invalid_rule');
    assert.equal(r.rule?.intervalKm, -5);
    assert.equal(r.rule?.source, 'override');
  });

  it('an explicit override wins over catalog and estimate', () => {
    const r = evaluateUsage(base({ intervalCandidates: { overrideIntervalKm: 1200, catalogIntervalKm: 5000, estimateIntervalKm: 900 }, usedKm: 1150 }));
    assert.equal(r.rule?.intervalKm, 1200);
    assert.equal(r.rule?.source, 'override');
    assert.equal(r.status, 'due_soon'); // 50 remaining <= 300 (25%)
  });

  it('an override interval is validated before usage is considered', () => {
    const r = evaluateUsage(base({ intervalCandidates: { overrideIntervalKm: 0 }, usedKm: -1 }));
    assert.equal(r.reason, 'invalid_rule'); // interval wins the evaluation order
  });

  it('a part that does not apply to the vehicle type is not applicable, before any usage check', () => {
    const r = evaluateUsage(base({ componentCode: 'drive_chain', vehicleType: 'car', appliesToVehicleTypes: CHAIN_TYPES, usedKm: null }));
    assert.equal(r.status, 'not_applicable');
    assert.equal(r.reason, 'not_applicable_to_vehicle_type');
    assert.equal(r.rule, null);
    assert.equal(r.progress, null);
  });

  it('a component disabled by a user override is not applicable', () => {
    const r = evaluateUsage(base({ enabled: false, usedKm: 100 }));
    assert.equal(r.status, 'not_applicable');
    assert.equal(r.reason, 'disabled_by_override');
  });

  it('is exported and returns progress exactly for good, due soon and overdue', () => {
    for (const usedKm of [100, 1900, 2500]) {
      const r = evaluateUsage(base({ usedKm }));
      assert.ok(r.progress, String(usedKm));
      assert.equal(r.reason, null, String(usedKm));
    }
  });
});

describe('evaluateUsage and evaluateComponent agree on shared inputs', () => {
  it('identical interval + usage produce identical status and progress', () => {
    const input = {
      componentCode: 'engine_oil',
      vehicleType: 'motorcycle' as VehicleType,
      appliesToVehicleTypes: ENGINE_OIL_TYPES as readonly VehicleType[],
      intervalCandidates: { catalogIntervalKm: 3000, warnRemainingPct: 20 },
    };
    for (const usedKm of [0, 500, 2399, 2400, 3000, 3500]) {
      const viaLedger = evaluateUsage({ ...input, usedKm });
      const viaOdometer = evaluateComponent({
        ...input,
        lastServiceOdometerKm: 1000,
        currentOdometerKm: 1000 + usedKm,
      });
      assert.equal(viaLedger.status, viaOdometer.status, String(usedKm));
      assert.deepEqual(viaLedger.progress, viaOdometer.progress, String(usedKm));
    }
  });
});
