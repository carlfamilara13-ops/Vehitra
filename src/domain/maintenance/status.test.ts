import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateComponent, isComponentApplicable } from './status';
import { DEFAULT_WARN_REMAINING_PCT } from './rules';
import type { ComponentMaintenanceInput, VehicleType } from './types';

// applies_to_types exactly as seeded in supabase/seed.sql
const ENGINE_OIL_TYPES = ['motorcycle', 'car', 'truck', 'bus', 'van', 'other'] as const;
const CHAIN_TYPES = ['motorcycle', 'bicycle', 'other'] as const;

const base = (over: Partial<ComponentMaintenanceInput> = {}): ComponentMaintenanceInput => ({
  componentCode: 'engine_oil',
  vehicleType: 'motorcycle',
  appliesToVehicleTypes: ENGINE_OIL_TYPES,
  intervalCandidates: { catalogIntervalKm: 2000, warnRemainingPct: 25 },
  lastServiceOdometerKm: 10_000,
  currentOdometerKm: 11_593,
  ...over,
});

const approx = (actual: number, expected: number): void =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} ≈ ${expected}`);

describe('evaluateComponent: distance progress', () => {
  it('normal progress: 1,593 / 2,000 km with 407 km remaining', () => {
    const r = evaluateComponent(base());
    assert.equal(r.status, 'due_soon'); // 407 km = 20.35% remaining <= 25% warn threshold
    assert.equal(r.reason, null);
    assert.ok(r.progress);
    assert.equal(r.progress.usedKm, 1593);
    assert.equal(r.progress.intervalKm, 2000);
    assert.equal(r.progress.remainingKm, 407);
    approx(r.progress.usedPercent, 79.65);
    approx(r.progress.remainingPercent, 20.35);
    assert.equal(r.rule?.intervalKm, 2000);
    assert.equal(r.rule?.source, 'catalog');
  });

  it('normal progress well inside the interval is good', () => {
    const r = evaluateComponent(base({ currentOdometerKm: 10_500 })); // 500 / 2,000 km
    assert.equal(r.status, 'good');
    assert.equal(r.reason, null);
    assert.ok(r.progress);
    assert.equal(r.progress.usedKm, 500);
    assert.equal(r.progress.remainingKm, 1500);
    approx(r.progress.usedPercent, 25);
    approx(r.progress.remainingPercent, 75);
  });
});

// interval 2,000 km, warn 25% -> due-soon threshold = 500 km remaining
describe('status boundaries: good / due soon / overdue', () => {
  it('good: 1 km above the threshold is still good (501 km remaining)', () => {
    assert.equal(evaluateComponent(base({ currentOdometerKm: 11_499 })).status, 'good');
  });

  it('due soon exactly at the threshold (500 km / 25% remaining)', () => {
    const r = evaluateComponent(base({ currentOdometerKm: 11_500 }));
    assert.equal(r.status, 'due_soon');
    assert.ok(r.progress);
    assert.equal(r.progress.remainingKm, 500);
    assert.equal(r.progress.remainingPercent, 25);
  });

  it('due soon with 1 km remaining', () => {
    const r = evaluateComponent(base({ currentOdometerKm: 11_999 }));
    assert.equal(r.status, 'due_soon');
    assert.ok(r.progress);
    assert.equal(r.progress.remainingKm, 1);
  });

  it('overdue exactly at the interval (0 km remaining is already overdue)', () => {
    const r = evaluateComponent(base({ currentOdometerKm: 12_000 }));
    assert.equal(r.status, 'overdue');
    assert.ok(r.progress);
    assert.equal(r.progress.remainingKm, 0);
    assert.equal(r.progress.usedPercent, 100);
    assert.equal(r.progress.remainingPercent, 0);
  });

  it('overdue past the interval keeps truthful negative remaining and >100% used', () => {
    const r = evaluateComponent(base({ currentOdometerKm: 12_500 }));
    assert.equal(r.status, 'overdue');
    assert.ok(r.progress);
    assert.equal(r.progress.usedKm, 2500);
    assert.equal(r.progress.remainingKm, -500);
    assert.equal(r.progress.usedPercent, 125);
    assert.equal(r.progress.remainingPercent, -25);
  });
});

describe('warn threshold controls the due-soon boundary', () => {
  it('warn 0 makes due soon unreachable: only good or overdue', () => {
    const candidates = { catalogIntervalKm: 2000, warnRemainingPct: 0 };
    assert.equal(evaluateComponent(base({ intervalCandidates: candidates, currentOdometerKm: 11_999 })).status, 'good');
    assert.equal(evaluateComponent(base({ intervalCandidates: candidates, currentOdometerKm: 12_000 })).status, 'overdue');
  });

  it('warn 100 makes every not-yet-overdue part due soon', () => {
    const candidates = { catalogIntervalKm: 2000, warnRemainingPct: 100 };
    assert.equal(evaluateComponent(base({ intervalCandidates: candidates, currentOdometerKm: 10_000 })).status, 'due_soon');
    assert.equal(evaluateComponent(base({ intervalCandidates: candidates, currentOdometerKm: 11_999 })).status, 'due_soon');
    assert.equal(evaluateComponent(base({ intervalCandidates: candidates, currentOdometerKm: 12_000 })).status, 'overdue');
  });

  it('falls back to the shared 25% default when no threshold is supplied', () => {
    const r = evaluateComponent(
      base({ intervalCandidates: { catalogIntervalKm: 2000, warnRemainingPct: null }, currentOdometerKm: 11_500 }),
    );
    assert.equal(r.rule?.warnRemainingPct, DEFAULT_WARN_REMAINING_PCT);
    assert.equal(r.status, 'due_soon'); // threshold behaves exactly like 25%
    const good = evaluateComponent(
      base({ intervalCandidates: { catalogIntervalKm: 2000, warnRemainingPct: null }, currentOdometerKm: 11_499 }),
    );
    assert.equal(good.status, 'good');
  });
});

describe('unknown service history', () => {
  it('no recorded service is unknown — never assumed good, even far past the interval', () => {
    const r = evaluateComponent(base({ lastServiceOdometerKm: null, currentOdometerKm: 99_999 }));
    assert.equal(r.status, 'unknown');
    assert.equal(r.reason, 'no_service_history');
    assert.equal(r.progress, null);
    assert.equal(r.rule?.intervalKm, 2000); // rule is kept so callers can still show the interval
  });

  it('an undefined baseline means the same as none recorded', () => {
    const r = evaluateComponent(base({ lastServiceOdometerKm: undefined }));
    assert.equal(r.status, 'unknown');
    assert.equal(r.reason, 'no_service_history');
  });

  it('missing history wins over a missing current reading (documented order)', () => {
    const r = evaluateComponent(base({ lastServiceOdometerKm: null, currentOdometerKm: null }));
    assert.equal(r.reason, 'no_service_history');
  });
});

describe('missing and invalid odometer data', () => {
  it('missing current reading is unknown, not a guess', () => {
    for (const current of [null, undefined]) {
      const r = evaluateComponent(base({ currentOdometerKm: current }));
      assert.equal(r.status, 'unknown', String(current));
      assert.equal(r.reason, 'missing_odometer');
      assert.equal(r.progress, null);
    }
  });

  it('negative, non-finite and non-number current readings are invalid', () => {
    const bad = [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '11593'];
    for (const current of bad) {
      const r = evaluateComponent(base({ currentOdometerKm: current as unknown as number }));
      assert.equal(r.status, 'unknown', String(current));
      assert.equal(r.reason, 'invalid_odometer', String(current));
      assert.equal(r.progress, null);
    }
  });

  it('an invalid service baseline is invalid regardless of the current reading', () => {
    for (const last of [-0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = evaluateComponent(base({ lastServiceOdometerKm: last }));
      assert.equal(r.status, 'unknown', String(last));
      assert.equal(r.reason, 'invalid_odometer', String(last));
    }
  });

  it('a service reading above the current reading is inconsistent, never negative usage', () => {
    const r = evaluateComponent(base({ lastServiceOdometerKm: 11_000, currentOdometerKm: 10_500 }));
    assert.equal(r.status, 'unknown');
    assert.equal(r.reason, 'inconsistent_odometer');
    assert.equal(r.progress, null);
  });

  it('a zero odometer is a valid reading (new vehicle)', () => {
    const r = evaluateComponent(base({ lastServiceOdometerKm: 0, currentOdometerKm: 0 }));
    assert.equal(r.status, 'good');
    assert.ok(r.progress);
    assert.equal(r.progress.usedKm, 0);
  });
});

describe('interval validation', () => {
  it('an applicable part with no interval anywhere is unknown, not good', () => {
    const r = evaluateComponent(
      base({ componentCode: 'drive_chain', appliesToVehicleTypes: CHAIN_TYPES, intervalCandidates: {} }),
    );
    assert.equal(r.status, 'unknown');
    assert.equal(r.reason, 'no_interval');
    assert.equal(r.rule?.intervalKm, null);
    assert.equal(r.rule?.source, 'none');
    assert.equal(r.progress, null);
  });

  it('the motorcycle estimate fills in only where the project ships one', () => {
    const moto = evaluateComponent(base({ intervalCandidates: {}, currentOdometerKm: 11_000 }));
    assert.equal(moto.status, 'good');
    assert.deepEqual(moto.rule, { intervalKm: 1500, warnRemainingPct: 25, source: 'estimate' });
    assert.ok(moto.progress);
    assert.equal(moto.progress.intervalKm, 1500);

    const car = evaluateComponent(
      base({ vehicleType: 'car', intervalCandidates: {}, currentOdometerKm: 11_000 }),
    );
    assert.equal(car.status, 'unknown');
    assert.equal(car.reason, 'no_interval');
  });

  it('a configured-but-invalid interval is reported, never silently replaced', () => {
    const r = evaluateComponent(base({ intervalCandidates: { overrideIntervalKm: -5, catalogIntervalKm: 2000 } }));
    assert.equal(r.status, 'unknown');
    assert.equal(r.reason, 'invalid_rule');
    assert.equal(r.rule?.intervalKm, -5);
    assert.equal(r.rule?.source, 'override');
    assert.equal(r.progress, null);
  });

  it('zero and non-finite intervals are invalid rules', () => {
    for (const intervalKm of [0, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const r = evaluateComponent(base({ intervalCandidates: { catalogIntervalKm: intervalKm } }));
      assert.equal(r.status, 'unknown', String(intervalKm));
      assert.equal(r.reason, 'invalid_rule', String(intervalKm));
    }
  });

  it('a warn threshold outside 0..100 is an invalid rule', () => {
    for (const warnRemainingPct of [-1, 101, Number.NaN]) {
      const r = evaluateComponent(base({ intervalCandidates: { catalogIntervalKm: 2000, warnRemainingPct } }));
      assert.equal(r.status, 'unknown', String(warnRemainingPct));
      assert.equal(r.reason, 'invalid_rule', String(warnRemainingPct));
    }
  });
});

describe('different intervals by configuration and usage', () => {
  const chain = (over: Partial<ComponentMaintenanceInput>): ComponentMaintenanceInput => ({
    componentCode: 'drive_chain',
    vehicleType: 'motorcycle',
    appliesToVehicleTypes: CHAIN_TYPES,
    lastServiceOdometerKm: 10_000,
    currentOdometerKm: 11_593, // 1,593 km since service
    ...over,
  });

  it('the same reading is good under a 5,000 km interval and due soon under 1,600 km', () => {
    const relaxed = evaluateComponent(chain({ intervalCandidates: { catalogIntervalKm: 5000 } }));
    assert.equal(relaxed.status, 'good');
    assert.ok(relaxed.progress);
    assert.equal(relaxed.progress.intervalKm, 5000);
    assert.equal(relaxed.progress.remainingKm, 3407);

    const tight = evaluateComponent(chain({ intervalCandidates: { catalogIntervalKm: 1600 } }));
    assert.equal(tight.status, 'due_soon');
    assert.ok(tight.progress);
    assert.equal(tight.progress.intervalKm, 1600);
    assert.equal(tight.progress.remainingKm, 7);
  });

  it('a usage-based interval wins over the catalog value', () => {
    const r = evaluateComponent(
      chain({ intervalCandidates: { usageIntervalKm: 1600, catalogIntervalKm: 5000 } }),
    );
    assert.equal(r.rule?.intervalKm, 1600);
    assert.equal(r.rule?.source, 'usage');
    assert.equal(r.status, 'due_soon');
  });

  it('an explicit override wins over usage, catalog and estimate', () => {
    const r = evaluateComponent(
      chain({
        intervalCandidates: { overrideIntervalKm: 1200, usageIntervalKm: 1600, catalogIntervalKm: 5000, estimateIntervalKm: 900 },
      }),
    );
    assert.equal(r.rule?.intervalKm, 1200);
    assert.equal(r.rule?.source, 'override');
  });
});

describe('not-applicable parts', () => {
  it('a drive chain is not applicable to a car', () => {
    const r = evaluateComponent(
      base({ componentCode: 'drive_chain', vehicleType: 'car', appliesToVehicleTypes: CHAIN_TYPES }),
    );
    assert.equal(r.status, 'not_applicable');
    assert.equal(r.reason, 'not_applicable_to_vehicle_type');
    assert.equal(r.rule, null);
    assert.equal(r.progress, null);
  });

  it('a component disabled by a user override is not applicable', () => {
    const r = evaluateComponent(base({ enabled: false }));
    assert.equal(r.status, 'not_applicable');
    assert.equal(r.reason, 'disabled_by_override');
    assert.equal(r.rule, null);
    assert.equal(r.progress, null);
  });

  it('vehicle type is checked before the enabled flag', () => {
    const r = evaluateComponent(base({ componentCode: 'drive_chain', vehicleType: 'car', appliesToVehicleTypes: CHAIN_TYPES, enabled: false }));
    assert.equal(r.status, 'not_applicable');
    assert.equal(r.reason, 'not_applicable_to_vehicle_type');
  });

  it('isComponentApplicable is plain set membership over applies_to_types', () => {
    assert.equal(isComponentApplicable(CHAIN_TYPES as readonly VehicleType[], 'motorcycle'), true);
    assert.equal(isComponentApplicable(CHAIN_TYPES as readonly VehicleType[], 'car'), false);
    assert.equal(isComponentApplicable(ENGINE_OIL_TYPES as readonly VehicleType[], 'bicycle'), false);
  });
});

describe('edge cases', () => {
  it('service exactly at the current reading is zero usage, not unknown', () => {
    const r = evaluateComponent(base({ lastServiceOdometerKm: 11_593, currentOdometerKm: 11_593 }));
    assert.equal(r.status, 'good');
    assert.ok(r.progress);
    assert.equal(r.progress.usedKm, 0);
    assert.equal(r.progress.usedPercent, 0);
    assert.equal(r.progress.remainingPercent, 100);
  });

  it('fractional intervals and readings work in explicit kilometres', () => {
    const r = evaluateComponent(
      base({ intervalCandidates: { catalogIntervalKm: 0.5, warnRemainingPct: 25 }, lastServiceOdometerKm: 0, currentOdometerKm: 0.25 }),
    );
    assert.equal(r.status, 'good'); // 0.25 km remaining > 0.125 km threshold
    assert.ok(r.progress);
    assert.equal(r.progress.remainingKm, 0.25);
    assert.equal(r.progress.usedPercent, 50);
  });

  it('very large readings stay finite and overdue, never NaN', () => {
    const r = evaluateComponent(base({ lastServiceOdometerKm: 0, currentOdometerKm: 1e12 }));
    assert.equal(r.status, 'overdue');
    assert.ok(r.progress);
    assert.ok(Number.isFinite(r.progress.usedPercent));
    assert.ok(Number.isFinite(r.progress.remainingPercent));
    assert.equal(r.progress.remainingKm, 2000 - 1e12);
  });

  it('progress is present exactly for good, due soon and overdue', () => {
    for (const currentOdometerKm of [11_499, 11_500, 12_500]) {
      const r = evaluateComponent(base({ currentOdometerKm }));
      assert.notEqual(r.status, 'unknown');
      assert.notEqual(r.status, 'not_applicable');
      assert.ok(r.progress, String(currentOdometerKm));
      assert.equal(r.reason, null, String(currentOdometerKm));
    }
    for (const r of [
      evaluateComponent(base({ lastServiceOdometerKm: null })),
      evaluateComponent(base({ currentOdometerKm: -1 })),
      evaluateComponent(base({ enabled: false })),
    ]) {
      assert.equal(r.progress, null);
      assert.notEqual(r.reason, null);
    }
  });
});
