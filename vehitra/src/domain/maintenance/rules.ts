import type { IntervalCandidates, IntervalSource, MaintenanceRule, VehicleType } from './types';

// Same default as model_components.warn_remaining_pct in supabase/migrations/20261010000200_catalog.sql,
// so local evaluation matches the schema when the catalog value has not been supplied yet.
export const DEFAULT_WARN_REMAINING_PCT = 25;

// Local fallback intervals   CONFIGURABLE ESTIMATES, NOT manufacturer recommendations.
// Provenance: the only interval number that exists in this project today is the motorcycle
// engine-oil value from the project spec, seeded as review_status = 'draft' / "Unverified" in
// supabase/seed.sql. The seed deliberately leaves every other interval NULL ("pending review"),
// so this map ships no numbers for chain, tires, brakes, etc. until reviewed data exists.
// Callers must label anything resolved from here as an estimate (rule.source === 'estimate').
export const ESTIMATED_INTERVAL_KM: Readonly<Partial<Record<VehicleType, Readonly<Record<string, number>>>>> = {
  motorcycle: { engine_oil: 1500 },
};

// Local estimate for one (vehicle type, component), or null when the project has no estimate.
export function estimateIntervalKm(vehicleType: VehicleType, componentCode: string): number | null {
  return ESTIMATED_INTERVAL_KM[vehicleType]?.[componentCode] ?? null;
}

// Picks the interval in force from the candidate layers. Precedence (first present wins):
//   override > usage > catalog > estimate
// - Absent (null/undefined) layers are skipped.
// - A PRESENT BUT INVALID value (e.g. overrideIntervalKm = -5) is still the winner: the evaluator
//   reports reason 'invalid_rule' instead of silently falling back to a different interval, so a
//   broken configured value is surfaced rather than papered over.
// - warnRemainingPct falls back to DEFAULT_WARN_REMAINING_PCT only when no layer supplied one;
//   an invalid supplied value is kept raw and reported by the evaluator.
// - Pure: it never inspects the vehicle or component itself, so usage-based and per-model
//   differences stay in the hands of whoever builds the candidates.
export function resolveMaintenanceRule(candidates: IntervalCandidates | null | undefined): MaintenanceRule {
  const c = candidates ?? {};
  const layers: [IntervalSource, number | null | undefined][] = [
    ['override', c.overrideIntervalKm],
    ['usage', c.usageIntervalKm],
    ['catalog', c.catalogIntervalKm],
    ['estimate', c.estimateIntervalKm],
  ];

  let intervalKm: number | null = null;
  let source: IntervalSource = 'none';
  for (const [name, value] of layers) {
    if (value !== null && value !== undefined) {
      intervalKm = value;
      source = name;
      break;
    }
  }

  const warn = c.warnRemainingPct;
  return {
    intervalKm,
    warnRemainingPct: warn !== null && warn !== undefined ? warn : DEFAULT_WARN_REMAINING_PCT,
    source,
  };
}
