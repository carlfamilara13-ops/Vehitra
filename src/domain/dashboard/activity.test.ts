import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWeeklyActivity,
  formatDurationS,
  localDayKey,
  WEEKDAY_LABELS,
  type ActivityRide,
} from './activity';

// Reference "now": Tuesday 20 October 2026, local noon. The window under test is
// Wed 14 Oct … Tue 20 Oct 2026.
const NOW = new Date(2026, 9, 20, 12, 0, 0).getTime();

const at = (month: number, day: number, hour = 10, minute = 0) =>
  new Date(2026, month, day, hour, minute).getTime();

const ride = (
  startedAt: number,
  overrides: Partial<ActivityRide> = {},
): ActivityRide => ({
  startedAt,
  status: 'finished',
  distanceM: 1000,
  durationS: 600,
  ...overrides,
});

describe('localDayKey', () => {
  it('uses the device local calendar day, including month and year rollover', () => {
    assert.equal(localDayKey(at(9, 19, 23, 59)), '2026-10-19');
    assert.equal(localDayKey(at(9, 20, 0, 0)), '2026-10-20');
    assert.equal(localDayKey(new Date(2026, 1, 1, 0, 0, 1).getTime()), '2026-02-01');
    assert.equal(localDayKey(new Date(2025, 11, 31, 23, 0, 0).getTime()), '2025-12-31');
  });

  it('is not shifted by the UTC day on either side of local midnight', () => {
    // Just after local midnight: in a UTC+ zone the UTC day is still the previous one.
    assert.equal(localDayKey(new Date(2026, 9, 20, 0, 30).getTime()), '2026-10-20');
    // Just before local midnight: in a UTC- zone the UTC day is already the next one.
    assert.equal(localDayKey(new Date(2026, 9, 20, 23, 30).getTime()), '2026-10-20');
  });
});

describe('buildWeeklyActivity — window', () => {
  it('returns exactly seven local days, oldest first, ending today', () => {
    const w = buildWeeklyActivity([], NOW);
    assert.equal(w.days.length, 7);
    assert.equal(w.days[0].dayKey, '2026-10-14');
    assert.equal(w.days[6].dayKey, '2026-10-20');
    assert.ok(w.days.slice(0, 6).every((d) => d.isToday === false));
    assert.equal(w.days[6].isToday, true);
    assert.equal(w.days[0].weekday, WEEKDAY_LABELS[3]); // Wednesday
    assert.equal(w.days[6].weekday, WEEKDAY_LABELS[2]); // Tuesday
  });

  it('anchors the window to the local day when run just after local midnight', () => {
    const justAfterMidnight = new Date(2026, 9, 20, 0, 30).getTime();
    const w = buildWeeklyActivity([], justAfterMidnight);
    assert.equal(w.days[6].dayKey, '2026-10-20');
    assert.equal(w.days[0].dayKey, '2026-10-14');
  });
});

describe('buildWeeklyActivity — qualifying rides', () => {
  it('counts finished and recovered rides but ignores rides still recording', () => {
    const w = buildWeeklyActivity(
      [
        ride(at(9, 16), { status: 'finished' }),
        ride(at(9, 17), { status: 'recovered' }),
        ride(at(9, 18), { status: 'recording' }),
      ],
      NOW,
    );
    assert.equal(w.rideCount, 2);
    assert.equal(w.days.find((d) => d.dayKey === '2026-10-18')?.hasRide, false);
    assert.equal(w.days.find((d) => d.dayKey === '2026-10-17')?.hasRide, true);
  });

  it('counts a calendar day once no matter how many rides started on it', () => {
    const w = buildWeeklyActivity(
      [ride(at(9, 19, 8)), ride(at(9, 19, 15)), ride(at(9, 19, 21))],
      NOW,
    );
    const monday = w.days.find((d) => d.dayKey === '2026-10-19');
    assert.equal(monday?.rideCount, 3);
    assert.equal(monday?.hasRide, true);
    // The three same-day rides still extend the streak by exactly one day.
    assert.equal(w.streakDays, 1);
  });
});

describe('buildWeeklyActivity — streak', () => {
  it('counts consecutive local days back from today', () => {
    const w = buildWeeklyActivity(
      [ride(at(9, 18)), ride(at(9, 19)), ride(at(9, 20))],
      NOW,
    );
    assert.equal(w.streakDays, 3);
  });

  it('keeps yesterday alive as a current streak when today has no ride yet', () => {
    const w = buildWeeklyActivity([ride(at(9, 18)), ride(at(9, 19))], NOW);
    assert.equal(w.streakDays, 2);
    assert.equal(w.days[6].hasRide, false);
  });

  it('breaks at the first gap', () => {
    const w = buildWeeklyActivity(
      [ride(at(9, 15)), ride(at(9, 17)), ride(at(9, 18)), ride(at(9, 19))],
      NOW,
    );
    // Tue 20 has no ride, so the streak counts back from Mon 19: 19, 18, 17, then the
    // Thu 16 gap stops the run at three.
    assert.equal(w.streakDays, 3);
    assert.equal(w.days.find((d) => d.dayKey === '2026-10-16')?.hasRide, false);
  });

  it('is zero when today and yesterday both have no rides', () => {
    const w = buildWeeklyActivity([ride(at(9, 14))], NOW);
    assert.equal(w.streakDays, 0);
  });

  it('counts past the seven-day window instead of capping at seven', () => {
    // Daily rides from Sat 10 Oct through Tue 20 Oct: eleven consecutive days, while the
    // stats window still only covers Wed 14 … Tue 20.
    const rides = Array.from({ length: 11 }, (_, i) => ride(at(9, 10 + i)));
    const w = buildWeeklyActivity(rides, NOW);
    assert.equal(w.streakDays, 11);
    assert.equal(w.rideCount, 7);
  });

  it('stops at a gap outside the window', () => {
    // Two runs: 1–3 Oct (outside the window) and 15–20 Oct. The 4–14 Oct gap breaks the
    // first run, so the current streak is the six days back to 15 Oct.
    const rides = [
      ...[1, 2, 3].map((d) => ride(at(9, d))),
      ...[15, 16, 17, 18, 19, 20].map((d) => ride(at(9, d))),
    ];
    const w = buildWeeklyActivity(rides, NOW);
    assert.equal(w.streakDays, 6);
  });
});

describe('buildWeeklyActivity — totals and empty state', () => {
  it('sums stored distance and duration over the seven-day window only', () => {
    const w = buildWeeklyActivity(
      [
        // Eight days before "now": outside the window, must not affect totals.
        ride(new Date(2026, 9, 12, 10).getTime(), { distanceM: 50_000, durationS: 3600 }),
        ride(at(9, 16), { distanceM: 12_000, durationS: 900 }),
        ride(at(9, 20), { distanceM: 8_000, durationS: 600 }),
      ],
      NOW,
    );
    assert.equal(w.distanceM, 20_000);
    assert.equal(w.durationS, 1500);
    assert.equal(w.rideCount, 2);
    assert.equal(w.isEmpty, false);
  });

  it('treats a null stored duration as zero rather than guessing', () => {
    const w = buildWeeklyActivity([ride(at(9, 19), { durationS: null })], NOW);
    assert.equal(w.durationS, 0);
    assert.equal(w.days.find((d) => d.dayKey === '2026-10-19')?.durationS, 0);
  });

  it('reports a true empty state with seven empty days and no streak', () => {
    const w = buildWeeklyActivity([], NOW);
    assert.equal(w.isEmpty, true);
    assert.equal(w.streakDays, 0);
    assert.equal(w.rideCount, 0);
    assert.equal(w.distanceM, 0);
    assert.equal(w.days.length, 7);
    assert.ok(w.days.every((d) => d.hasRide === false && d.rideCount === 0));
  });
});

describe('formatDurationS', () => {
  it('renders hours, minutes and zero without fractional minutes', () => {
    assert.equal(formatDurationS(0), '0m');
    assert.equal(formatDurationS(59), '0m');
    assert.equal(formatDurationS(90), '1m');
    assert.equal(formatDurationS(3599), '59m');
    assert.equal(formatDurationS(3600), '1h');
    assert.equal(formatDurationS(3725), '1h 2m');
    assert.equal(formatDurationS(7200), '2h');
  });

  it('treats non-finite and negative input as zero', () => {
    assert.equal(formatDurationS(Number.NaN), '0m');
    assert.equal(formatDurationS(-5), '0m');
    assert.equal(formatDurationS(Number.POSITIVE_INFINITY), '0m');
  });
});
