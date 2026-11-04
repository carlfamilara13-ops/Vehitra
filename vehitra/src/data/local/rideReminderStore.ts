import { serialize } from './serialize';
import type { Db } from './types';

export type MovementReminderState = {
  id: number;
  moving_since: number | null;
  last_fix_at: number | null;
  last_notice_at: number | null;
  notification_id: string | null;
  updated_at: number;
};

export type StationaryRideReminderState = {
  ride_id: string;
  stationary_since: number | null;
  last_fix_at: number | null;
  last_lat: number | null;
  last_lon: number | null;
  sample_count: number;
  snooze_until: number | null;
  suppressed: number;
  reminded_at: number | null;
  notification_id: string | null;
  response_id: string | null;
  updated_at: number;
};

export async function getMovementReminderState(db: Db): Promise<MovementReminderState> {
  const row = await db.getFirstAsync<MovementReminderState>(
    'SELECT * FROM movement_reminder_state WHERE id = 1',
  );
  return row ?? {
    id: 1, moving_since: null, last_fix_at: null, last_notice_at: null,
    notification_id: null, updated_at: 0,
  };
}

export function saveMovementReminderState(
  db: Db,
  state: Omit<MovementReminderState, 'id'>,
): Promise<void> {
  return serialize(async () => {
    await db.runAsync(
      `UPDATE movement_reminder_state
          SET moving_since = ?, last_fix_at = ?, last_notice_at = ?, notification_id = ?, updated_at = ?
        WHERE id = 1`,
      state.moving_since, state.last_fix_at, state.last_notice_at, state.notification_id, state.updated_at,
    );
  });
}

export async function getStationaryRideReminderState(
  db: Db,
  rideId: string,
): Promise<StationaryRideReminderState | null> {
  return db.getFirstAsync<StationaryRideReminderState>(
    'SELECT * FROM stationary_ride_reminders WHERE ride_id = ?', rideId,
  );
}

export function saveStationaryRideReminderState(
  db: Db,
  state: StationaryRideReminderState,
): Promise<void> {
  return serialize(async () => {
    await db.runAsync(
      `INSERT INTO stationary_ride_reminders
         (ride_id, stationary_since, last_fix_at, last_lat, last_lon, sample_count,
          snooze_until, suppressed, reminded_at, notification_id, response_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (ride_id) DO UPDATE SET
         stationary_since = excluded.stationary_since,
         last_fix_at = excluded.last_fix_at,
         last_lat = excluded.last_lat,
         last_lon = excluded.last_lon,
         sample_count = excluded.sample_count,
         snooze_until = excluded.snooze_until,
         suppressed = excluded.suppressed,
         reminded_at = excluded.reminded_at,
         notification_id = excluded.notification_id,
         response_id = excluded.response_id,
         updated_at = excluded.updated_at`,
      state.ride_id, state.stationary_since, state.last_fix_at, state.last_lat, state.last_lon,
      state.sample_count, state.snooze_until, state.suppressed, state.reminded_at,
      state.notification_id, state.response_id, state.updated_at,
    );
  });
}

export function deleteStationaryRideReminderState(db: Db, rideId: string): Promise<void> {
  return serialize(async () => {
    await db.runAsync('DELETE FROM stationary_ride_reminders WHERE ride_id = ?', rideId);
  });
}

export function deleteOtherStationaryRideReminderStates(db: Db, rideId: string): Promise<void> {
  return serialize(async () => {
    await db.runAsync('DELETE FROM stationary_ride_reminders WHERE ride_id <> ?', rideId);
  });
}
