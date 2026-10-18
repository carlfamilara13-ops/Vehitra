import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import type { Db } from './types';

const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);

async function count(db: Db, sql: string, ...params: (string | number)[]): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(sql, ...params);
  return row?.n ?? 0;
}

async function tableExists(db: Db, name: string): Promise<boolean> {
  return (await count(db, `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`, name)) === 1;
}

describe('migration 005: maintenance schema', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
  });

  it('adds the four maintenance tables and is idempotent', async () => {
    const latestM = Math.max(...MIGRATIONS.map((m) => m.version));
    for (const t of ['mileage_entries', 'service_events', 'part_installs', 'component_overrides']) {
      assert.equal(await tableExists(db, t), true, t);
    }
    assert.equal(await migrate(db, MIGRATIONS), latestM);
  });

  it('upgrades a version-4 database with rides and vehicles in place, without touching them', async () => {
    const old = createNodeSqliteDb();
    const latestM = Math.max(...MIGRATIONS.map((m) => m.version));
    assert.equal(await migrate(old, MIGRATIONS.slice(0, 4)), 4);
    await old.runAsync(
      `INSERT INTO rides (id, started_at, status, point_count, distance_m, client_updated_at)
       VALUES ('existing', ?, 'finished', 7, 123, ?)`,
      T0, T0,
    );
    await old.runAsync(
      `INSERT INTO vehicles (id, vehicle_type, odometer_km, created_at, updated_at, client_updated_at)
       VALUES ('v1', 'motorcycle', 1234, ?, ?, ?)`,
      T0, T0, T0,
    );

    assert.equal(await migrate(old, MIGRATIONS), latestM);
    const ride = await old.getFirstAsync<{ distance_m: number; point_count: number }>(
      'SELECT distance_m, point_count FROM rides WHERE id = ?', 'existing');
    assert.equal(ride?.distance_m, 123);
    assert.equal(ride?.point_count, 7);
    const veh = await old.getFirstAsync<{ odometer_km: number }>('SELECT odometer_km FROM vehicles WHERE id = ?', 'v1');
    assert.equal(veh?.odometer_km, 1234);
    assert.equal(await tableExists(old, 'mileage_entries'), true);
  });

  it('rejects UPDATE and DELETE on mileage_entries (insert-only)', async () => {
    await db.runAsync(
      `INSERT INTO mileage_entries (id, user_vehicle_id, kind, source, ride_id, applied_km, client_created_at, created_at)
       VALUES ('m1', 'v1', 'ride', 'gps', 'm1', 10, ?, ?)`,
      T0, T0,
    );
    await assert.rejects(() => db.runAsync(`UPDATE mileage_entries SET applied_km = 999 WHERE id = 'm1'`));
    await assert.rejects(() => db.runAsync(`DELETE FROM mileage_entries WHERE id = 'm1'`));
    assert.equal(await count(db, `SELECT COUNT(*) AS n FROM mileage_entries`), 1);
  });

  it('rejects UPDATE and DELETE on service_events (insert-only)', async () => {
    await db.runAsync(
      `INSERT INTO service_events (id, user_vehicle_id, component_code, action, performed_at, client_created_at, created_at)
       VALUES ('s1', 'v1', 'engine_oil', 'service', ?, ?, ?)`,
      T0, T0, T0,
    );
    await assert.rejects(() => db.runAsync(`UPDATE service_events SET action = 'replace' WHERE id = 's1'`));
    await assert.rejects(() => db.runAsync(`DELETE FROM service_events WHERE id = 's1'`));
    assert.equal(await count(db, `SELECT COUNT(*) AS n FROM service_events`), 1);
  });

  it('allows at most one OPEN part install per (vehicle, component)', async () => {
    const open = (id: string) =>
      db.runAsync(
        `INSERT INTO part_installs (id, user_vehicle_id, component_code, installed_at, client_updated_at, created_at, updated_at)
         VALUES (?, 'v1', 'engine_oil', ?, ?, ?, ?)`,
        id, T0, T0, T0, T0,
      );
    await open('p1');
    await assert.rejects(() => open('p2')); // second open row for the same component
    // a different component may be open at the same time
    await db.runAsync(
      `INSERT INTO part_installs (id, user_vehicle_id, component_code, installed_at, client_updated_at, created_at, updated_at)
       VALUES ('p3', 'v1', 'front_tire', ?, ?, ?, ?)`,
      T0, T0, T0, T0,
    );
    assert.equal(await count(db, `SELECT COUNT(*) AS n FROM part_installs WHERE removed_at IS NULL`), 2);
  });

  it('freezes a closed install: closing once is allowed, editing after is not, deleting never is', async () => {
    await db.runAsync(
      `INSERT INTO part_installs (id, user_vehicle_id, component_code, installed_at, client_updated_at, created_at, updated_at)
       VALUES ('p1', 'v1', 'engine_oil', ?, ?, ?, ?)`,
      T0, T0, T0, T0,
    );
    await db.runAsync(`UPDATE part_installs SET removed_at = ?, removal_odo = 500 WHERE id = 'p1'`, T0 + 1);
    assert.equal(await count(db, `SELECT COUNT(*) AS n FROM part_installs WHERE id = 'p1' AND removed_at IS NOT NULL`), 1);
    await assert.rejects(() => db.runAsync(`UPDATE part_installs SET removal_odo = 999 WHERE id = 'p1'`));
    await assert.rejects(() => db.runAsync(`DELETE FROM part_installs WHERE id = 'p1'`));
    // once closed, a new install for the same component may be opened
    await db.runAsync(
      `INSERT INTO part_installs (id, user_vehicle_id, component_code, installed_at, client_updated_at, created_at, updated_at)
       VALUES ('p2', 'v1', 'engine_oil', ?, ?, ?, ?)`,
      T0 + 2, T0 + 2, T0 + 2, T0 + 2,
    );
    assert.equal(await count(db, `SELECT COUNT(*) AS n FROM part_installs`), 2);
  });

  it('keeps one override row per (vehicle, component) and allows edit/delete', async () => {
    await db.runAsync(
      `INSERT INTO component_overrides (id, user_vehicle_id, component_code, interval_km, client_updated_at, created_at, updated_at)
       VALUES ('o1', 'v1', 'engine_oil', 2000, ?, ?, ?)`,
      T0, T0, T0,
    );
    await assert.rejects(() =>
      db.runAsync(
        `INSERT INTO component_overrides (id, user_vehicle_id, component_code, interval_km, client_updated_at, created_at, updated_at)
         VALUES ('o2', 'v1', 'engine_oil', 3000, ?, ?, ?)`,
        T0, T0, T0,
      ),
    );
    await db.runAsync(`UPDATE component_overrides SET interval_km = 2500 WHERE id = 'o1'`);
    assert.equal((await db.getFirstAsync<{ interval_km: number }>(`SELECT interval_km FROM component_overrides WHERE id = 'o1'`))?.interval_km, 2500);
    await db.runAsync(`DELETE FROM component_overrides WHERE id = 'o1'`);
    assert.equal(await count(db, `SELECT COUNT(*) AS n FROM component_overrides`), 0);
  });

  it('rejects a negative applied_km via CHECK', async () => {
    await assert.rejects(() =>
      db.runAsync(
        `INSERT INTO mileage_entries (id, user_vehicle_id, kind, source, ride_id, applied_km, client_created_at, created_at)
         VALUES ('bad', 'v1', 'ride', 'gps', 'bad', -1, ?, ?)`,
        T0, T0,
      ),
    );
  });
});
