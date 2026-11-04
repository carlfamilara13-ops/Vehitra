// Weekly activity derivation for the dashboard hero.
//
// Everything here is pure date/calendar arithmetic over data that is already persisted. The
// module deliberately takes a structural input type instead of importing the SQLite row shape,
// so it stays a pure function that can be reasoned about and tested without a database.
//
// Distance and duration are used exactly as stored (`distance_m`, `duration_s`). No alternative
// ride mathematics is introduced here   the only work is grouping saved rides onto local
// calendar days and summing the stored values.

export const WEEK_LENGTH = 7;

// Short weekday labels for the seven-column strip. Two letters rather than one so the weekend
// pair is not ambiguous; the whole strip is also exposed to assistive technology as a single
// spoken summary, so these labels are decorative for screen readers.
export const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

export type ActivityRide = {
  /** Epoch milliseconds of `started_at`. Grouped by the device's local calendar day. */
  startedAt: number;
  /** Only finalized rides are saved records; a ride still recording is excluded. */
  status: 'recording' | 'finished' | 'recovered';
  /** Stored metres. Summed as-is. */
  distanceM: number;
  /** Stored seconds. Null is treated as zero rather than guessed. */
  durationS: number | null;
};

export type DayActivity = {
  /** `YYYY-MM-DD` in the device's local calendar. */
  dayKey: string;
  /** Two-letter weekday label derived from the same local date. */
  weekday: string;
  isToday: boolean;
  rideCount: number;
  distanceM: number;
  durationS: number;
  /** True when at least one qualifying saved ride started on this local day. */
  hasRide: boolean;
};

export type WeeklyActivity = {
  /**
   * Consecutive local calendar days with at least one qualifying ride, counting back from
   * today across all loaded rides   not limited to the seven-day window, so a long streak
   * reports its true length. When today has no ride yet the streak is not yet broken   it
   * counts back from yesterday instead   so a streak stays visible for the rest of the day
   * after it was earned.
   */
  streakDays: number;
  /** Exactly seven entries, oldest first, ending at the local day `nowMs` falls on. */
  days: DayActivity[];
  /** Totals over the seven-day window only. */
  distanceM: number;
  rideCount: number;
  durationS: number;
  /** True when the window contains no qualifying rides at all. */
  isEmpty: boolean;
};

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/** Local calendar day key for an instant, in the device's own time zone. */
export function localDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Whole-minute duration for display: `1h 2m`, `45m`, `0m`.
 * Minutes are floored, so a sub-minute ride reads as zero rather than a rounded-up minute.
 */
export function formatDurationS(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

/**
 * Builds the seven-day activity window ending on the local day `nowMs` falls on.
 *
 * A calendar day counts once if at least one qualifying saved ride started on that local day;
 * multiple rides on the same day increase the day's counts but never extend the streak by more
 * than one day. Rides still recording are not saved records and are ignored.
 *
 * The streak is computed over every ride passed in, so it counts back past the seven-day
 * window; the distance/ride/time totals stay window-only.
 */
export function buildWeeklyActivity(rides: readonly ActivityRide[], nowMs: number): WeeklyActivity {
  const byDay = new Map<string, { count: number; distanceM: number; durationS: number }>();

  for (const ride of rides) {
    if (ride.status === 'recording') continue;
    const key = localDayKey(ride.startedAt);
    const slot = byDay.get(key) ?? { count: 0, distanceM: 0, durationS: 0 };
    slot.count += 1;
    slot.distanceM += ride.distanceM;
    slot.durationS += ride.durationS ?? 0;
    byDay.set(key, slot);
  }

  // Local midnights; Date normalises month and year rollover for us.
  const now = new Date(nowMs);

  // Streak counts back from today, or from yesterday when today has no ride yet, over the
  // full set of ride days   the run only stops at a calendar day with no qualifying ride.
  let streakAnchor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!byDay.has(localDayKey(streakAnchor.getTime()))) {
    streakAnchor = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  }
  let streakDays = 0;
  while (byDay.has(localDayKey(streakAnchor.getTime()))) {
    streakDays += 1;
    streakAnchor = new Date(
      streakAnchor.getFullYear(),
      streakAnchor.getMonth(),
      streakAnchor.getDate() - 1,
    );
  }

  const days: DayActivity[] = [];
  for (let back = WEEK_LENGTH - 1; back >= 0; back -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    const slot = byDay.get(localDayKey(d.getTime()));
    const rideCount = slot?.count ?? 0;
    days.push({
      dayKey: localDayKey(d.getTime()),
      weekday: WEEKDAY_LABELS[d.getDay()],
      isToday: back === 0,
      rideCount,
      distanceM: slot?.distanceM ?? 0,
      durationS: slot?.durationS ?? 0,
      hasRide: rideCount > 0,
    });
  }

  let distanceM = 0;
  let rideCount = 0;
  let durationS = 0;
  for (const day of days) {
    distanceM += day.distanceM;
    rideCount += day.rideCount;
    durationS += day.durationS;
  }

  return {
    streakDays,
    days,
    distanceM,
    rideCount,
    durationS,
    isEmpty: rideCount === 0,
  };
}
