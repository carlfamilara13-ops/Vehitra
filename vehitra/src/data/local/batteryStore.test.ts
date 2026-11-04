import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import { createVehicle } from './vehicleStore';
import { getBatteryState, listBatteryStates, recordBatteryUse } from './batteryStore';
import { MaintenanceNotFoundError, MaintenanceValidationError } from './maintenanceErrors';
import { batteryIdleDays, batteryIdleLevel } from '../../domain/battery/idle';
import type { Db } from './types';

const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);
const DAY = 86_400_000;

describe('battery state store', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
    await createVehicle(db, { id: 'v1', vehicle_type: 'motorcycle' }, T0);
    await createVehicle(db, { id: 'v2', vehicle_type: 'car' }, T0);
  });

  it('records battery use and reads it back', async () => {
    const row = await recordBatteryUse(db, 'v1', T0, 'Charged yesterday', T0);
    assert.equal(row.user_vehicle_id, 'v1');
    assert.equal(row.last_active_at, T0);
    assert.equal(row.note, 'Charged yesterday');
    assert.equal(row.sync_status, 'pending');
    assert.equal((await getBatteryState(db, 'v1'))?.last_active_at, T0);
  });

  it('upserts: recording again corrects the timestamp instead of duplicating', async () => {
    await recordBatteryUse(db, 'v1', T0, null, T0);
    await recordBatteryUse(db, 'v1', T0 + 5 * DAY, null, T0 + 5 * DAY);
    const all = await listBatteryStates(db);
    assert.equal(all.length, 1);
    assert.equal(all[0].last_active_at, T0 + 5 * DAY);
    // a corrected timestamp immediately changes derived idle level   nothing stale can remain
    const idle = batteryIdleDays(all[0].last_active_at, T0 + 5 * DAY);
    assert.equal(batteryIdleLevel(idle), 'ok');
  });

  it('lists every vehicle state in vehicle order', async () => {
    await recordBatteryUse(db, 'v2', T0, null, T0);
    await recordBatteryUse(db, 'v1', T0, null, T0);
    const rows = await listBatteryStates(db);
    assert.deepEqual(rows.map((r) => r.user_vehicle_id), ['v1', 'v2']);
  });

  it('rejects future, non-finite and missing-vehicle use dates', async () => {
    await assert.rejects(
      () => recordBatteryUse(db, 'v1', T0 + 3 * DAY, null, T0), // 3 days in the future
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
    await assert.rejects(
      () => recordBatteryUse(db, 'v1', Number.NaN, null, T0),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
    await assert.rejects(
      () => recordBatteryUse(db, 'ghost', T0, null, T0),
      (e: unknown) => e instanceof MaintenanceNotFoundError,
    );
    assert.equal(await getBatteryState(db, 'v1'), null);
    assert.equal((await listBatteryStates(db)).length, 0);
  });

  it('allows a one-day clock-skew grace but rejects anything further', async () => {
    await recordBatteryUse(db, 'v1', T0 + DAY, null, T0); // exactly +1 day: tolerated
    assert.equal((await getBatteryState(db, 'v1'))?.last_active_at, T0 + DAY);
    await assert.rejects(
      () => recordBatteryUse(db, 'v1', T0 + DAY + 1, null, T0),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
  });

  it('trims notes and enforces the 200-character cap', async () => {
    const row = await recordBatteryUse(db, 'v1', T0, '  boosted  ', T0);
    assert.equal(row.note, 'boosted');
    await assert.rejects(
      () => recordBatteryUse(db, 'v1', T0, 'x'.repeat(201), T0),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
  });
});
