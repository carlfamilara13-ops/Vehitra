import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../../data/local/migrate';
import { MIGRATIONS } from '../../data/local/migrations';
import { createNodeSqliteDb, hasNodeSqlite } from '../../data/local/nodeSqliteDb.testutil';
import { createVehicle, setVehicleOdometer } from '../../data/local/vehicleStore';
import { upsertDeadline } from '../../data/local/deadlineStore';
import { recordBatteryUse } from '../../data/local/batteryStore';
import { upsertOverride } from '../../data/local/overrideStore';
import { createCustomPart } from '../../data/local/customPartStore';
import { insertServiceEvent } from '../../data/local/serviceStore';
import { listReminderSchedule } from '../../data/local/reminderStore';
import { updateAppSettings } from '../../data/local/settingsStore';
import { syncReminders } from './scheduler';
import type { NotificationsAdapter, ReminderNotification } from './notifications';
import type { Db } from '../../data/local/types';

const T0 = Date.UTC(2026, 9, 10, 4, 0, 0);

function fakeAdapter(opts?: { permission?: boolean; available?: boolean }) {
  const calls = {
    scheduled: [] as ReminderNotification[],
    cancelled: [] as string[],
    cancelAll: 0,
  };
  const adapter: NotificationsAdapter = {
    available: opts?.available ?? true,
    ensurePermissions: async () => opts?.permission ?? true,
    schedule: async (n) => {
      calls.scheduled.push(n);
      return `pn-${calls.scheduled.length}`;
    },
    cancel: async (id) => {
      calls.cancelled.push(id);
    },
    cancelAll: async () => {
      calls.cancelAll++;
    },
  };
  return { adapter, calls };
}

const scheduledRows = (rows: Awaited<ReturnType<typeof listReminderSchedule>>) =>
  rows.filter((r) => r.status === 'scheduled');

describe('reminder scheduler', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
    await createVehicle(db, { id: 'v1', vehicle_type: 'motorcycle' }, T0);
  });

  it('plans a deadline notice, schedules it once and records the ledger', async () => {
    await upsertDeadline(
      db,
      { id: 'd1', kind: 'registration', user_vehicle_id: 'v1', due_date: '2026-10-25' },
      T0,
    );
    const { adapter, calls } = fakeAdapter();

    const result = await syncReminders(db, adapter, T0);

    assert.equal(result.enabled, true);
    assert.equal(result.plans, 1);
    assert.equal(result.scheduled, 1);
    assert.equal(calls.scheduled.length, 1);
    assert.match(calls.scheduled[0].title, /registration/i);

    const rows = scheduledRows(await listReminderSchedule(db));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].notification_id, 'pn-1');
    assert.equal(rows[0].kind, 'deadline');
    assert.equal(rows[0].user_vehicle_id, 'v1');
    assert.equal(rows[0].fire_at, calls.scheduled[0].fireAt);
  });

  it('is idempotent: a second sync changes nothing', async () => {
    await upsertDeadline(
      db,
      { id: 'd1', kind: 'registration', user_vehicle_id: 'v1', due_date: '2026-10-25' },
      T0,
    );
    const first = fakeAdapter();
    await syncReminders(db, first.adapter, T0);

    const second = fakeAdapter();
    const result = await syncReminders(db, second.adapter, T0);

    assert.equal(result.unchanged, 1);
    assert.equal(result.scheduled, 0);
    assert.equal(second.calls.scheduled.length, 0);
    assert.equal(second.calls.cancelled.length, 0);
  });

  it('replaces the notice when the due date changes (no stacking)', async () => {
    await upsertDeadline(
      db,
      { id: 'd1', kind: 'registration', user_vehicle_id: 'v1', due_date: '2026-10-25' },
      T0,
    );
    const first = fakeAdapter();
    await syncReminders(db, first.adapter, T0);

    // Same reminder, different due date still inside the notice window -> different planner key.
    await upsertDeadline(
      db,
      { id: 'd1', kind: 'registration', user_vehicle_id: 'v1', due_date: '2026-11-01' },
      T0,
    );
    const second = fakeAdapter();
    const result = await syncReminders(db, second.adapter, T0);

    assert.equal(result.cancelled, 1);
    assert.equal(result.scheduled, 1);
    assert.equal(second.calls.cancelled.length, 1);
    assert.equal(second.calls.cancelled[0], 'pn-1');
    assert.equal(second.calls.scheduled.length, 1);

    const rows = scheduledRows(await listReminderSchedule(db));
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].reminder_key, 'deadline:d1:2026-10-18');
  });

  it('cancels document notices when that category is disabled', async () => {
    await upsertDeadline(
      db,
      { id: 'd1', kind: 'registration', user_vehicle_id: 'v1', due_date: '2026-10-25' },
      T0,
    );
    const first = fakeAdapter();
    await syncReminders(db, first.adapter, T0);

    await updateAppSettings(db, { document_reminders_enabled: false }, T0 + 1);
    const second = fakeAdapter();
    const result = await syncReminders(db, second.adapter, T0 + 1);

    assert.equal(result.enabled, true);
    assert.equal(result.plans, 0);
    assert.equal(result.cancelled, 1);
    assert.equal(second.calls.scheduled.length, 0);
    assert.equal(second.calls.cancelled.length, 1);
    assert.equal(scheduledRows(await listReminderSchedule(db)).length, 0);
  });

  it('tears everything down when the notifications switch is off', async () => {
    await upsertDeadline(
      db,
      { id: 'd1', kind: 'registration', user_vehicle_id: 'v1', due_date: '2026-10-25' },
      T0,
    );
    const first = fakeAdapter();
    await syncReminders(db, first.adapter, T0);

    await updateAppSettings(db, { notifications_enabled: false }, T0);
    const second = fakeAdapter();
    const result = await syncReminders(db, second.adapter, T0);

    assert.equal(result.enabled, false);
    assert.equal(result.cancelled, 1);
    assert.equal(second.calls.scheduled.length, 0);
    assert.equal(second.calls.cancelled.length, 1);
    assert.equal(scheduledRows(await listReminderSchedule(db)).length, 0);

    const rows = await listReminderSchedule(db);
    assert.equal(rows[0].status, 'cancelled');
    assert.equal(rows[0].notification_id, null);
  });

  it('records nothing while permission is denied, then schedules once granted', async () => {
    await upsertDeadline(
      db,
      { id: 'd1', kind: 'registration', user_vehicle_id: 'v1', due_date: '2026-10-25' },
      T0,
    );
    const denied = fakeAdapter({ permission: false });
    const result = await syncReminders(db, denied.adapter, T0);

    assert.equal(result.permissionDenied, true);
    assert.equal(result.scheduled, 0);
    assert.equal(denied.calls.scheduled.length, 0);
    assert.equal(scheduledRows(await listReminderSchedule(db)).length, 0);

    const granted = fakeAdapter({ permission: true });
    const second = await syncReminders(db, granted.adapter, T0);
    assert.equal(second.permissionDenied, false);
    assert.equal(second.scheduled, 1);
    assert.equal(scheduledRows(await listReminderSchedule(db)).length, 1);
  });

  it('reports unavailable adapters instead of pretending to schedule', async () => {
    await upsertDeadline(
      db,
      { id: 'd1', kind: 'registration', user_vehicle_id: 'v1', due_date: '2026-10-25' },
      T0,
    );
    const { adapter } = fakeAdapter({ available: false });
    const result = await syncReminders(db, adapter, T0);

    assert.equal(result.available, false);
    assert.equal(result.scheduled, 0);
    assert.equal(scheduledRows(await listReminderSchedule(db)).length, 0);
  });

  it('schedules a user-configured time maintenance reminder from its baseline', async () => {
    await upsertOverride(db, {
      id: 'override-1', user_vehicle_id: 'v1', component_code: 'engine_oil', interval_days: 10,
    }, T0);
    await insertServiceEvent(db, {
      id: 'baseline-1', user_vehicle_id: 'v1', component_code: 'engine_oil',
      action: 'baseline', performed_at: T0, estimated: true,
    }, T0);
    const { adapter, calls } = fakeAdapter();

    const result = await syncReminders(db, adapter, T0 + 7 * 86_400_000);

    assert.equal(result.plans, 1);
    assert.equal(calls.scheduled.length, 1);
    assert.equal(calls.scheduled[0].title.includes('time service'), true);
    const rows = scheduledRows(await listReminderSchedule(db));
    assert.equal(rows[0].kind, 'maintenance_time');
  });

  it('schedules a time reminder for a custom part using its existing maintenance record', async () => {
    const part = await createCustomPart(db, {
      id: 'custom-1', user_vehicle_id: 'v1', component_code: 'custom_auxlight', name: 'Auxiliary light', category: 'electrical',
    }, T0);
    await upsertOverride(db, {
      id: 'custom-interval', user_vehicle_id: 'v1', component_code: part.component_code, interval_days: 10,
    }, T0);
    await insertServiceEvent(db, {
      id: 'custom-baseline', user_vehicle_id: 'v1', component_code: part.component_code,
      action: 'replace', performed_at: T0, estimated: false,
    }, T0);
    const { adapter, calls } = fakeAdapter();

    const result = await syncReminders(db, adapter, T0 + 7 * 86_400_000);

    assert.equal(result.plans, 1);
    assert.equal(calls.scheduled.length, 1);
    assert.match(calls.scheduled[0].body, /Auxiliary light/);
    assert.equal(scheduledRows(await listReminderSchedule(db))[0].kind, 'maintenance_time');
  });

  it('delivers an overdue maintenance notice immediately and does not reschedule it on refresh', async () => {
    await setVehicleOdometer(db, 'v1', 2600, T0 + 1);
    await insertServiceEvent(db, {
      id: 'oil-replaced', user_vehicle_id: 'v1', component_code: 'engine_oil',
      action: 'replace', performed_at: T0, odo_at: 1000,
    }, T0);
    await upsertOverride(db, {
      id: 'oil-interval', user_vehicle_id: 'v1', component_code: 'engine_oil', interval_km: 1500,
    }, T0);

    const first = fakeAdapter();
    const scheduled = await syncReminders(db, first.adapter, T0 + 2);
    assert.equal(scheduled.plans, 1);
    assert.equal(first.calls.scheduled[0].immediate, true);
    assert.match(first.calls.scheduled[0].title, /overdue/i);

    const second = fakeAdapter();
    const refreshed = await syncReminders(db, second.adapter, T0 + 3);
    assert.equal(refreshed.unchanged, 1);
    assert.equal(second.calls.scheduled.length, 0);
  });
  it('plans battery-idle reminders from the last check-in', async () => {
    await recordBatteryUse(db, 'v1', T0 - 10 * 86_400_000, null, T0);
    const { adapter, calls } = fakeAdapter();

    const result = await syncReminders(db, adapter, T0);

    assert.equal(result.plans, 1);
    assert.equal(calls.scheduled.length, 1);
    const rows = scheduledRows(await listReminderSchedule(db));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'battery_idle');
    assert.equal(rows[0].user_vehicle_id, 'v1');
  });
});
