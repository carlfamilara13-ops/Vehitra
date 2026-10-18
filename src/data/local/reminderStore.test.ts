import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import {
  cancelReminder,
  deleteReminder,
  getReminder,
  listReminderSchedule,
  upsertReminder,
} from './reminderStore';
import type { Db } from './types';

const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);
const HOUR = 3_600_000;

describe('reminder schedule ledger', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
  });

  it('records a scheduled reminder and reads it back', async () => {
    await upsertReminder(
      db,
      { key: 'deadline:d1:2026-11-01', kind: 'deadline', userVehicleId: 'v1', fireAt: T0, notificationId: 'n-1' },
      T0,
    );
    const row = await getReminder(db, 'deadline:d1:2026-11-01');
    assert.equal(row?.status, 'scheduled');
    assert.equal(row?.notification_id, 'n-1');
    assert.equal(row?.user_vehicle_id, 'v1');
    assert.equal(row?.fire_at, T0);
  });

  it('replaces the same key instead of stacking a duplicate row', async () => {
    await upsertReminder(db, { key: 'k', kind: 'deadline', fireAt: T0, notificationId: 'n-1' }, T0);
    await upsertReminder(db, { key: 'k', kind: 'deadline', fireAt: T0 + HOUR, notificationId: 'n-2' }, T0 + 1);
    const rows = await listReminderSchedule(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].notification_id, 'n-2');
    assert.equal(rows[0].fire_at, T0 + HOUR);
    assert.equal(rows[0].updated_at, T0 + 1);
  });

  it('lists in fire-time then key order for deterministic scheduler runs', async () => {
    await upsertReminder(db, { key: 'b', kind: 'deadline', fireAt: T0 + 10, notificationId: null }, T0);
    await upsertReminder(db, { key: 'a', kind: 'deadline', fireAt: T0 + 10, notificationId: null }, T0);
    await upsertReminder(db, { key: 'c', kind: 'battery_idle', fireAt: T0, notificationId: null }, T0);
    const rows = await listReminderSchedule(db);
    assert.deepEqual(rows.map((r) => r.reminder_key), ['c', 'a', 'b']);
  });

  it('cancels a reminder: status flips, platform id clears, row stays auditable', async () => {
    await upsertReminder(db, { key: 'k', kind: 'maintenance', fireAt: T0, notificationId: 'n-1' }, T0);
    await cancelReminder(db, 'k', T0 + 1);
    const row = await getReminder(db, 'k');
    assert.equal(row?.status, 'cancelled');
    assert.equal(row?.notification_id, null);
    assert.equal(row?.updated_at, T0 + 1);
    // cancelling something unknown is a harmless no-op
    await cancelReminder(db, 'missing', T0 + 2);
    assert.equal(await getReminder(db, 'missing'), null);
  });

  it('deleteReminder drops the row entirely (fresh re-schedule path)', async () => {
    await upsertReminder(db, { key: 'k', kind: 'deadline', fireAt: T0, notificationId: 'n' }, T0);
    await cancelReminder(db, 'k', T0 + 1);
    await deleteReminder(db, 'k');
    assert.equal(await getReminder(db, 'k'), null);
    // and the same key can be scheduled anew
    await upsertReminder(db, { key: 'k', kind: 'deadline', fireAt: T0, notificationId: 'n2' }, T0 + 2);
    assert.equal((await getReminder(db, 'k'))?.notification_id, 'n2');
    assert.equal((await listReminderSchedule(db)).length, 1);
  });

  it('accepts a null vehicle for user-level reminders and defaults status to scheduled', async () => {
    await upsertReminder(db, { key: 'k', kind: 'deadline', fireAt: T0, notificationId: null }, T0);
    const row = await getReminder(db, 'k');
    assert.equal(row?.status, 'scheduled');
    assert.equal(row?.user_vehicle_id, null);
  });
});
