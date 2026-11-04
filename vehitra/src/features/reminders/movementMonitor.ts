import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { getActiveRideId } from '../../data/local/ridesStore';
import { getAppSettings } from '../../data/local/settingsStore';
import { getDb } from '../../data/local/db';

export const MOVEMENT_TASK_NAME = 'vehitra-movement-reminder-task';

export async function stopMovementMonitor(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(MOVEMENT_TASK_NAME)) {
      await Location.stopLocationUpdatesAsync(MOVEMENT_TASK_NAME);
    }
  } catch {
    // The ride recorder remains independent; a stale monitor can be retried on app foreground.
  }
}

// Idle movement monitoring is opt-in and Android-only. It runs at a lower rate than ride
// recording and shows an ongoing foreground-service notice while location is being monitored.
export async function syncMovementMonitor(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    await stopMovementMonitor();
    return false;
  }
  const db = await getDb();
  const [settings, activeRideId] = await Promise.all([getAppSettings(db), getActiveRideId(db)]);
  const wantsMonitoring = settings.notifications_enabled === 1 && settings.movement_reminders_enabled === 1;
  if (!wantsMonitoring || activeRideId) {
    await stopMovementMonitor();
    return true;
  }

  const [foreground, background] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
  ]);
  if (foreground.status !== 'granted' || background.status !== 'granted') {
    await stopMovementMonitor();
    return false;
  }
  if (await Location.hasStartedLocationUpdatesAsync(MOVEMENT_TASK_NAME)) return true;

  await Location.startLocationUpdatesAsync(MOVEMENT_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 5_000,
    distanceInterval: 10,
    pausesUpdatesAutomatically: true,
    foregroundService: {
      notificationTitle: 'Vehitra movement reminders',
      notificationBody: 'Location is monitored while idle so Vehitra can remind you to record a ride.',
      notificationColor: '#1E6BFF',
      killServiceOnDestroy: false,
    },
  });
  return true;
}
