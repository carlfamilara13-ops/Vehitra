import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import {
  DriverProfileValidationError,
  getDriverProfile,
  saveDriverProfile,
} from './driverProfileStore';
import type { DriverProfileInput } from '../../domain/driverProfile/profile';
import type { Db } from './types';

const T0 = Date.UTC(2026, 9, 22, 1, 0, 0);

const input = (overrides: Partial<DriverProfileInput> = {}): DriverProfileInput => ({
  fullName: 'Maria Santos',
  nationality: 'Filipino',
  sex: 'Female',
  dateOfBirth: '1990-05-12',
  weightKg: '65',
  heightM: '1.75',
  address: 'Makati City',
  licenseNumber: 'N01-23-456789',
  expirationDate: '2030-05-12',
  agencyCode: 'NCR',
  bloodType: 'O+',
  eyeColor: 'Brown',
  licenseCodes: 'A, B',
  conditions: 'Corrective lenses',
  portraitUri: 'file:///data/driver-profile/portrait-1.jpg',
  ...overrides,
});

describe('driver profile store', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
  });

  it('returns null on first use', async () => {
    assert.equal(await getDriverProfile(db), null);
  });

  it('saves every field and reloads it across a new read', async () => {
    const saved = await saveDriverProfile(db, input(), T0);
    assert.equal(saved.full_name, 'Maria Santos');
    assert.equal(saved.weight_kg, 65);
    assert.equal(saved.height_m, 1.75);
    assert.equal(saved.portrait_uri, 'file:///data/driver-profile/portrait-1.jpg');
    assert.equal(saved.created_at, T0);
    assert.equal(saved.updated_at, T0);

    const loaded = await getDriverProfile(db);
    assert.deepEqual(
      {
        name: loaded?.full_name,
        address: loaded?.address,
        blood: loaded?.blood_type,
        conditions: loaded?.conditions,
        portrait: loaded?.portrait_uri,
      },
      {
        name: 'Maria Santos',
        address: 'Makati City',
        blood: 'O+',
        conditions: 'Corrective lenses',
        portrait: 'file:///data/driver-profile/portrait-1.jpg',
      },
    );
  });

  it('saves a name-only profile with optional fields null', async () => {
    const saved = await saveDriverProfile(
      db,
      input({
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
      }),
      T0,
    );
    assert.equal(saved.full_name, 'Maria Santos');
    assert.equal(saved.nationality, null);
    assert.equal(saved.date_of_birth, null);
    assert.equal(saved.weight_kg, null);
    assert.equal(saved.height_m, null);
    assert.equal(saved.address, null);
    assert.equal(saved.portrait_uri, null);
  });

  it('updates the single row and preserves created_at', async () => {
    await saveDriverProfile(db, input(), T0);
    const updated = await saveDriverProfile(db, input({ fullName: 'Maria S. Reyes' }), T0 + 1000);
    assert.equal(updated.full_name, 'Maria S. Reyes');
    assert.equal(updated.created_at, T0);
    assert.equal(updated.updated_at, T0 + 1000);
    const count = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM driver_profile');
    assert.equal(count?.n, 1);
  });

  it('does not write invalid input and leaves the previous profile intact', async () => {
    await saveDriverProfile(db, input(), T0);
    await assert.rejects(
      () => saveDriverProfile(db, input({ fullName: ' ', weightKg: '-1' }), T0 + 1),
      (error: unknown) => error instanceof DriverProfileValidationError,
    );
    const loaded = await getDriverProfile(db);
    assert.equal(loaded?.full_name, 'Maria Santos');
    assert.equal(loaded?.weight_kg, 65);
    assert.equal(loaded?.updated_at, T0);
  });

  it('never creates a second row', async () => {
    await saveDriverProfile(db, input(), T0);
    await saveDriverProfile(db, input({ fullName: 'Another Name' }), T0 + 1);
    const count = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM driver_profile');
    assert.equal(count?.n, 1);
  });
});
