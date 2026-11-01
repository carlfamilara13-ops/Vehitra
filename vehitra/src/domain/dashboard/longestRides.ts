// Longest-rides ranking for the dashboard.
//
// A pure sort/select over persisted rides. Distances are the stored `distance_m` values, used
// as-is — this module ranks rides, it does not recalculate them. The input type is structural
// so the ranking can be tested without a database, and the original row is carried through so
// the caller can navigate straight to the ride it already has.

export type RankableRide = {
  startedAt: number;
  status: 'recording' | 'finished' | 'recovered';
  distanceM: number;
  durationS: number | null;
};

export type RankedRide<T extends RankableRide> = T & {
  /** 1-based position in the longest-first ordering. */
  rank: number;
  /** Whole-minute duration for display; null when the stored duration is missing. */
  durationS: number | null;
};

/**
 * Returns up to `limit` finalized rides ordered longest-first.
 *
 * Rides still recording are not saved records and are excluded. Rides with a shorter distance
 * than one already selected are never surfaced, so the list is the true top of what was
 * recorded. Ties fall back to the most recent ride first, which keeps the ordering stable
 * across reloads for rides of identical length.
 */
export function rankLongestRides<T extends RankableRide>(
  rides: readonly T[],
  limit: number,
): RankedRide<T>[] {
  if (limit <= 0) return [];
  const qualifying = rides.filter((r) => r.status !== 'recording' && Number.isFinite(r.distanceM));
  const sorted = [...qualifying].sort((a, b) => {
    if (b.distanceM !== a.distanceM) return b.distanceM - a.distanceM;
    return b.startedAt - a.startedAt;
  });
  return sorted.slice(0, limit).map((ride, i) => ({ ...ride, rank: i + 1 }));
}
