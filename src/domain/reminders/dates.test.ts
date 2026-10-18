import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysUntilDateOnly,
  deadlinePhase,
  formatDateOnly,
  nextOffsetDays,
  parseDateOnly,
  reminderFireAt,
  reminderKey,
  REMINDER_OFFSET_CHOICES,
} from './dates';

describe('date-only reminder helpers', () => {
  it('parses valid dates as local midnight and rejects impossible ones', () => {
    const ms = parseDateOnly('2026-11-05');
    assert.ok(ms != null);
    const d = new Date(ms!);
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 10);
    assert.equal(d.getDate(), 5);
    assert.equal(d.getHours(), 0);

    assert.equal(parseDateOnly('2026-02-30'), null);
    assert.equal(parseDateOnly('2026-13-01'), null);
    assert.equal(parseDateOnly('05/11/2026'), null);
    assert.equal(parseDateOnly(''), null);
  });

  it('round-trips through formatDateOnly', () => {
    const ms = parseDateOnly('2027-01-03')!;
    assert.equal(formatDateOnly(ms), '2027-01-03');
  });

  it('counts calendar days until a due date, negative when overdue', () => {
    const now = new Date(2026, 9, 18, 15, 30).getTime(); // local afternoon
    assert.equal(daysUntilDateOnly('2026-10-18', now), 0);
    assert.equal(daysUntilDateOnly('2026-10-21', now), 3);
    assert.equal(daysUntilDateOnly('2026-10-15', now), -3);
    assert.equal(daysUntilDateOnly('bogus', now), null);
    assert.equal(daysUntilDateOnly('2026-10-21', Number.NaN), null);
  });

  it('classifies phases with the configured due-soon window', () => {
    assert.equal(deadlinePhase(null), 'none');
    assert.equal(deadlinePhase(-1), 'overdue');
    assert.equal(deadlinePhase(0), 'due_soon');
    assert.equal(deadlinePhase(30, 30), 'due_soon');
    assert.equal(deadlinePhase(31, 30), 'upcoming');
    assert.equal(deadlinePhase(60, 30), 'upcoming');
  });

  it('picks the last applicable offset at or before days remaining', () => {
    assert.equal(nextOffsetDays(45, [30, 7, 3, 0]), 30);
    assert.equal(nextOffsetDays(10, [30, 7, 3, 0]), 7);
    assert.equal(nextOffsetDays(3, [30, 7, 3, 0]), 3);
    assert.equal(nextOffsetDays(0, [30, 7, 3, 0]), 0);
    assert.equal(nextOffsetDays(-2, [30, 7, 3, 0]), null);
    assert.equal(nextOffsetDays(null, [30, 7]), null);
    assert.equal(nextOffsetDays(10, []), null);
  });

  it('computes reminder fire times from due date minus offset', () => {
    const fire = reminderFireAt('2026-12-01', 7);
    assert.ok(fire != null);
    assert.equal(formatDateOnly(fire!), '2026-11-24');
    assert.equal(reminderFireAt('bad-date', 7), null);
    assert.equal(reminderFireAt('2026-12-01', -1), null);
  });

  it('produces stable, distinct reminder keys', () => {
    const a = reminderKey('deadline', 'd1', '2026-11-01');
    assert.equal(a, reminderKey('deadline', 'd1', '2026-11-01'));
    assert.notEqual(a, reminderKey('deadline', 'd2', '2026-11-01'));
    assert.notEqual(a, reminderKey('deadline', 'd1', '2026-11-02'));
    assert.equal(reminderKey('battery_idle', null, 'warn'), 'battery_idle:-:warn');
  });

  it('uses only the whitelisted offset choices (matches the cloud schema)', () => {
    assert.deepEqual([...REMINDER_OFFSET_CHOICES], [0, 1, 2, 3, 5, 7, 14, 30, 60, 90]);
  });

  it('treats due dates as whole calendar days regardless of time of day', () => {
    const lateEvening = new Date(2026, 9, 18, 23, 59).getTime();
    const earlyMorning = new Date(2026, 9, 18, 0, 1).getTime();
    assert.equal(daysUntilDateOnly('2026-10-19', lateEvening), 1);
    assert.equal(daysUntilDateOnly('2026-10-19', earlyMorning), 1);
  });
});
