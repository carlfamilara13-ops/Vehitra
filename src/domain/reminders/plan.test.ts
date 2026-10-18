import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  planBatteryReminders,
  planDeadlineReminders,
  planMaintenanceReminders,
  planReminders,
  type DeadlineReminderInput,
} from './plan';

const DAY = 86_400_000;
// Local afternoon so "today" is unambiguous in any timezone the suite runs.
const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime();

const deadline = (over: Partial<DeadlineReminderInput> = {}): DeadlineReminderInput => ({
  id: 'd1',
  kind: 'registration',
  label: null,
  dueDate: '2026-10-28', // 10 days out
  vehicleId: 'v1',
  vehicleName: 'Daily',
  offsetsDays: [30, 7, 3, 0],
  enabled: true,
  deletedAt: null,
  ...over,
});

describe('reminder planner — deadlines', () => {
  it('plans the next applicable offset notice', () => {
    const plans = planDeadlineReminders([deadline()], NOW);
    assert.equal(plans.length, 1);
    // 10 days out: 30-day notice passed, 7-day notice not yet due -> next is 7 days out (future).
    // The fire time stays in the future, so nothing schedules yet? At 10 days the 7-day offset
    // has NOT arrived; only offsets <= daysUntil apply (7 <= 10 is true), so 7-day applies now.
    assert.equal(plans[0].fireAt, new Date(2026, 9, 21).getTime());
    assert.equal(plans[0].urgency, 'due_soon');
    assert.match(plans[0].title, /Registration expiry/);
    assert.match(plans[0].body, /2026-10-28/);
  });

  it('clamps an overdue deadline to fire immediately with overdue urgency', () => {
    const plans = planDeadlineReminders([deadline({ dueDate: '2026-10-01' })], NOW);
    assert.equal(plans.length, 1);
    assert.equal(plans[0].urgency, 'overdue');
    assert.equal(plans[0].fireAt, NOW);
    assert.match(plans[0].title, /has passed/);
  });

  it('skips disabled, deleted and far-future deadlines', () => {
    assert.equal(planDeadlineReminders([deadline({ enabled: false })], NOW).length, 0);
    assert.equal(planDeadlineReminders([deadline({ deletedAt: NOW })], NOW).length, 0);
    // 100 days out with no offset beyond 30 -> nothing applicable yet.
    assert.equal(planDeadlineReminders([deadline({ dueDate: '2027-01-27' })], NOW).length, 0);
    // Bad date produces no plan rather than a bogus reminder.
    assert.equal(planDeadlineReminders([deadline({ dueDate: 'nope' })], NOW).length, 0);
  });

  it('includes the vehicle name in the body and supports user-level licences', () => {
    const licence = deadline({
      id: 'l1',
      kind: 'license',
      vehicleId: null,
      vehicleName: null,
      dueDate: '2026-10-19', // tomorrow -> offset 0 not reached (0 <= 1 yes, reached)
    });
    const plans = planDeadlineReminders([licence], NOW);
    assert.equal(plans.length, 1);
    assert.match(plans[0].title, /licence/i);
    assert.doesNotMatch(plans[0].body, /for Daily/);
  });
});

describe('reminder planner — battery idle', () => {
  const battery = (daysAgo: number) => ({
    vehicleId: 'v1',
    vehicleName: 'Daily',
    lastActiveAt: NOW - daysAgo * DAY,
  });

  it('plans nothing below the 3-day watch threshold', () => {
    assert.equal(planBatteryReminders([battery(0)], NOW).length, 0);
    assert.equal(planBatteryReminders([battery(2)], NOW).length, 0);
  });

  it('plans a watch reminder at 3 days and upgrades to warn at 7', () => {
    const watch = planBatteryReminders([battery(3)], NOW);
    assert.equal(watch.length, 1);
    assert.equal(watch[0].urgency, 'info');
    assert.equal(watch[0].fireAt, NOW);
    assert.match(watch[0].body, /cannot measure battery health/);

    const warn = planBatteryReminders([battery(7)], NOW);
    assert.equal(warn.length, 1);
    assert.equal(warn[0].urgency, 'due_soon');
    assert.match(warn[0].title, /over a week/);
    // Keys differ per level so a downgrade cancels the warn key explicitly.
    assert.notEqual(watch[0].key, warn[0].key);
  });

  it('uses one stable key per vehicle+level so refreshes never stack duplicates', () => {
    const a = planBatteryReminders([battery(4)], NOW);
    const b = planBatteryReminders([battery(4)], NOW + HOUR());
    assert.equal(a[0].key, b[0].key);
  });
});

function HOUR() {
  return 3_600_000;
}

describe('reminder planner — maintenance and composition', () => {
  it('creates one stable key per vehicle+component for due/overdue items', () => {
    const items = [
      { vehicleId: 'v1', vehicleName: 'Daily', componentCode: 'engine_oil', componentName: 'Engine Oil', status: 'overdue' as const },
      { vehicleId: 'v1', vehicleName: 'Daily', componentCode: 'drive_chain', componentName: 'Drive Chain', status: 'due_soon' as const },
    ];
    const plans = planMaintenanceReminders(items, NOW);
    assert.equal(plans.length, 2);
    assert.equal(plans[0].key, planMaintenanceReminders(items, NOW + HOUR())[0].key);
    assert.equal(new Set(plans.map((p) => p.key)).size, 2);
  });

  it('sorts by urgency, then fire time, then key, combining all sources', () => {
    const plans = planReminders({
      deadlines: [deadline({ id: 'far', dueDate: '2026-10-21' })], // 3 days out, due_soon
      batteries: [{ vehicleId: 'v1', vehicleName: 'Daily', lastActiveAt: NOW - 10 * DAY }],
      maintenance: [
        { vehicleId: 'v1', vehicleName: 'Daily', componentCode: 'engine_oil', componentName: 'Engine Oil', status: 'due_soon' as const },
      ],
      nowMs: NOW,
    });
    assert.equal(plans.length, 3);
    assert.equal(plans[0].urgency, 'due_soon'); // battery warn is due_soon; deadlines too
    const urgencies = plans.map((p) => p.urgency);
    const rank = { overdue: 0, due_soon: 1, info: 2 } as const;
    for (let i = 1; i < urgencies.length; i++) {
      assert.ok(rank[urgencies[i - 1]] <= rank[urgencies[i]], 'urgencies must be non-decreasing');
    }
    // deterministic across runs
    const again = planReminders({
      deadlines: [deadline({ id: 'far', dueDate: '2026-10-21' })],
      batteries: [{ vehicleId: 'v1', vehicleName: 'Daily', lastActiveAt: NOW - 10 * DAY }],
      maintenance: [
        { vehicleId: 'v1', vehicleName: 'Daily', componentCode: 'engine_oil', componentName: 'Engine Oil', status: 'due_soon' as const },
      ],
      nowMs: NOW,
    });
    assert.deepEqual(plans.map((p) => p.key), again.map((p) => p.key));
  });
});
