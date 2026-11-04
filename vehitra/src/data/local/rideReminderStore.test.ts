import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import { getAppSettings, updateAppSettings } from './settingsStore';
import { getStationaryRideReminderState, saveStationaryRideReminderState } from './rideReminderStore';
import type { Db } from './types';

describe('tracking reminder persistence', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;
  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
  });

  it('defaults movement monitoring off and stationary reminders on', async () => {
    const settings = await getAppSettings(db);
    assert.equal(settings.movement_reminders_enabled, 0);
    assert.equal(settings.stationary_ride_reminders_enabled, 1);
  });

  it('persists the notification controls and per-ride snooze/suppression state', async () => {
    const settings = await updateAppSettings(db, {
      movement_reminders_enabled: true,
      stationary_ride_reminders_enabled: false,
    });
    assert.equal(settings.movement_reminders_enabled, 1);
    assert.equal(settings.stationary_ride_reminders_enabled, 0);

    await saveStationaryRideReminderState(db, {
      ride_id: 'ride-1', stationary_since: 10, last_fix_at: 20, last_lat: 1, last_lon: 2,
      sample_count: 4, snooze_until: 30, suppressed: 1, reminded_at: null,
      notification_id: null, response_id: null, updated_at: 20,
    });
    assert.equal((await getStationaryRideReminderState(db, 'ride-1'))?.suppressed, 1);
    assert.equal((await getStationaryRideReminderState(db, 'ride-1'))?.snooze_until, 30);
  });
});
