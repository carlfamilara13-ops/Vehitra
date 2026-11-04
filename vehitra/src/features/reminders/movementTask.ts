// Registered from index.ts before the app mounts, just like the active ride task.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { getDb } from '../../data/local/db';
import { getActiveRideId } from '../../data/local/ridesStore';
import { getAppSettings } from '../../data/local/settingsStore';
import { getMovementReminderState, saveMovementReminderState } from '../../data/local/rideReminderStore';
import { createNotificationsAdapter } from './notifications';
import { evaluateMovementFix } from './movementDetection';
import { MOVEMENT_TASK_NAME, stopMovementMonitor } from './movementMonitor';

TaskManager.defineTask(MOVEMENT_TASK_NAME, async ({ data, error }) => {
  try {
    const db = await getDb();
    if (error) {
      await stopMovementMonitor();
      return;
    }
    const [settings, activeRideId] = await Promise.all([
      getAppSettings(db),
      getActiveRideId(db),
    ]);
    if (activeRideId || settings.notifications_enabled !== 1 || settings.movement_reminders_enabled !== 1) {
      await stopMovementMonitor();
      const state = await getMovementReminderState(db);
      await saveMovementReminderState(db, { ...state, moving_since: null, updated_at: Date.now() });
      return;
    }

    const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
    if (locations.length === 0) return;
    const adapter = createNotificationsAdapter();
    let stored = await getMovementReminderState(db);
    for (const location of [...locations].sort((a, b) => a.timestamp - b.timestamp)) {
      const decision = evaluateMovementFix(
        {
          movingSince: stored.moving_since,
          lastFixAt: stored.last_fix_at,
          lastNoticeAt: stored.last_notice_at,
        },
        {
          timestamp: location.timestamp,
          accuracy: location.coords.accuracy ?? null,
          speed: location.coords.speed ?? null,
        },
        false,
      );
      stored = {
        ...stored,
        moving_since: decision.state.movingSince,
        last_fix_at: decision.state.lastFixAt,
        last_notice_at: decision.state.lastNoticeAt,
        updated_at: location.timestamp,
      };
      if (decision.shouldNotify && adapter.available) {
        const id = await adapter.schedule({
          title: "Looks like you're on the move",
          body: 'Start ride tracking to record this trip.',
          fireAt: Math.max(Date.now(), location.timestamp),
          data: { type: 'movement_reminder' },
        });
        if (id) stored.notification_id = id;
        else stored.last_notice_at = decision.state.lastNoticeAt === location.timestamp
          ? null
          : decision.state.lastNoticeAt;
      }
      await saveMovementReminderState(db, stored);
    }
  } catch {
    // A reminder failure must never stop the location task or affect recorded rides.
  }
});
