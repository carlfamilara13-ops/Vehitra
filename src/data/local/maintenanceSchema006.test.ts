import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import { createVehicle } from './vehicleStore';
import { insertMileageEntry, rideMileageEntryId, voidMileageEntry } from './mileageStore';
import { insertServiceEvent, voidServiceEvent } from './serviceStore';
import { closeInstall, openInstall, replaceInstall } from './installStore';
import { upsertOverride } from './overrideStore';
import { MaintenanceValidationError } from './maintenanceErrors';
import type { Db } from './types';

const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);

async function count(db: Db, sql: string, ...params: (string | number | null)[]): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(sql, ...params);
  return row?.n ?? 0;
}

describe('migration 006: maintenance invariants', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
    await createVehicle(db, { id: 'v1', vehicle_type: 'motorcycle' }, T0);
  });

  it('brings a fresh DB to the latest version and preserves store operations', async () => {
    const latest = Math.max(...MIGRATIONS.map((m) => m.version));
    assert.equal((await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version, latest);
    // can write service replace (baseline-eligible)
    const s = await insertServiceEvent(db, { id: 's1', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'replace', performed_at: T0 });
    assert.equal(s.action, 'replace');
    // voiding preserves insert-only semantics
    const v = await voidServiceEvent(db, 's1', 's1v', T0 + 1);
    assert.equal(v.action, 'void');
  });

  it('upgrades from v5 to v6 without rewriting existing maintenance rows', async () => {
    const old = createNodeSqliteDb();
    await migrate(old, MIGRATIONS.slice(0, 5));
    // Seed a vehicle in raw v5 space (the current createVehicle targets the latest schema);
    // everything else below goes through the real stores so the rows survive the v6 upgrade.
    await old.runAsync(
      `INSERT INTO vehicles (id, vehicle_type, created_at, updated_at, client_updated_at, sync_status)
       VALUES ('v1', 'motorcycle', ?, ?, ?, 'pending')`,
      T0, T0, T0,
    );
    await insertMileageEntry(old, { id: 'm1', user_vehicle_id: 'v1', kind: 'ride', source: 'gps', ride_id: 'm1', applied_km: 10 }, T0 + 1000);
    await insertServiceEvent(old, { id: 's1', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'replace', performed_at: T0 });
    await openInstall(old, { id: 'p1', user_vehicle_id: 'v1', component_code: 'engine_oil', installed_at: T0 });
    await upsertOverride(old, { id: 'o1', user_vehicle_id: 'v1', component_code: 'engine_oil', interval_km: 1500 });
    const mCount = await count(old, 'SELECT COUNT(*) AS n FROM mileage_entries');
    const sCount = await count(old, 'SELECT COUNT(*) AS n FROM service_events');
    const pCount = await count(old, 'SELECT COUNT(*) AS n FROM part_installs');
    const oCount = await count(old, 'SELECT COUNT(*) AS n FROM component_overrides');
    const latest = Math.max(...MIGRATIONS.map((m) => m.version));
    assert.equal(await migrate(old, MIGRATIONS), latest);
    assert.equal(await count(old, 'SELECT COUNT(*) AS n FROM mileage_entries'), mCount);
    assert.equal(await count(old, 'SELECT COUNT(*) AS n FROM service_events'), sCount);
    assert.equal(await count(old, 'SELECT COUNT(*) AS n FROM part_installs'), pCount);
    assert.equal(await count(old, 'SELECT COUNT(*) AS n FROM component_overrides'), oCount);
  });

  it('ride mileage row is accepted with odo_reading_after NULL (intentional cloud-discrepancy exception)', async () => {
    await insertMileageEntry(db, {
      id: rideMileageEntryId('r1'),
      user_vehicle_id: 'v1',
      kind: 'ride',
      source: 'gps',
      ride_id: 'r1',
      applied_km: 5,
      gps_distance_m: 5000,
      odo_reading_after: null,
    }, T0 + 1000);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM mileage_entries WHERE kind = 'ride'"), 1);
  });

  it('void mileage row must carry no applied_km/odo/offset and reference a real non-void entry', async () => {
    await insertMileageEntry(db, { id: 'm1', user_vehicle_id: 'v1', kind: 'ride', source: 'gps', ride_id: 'm1', applied_km: 10 }, T0 + 1000);
    // Raw inserts bypass the store, so these exercise the migration-006 triggers directly.
    await assert.rejects(() =>
      db.runAsync(
        `INSERT INTO mileage_entries (id, user_vehicle_id, kind, source, applied_km, voids_entry_id, client_created_at, created_at)
         VALUES ('mv', 'v1', 'void', 'gps', 1, 'm1', ?, ?)`,
        T0 + 2000, T0 + 2000,
      ),
    );
    await assert.rejects(() =>
      db.runAsync(
        `INSERT INTO mileage_entries (id, user_vehicle_id, kind, source, applied_km, voids_entry_id, client_created_at, created_at)
         VALUES ('mv2', 'v1', 'void', 'gps', 0, 'ghost', ?, ?)`,
        T0 + 2000, T0 + 2000,
      ),
    );
    const v = await voidMileageEntry(db, 'm1', 'mv3', T0 + 3000);
    assert.equal(v.kind, 'void');
  });

  it('dashboard reading with no added distance must carry a flag', async () => {
    // The flag requirement is a DB-level (trigger) invariant, so it raises a plain SQLite error.
    await assert.rejects(() =>
      insertMileageEntry(db, { id: 'd1', user_vehicle_id: 'v1', kind: 'dashboard_reading', source: 'dashboard_reading', applied_km: 0 }, T0 + 1000),
    );
    const ok = await insertMileageEntry(db, { id: 'd2', user_vehicle_id: 'v1', kind: 'dashboard_reading', source: 'dashboard_reading', applied_km: 0, flags: ['calibration'] }, T0 + 1000);
    assert.equal(ok.flags, JSON.stringify(['calibration']));
  });

  it('initial cannot apply distance; odometer_replacement cannot have applied_km nonzero', async () => {
    // kind-specific applied_km rules are DB-level (trigger) invariants.
    await assert.rejects(() =>
      insertMileageEntry(db, { id: 'i1', user_vehicle_id: 'v1', kind: 'initial', source: 'initial', applied_km: 5 }, T0 + 1000),
    );
    await assert.rejects(() =>
      insertMileageEntry(db, { id: 'o1', user_vehicle_id: 'v1', kind: 'odometer_replacement', source: 'manual_adjustment', applied_km: 5 }, T0 + 1000),
    );
  });

  it('void event must reference same vehicle and component and be non-void', async () => {
    const s = await insertServiceEvent(db, { id: 's1', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'replace', performed_at: T0 });
    // void is fine via store
    const v = await voidServiceEvent(db, 's1', 's1v', T0 + 1);
    assert.equal(v.action, 'void');
    // attempting to void a void should be rejected by store
    await assert.rejects(() => voidServiceEvent(db, 's1v', 's1vv', T0 + 2), (e: unknown) => e instanceof MaintenanceValidationError);
  });

  it('baseline service event must be estimated', async () => {
    await assert.rejects(() =>
      insertServiceEvent(db, { id: 'b1', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'baseline', performed_at: T0, estimated: false } as any),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
    const b = await insertServiceEvent(db, { id: 'b2', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'baseline', performed_at: T0, estimated: true });
    assert.equal(b.estimated, 1);
  });

  it('closed part install remains immutable and open can be closed/replaced with valid ordering', async () => {
    const p1 = await openInstall(db, { id: 'p1', user_vehicle_id: 'v1', component_code: 'engine_oil', installed_at: T0 });
    const closed = await closeInstall(db, p1.id, { removed_at: T0 + 5 }, T0 + 5);
    assert.equal(closed?.removed_at, T0 + 5);
    // cannot close again
    await assert.rejects(() => closeInstall(db, p1.id, { removed_at: T0 + 10 }, T0 + 10), (e: unknown) => e instanceof MaintenanceValidationError);

    // open a new install, then a replacement whose removal time precedes it must be rejected
    await openInstall(db, { id: 'p2', user_vehicle_id: 'v1', component_code: 'engine_oil', installed_at: T0 + 20 });
    await assert.rejects(
      () => replaceInstall(db, { id: 'p3', user_vehicle_id: 'v1', component_code: 'engine_oil', installed_at: T0 + 10 }, T0 + 10),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
    // a correctly ordered replacement closes p2 and opens p4
    const p4 = await replaceInstall(db, { id: 'p4', user_vehicle_id: 'v1', component_code: 'engine_oil', installed_at: T0 + 30 }, T0 + 30);
    assert.equal(p4.id, 'p4');
    // the replacement closed p2, so it can no longer be closed
    await assert.rejects(() => closeInstall(db, 'p2', { removed_at: T0 + 40 }, T0 + 40), (e: unknown) => e instanceof MaintenanceValidationError);
  });

  it('override interval must be greater than zero', async () => {
    await assert.rejects(() =>
      upsertOverride(db, { id: 'o1', user_vehicle_id: 'v1', component_code: 'engine_oil', interval_km: 0 }),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
    await assert.rejects(() =>
      upsertOverride(db, { id: 'o2', user_vehicle_id: 'v1', component_code: 'engine_oil', interval_km: -1 }),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
  });

  it('existing store operations still work after migration', async () => {
    await insertServiceEvent(db, { id: 's1', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'replace', performed_at: T0 });
    const rideId = rideMileageEntryId('rX');
    await insertMileageEntry(db, { id: rideId, user_vehicle_id: 'v1', kind: 'ride', source: 'gps', ride_id: 'rX', applied_km: 1.5 }, T0 + 1000);
    const ov = await upsertOverride(db, { id: 'o1', user_vehicle_id: 'v1', component_code: 'engine_oil', interval_km: 2000 });
    assert.equal(ov.interval_km, 2000);
    const p = await openInstall(db, { id: 'p1', user_vehicle_id: 'v1', component_code: 'engine_oil', installed_at: T0 });
    assert.equal(p.component_code, 'engine_oil');
  });
});