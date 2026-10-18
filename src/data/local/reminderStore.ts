import { serialize } from './serialize';
import type { Db } from './types';

// Idempotency ledger for scheduled reminders (schema v9). One row per deterministic reminder
// key (domain/reminders/dates.reminderKey), holding the platform notification id. The scheduler
// always upserts through here before/after touching the notification platform, so a re-run
// cancels the previous notification instead of stacking duplicates, and a platform failure
// never leaves a row claiming something was scheduled.

export type ReminderScheduleRow = {
  reminder_key: string;
  kind: string;
  user_vehicle_id: string | null;
  fire_at: number;
  notification_id: string | null;
  status: 'scheduled' | 'sent' | 'cancelled';
  updated_at: number;
};

export type ReminderScheduleInput = {
  key: string;
  kind: string;
  userVehicleId?: string | null;
  fireAt: number;
  notificationId: string | null;
  status?: 'scheduled' | 'sent' | 'cancelled';
};

export async function listReminderSchedule(db: Db): Promise<ReminderScheduleRow[]> {
  return db.getAllAsync<ReminderScheduleRow>(
    'SELECT * FROM reminder_schedule ORDER BY fire_at ASC, reminder_key ASC',
  );
}

export async function getReminder(db: Db, key: string): Promise<ReminderScheduleRow | null> {
  return db.getFirstAsync<ReminderScheduleRow>('SELECT * FROM reminder_schedule WHERE reminder_key = ?', key);
}

export function upsertReminder(db: Db, input: ReminderScheduleInput, now = Date.now()): Promise<void> {
  return serialize(async () => {
    await db.runAsync(
      `INSERT INTO reminder_schedule
         (reminder_key, kind, user_vehicle_id, fire_at, notification_id, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (reminder_key) DO UPDATE SET
         kind = excluded.kind,
         user_vehicle_id = excluded.user_vehicle_id,
         fire_at = excluded.fire_at,
         notification_id = excluded.notification_id,
         status = excluded.status,
         updated_at = excluded.updated_at`,
      input.key, input.kind, input.userVehicleId ?? null, input.fireAt,
      input.notificationId, input.status ?? 'scheduled', now,
    );
  });
}

// Mark one reminder as cancelled (its platform notification was cancelled or the underlying
// data changed). Keeps the row so a cancelled key is still auditable.
export function cancelReminder(db: Db, key: string, now = Date.now()): Promise<void> {
  return serialize(async () => {
    await db.runAsync(
      `UPDATE reminder_schedule SET status = 'cancelled', notification_id = NULL, updated_at = ?
        WHERE reminder_key = ?`,
      now, key,
    );
  });
}

// Drop a cancelled row entirely — used before re-scheduling the same key afresh.
export function deleteReminder(db: Db, key: string): Promise<void> {
  return serialize(async () => {
    await db.runAsync('DELETE FROM reminder_schedule WHERE reminder_key = ?', key);
  });
}
