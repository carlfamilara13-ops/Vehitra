import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import {
  createVehicle,
  getActiveVehicle,
  getVehicle,
  setActiveVehicle,
  softDeleteVehicle,
  VehicleNotFoundError,
} from './vehicleStore';
import { saveDriverProfile, getDriverProfile } from './driverProfileStore';
import {
  getVehicleDocument,
  listVehicleDocuments,
  saveVehicleDocument,
  VehicleDocumentValidationError,
} from './vehicleDocumentStore';
import type { Db } from './types';

const T0 = Date.UTC(2026, 10, 2, 1, 0, 0);

async function seedVehicles(db: Db): Promise<void> {
  await createVehicle(db, { id: 'v1', vehicle_type: 'motorcycle', nickname: 'Daily' }, T0);
  await createVehicle(db, { id: 'v2', vehicle_type: 'car', nickname: 'Weekend' }, T0 + 1);
}

describe('vehicle document store', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
  });

  it('migration 13 adds the vehicle_documents table without touching user data', async () => {
    const old = createNodeSqliteDb();
    const before = MIGRATIONS.filter((m) => m.version <= 12);
    assert.equal(await migrate(old, before), 12);
    await createVehicle(old, { id: 'old-vehicle', vehicle_type: 'motorcycle', plate: 'OLD-1' }, T0);
    await saveDriverProfile(
      old,
      {
        fullName: 'Old Driver',
        nationality: '',
        sex: '',
        dateOfBirth: '',
        weightKg: '',
        heightM: '',
        address: '',
        licenseNumber: '',
        expirationDate: '',
        agencyCode: '',
        bloodType: '',
        eyeColor: '',
        licenseCodes: '',
        conditions: '',
        portraitUri: null,
      },
      T0,
    );

    assert.equal(await migrate(old, MIGRATIONS), 13);
    const table = await old.getFirstAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vehicle_documents'`,
    );
    assert.equal(table?.name, 'vehicle_documents');
    assert.equal((await getVehicle(old, 'old-vehicle'))?.plate, 'OLD-1');
    assert.equal((await getDriverProfile(old))?.full_name, 'Old Driver');

    const saved = await saveVehicleDocument(
      old,
      { id: 'doc-after-upgrade', vehicleId: 'old-vehicle', kind: 'or', imageUri: 'file:///or.jpg' },
      T0 + 10,
    );
    assert.equal(saved.kind, 'or');
  });

  it('stores OR and CR independently for the same vehicle', async () => {
    await seedVehicles(db);
    const or = await saveVehicleDocument(
      db,
      { id: 'or-1', vehicleId: 'v1', kind: 'or', imageUri: 'file:///v1-or.jpg' },
      T0,
    );
    const cr = await saveVehicleDocument(
      db,
      { id: 'cr-1', vehicleId: 'v1', kind: 'cr', imageUri: 'file:///v1-cr.jpg' },
      T0 + 1,
    );

    assert.equal(or.image_uri, 'file:///v1-or.jpg');
    assert.equal(cr.image_uri, 'file:///v1-cr.jpg');
    assert.equal((await getVehicleDocument(db, 'v1', 'or'))?.image_uri, 'file:///v1-or.jpg');
    assert.equal((await getVehicleDocument(db, 'v1', 'cr'))?.image_uri, 'file:///v1-cr.jpg');
    assert.equal((await listVehicleDocuments(db, 'v1')).length, 2);
  });

  it('keeps each vehicle on its own OR/CR records', async () => {
    await seedVehicles(db);
    await saveVehicleDocument(
      db,
      { id: 'v1-or', vehicleId: 'v1', kind: 'or', imageUri: 'file:///v1-or.jpg' },
      T0,
    );
    await saveVehicleDocument(
      db,
      { id: 'v2-or', vehicleId: 'v2', kind: 'or', imageUri: 'file:///v2-or.jpg' },
      T0,
    );

    assert.equal((await getVehicleDocument(db, 'v1', 'or'))?.image_uri, 'file:///v1-or.jpg');
    assert.equal((await getVehicleDocument(db, 'v2', 'or'))?.image_uri, 'file:///v2-or.jpg');
    assert.deepEqual(
      (await listVehicleDocuments(db, 'v1')).map((row) => row.image_uri),
      ['file:///v1-or.jpg'],
    );
  });

  it('replaces one kind in place without duplicating or touching the other', async () => {
    await seedVehicles(db);
    const or = await saveVehicleDocument(
      db,
      { id: 'or-old', vehicleId: 'v1', kind: 'or', imageUri: 'file:///old-or.jpg' },
      T0,
    );
    await saveVehicleDocument(
      db,
      { id: 'cr-1', vehicleId: 'v1', kind: 'cr', imageUri: 'file:///cr.jpg' },
      T0,
    );

    const replaced = await saveVehicleDocument(
      db,
      { id: 'or-new', vehicleId: 'v1', kind: 'or', imageUri: 'file:///new-or.jpg' },
      T0 + 1000,
    );

    assert.equal(replaced.image_uri, 'file:///new-or.jpg');
    assert.equal(replaced.id, or.id);
    assert.equal(replaced.created_at, T0);
    assert.equal(replaced.updated_at, T0 + 1000);
    assert.equal((await getVehicleDocument(db, 'v1', 'cr'))?.image_uri, 'file:///cr.jpg');

    const rows = await listVehicleDocuments(db, 'v1');
    assert.equal(rows.length, 2);
    assert.equal(rows.filter((row) => row.kind === 'or').length, 1);
  });

  it('loading the active vehicle returns only that vehicle’s photos', async () => {
    await seedVehicles(db);
    await saveVehicleDocument(
      db,
      { id: 'v1-or', vehicleId: 'v1', kind: 'or', imageUri: 'file:///v1-or.jpg' },
      T0,
    );
    await saveVehicleDocument(
      db,
      { id: 'v2-cr', vehicleId: 'v2', kind: 'cr', imageUri: 'file:///v2-cr.jpg' },
      T0,
    );

    await setActiveVehicle(db, 'v2');
    const active = await getActiveVehicle(db);
    assert.equal(active?.id, 'v2');
    assert.deepEqual(
      (await listVehicleDocuments(db, active!.id)).map((row) => row.image_uri),
      ['file:///v2-cr.jpg'],
    );
  });

  it('switching the active vehicle swaps both OR and CR with no leak', async () => {
    await seedVehicles(db);
    for (const [vehicleId, prefix] of [['v1', 'v1'], ['v2', 'v2']] as const) {
      await saveVehicleDocument(
        db,
        { id: `${prefix}-or`, vehicleId, kind: 'or', imageUri: `file:///${prefix}-or.jpg` },
        T0,
      );
      await saveVehicleDocument(
        db,
        { id: `${prefix}-cr`, vehicleId, kind: 'cr', imageUri: `file:///${prefix}-cr.jpg` },
        T0,
      );
    }

    await setActiveVehicle(db, 'v1');
    const first = await getActiveVehicle(db);
    assert.deepEqual(
      (await listVehicleDocuments(db, first!.id)).map((doc) => doc.image_uri),
      ['file:///v1-cr.jpg', 'file:///v1-or.jpg'],
    );

    await setActiveVehicle(db, 'v2');
    const second = await getActiveVehicle(db);
    assert.deepEqual(
      (await listVehicleDocuments(db, second!.id)).map((doc) => doc.image_uri),
      ['file:///v2-cr.jpg', 'file:///v2-or.jpg'],
    );
  });

  it('a vehicle with no documents reads empty while another has both', async () => {
    await seedVehicles(db);
    await saveVehicleDocument(
      db,
      { id: 'v1-or', vehicleId: 'v1', kind: 'or', imageUri: 'file:///v1-or.jpg' },
      T0,
    );
    await saveVehicleDocument(
      db,
      { id: 'v1-cr', vehicleId: 'v1', kind: 'cr', imageUri: 'file:///v1-cr.jpg' },
      T0,
    );

    await setActiveVehicle(db, 'v2');
    const active = await getActiveVehicle(db);
    assert.equal(active?.id, 'v2');
    assert.deepEqual(await listVehicleDocuments(db, active!.id), []);
    assert.equal((await listVehicleDocuments(db, 'v1')).length, 2);
  });

  it('replacing one vehicle’s OR leaves the other vehicle’s OR and CR untouched', async () => {
    await seedVehicles(db);
    await saveVehicleDocument(
      db,
      { id: 'v1-or', vehicleId: 'v1', kind: 'or', imageUri: 'file:///v1-or-old.jpg' },
      T0,
    );
    await saveVehicleDocument(
      db,
      { id: 'v2-or', vehicleId: 'v2', kind: 'or', imageUri: 'file:///v2-or.jpg' },
      T0,
    );
    await saveVehicleDocument(
      db,
      { id: 'v2-cr', vehicleId: 'v2', kind: 'cr', imageUri: 'file:///v2-cr.jpg' },
      T0,
    );

    await saveVehicleDocument(
      db,
      { id: 'v1-or-new', vehicleId: 'v1', kind: 'or', imageUri: 'file:///v1-or-new.jpg' },
      T0 + 1000,
    );

    assert.equal((await getVehicleDocument(db, 'v1', 'or'))?.image_uri, 'file:///v1-or-new.jpg');
    assert.equal((await getVehicleDocument(db, 'v2', 'or'))?.image_uri, 'file:///v2-or.jpg');
    assert.equal((await getVehicleDocument(db, 'v2', 'cr'))?.image_uri, 'file:///v2-cr.jpg');
    assert.deepEqual(
      (await listVehicleDocuments(db, 'v2')).map((doc) => doc.image_uri),
      ['file:///v2-cr.jpg', 'file:///v2-or.jpg'],
    );
  });

  it('rejects a missing or soft-deleted vehicle without writing a record', async () => {
    await createVehicle(db, { id: 'gone', vehicle_type: 'car' }, T0);
    await softDeleteVehicle(db, 'gone', T0 + 1);

    await assert.rejects(
      () =>
        saveVehicleDocument(
          db,
          { id: 'ghost', vehicleId: 'missing', kind: 'or', imageUri: 'file:///x.jpg' },
          T0,
        ),
      (error: unknown) => error instanceof VehicleNotFoundError,
    );
    await assert.rejects(
      () =>
        saveVehicleDocument(
          db,
          { id: 'deleted', vehicleId: 'gone', kind: 'or', imageUri: 'file:///x.jpg' },
          T0 + 2,
        ),
      (error: unknown) => error instanceof VehicleNotFoundError,
    );

    const count = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM vehicle_documents');
    assert.equal(count?.n, 0);
  });

  it('validates the kind and image URI before writing', async () => {
    await seedVehicles(db);
    await assert.rejects(
      () =>
        saveVehicleDocument(
          db,
          { id: 'bad', vehicleId: 'v1', kind: 'x' as never, imageUri: 'file:///x.jpg' },
          T0,
        ),
      (error: unknown) => error instanceof VehicleDocumentValidationError,
    );
    await assert.rejects(
      () =>
        saveVehicleDocument(
          db,
          { id: 'bad', vehicleId: 'v1', kind: 'or', imageUri: '  ' },
          T0,
        ),
      (error: unknown) => error instanceof VehicleDocumentValidationError,
    );
    assert.equal((await listVehicleDocuments(db, 'v1')).length, 0);
  });

  it('soft-deleting a vehicle leaves its document records in place for a later restore', async () => {
    await seedVehicles(db);
    await saveVehicleDocument(
      db,
      { id: 'v1-or', vehicleId: 'v1', kind: 'or', imageUri: 'file:///v1-or.jpg' },
      T0,
    );

    await softDeleteVehicle(db, 'v1', T0 + 1);
    assert.equal(await getVehicle(db, 'v1'), null);
    assert.equal((await getVehicleDocument(db, 'v1', 'or'))?.image_uri, 'file:///v1-or.jpg');
  });
});
