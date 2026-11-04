import * as SQLite from 'expo-sqlite';
import { closeAndResetDbConnection, getDb, getNativeDb } from './db';
import { getMeta, setMeta } from './metaStore';

const SNAPSHOT_DATABASE = 'vehitra-sync-recovery.db';
const SNAPSHOT_META_KEY = 'sync_recovery_snapshot_created_at';

// The snapshot remains in the app's private SQLite directory. It contains the entire local
// database, including any raw ride points, and is never sent to the account service.
export async function createSyncRecoverySnapshot(): Promise<number> {
  await getDb();
  const sourceDatabase = getNativeDb();
  const destDatabase = await SQLite.openDatabaseAsync(SNAPSHOT_DATABASE);
  const createdAt = Date.now();
  try {
    await SQLite.backupDatabaseAsync({ sourceDatabase, destDatabase });
    await setMeta(sourceDatabase, SNAPSHOT_META_KEY, String(createdAt));
    return createdAt;
  } finally {
    await destDatabase.closeAsync();
  }
}

export async function hasSyncRecoverySnapshot(): Promise<boolean> {
  const db = await getDb();
  return (await getMeta(db, SNAPSHOT_META_KEY)) !== null;
}

export async function deleteSyncRecoverySnapshot(): Promise<void> {
  const db = await getDb();
  await SQLite.deleteDatabaseAsync(SNAPSHOT_DATABASE);
  await setMeta(db, SNAPSHOT_META_KEY, null);
}

// Restores sync-managed vehicle and reminder rows from the pre-sync copy. Other local history
// stays in place. The caller asks the user to restart so screens reopen the restored connection.
export async function restoreSyncRecoverySnapshot(): Promise<void> {
  const db = await getDb();
  const createdAt = await getMeta(db, SNAPSHOT_META_KEY);
  if (!createdAt) throw new Error('There is no saved sync recovery copy.');
  const snapshotTime = Number(createdAt);
  if (!Number.isSafeInteger(snapshotTime) || snapshotTime < 0) {
    throw new Error('The saved sync recovery copy has invalid metadata.');
  }

  const sourceDatabase = await SQLite.openDatabaseAsync(SNAPSHOT_DATABASE);
  const destDatabase = getNativeDb();
  try {
    const [snapshotVersion, currentVersion] = await Promise.all([
      sourceDatabase.getFirstAsync<{ user_version: number }>('PRAGMA user_version'),
      destDatabase.getFirstAsync<{ user_version: number }>('PRAGMA user_version'),
    ]);
    if (snapshotVersion?.user_version !== currentVersion?.user_version) {
      throw new Error('This recovery copy belongs to a different Vehitra database version.');
    }

    const escapedPath = sourceDatabase.databasePath.replace(/'/g, "''");
    await destDatabase.execAsync("ATTACH DATABASE '" + escapedPath + "' AS sync_recovery");
    try {
      await destDatabase.withTransactionAsync(async () => {
        // Preserve local records created or edited after the snapshot, plus any new cloud
        // vehicle that now has local history attached. Sync itself only changes these tables.
        await destDatabase.runAsync(
          `CREATE TEMP TABLE sync_recovery_keep_vehicles AS
             SELECT * FROM main.vehicles
              WHERE (sync_status = 'pending' AND updated_at > ?)
                 OR (id NOT IN (SELECT id FROM sync_recovery.vehicles) AND (
                   EXISTS (SELECT 1 FROM rides r WHERE r.user_vehicle_id = vehicles.id)
                   OR EXISTS (SELECT 1 FROM mileage_entries m WHERE m.user_vehicle_id = vehicles.id)
                   OR EXISTS (SELECT 1 FROM service_events s WHERE s.user_vehicle_id = vehicles.id)
                   OR EXISTS (SELECT 1 FROM part_installs p WHERE p.user_vehicle_id = vehicles.id)
                   OR EXISTS (SELECT 1 FROM component_overrides c WHERE c.user_vehicle_id = vehicles.id)
                   OR EXISTS (SELECT 1 FROM accessories a WHERE a.user_vehicle_id = vehicles.id)
                   OR EXISTS (SELECT 1 FROM battery_state b WHERE b.user_vehicle_id = vehicles.id)
                   OR EXISTS (SELECT 1 FROM vehicle_documents d WHERE d.user_vehicle_id = vehicles.id)
                 ))`,
          snapshotTime,
        );
        await destDatabase.runAsync(
          `CREATE TEMP TABLE sync_recovery_keep_deadlines AS
             SELECT * FROM main.deadlines
              WHERE (sync_status = 'pending' AND updated_at > ?)
                 OR user_vehicle_id IN (SELECT id FROM sync_recovery_keep_vehicles)`,
          snapshotTime,
        );
        await destDatabase.execAsync(
          `DELETE FROM main.deadlines;
           DELETE FROM main.vehicles;
           INSERT INTO main.vehicles SELECT * FROM sync_recovery.vehicles;
           INSERT OR IGNORE INTO main.vehicles SELECT * FROM sync_recovery_keep_vehicles;
           INSERT INTO main.deadlines SELECT * FROM sync_recovery.deadlines;
           INSERT OR IGNORE INTO main.deadlines SELECT * FROM sync_recovery_keep_deadlines;
           DROP TABLE sync_recovery_keep_deadlines;
           DROP TABLE sync_recovery_keep_vehicles;`,
        );
      });
    } finally {
      await destDatabase.execAsync('DETACH DATABASE sync_recovery');
    }
  } finally {
    await sourceDatabase.closeAsync();
  }

  await closeAndResetDbConnection();
  const restored = await getDb();
  await setMeta(restored, SNAPSHOT_META_KEY, createdAt);
}
