// Background location task. MUST be imported from index.ts before the app registers: when Android restarts
// the JS runtime for a location event, this module is what runs.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { TASK_NAME } from '../../../config/tracking';
import { getDb } from '../../../data/local/db';
import { applyBatch, logEvent } from '../../../data/local/ridesStore';
import type { Fix } from '../../../domain/ride/types';

export function toFix(l: Location.LocationObject): Fix {
  return {
    timestamp: l.timestamp,
    lat: l.coords.latitude,
    lon: l.coords.longitude,
    accuracy: l.coords.accuracy ?? null,
    speed: l.coords.speed ?? null,
    altitude: l.coords.altitude ?? null,
    heading: l.coords.heading ?? null,
  };
}

TaskManager.defineTask(TASK_NAME, async ({ data, error }) => {
  try {
    const db = await getDb();
    if (error) {
      await logEvent(db, 'task_error', error.message);
      return;
    }
    const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
    if (!locations || locations.length === 0) return;
    const result = await applyBatch(db, locations.map(toFix));
    if (result === null && (await Location.hasStartedLocationUpdatesAsync(TASK_NAME))) {
      // No ride is recording but fixes keep arriving: do not leave the foreground service running for nothing.
      await Location.stopLocationUpdatesAsync(TASK_NAME);
      await logEvent(db, 'orphan_tracking_stopped', '');
    }
  } catch (e) {
    try {
      await logEvent(await getDb(), 'store_error', String(e));
    } catch {
      /* nothing more we can do */
    }
  }
});
