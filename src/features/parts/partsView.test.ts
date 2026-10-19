import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  categoryLabel,
  formatKm,
  intervalSourceNote,
  matchesQuery,
  parseDateInput,
  parseIntervalKm,
  parseOdometerKm,
  parseOptionalOdometerKm,
  progressFraction,
  reasonLabel,
  STATUS_LABELS,
  STATUS_TONES,
  summarize,
  todayInput,
  usageLine,
} from './partsView';

describe('partsView: status labels and tone', () => {
  it('labels every status and keeps unknown distinct from good', () => {
    assert.equal(STATUS_LABELS.good, 'Good');
    assert.equal(STATUS_LABELS.due_soon, 'Due soon');
    assert.equal(STATUS_LABELS.overdue, 'Overdue');
    assert.equal(STATUS_LABELS.unknown, 'Unknown');
    assert.equal(STATUS_LABELS.not_applicable, 'Not applicable');
  });

  it('maps status to a tone', () => {
    assert.equal(STATUS_TONES.good, 'good');
    assert.equal(STATUS_TONES.due_soon, 'due');
    assert.equal(STATUS_TONES.overdue, 'overdue');
    assert.equal(STATUS_TONES.unknown, 'unknown');
    assert.equal(STATUS_TONES.not_applicable, 'off');
  });
});

describe('partsView: summarize', () => {
  it('counts each status separately, including unknown and not_applicable', () => {
    const counts = summarize(['good', 'good', 'due_soon', 'overdue', 'unknown', 'unknown', 'not_applicable']);
    assert.deepEqual(counts, {
      total: 7,
      good: 2,
      due_soon: 1,
      overdue: 1,
      unknown: 2,
      not_applicable: 1,
    });
  });

  it('returns all zeroes for no components', () => {
    assert.deepEqual(summarize([]), {
      total: 0,
      good: 0,
      due_soon: 0,
      overdue: 0,
      unknown: 0,
      not_applicable: 0,
    });
  });
});

describe('partsView: search', () => {
  const item = { componentCode: 'engine_oil', name: 'Engine Oil' };

  it('matches everything for an empty or blank query', () => {
    assert.equal(matchesQuery(item, ''), true);
    assert.equal(matchesQuery(item, '   '), true);
  });

  it('matches by name or code, case-insensitively', () => {
    assert.equal(matchesQuery(item, 'engine'), true);
    assert.equal(matchesQuery(item, 'OIL'), true);
    assert.equal(matchesQuery(item, 'oil'), true);
    assert.equal(matchesQuery(item, 'brake'), false);
  });

  it('does not treat component codes as matching via unrelated substrings', () => {
    assert.equal(matchesQuery(item, 'zzz'), false);
  });
});

describe('partsView: progress and usage', () => {
  it('clamps the bar fraction into 0..1', () => {
    assert.equal(progressFraction(0), 0);
    assert.equal(progressFraction(-5), 0);
    assert.equal(progressFraction(50), 0.5);
    assert.equal(progressFraction(100), 1);
    assert.equal(progressFraction(180), 1);
    assert.equal(progressFraction(Number.NaN), 0);
  });

  it('formats kilometres without trailing zeros', () => {
    assert.equal(formatKm(0), '0');
    assert.equal(formatKm(1500), '1500');
    assert.equal(formatKm(12.25), '12.3');
    assert.equal(formatKm(1.5), '1.5');
  });

  it('builds a truthful usage line for good, at-interval and overdue', () => {
    assert.equal(usageLine(500, 1500, 1000), '500 of 1500 km (33%) · 1000 km left');
    assert.equal(usageLine(1500, 1500, 0), '1500 of 1500 km (100%) · at the interval now');
    assert.equal(usageLine(1800, 1500, -300), '1800 of 1500 km (120%) · 300 km over');
  });
});

describe('partsView: labels', () => {
  it('explains unknown reasons in plain language', () => {
    assert.match(reasonLabel('no_service_history') ?? '', /no service/i);
    assert.match(reasonLabel('no_interval') ?? '', /interval/i);
    assert.equal(reasonLabel(null), null);
  });

  it('flags estimate intervals as not a manufacturer recommendation', () => {
    assert.match(intervalSourceNote('estimate') ?? '', /not a manufacturer recommendation/i);
    assert.match(intervalSourceNote('override') ?? '', /user configured/i);
    assert.match(intervalSourceNote('override') ?? '', /not a manufacturer recommendation/i);
    // catalog intervals are wired now — and labelled as draft pack data, never manufacturer data
    assert.match(intervalSourceNote('catalog') ?? '', /draft data, not a manufacturer recommendation/i);
    assert.match(intervalSourceNote('catalog') ?? '', /resource pack/i);
    assert.match(intervalSourceNote('usage') ?? '', /recorded usage/i);
    assert.equal(intervalSourceNote('mystery_source'), null);
  });

  it('humanises categories and falls back to the raw code', () => {
    assert.equal(categoryLabel('wheels_tires'), 'Wheels & tires');
    assert.equal(categoryLabel('mystery'), 'mystery');
  });
});

describe('partsView: form input parsing', () => {
  it('accepts finite non-negative odometers and preserves precision', () => {
    assert.deepEqual(parseOdometerKm('12500.5'), { ok: true, value: 12500.5 });
    assert.deepEqual(parseOdometerKm(' 0 '), { ok: true, value: 0 });
    assert.deepEqual(parseOdometerKm(''), { ok: false, error: 'Enter an odometer reading.' });
    assert.ok(!parseOdometerKm('abc').ok);
    assert.ok(!parseOdometerKm('-3').ok);
    assert.ok(!parseOdometerKm('Infinity').ok);
  });

  it('treats a blank optional odometer as null and otherwise validates it', () => {
    assert.deepEqual(parseOptionalOdometerKm('   '), { ok: true, value: null });
    assert.deepEqual(parseOptionalOdometerKm('42'), { ok: true, value: 42 });
    assert.ok(!parseOptionalOdometerKm('-1').ok);
  });

  it('requires a positive interval', () => {
    assert.deepEqual(parseIntervalKm('2000'), { ok: true, value: 2000 });
    assert.ok(!parseIntervalKm('').ok);
    assert.ok(!parseIntervalKm('0').ok);
    assert.ok(!parseIntervalKm('-500').ok);
    assert.ok(!parseIntervalKm('lots').ok);
  });

  it('parses YYYY-MM-DD dates and rejects impossible or future ones', () => {
    const now = new Date(2026, 9, 18); // fixed local reference day
    const parsed = parseDateInput('2026-10-18', now);
    assert.ok(parsed.ok);
    if (parsed.ok) {
      const d = new Date(parsed.value);
      assert.equal(d.getFullYear(), 2026);
      assert.equal(d.getMonth(), 9);
      assert.equal(d.getDate(), 18);
    }
    assert.deepEqual(parseDateInput('18/10/2026', now), { ok: false, error: 'Enter the date as YYYY-MM-DD.' });
    assert.deepEqual(parseDateInput('2026-02-30', now), { ok: false, error: 'That date does not exist.' });
    // Today and earlier are allowed; a later calendar day is not.
    assert.ok(parseDateInput('2026-10-18', now).ok);
    assert.ok(parseDateInput('2026-10-17', now).ok);
    assert.deepEqual(parseDateInput('2026-10-19', now), { ok: false, error: 'Date cannot be in the future.' });
    assert.deepEqual(parseDateInput('2027-01-01', now), { ok: false, error: 'Date cannot be in the future.' });
  });

  it('formats today as a zero-padded YYYY-MM-DD', () => {
    assert.equal(todayInput(new Date(2026, 0, 5)), '2026-01-05');
    assert.equal(todayInput(new Date(2026, 11, 31)), '2026-12-31');
  });
});

describe('partsView: usageLine unit conversion', () => {
  it('keeps metric output byte-identical whether or not units are passed explicitly', () => {
    assert.equal(usageLine(500, 1500, 1000), '500 of 1500 km (33%) · 1000 km left');
    assert.equal(usageLine(500, 1500, 1000), usageLine(500, 1500, 1000, 'metric'));
    assert.equal(
      usageLine(1500, 1500, 0),
      usageLine(1500, 1500, 0, 'metric'),
    );
    assert.equal(
      usageLine(1800, 1500, -300),
      usageLine(1800, 1500, -300, 'metric'),
    );
  });

  it('converts every km figure to miles in imperial; percent stays a ratio of stored km', () => {
    // 1609.344 km = exactly 1000 mi, so rounding to one decimal is stable.
    assert.equal(
      usageLine(1609.344, 3218.688, 1609.344, 'imperial'),
      '1000 of 2000 mi (50%) · 1000 mi left',
    );
  });

  it('keeps the same phrase shapes in imperial', () => {
    assert.match(usageLine(3000, 3000, 0, 'imperial'), /mi \(100%\) · at the interval now$/);
    assert.match(usageLine(3600, 3000, -600, 'imperial'), /mi \(120%\) · [\d.]+ mi over$/);
  });
});
