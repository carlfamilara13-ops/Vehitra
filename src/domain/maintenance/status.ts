import { estimateIntervalKm, resolveMaintenanceRule } from './rules';
import type {
  ComponentMaintenanceInput,
  ComponentUsageInput,
  DistanceProgress,
  IntervalCandidates,
  MaintenanceEvaluation,
  MaintenanceReason,
  MaintenanceRule,
  VehicleType,
} from './types';

// ---------------------------------------------------------------- boundaries (Stage 4A)
//
// Evaluation order — the first failing step decides `status` / `reason`:
//   1. applicability   applies_to_types excludes the vehicle type -> 'not_applicable'
//                      component_overrides.enabled = false        -> 'not_applicable'
//   2. interval rule   no interval anywhere                      -> 'unknown' / 'no_interval'
//                      interval <= 0, non-finite, or warn outside 0..100 -> 'unknown' / 'invalid_rule'
//   3. service history lastServiceOdometerKm absent              -> 'unknown' / 'no_service_history'
//                      lastServiceOdometerKm invalid             -> 'unknown' / 'invalid_odometer'
//   4. current reading absent                                     -> 'unknown' / 'missing_odometer'
//                      non-finite or negative                    -> 'unknown' / 'invalid_odometer'
//   5. consistency     currentOdometerKm < lastServiceOdometerKm  -> 'unknown' / 'inconsistent_odometer'
//                      (usage would be negative; never turned into "progress")
//   6. classify        usedKm = current - lastService (>= 0), remainingKm = intervalKm - usedKm
//
// Status boundaries, exactly (warnRemainingPct W in 0..100, threshold T = intervalKm * W / 100):
//   overdue   remainingKm <= 0            — exactly at the interval is already overdue
//   due_soon  0 < remainingKm <= T        — exactly at the threshold is due soon
//   good      remainingKm >  T
//   unknown   any input step above failed — never treated as good or overdue
// Classification compares kilometres, not percentages, so whole-number inputs hit exact boundaries.
// W = 0 makes 'due_soon' unreachable (only good or overdue); W = 100 makes every not-yet-overdue
// part due soon. Both are allowed (the catalog permits 0..100).
//
// Units: everything is kilometres. Progress is computed unrounded; formatting is the UI's job.
// History with an invalid/absent current reading stays 'unknown' — no estimate is substituted.
//
// Two entry points share steps 1-2 (applicability, interval rule) and steps 3-6 (classify):
//   evaluateComponent(input) — usage from an odometer pair (current - lastService). Steps 3-5.
//   evaluateUsage(input)     — usage from the maintenance ledger: usedKm = Σ applied_km since the
//                              baseline. `usedKm` absent means no baseline is known -> 'unknown' /
//                              'no_service_history'; a negative/non-finite sum is 'unknown' /
//                              'invalid_usage'. This is the architecture's maintenance source: it
//                              never subtracts odometers, so odometer jumps/resets cannot corrupt it.

const isMissing = (v: number | null | undefined): v is null | undefined => v === null || v === undefined;
const isValidReading = (v: number): boolean => Number.isFinite(v) && v >= 0;

// component_definitions.applies_to_types includes this vehicle type?
export function isComponentApplicable(
  appliesToVehicleTypes: readonly VehicleType[],
  vehicleType: VehicleType,
): boolean {
  return (appliesToVehicleTypes as readonly string[]).includes(vehicleType);
}

type UsageResult =
  | { ok: true; usedKm: number }
  | {
      ok: false;
      reason: 'no_service_history' | 'missing_odometer' | 'invalid_odometer' | 'inconsistent_odometer';
    };

// Steps 3-5 of the evaluation order. Both readings must be finite and >= 0; a service reading
// above the current reading is inconsistent (odometer replaced/corrected) and never yields a
// negative usage.
function resolveUsage(
  currentOdometerKm: number | null | undefined,
  lastServiceOdometerKm: number | null | undefined,
): UsageResult {
  if (isMissing(lastServiceOdometerKm)) return { ok: false, reason: 'no_service_history' };
  if (!isValidReading(lastServiceOdometerKm)) return { ok: false, reason: 'invalid_odometer' };
  if (isMissing(currentOdometerKm)) return { ok: false, reason: 'missing_odometer' };
  if (!isValidReading(currentOdometerKm)) return { ok: false, reason: 'invalid_odometer' };
  if (currentOdometerKm < lastServiceOdometerKm) return { ok: false, reason: 'inconsistent_odometer' };
  return { ok: true, usedKm: currentOdometerKm - lastServiceOdometerKm };
}

function progressFor(intervalKm: number, usedKm: number): DistanceProgress {
  const remainingKm = intervalKm - usedKm;
  return {
    usedKm,
    intervalKm,
    remainingKm,
    usedPercent: (usedKm / intervalKm) * 100,
    remainingPercent: (remainingKm / intervalKm) * 100,
  };
}

function classify(progress: DistanceProgress, warnRemainingPct: number): 'good' | 'due_soon' | 'overdue' {
  if (progress.remainingKm <= 0) return 'overdue';
  if (progress.remainingKm <= progress.intervalKm * (warnRemainingPct / 100)) return 'due_soon';
  return 'good';
}

function unknownResult(
  base: Pick<MaintenanceEvaluation, 'componentCode' | 'vehicleType'>,
  rule: MaintenanceRule,
  reason: MaintenanceReason,
): MaintenanceEvaluation {
  return { ...base, status: 'unknown', reason, rule, progress: null };
}

type Preflight =
  | { ok: false; evaluation: MaintenanceEvaluation }
  | {
      ok: true;
      base: Pick<MaintenanceEvaluation, 'componentCode' | 'vehicleType'>;
      rule: MaintenanceRule;
      intervalKm: number;
    };

// Steps 1-2 of the evaluation order, shared by both entry points: applicability (vehicle type, then
// the enabled flag) and interval-rule resolution/validation. On success it returns the validated
// interval so callers never re-check it.
function preflight(input: {
  componentCode: string;
  vehicleType: VehicleType;
  appliesToVehicleTypes: readonly VehicleType[];
  enabled?: boolean | null;
  intervalCandidates?: IntervalCandidates | null;
}): Preflight {
  const base = { componentCode: input.componentCode, vehicleType: input.vehicleType };

  if (!isComponentApplicable(input.appliesToVehicleTypes, input.vehicleType)) {
    return {
      ok: false,
      evaluation: {
        ...base,
        status: 'not_applicable',
        reason: 'not_applicable_to_vehicle_type',
        rule: null,
        progress: null,
      },
    };
  }
  if (input.enabled === false) {
    return {
      ok: false,
      evaluation: { ...base, status: 'not_applicable', reason: 'disabled_by_override', rule: null, progress: null },
    };
  }

  const candidates = input.intervalCandidates ?? {};
  const rule = resolveMaintenanceRule({
    ...candidates,
    estimateIntervalKm: candidates.estimateIntervalKm ?? estimateIntervalKm(input.vehicleType, input.componentCode),
  });

  if (rule.intervalKm === null) return { ok: false, evaluation: unknownResult(base, rule, 'no_interval') };
  if (!Number.isFinite(rule.intervalKm) || rule.intervalKm <= 0) {
    return { ok: false, evaluation: unknownResult(base, rule, 'invalid_rule') };
  }
  if (!Number.isFinite(rule.warnRemainingPct) || rule.warnRemainingPct < 0 || rule.warnRemainingPct > 100) {
    return { ok: false, evaluation: unknownResult(base, rule, 'invalid_rule') };
  }
  return { ok: true, base, rule, intervalKm: rule.intervalKm };
}

// Step 6: progress + classification, shared by both entry points.
function classified(
  base: Pick<MaintenanceEvaluation, 'componentCode' | 'vehicleType'>,
  rule: MaintenanceRule,
  intervalKm: number,
  usedKm: number,
): MaintenanceEvaluation {
  const progress = progressFor(intervalKm, usedKm);
  return { ...base, status: classify(progress, rule.warnRemainingPct), reason: null, rule, progress };
}

// Step 3 for the ledger path: usedKm must be a finite, non-negative sum of applied_km. Absent means
// no baseline has been recorded yet (unknown history); a negative/non-finite sum is an invalid input.
function resolveAppliedUsage(
  usedKm: number | null | undefined,
): { ok: true; usedKm: number } | { ok: false; reason: 'no_service_history' | 'invalid_usage' } {
  if (isMissing(usedKm)) return { ok: false, reason: 'no_service_history' };
  if (typeof usedKm !== 'number' || !Number.isFinite(usedKm) || usedKm < 0) {
    return { ok: false, reason: 'invalid_usage' };
  }
  return { ok: true, usedKm };
}

// Pure evaluation of one component on one vehicle. Interval layers come from intervalCandidates;
// when no layer supplies one, the local estimate for (vehicleType, componentCode) fills in last —
// rule.source === 'estimate' tells callers to label it as an unverified estimate.
export function evaluateComponent(input: ComponentMaintenanceInput): MaintenanceEvaluation {
  const p = preflight(input);
  if (!p.ok) return p.evaluation;

  const usage = resolveUsage(input.currentOdometerKm, input.lastServiceOdometerKm);
  if (!usage.ok) return unknownResult(p.base, p.rule, usage.reason);

  return classified(p.base, p.rule, p.intervalKm, usage.usedKm);
}

// Pure evaluation from the maintenance ledger (applied_km since the baseline). Prefer this over
// evaluateComponent for real maintenance status: it does not depend on odometer readings.
export function evaluateUsage(input: ComponentUsageInput): MaintenanceEvaluation {
  const p = preflight(input);
  if (!p.ok) return p.evaluation;

  const usage = resolveAppliedUsage(input.usedKm);
  if (!usage.ok) return unknownResult(p.base, p.rule, usage.reason);

  return classified(p.base, p.rule, p.intervalKm, usage.usedKm);
}
