// Pure usage-baseline policy for the maintenance domain (Stage 4B-5). No React/Expo/SQLite/Supabase
// imports, and no store imports: the data layer supplies the candidate events, this decides which of
// them restarts a component's applied_km count.
//
// The usage baseline is the moment a component's usage restarts. Only events that actually replace or
// deliberately (re)establish the part's wear state reset usage:
//   - 'replace'  installs a fresh part/fluid, so the interval restarts from zero;
//   - 'baseline' records an explicit, estimated starting point for pre-existing history.
// Events that merely observe or lightly maintain the part do NOT reset usage:
//   - 'service'                       an undifferentiated log entry (no part/fluid change);
//   - 'inspect' / 'clean' / 'lubricate'  preserve the existing part;
//   - 'void'                          a correction marker, never a baseline.
// A part install always resets usage (a new part is a new baseline); the caller combines installs
// with the service events above.

export const INTERVAL_RESET_ACTIONS = ['replace', 'baseline'] as const;
export type IntervalResetAction = (typeof INTERVAL_RESET_ACTIONS)[number];

// Does this service action restart the component's usage interval?
export function actionResetsInterval(action: string): action is IntervalResetAction {
  return (INTERVAL_RESET_ACTIONS as readonly string[]).includes(action);
}

// A baseline's position in ledger order: the wall-clock time the event happened plus a deterministic
// tiebreak id. Structurally compatible with mileageStore.LedgerBaseline, which is what usage sums use.
export type UsageBaseline = { at: number; id: string };

// The later of the supplied candidates by (at, id), or null when none are present. Ties are broken by
// the greater id, matching the ledger's (client_created_at, id) ordering so the choice is stable.
export function establishUsageBaseline(
  candidates: ReadonlyArray<UsageBaseline | null | undefined>,
): UsageBaseline | null {
  let best: UsageBaseline | null = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!best || candidate.at > best.at || (candidate.at === best.at && candidate.id > best.id)) {
      best = { at: candidate.at, id: candidate.id };
    }
  }
  return best;
}
