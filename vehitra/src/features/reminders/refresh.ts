import { getDb } from '../../data/local/db';
import { createNotificationsAdapter } from './notifications';
import { syncReminders, type SyncResult } from './scheduler';

// Reconcile local plans without opening a permission prompt during ordinary app startup or ride stop.
export async function refreshLocalReminders(): Promise<SyncResult> {
  const db = await getDb();
  return syncReminders(db, createNotificationsAdapter(), Date.now(), false);
}
