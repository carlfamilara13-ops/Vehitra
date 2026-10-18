import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import { createRide, getActiveRideId, getRide } from './ridesStore';
import {
  createVehicle, getActiveVehicle, getActiveVehicleId, getVehicle, listVehicles, setActiveVehicle,
  setVehicleOdometer, softDeleteVehicle, updateVehicle, validateVehicleInput, vehicleDisplayName,
  VehicleNotFoundError, VehicleValidationError, type VehicleRow,
} from './vehicleStore';
import { listMileageEntries } from './mileageStore';
import { listServiceEvents } from './serviceStore';
import { listInstalls } from './installStore';
import type { Db } from './types';

const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);

async function count(db: Db, sql: string, ...params: (string | number)[]): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(sql, ...params);
  return row?.n ?? 0;
}

describe('vehicleStore (local garage)', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
  });

  it('migration 3 adds the vehicles table', async () => {
    const v3 = createNodeSqliteDb();
    assert.equal(await migrate(v3, MIGRATIONS.slice(0, 3)), 3);
    assert.equal(await count(v3, `SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'vehicles'`), 1);
  });

  it('migration 3 upgrades a version-2 database with rides in place, without touching the ride', async () => {
    const old = createNodeSqliteDb();
    await migrate(old, [MIGRATIONS[0], MIGRATIONS[1]]);
    await old.runAsync(
      `INSERT INTO rides (id, started_at, status, point_count, distance_m, client_updated_at)
       VALUES ('existing', ?, 'finished', 7, 123, ?)`,
      T0, T0,
    );

    assert.equal(await migrate(old, MIGRATIONS.slice(0, 3)), 3);
    const ride = await getRide(old, 'existing');
    assert.equal(ride?.distance_m, 123);
    assert.equal(ride?.point_count, 7);

    // and once fully migrated, the current store can store vehicles
    await migrate(old, MIGRATIONS);
    await createVehicle(old, { id: 'v1', vehicle_type: 'car' }, T0);
    assert.equal((await listVehicles(old)).length, 1);
  });

  it('creates a minimal (generic) vehicle: only the type is required, optional fields become NULL', async () => {
    const v = await createVehicle(db, { id: 'a', vehicle_type: 'motorcycle', nickname: '  ' }, T0);
    assert.equal(v.vehicle_type, 'motorcycle');
    assert.equal(v.nickname, null);
    assert.equal(v.brand, null);
    assert.equal(v.model, null);
    assert.equal(v.model_year, null);
    assert.equal(v.plate, null);
    assert.equal(v.odometer_km, null);
    assert.equal(v.deleted_at, null);
    assert.equal(v.sync_status, 'pending');
    assert.equal(v.created_at, T0);
    assert.equal(v.updated_at, T0);
    assert.equal(v.client_updated_at, T0);
  });

  it('stores and trims all optional fields', async () => {
    const v = await createVehicle(
      db,
      {
        id: 'b',
        vehicle_type: 'car',
        brand: '  Toyota ',
        model: 'Vios',
        nickname: 'Daily',
        model_year: 2019,
        plate: ' abc 123 ',
        odometer_km: 42150.5,
      },
      T0,
    );
    assert.equal(v.brand, 'Toyota');
    assert.equal(v.nickname, 'Daily');
    assert.equal(v.plate, 'abc 123');
    assert.equal(v.model_year, 2019);
    assert.equal(v.odometer_km, 42150.5);
  });

  it('rejects invalid input (bad type, year, odometer, over-long plate)', async () => {
    assert.deepEqual(validateVehicleInput({ vehicle_type: 'spaceship' }), ['Choose a vehicle type.']);
    assert.ok(validateVehicleInput({ vehicle_type: 'car', model_year: 1500 }).length === 1);
    assert.ok(validateVehicleInput({ vehicle_type: 'car', model_year: 2019.5 }).length === 1);
    assert.ok(validateVehicleInput({ vehicle_type: 'car', odometer_km: -1 }).length === 1);
    assert.ok(validateVehicleInput({ vehicle_type: 'car', plate: 'x'.repeat(21) }).length === 1);
    assert.deepEqual(validateVehicleInput({ vehicle_type: 'car' }), []);

    await assert.rejects(
      () => createVehicle(db, { id: 'bad', vehicle_type: 'spaceship' }, T0),
      (e: unknown) => e instanceof VehicleValidationError,
    );
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM vehicles'), 0);
  });

  it('updates a vehicle, bumps sync metadata, and returns null for an unknown id', async () => {
    await createVehicle(db, { id: 'c', vehicle_type: 'car', nickname: 'Old' }, T0);
    const updated = await updateVehicle(db, 'c', { vehicle_type: 'truck', nickname: 'New', model_year: 2020 }, T0 + 5000);
    assert.equal(updated?.vehicle_type, 'truck');
    assert.equal(updated?.nickname, 'New');
    assert.equal(updated?.model_year, 2020);
    assert.equal(updated?.updated_at, T0 + 5000);
    assert.equal(updated?.client_updated_at, T0 + 5000);
    assert.equal(updated?.created_at, T0);
    assert.equal(await updateVehicle(db, 'missing', { vehicle_type: 'car' }, T0), null);
  });

  it('soft delete hides the vehicle and keeps it out of the active slot', async () => {
    await createVehicle(db, { id: 'd', vehicle_type: 'van' }, T0);
    await setActiveVehicle(db, 'd');
    assert.equal(await getActiveVehicleId(db), 'd');

    assert.equal(await softDeleteVehicle(db, 'd', T0 + 1), true);
    assert.equal(await softDeleteVehicle(db, 'd', T0 + 2), false);
    assert.deepEqual(await listVehicles(db), []);
    assert.equal(await getVehicle(db, 'd'), null);
    assert.equal(await getActiveVehicleId(db), null);
    assert.equal(await getActiveVehicle(db), null);
  });

  it('persists the active vehicle and rejects an unknown one', async () => {
    await createVehicle(db, { id: 'e1', vehicle_type: 'car' }, T0);
    await createVehicle(db, { id: 'e2', vehicle_type: 'bicycle' }, T0);
    assert.equal(await getActiveVehicleId(db), null);

    await setActiveVehicle(db, 'e2');
    assert.equal(await getActiveVehicleId(db), 'e2');
    assert.equal((await getActiveVehicle(db))?.id, 'e2');

    await assert.rejects(
      () => setActiveVehicle(db, 'ghost'),
      (e: unknown) => e instanceof VehicleNotFoundError,
    );
    assert.equal(await getActiveVehicleId(db), 'e2');

    await setActiveVehicle(db, null);
    assert.equal(await getActiveVehicleId(db), null);
  });

  it('lists vehicles in creation order and does not touch existing rides', async () => {
    await db.runAsync(
      `INSERT INTO rides (id, started_at, status, point_count, distance_m, client_updated_at)
       VALUES ('r1', ?, 'finished', 3, 55, ?)`,
      T0, T0,
    );
    await createVehicle(db, { id: 'z', vehicle_type: 'car' }, T0);
    await createVehicle(db, { id: 'y', vehicle_type: 'car' }, T0 + 1000);

    assert.deepEqual((await listVehicles(db)).map((v) => v.id), ['z', 'y']);
    assert.equal((await getRide(db, 'r1'))?.distance_m, 55);
    assert.equal(await getActiveRideId(db), null);
  });

  it('getActiveVehicle resolves the active vehicle, or null when unset, missing, or deleted', async () => {
    await createVehicle(db, { id: 'a1', vehicle_type: 'car' }, T0);
    assert.equal(await getActiveVehicle(db), null);

    await setActiveVehicle(db, 'a1');
    assert.equal((await getActiveVehicle(db))?.id, 'a1');

    // A dangling pointer (row missing or soft-deleted) resolves to null, so a stale selection
    // can never be attached to a new ride.
    await db.runAsync(`INSERT OR REPLACE INTO meta (key, value) VALUES ('active_vehicle', 'ghost')`);
    assert.equal(await getActiveVehicle(db), null);

    await db.runAsync(`UPDATE vehicles SET deleted_at = ? WHERE id = 'a1'`, T0 + 1);
    await db.runAsync(`INSERT OR REPLACE INTO meta (key, value) VALUES ('active_vehicle', 'a1')`);
    assert.equal(await getActiveVehicle(db), null);
  });

  it('deleting the active vehicle keeps the vehicle id on an already-created ride', async () => {
    await createVehicle(db, { id: 'v1', vehicle_type: 'car' }, T0);
    await setActiveVehicle(db, 'v1');
    await createRide(db, 'ride-1', T0, 'v1');

    assert.equal(await softDeleteVehicle(db, 'v1', T0 + 1), true);
    assert.equal((await getRide(db, 'ride-1'))?.user_vehicle_id, 'v1');
    assert.equal(await getVehicle(db, 'v1'), null);
    assert.equal(await getActiveVehicle(db), null);
  });

  it('vehicleDisplayName prefers nickname, then brand/model, then the type label', () => {
    const base: VehicleRow = {
      id: 'v', vehicle_type: 'car', brand: null, model: null, nickname: null, model_year: null,
      plate: null, odometer_km: null, catalog_model_slug: null, catalog_version: null,
      created_at: 0, updated_at: 0, client_updated_at: 0,
      deleted_at: null, sync_status: 'pending', server_updated_at: null,
    };
    assert.equal(vehicleDisplayName({ ...base, nickname: 'Daily', brand: 'Toyota', model: 'Vios' }), 'Daily');
    assert.equal(vehicleDisplayName({ ...base, brand: 'Toyota', model: 'Vios' }), 'Toyota Vios');
    assert.equal(vehicleDisplayName({ ...base, brand: 'Toyota' }), 'Toyota');
    assert.equal(vehicleDisplayName({ ...base, model: 'Vios' }), 'Vios');
    assert.equal(vehicleDisplayName({ ...base, vehicle_type: 'bicycle' }), 'Bicycle');
    // a placeholder name is never blank: an unknown type falls back to the raw code
    assert.equal(vehicleDisplayName({ ...base, vehicle_type: 'hoverboard' }), 'hoverboard');
  });

  it('snapshots the active vehicle name onto a new ride and keeps it after the vehicle is deleted', async () => {
    await createVehicle(db, { id: 'v1', vehicle_type: 'car', brand: 'Toyota', model: 'Vios' }, T0);
    await setActiveVehicle(db, 'v1');

    const activeVehicle = await getActiveVehicle(db);
    await createRide(
      db, 'ride-1', T0,
      activeVehicle?.id ?? null,
      activeVehicle ? vehicleDisplayName(activeVehicle) : null,
    );
    assert.equal((await getRide(db, 'ride-1'))?.vehicle_name, 'Toyota Vios');

    // The snapshot survives the vehicle leaving the garage.
    await softDeleteVehicle(db, 'v1', T0 + 1);
    assert.equal((await getRide(db, 'ride-1'))?.vehicle_name, 'Toyota Vios');
    assert.equal(await getActiveVehicle(db), null);
  });

  it('an unassigned ride (no active vehicle) has a null vehicle name', async () => {
    assert.equal(await getActiveVehicle(db), null);
    await createRide(db, 'ride-none', T0, null, null);
    assert.equal((await getRide(db, 'ride-none'))?.vehicle_name, null);
  });

  it('sets the odometer reading with full precision and bumps sync metadata', async () => {
    await createVehicle(db, { id: 'odo', vehicle_type: 'car', nickname: 'Keep' }, T0);
    const updated = await setVehicleOdometer(db, 'odo', 12500.5, T0 + 9000);
    assert.equal(updated?.odometer_km, 12500.5);
    assert.equal(updated?.nickname, 'Keep'); // profile is untouched
    assert.equal(updated?.updated_at, T0 + 9000);
    assert.equal(updated?.client_updated_at, T0 + 9000);
    assert.equal(updated?.created_at, T0);
    assert.equal(updated?.sync_status, 'pending');
    assert.equal(await setVehicleOdometer(db, 'missing', 10, T0), null);
  });

  it('rejects an invalid odometer and writes nothing', async () => {
    await createVehicle(db, { id: 'odo', vehicle_type: 'car' }, T0);
    await assert.rejects(
      () => setVehicleOdometer(db, 'odo', -1, T0 + 1),
      (e: unknown) => e instanceof VehicleValidationError,
    );
    await assert.rejects(
      () => setVehicleOdometer(db, 'odo', Number.NaN, T0 + 2),
      (e: unknown) => e instanceof VehicleValidationError,
    );
    assert.equal((await getVehicle(db, 'odo'))?.odometer_km, null);
  });

  it('recording an odometer never writes ledger, service or install rows', async () => {
    await createVehicle(db, { id: 'odo', vehicle_type: 'motorcycle' }, T0);
    await setVehicleOdometer(db, 'odo', 4000, T0 + 1);
    assert.equal((await listMileageEntries(db, 'odo')).length, 0);
    assert.equal((await listServiceEvents(db, 'odo')).length, 0);
    assert.equal((await listInstalls(db, 'odo')).length, 0);
  });
});
