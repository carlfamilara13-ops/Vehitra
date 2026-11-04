import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import { createVehicle, softDeleteVehicle, VehicleNotFoundError } from './vehicleStore';
import { getVehicleDocument, saveVehicleDocument } from './vehicleDocumentStore';
import {
  replaceVehicleDocumentImage,
  type VehicleDocumentImageStorage,
} from './vehicleDocumentService';
import type { Db } from './types';

const T0 = Date.UTC(2026, 10, 2, 2, 0, 0);

type FakeStorage = VehicleDocumentImageStorage & {
  failPersist: boolean;
  persisted: string[];
  removed: string[];
};

function fakeStorage(): FakeStorage {
  let next = 0;
  const storage: FakeStorage = {
    failPersist: false,
    persisted: [],
    removed: [],
    persist: async (_sourceUri, _fileName) => {
      if (storage.failPersist) throw new Error('copy failed');
      next += 1;
      const uri = `file:///vehicle-documents/new-${next}.jpg`;
      storage.persisted.push(uri);
      return uri;
    },
    remove: (uri) => {
      if (uri) storage.removed.push(uri);
    },
  };
  return storage;
}

describe('replaceVehicleDocumentImage', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
    await createVehicle(db, { id: 'v1', vehicle_type: 'motorcycle' }, T0);
  });

  it('copies first, updates the row, then removes the previous app-owned image', async () => {
    await saveVehicleDocument(
      db,
      { id: 'or-old', vehicleId: 'v1', kind: 'or', imageUri: 'file:///vehicle-documents/old-or.jpg' },
      T0,
    );
    const storage = fakeStorage();

    const saved = await replaceVehicleDocumentImage(
      db,
      storage,
      {
        id: 'or-new',
        vehicleId: 'v1',
        kind: 'or',
        sourceUri: 'file:///cache/picked.jpg',
        fileName: 'picked.jpg',
      },
      T0 + 1000,
    );

    assert.equal(saved.id, 'or-old');
    assert.equal(saved.image_uri, 'file:///vehicle-documents/new-1.jpg');
    assert.deepEqual(storage.persisted, ['file:///vehicle-documents/new-1.jpg']);
    assert.deepEqual(storage.removed, ['file:///vehicle-documents/old-or.jpg']);
  });

  it('a failed database write keeps the previous image and removes the new file', async () => {
    await saveVehicleDocument(
      db,
      { id: 'or-old', vehicleId: 'v1', kind: 'or', imageUri: 'file:///vehicle-documents/old-or.jpg' },
      T0,
    );
    const storage = fakeStorage();
    const failingDb: Db = {
      ...db,
      runAsync: async (sql, ...params) => {
        if (sql.includes('INSERT INTO vehicle_documents')) throw new Error('disk full');
        return db.runAsync(sql, ...params);
      },
    };

    await assert.rejects(
      () =>
        replaceVehicleDocumentImage(
          failingDb,
          storage,
          { id: 'or-new', vehicleId: 'v1', kind: 'or', sourceUri: 'file:///cache/picked.jpg' },
          T0 + 1000,
        ),
      /disk full/,
    );

    assert.equal(
      (await getVehicleDocument(db, 'v1', 'or'))?.image_uri,
      'file:///vehicle-documents/old-or.jpg',
    );
    assert.deepEqual(storage.removed, ['file:///vehicle-documents/new-1.jpg']);
  });

  it('a failed image copy leaves the previous record untouched', async () => {
    await saveVehicleDocument(
      db,
      { id: 'cr-old', vehicleId: 'v1', kind: 'cr', imageUri: 'file:///vehicle-documents/old-cr.jpg' },
      T0,
    );
    const storage = fakeStorage();
    storage.failPersist = true;

    await assert.rejects(
      () =>
        replaceVehicleDocumentImage(
          db,
          storage,
          { id: 'cr-new', vehicleId: 'v1', kind: 'cr', sourceUri: 'file:///cache/picked.jpg' },
          T0 + 1000,
        ),
      /copy failed/,
    );

    assert.equal(
      (await getVehicleDocument(db, 'v1', 'cr'))?.image_uri,
      'file:///vehicle-documents/old-cr.jpg',
    );
    assert.deepEqual(storage.removed, []);
  });

  it('replacing one kind never removes the other kind’s image', async () => {
    await saveVehicleDocument(
      db,
      { id: 'or-1', vehicleId: 'v1', kind: 'or', imageUri: 'file:///vehicle-documents/or.jpg' },
      T0,
    );
    await saveVehicleDocument(
      db,
      { id: 'cr-old', vehicleId: 'v1', kind: 'cr', imageUri: 'file:///vehicle-documents/old-cr.jpg' },
      T0,
    );
    const storage = fakeStorage();

    await replaceVehicleDocumentImage(
      db,
      storage,
      { id: 'cr-new', vehicleId: 'v1', kind: 'cr', sourceUri: 'file:///cache/picked.jpg' },
      T0 + 1000,
    );

    assert.equal((await getVehicleDocument(db, 'v1', 'or'))?.image_uri, 'file:///vehicle-documents/or.jpg');
    assert.deepEqual(storage.removed, ['file:///vehicle-documents/old-cr.jpg']);
  });

  it('does not leave the copied file behind when the vehicle disappears', async () => {
    await createVehicle(db, { id: 'gone', vehicle_type: 'car' }, T0);
    await softDeleteVehicle(db, 'gone', T0 + 1);
    const storage = fakeStorage();

    await assert.rejects(
      () =>
        replaceVehicleDocumentImage(
          db,
          storage,
          { id: 'new', vehicleId: 'gone', kind: 'or', sourceUri: 'file:///cache/picked.jpg' },
          T0 + 2,
        ),
      (error: unknown) => error instanceof VehicleNotFoundError,
    );

    assert.deepEqual(storage.removed, ['file:///vehicle-documents/new-1.jpg']);
  });
});
