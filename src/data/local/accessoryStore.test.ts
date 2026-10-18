import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import { createVehicle } from './vehicleStore';
import {
  createAccessory,
  getAccessory,
  listAccessories,
  softDeleteAccessory,
  updateAccessory,
  validateAccessoryInput,
} from './accessoryStore';
import { MaintenanceNotFoundError, MaintenanceValidationError } from './maintenanceErrors';
import type { Db } from './types';

const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);

describe('accessory store', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
    await createVehicle(db, { id: 'v1', vehicle_type: 'motorcycle' }, T0);
  });

  it('creates, reads, lists and edits an accessory', async () => {
    const row = await createAccessory(
      db,
      { id: 'a1', user_vehicle_id: 'v1', name: ' Top box ', brand: 'GIVI', model: 'E450' },
      T0,
    );
    assert.equal(row.name, 'Top box'); // trimmed
    assert.equal(row.brand, 'GIVI');
    assert.equal(row.sync_status, 'pending');
    assert.equal((await getAccessory(db, 'a1'))?.id, 'a1');

    const created = row.created_at;
    const edited = await updateAccessory(
      db,
      'a1',
      { id: 'a1', user_vehicle_id: 'v1', name: 'Top box XL', notes: '33 L' },
      T0 + 1000,
    );
    assert.equal(edited?.name, 'Top box XL');
    assert.equal(edited?.created_at, created); // created_at preserved
    assert.equal(edited?.updated_at, T0 + 1000);
    assert.equal(edited?.sync_status, 'pending');
    assert.equal((await listAccessories(db, 'v1')).length, 1);
  });

  it('lists live rows ordered by name', async () => {
    await createAccessory(db, { id: 'b', user_vehicle_id: 'v1', name: 'Phone mount' }, T0);
    await createAccessory(db, { id: 'a', user_vehicle_id: 'v1', name: 'Crash bars' }, T0);
    await createAccessory(db, { id: 'c', user_vehicle_id: 'v1', name: 'Bag' }, T0);
    const names = (await listAccessories(db, 'v1')).map((r) => r.name);
    assert.deepEqual(names, ['Bag', 'Crash bars', 'Phone mount']);
  });

  it('soft-deletes: hidden from list/get, editing a deleted row returns null', async () => {
    await createAccessory(db, { id: 'a1', user_vehicle_id: 'v1', name: 'Lamp' }, T0);
    assert.equal(await softDeleteAccessory(db, 'a1', T0 + 1), true);
    assert.equal(await softDeleteAccessory(db, 'a1', T0 + 2), false); // already gone
    assert.equal(await getAccessory(db, 'a1'), null);
    assert.equal((await listAccessories(db, 'v1')).length, 0);
    assert.equal(
      await updateAccessory(db, 'a1', { id: 'a1', user_vehicle_id: 'v1', name: 'Lamp 2' }, T0 + 3),
      null,
    );
    // the row itself survives as history
    const raw = await db.getFirstAsync<{ deleted_at: number | null }>(
      'SELECT deleted_at FROM accessories WHERE id = ?',
      'a1',
    );
    assert.equal(raw?.deleted_at, T0 + 1);
  });

  it('rejects invalid input before touching the database', async () => {
    assert.ok(validateAccessoryInput({ id: 'x', user_vehicle_id: 'v1', name: '' }).length === 1);
    assert.ok(
      validateAccessoryInput({ id: 'x', user_vehicle_id: 'v1', name: 'n'.repeat(61) }).length === 1,
    );
    assert.ok(
      validateAccessoryInput({ id: 'x', user_vehicle_id: 'v1', name: 'ok', installed_at: Date.now() + 5 * 86_400_000 })
        .length === 1,
    );
    await assert.rejects(
      () => createAccessory(db, { id: 'bad', user_vehicle_id: 'v1', name: '' }),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
    assert.equal((await listAccessories(db, 'v1')).length, 0);
  });

  it('refuses accessories for a missing vehicle', async () => {
    await assert.rejects(
      () => createAccessory(db, { id: 'a', user_vehicle_id: 'ghost', name: 'Lamp' }),
      (e: unknown) => e instanceof MaintenanceNotFoundError,
    );
  });

  it('never touches maintenance evaluation data (descriptive only)', async () => {
    await createAccessory(db, { id: 'a1', user_vehicle_id: 'v1', name: 'Lamp', installed_at: T0 }, T0);
    const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(accessories)`);
    const names = cols.map((c) => c.name);
    // no interval / usage / status columns can exist on an accessory
    for (const forbidden of ['interval_km', 'used_km', 'status', 'warn_remaining_pct']) {
      assert.ok(!names.includes(forbidden), `${forbidden} must not exist on accessories`);
    }
  });
});
