import { PROCESS } from '../../config/tracking';
import { getActiveRideId } from '../../data/local/ridesStore';
import {
  deleteOtherStationaryRideReminderStates,
  getStationaryRideReminderState,
  saveStationaryRideReminderState,
  type StationaryRideReminderState,
} from '../../data/local/rideReminderStore';
import { getAppSettings } from '../../data/local/settingsStore';
import type { Db } from '../../data/local/types';
import type { Fix } from '../../domain/ride/types';
import { createNotificationsAdapter, STATIONARY_RIDE_CATEGORY } from './notifications';
import {
  indicatesMovement,
  isReliableStationaryFix,
  shouldSendStationaryReminder,
  STATIONARY_REMINDER_POLICY,
} from './stationaryDetection';

export const STATIONARY_RIDE_POLICY = STATIONARY_REMINDER_POLICY;

const emptyState = (rideId: string, now: number): StationaryRideReminderState => ({
  ride_id: rideId,
  stationary_since: null,
  last_fix_at: null,
  last_lat: null,
  last_lon: null,
  sample_count: 0,
  snooze_until: null,
  suppressed: 0,
  reminded_at: null,
  notification_id: null,
  response_id: null,
  updated_at: now,
});

async function clearVisibleReminder(state: StationaryRideReminderState): Promise<void> {
  if (!state.notification_id) return;
  const adapter = createNotificationsAdapter();
  await adapter.cancel(state.notification_id);
  await adapter.dismiss?.(state.notification_id);
}

// Called only from the ride location task. It observes GPS fixes but never changes ride status,
// pauses updates, or alters the tracker’s filtered-distance calculation.
export async function processStationaryRideFixes(db: Db, fixes: readonly Fix[]): Promise<void> {
  if (fixes.length === 0) return;
  const settings = await getAppSettings(db);
  const rideId = await getActiveRideId(db);
  if (!rideId) return;
  if (settings.notifications_enabled !== 1 || settings.stationary_ride_reminders_enabled !== 1) {
    const existing = await getStationaryRideReminderState(db, rideId);
    if (existing?.notification_id) {
      const adapter = createNotificationsAdapter();
      await adapter.cancel(existing.notification_id);
      await adapter.dismiss?.(existing.notification_id);
      existing.notification_id = null;
      existing.reminded_at = null;
      existing.updated_at = Date.now();
      await saveStationaryRideReminderState(db, existing);
    }
    return;
  }

  await deleteOtherStationaryRideReminderStates(db, rideId);
  const initial = await getStationaryRideReminderState(db, rideId);
  let state = initial ?? emptyState(rideId, fixes[0].timestamp);
  const adapter = createNotificationsAdapter();

  for (const fix of [...fixes].sort((a, b) => a.timestamp - b.timestamp)) {
    if (state.suppressed === 1) {
      state.last_fix_at = Math.max(state.last_fix_at ?? 0, fix.timestamp);
      state.updated_at = fix.timestamp;
      continue;
    }
    if (state.last_fix_at != null && fix.timestamp <= state.last_fix_at) continue;

    if (!isReliableStationaryFix(fix)) {
      await clearVisibleReminder(state);
      state = {
        ...state,
        stationary_since: null,
        last_fix_at: fix.timestamp,
        sample_count: 0,
        snooze_until: null,
        reminded_at: null,
        notification_id: null,
        updated_at: fix.timestamp,
      };
      continue;
    }

    const gap = state.last_fix_at == null ? null : fix.timestamp - state.last_fix_at;
    const moving = indicatesMovement(fix, state.last_lat == null || state.last_lon == null
      ? null
      : { lat: state.last_lat, lon: state.last_lon });
    if (moving || (gap != null && gap > STATIONARY_RIDE_POLICY.maxFixGapMs)) {
      await clearVisibleReminder(state);
      state = {
        ...state,
        stationary_since: moving ? null : fix.timestamp,
        last_fix_at: fix.timestamp,
        last_lat: fix.lat,
        last_lon: fix.lon,
        sample_count: moving ? 0 : 1,
        snooze_until: null,
        reminded_at: null,
        notification_id: null,
        updated_at: fix.timestamp,
      };
      continue;
    }

    state = {
      ...state,
      stationary_since: state.stationary_since ?? fix.timestamp,
      last_fix_at: fix.timestamp,
      last_lat: fix.lat,
      last_lon: fix.lon,
      sample_count: state.sample_count + 1,
      updated_at: fix.timestamp,
    };
    const shouldRemind = shouldSendStationaryReminder({
      now: fix.timestamp,
      stationarySince: state.stationary_since,
      sampleCount: state.sample_count,
      snoozeUntil: state.snooze_until,
      alreadyReminded: state.reminded_at != null,
    });
    if (shouldRemind && adapter.available) {
      const id = await adapter.schedule({
        title: 'Still on your ride?',
        body: "Your vehicle hasn't moved for a while. Are you taking a break or finished your ride?",
        fireAt: Math.max(Date.now(), fix.timestamp),
        categoryIdentifier: STATIONARY_RIDE_CATEGORY,
        data: { type: 'stationary_ride', rideId },
      });
      if (id) {
        state.reminded_at = fix.timestamp;
        state.notification_id = id;
      }
    }
  }

  await saveStationaryRideReminderState(db, state);
}

export async function handleStationaryRideAction(
  db: Db,
  rideId: string,
  actionIdentifier: string,
  responseId: string,
  now = Date.now(),
): Promise<void> {
  const state = await getStationaryRideReminderState(db, rideId);
  if (!state || state.response_id === responseId) return;
  const adapter = createNotificationsAdapter();
  await adapter.dismiss?.(responseId);
  state.response_id = responseId;
  state.notification_id = null;
  if (actionIdentifier === 'stationary-remind-later') {
    state.snooze_until = now + STATIONARY_REMINDER_POLICY.snoozeMs;
    state.reminded_at = null;
  } else if (actionIdentifier === 'stationary-stop-for-ride') {
    state.suppressed = 1;
    state.snooze_until = null;
    state.reminded_at = now;
  }
  state.updated_at = now;
  await saveStationaryRideReminderState(db, state);
}
