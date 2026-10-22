import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import type { Db } from './types';

// Migration compatibility and seed integrity. These run on disposable databases only —
// never the device's file. Two guarantees are under test:
// 1. A database created before the Stage A migrations (v6) upgrades to v10 with all user
//    rows intact and the new columns/tables present (forward-only, no data rewrite).
// 2. Re-running migrate() is a no-op: the bundled catalog seed must not duplicate.

const counts = async (db: Db) => {
  const q = async (sql: string) => {
    const row = await db.getFirstAsync<{ c: number }>(sql);
    return row?.c ?? -1;
  };
  return {
    brands: await q('SELECT COUNT(*) c FROM catalog_brands'),
    models: await q('SELECT COUNT(*) c FROM catalog_models'),
    components: await q('SELECT COUNT(*) c FROM catalog_model_components'),
    vehicles: await q('SELECT COUNT(*) c FROM vehicles'),
    rides: await q('SELECT COUNT(*) c FROM rides'),
  };
};

describe('migrations', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  beforeEach(() => {
    db = createNodeSqliteDb();
  });

  it('initializes a fresh database to v10 with the seeded catalog', async () => {
    const version = await migrate(db, MIGRATIONS);
    assert.equal(version, 10);
    const pragma = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    assert.equal(pragma?.user_version, 10);

    const c = await counts(db);
    // Verified against the migration source: 5 brands, 21 models (14 branded + 7 generic),
    // 13 draft component rows.
    assert.equal(c.brands, 5);
    assert.equal(c.models, 21);
    assert.equal(c.components, 13);

    // Referential integrity of the seed (no FKs in this table pair, so it is asserted here).
    const orphanModels = await db.getAllAsync(
      'SELECT slug FROM catalog_models WHERE brand_slug IS NOT NULL AND brand_slug NOT IN (SELECT slug FROM catalog_brands)',
    );
    assert.deepEqual(orphanModels, []);
    const orphanComps = await db.getAllAsync(
      'SELECT model_slug FROM catalog_model_components WHERE model_slug NOT IN (SELECT slug FROM catalog_models)',
    );
    assert.deepEqual(orphanComps, []);
  });

  it('re-running migrate is a no-op and never duplicates the seed', async () => {
    await migrate(db, MIGRATIONS);
    const before = await counts(db);
    const second = await migrate(db, MIGRATIONS);
    assert.equal(second, 10);
    const after = await counts(db);
    assert.deepEqual(after, before);
  });

  it('applies migrations in version order even from a shuffled list', async () => {
    const shuffled = [...MIGRATIONS].reverse();
    const version = await migrate(db, shuffled);
    assert.equal(version, 10);
    const c = await counts(db);
    assert.equal(c.models, 21);
  });

  it('upgrades a pre-catalog (v6) database with user data intact', async () => {
    // A device as it existed before Stage A: no accessories, deadlines or catalog columns.
    const legacy = MIGRATIONS.filter((m) => m.version <= 6);
    const legacyVersion = await migrate(db, legacy);
    assert.equal(legacyVersion, 6);

    await db.runAsync(
      `INSERT INTO vehicles (id, vehicle_type, brand, model, nickname, model_year, plate,
                             odometer_km, created_at, updated_at, client_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'v-legacy', 'motorcycle', 'Honda', 'TMX 125', 'Old bike', 2020, 'ABC-1',
      8123.4, 1000, 2000, 3000,
    );
    await db.runAsync(
      `INSERT INTO rides (id, user_vehicle_id, started_at, ended_at, status, point_count,
                          distance_m, client_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'r-legacy', 'v-legacy', 1000, 2000, 'finished', 12, 4567.8, 2000,
    );
    await db.runAsync('INSERT INTO meta (key, value) VALUES (?, ?)', 'active_vehicle', 'v-legacy');

    const version = await migrate(db, MIGRATIONS);
    assert.equal(version, 10);

    const veh = await db.getFirstAsync<{
      nickname: string | null;
      odometer_km: number | null;
      catalog_model_slug: string | null;
      catalog_version: number | null;
      sync_status: string;
    }>('SELECT * FROM vehicles WHERE id = ?', 'v-legacy');
    assert.ok(veh);
    assert.equal(veh.nickname, 'Old bike');
    assert.equal(veh.odometer_km, 8123.4);
    assert.equal(veh.catalog_model_slug, null);
    assert.equal(veh.catalog_version, null);
    assert.equal(veh.sync_status, 'pending');

    const ride = await db.getFirstAsync<{ distance_m: number; status: string }>(
      'SELECT distance_m, status FROM rides WHERE id = ?',
      'r-legacy',
    );
    assert.ok(ride);
    assert.equal(ride.distance_m, 4567.8);
    assert.equal(ride.status, 'finished');

    const meta = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?',
      'active_vehicle',
    );
    assert.equal(meta?.value, 'v-legacy');

    // New tables exist, and the seed arrived without touching user rows.
    const c = await counts(db);
    assert.equal(c.vehicles, 1);
    assert.equal(c.rides, 1);
    assert.equal(c.models, 21);
    assert.equal(c.brands, 5);

    // A legacy vehicle can adopt a catalog link after the upgrade (what the form does).
    await db.runAsync('UPDATE vehicles SET catalog_model_slug = ?, catalog_version = ? WHERE id = ?',
      'honda-tmx-125', 1, 'v-legacy');
    const relinked = await db.getFirstAsync<{ catalog_model_slug: string | null }>(
      'SELECT catalog_model_slug FROM vehicles WHERE id = ?',
      'v-legacy',
    );
    assert.equal(relinked?.catalog_model_slug, 'honda-tmx-125');
  });
});
