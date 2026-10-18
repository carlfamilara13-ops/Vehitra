import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import { createVehicle, softDeleteVehicle } from './vehicleStore';
import {
  insertMileageEntry, listMileageEntries, sumAppliedKmSince, validateMileageEntryInput, voidMileageEntry,
  type LedgerBaseline,
} from './mileageStore';
import { insertServiceEvent, latestServiceEvent, listServiceEvents, voidServiceEvent } from './serviceStore';
import { closeInstall, getInstall, listInstalls, openInstall, replaceInstall } from './installStore';
import { deleteOverride, getOverride, listOverrides, upsertOverride } from './overrideStore';
import { evaluateVehicleMaintenance } from './maintenanceQuery';
import { MaintenanceNotFoundError, MaintenanceValidationError } from './maintenanceErrors';
import type { Db } from './types';

const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);

async function count(db: Db, sql: string): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(sql);
  return row?.n ?? 0;
}

describe('local maintenance stores', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  // A ledger ride entry for the vehicle, recorded at `at` (which becomes client_created_at).
  const addRide = (id: string, km: number, at: number) =>
    insertMileageEntry(db, { id, user_vehicle_id: 'v1', kind: 'ride', source: 'gps', applied_km: km, ride_id: id }, at);

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
    await createVehicle(db, { id: 'v1', vehicle_type: 'motorcycle' }, T0);
  });

  // ---- mileage ledger ---------------------------------------------------------------------------
  it('inserts and lists ledger entries in (client_created_at, id) order', async () => {
    await addRide('m2', 30, T0 + 2000);
    await addRide('m1', 10, T0 + 1000);
    const rows = await listMileageEntries(db, 'v1');
    assert.deepEqual(rows.map((r) => r.id), ['m1', 'm2']);
    assert.equal(rows[0].client_created_at, T0 + 1000);
  });

  it('rejects invalid ledger input and writes nothing', async () => {
    assert.ok(validateMileageEntryInput({ id: 'x', user_vehicle_id: 'v1', kind: 'ride', source: 'gps', applied_km: -1 }).length === 1);
    assert.ok(validateMileageEntryInput({ id: 'x', user_vehicle_id: 'v1', kind: 'void', source: 'gps', applied_km: 0 }).length === 1);
    await assert.rejects(
      () => insertMileageEntry(db, { id: 'bad', user_vehicle_id: 'v1', kind: 'ride', source: 'gps', applied_km: -1 }),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM mileage_entries'), 0);
  });

  it('refuses a ledger write for a missing or deleted vehicle', async () => {
    await assert.rejects(
      () => insertMileageEntry(db, { id: 'm', user_vehicle_id: 'ghost', kind: 'ride', source: 'gps', applied_km: 1 }),
      (e: unknown) => e instanceof MaintenanceNotFoundError,
    );
    await softDeleteVehicle(db, 'v1', T0 + 1);
    await assert.rejects(
      () => insertMileageEntry(db, { id: 'm', user_vehicle_id: 'v1', kind: 'ride', source: 'gps', applied_km: 1 }),
      (e: unknown) => e instanceof MaintenanceNotFoundError,
    );
  });

  it('sums applied_km only after the baseline, excluding voids and voided entries', async () => {
    await addRide('before', 999, T0 - 1000);
    await addRide('a', 20, T0 + 1000);
    await addRide('b', 30, T0 + 2000);
    await addRide('c', 5, T0 + 3000);
    await voidMileageEntry(db, 'c', 'c-void', T0 + 4000);

    const baseline: LedgerBaseline = { at: T0, id: 's1' };
    assert.equal(await sumAppliedKmSince(db, 'v1', baseline), 50); // 20 + 30; 'before' is pre-baseline, 'c' is voided
    assert.equal(await sumAppliedKmSince(db, 'v1', null), 1049); // from the start: includes 'before', excludes voided 'c'
  });

  it('rejects voiding a void or an already-voided entry', async () => {
    await addRide('a', 20, T0 + 1);
    await voidMileageEntry(db, 'a', 'a-void', T0 + 2);
    await assert.rejects(() => voidMileageEntry(db, 'a', 'a-void-2', T0 + 3), (e: unknown) => e instanceof MaintenanceValidationError);
    await assert.rejects(() => voidMileageEntry(db, 'a-void', 'nope', T0 + 4), (e: unknown) => e instanceof MaintenanceValidationError);
  });

  // ---- service events ---------------------------------------------------------------------------
  it('logs service events and finds the latest effective one (ignoring voided/void rows)', async () => {
    await insertServiceEvent(db, { id: 's1', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'service', performed_at: T0 });
    await insertServiceEvent(db, { id: 's2', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'replace', performed_at: T0 + 1000 });
    assert.equal((await latestServiceEvent(db, 'v1', 'engine_oil'))?.id, 's2');

    await voidServiceEvent(db, 's2', 's2-void', T0 + 2000);
    assert.equal((await latestServiceEvent(db, 'v1', 'engine_oil'))?.id, 's1');
    assert.equal((await listServiceEvents(db, 'v1', 'engine_oil')).length, 3);
  });

  it('rejects service events for an unknown component', async () => {
    await assert.rejects(
      () => insertServiceEvent(db, { id: 's', user_vehicle_id: 'v1', component_code: 'ghost_part', action: 'service', performed_at: T0 }),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
  });

  it('rejects an action the component does not allow, but accepts allowed and generic actions', async () => {
    await assert.rejects(
      () => insertServiceEvent(db, { id: 'x', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'clean', performed_at: T0 }),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
    const chain = await insertServiceEvent(db, { id: 'y', user_vehicle_id: 'v1', component_code: 'drive_chain', action: 'clean', performed_at: T0 });
    assert.equal(chain.action, 'clean');
    const generic = await insertServiceEvent(db, { id: 'z', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'service', performed_at: T0 });
    assert.equal(generic.action, 'service');
  });

  it('requires an explicit baseline to be estimated', async () => {
    await assert.rejects(
      () => insertServiceEvent(db, { id: 'b', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'baseline', performed_at: T0 }),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
    const b = await insertServiceEvent(db, { id: 'b2', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'baseline', performed_at: T0, estimated: true });
    assert.equal(b.estimated, 1);
  });

  // ---- part installs ----------------------------------------------------------------------------
  it('opens, closes and lists installs; a closed install cannot be closed again', async () => {
    await openInstall(db, { id: 'p1', user_vehicle_id: 'v1', component_code: 'engine_oil', installed_at: T0, install_odo: 1000 });
    const closed = await closeInstall(db, 'p1', { removed_at: T0 + 5000, removal_odo: 3000 }, T0 + 5000);
    assert.equal(closed?.removed_at, T0 + 5000);
    const again = await closeInstall(db, 'p1', { removed_at: T0 + 6000 }, T0 + 6000).then(() => 'closed-again').catch(() => 'rejected');
    assert.equal(again, 'rejected');
    assert.equal((await listInstalls(db, 'v1', 'engine_oil')).length, 1);
  });

  it('refuses a second open install for the same component and replaces atomically', async () => {
    await openInstall(db, { id: 'p1', user_vehicle_id: 'v1', component_code: 'engine_oil', installed_at: T0 });
    await assert.rejects(
      () => openInstall(db, { id: 'p2', user_vehicle_id: 'v1', component_code: 'engine_oil', installed_at: T0 + 1 }),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
    const newer = await replaceInstall(db, { id: 'p3', user_vehicle_id: 'v1', component_code: 'engine_oil', installed_at: T0 + 2000 }, T0 + 2000);
    assert.equal(newer.id, 'p3');
    assert.equal((await listInstalls(db, 'v1', 'engine_oil')).length, 2);
    assert.equal((await getInstall(db, 'p1'))?.removed_at, T0 + 2000);
  });

  // ---- overrides --------------------------------------------------------------------------------
  it('upserts, updates, lists and deletes one override per component', async () => {
    const a = await upsertOverride(db, { id: 'o1', user_vehicle_id: 'v1', component_code: 'engine_oil', interval_km: 2000 });
    assert.equal(a.interval_km, 2000);
    assert.equal(a.enabled, 1);
    const b = await upsertOverride(db, { id: 'o-ignored', user_vehicle_id: 'v1', component_code: 'engine_oil', interval_km: 3000, enabled: false });
    assert.equal(b.id, 'o1'); // existing id preserved
    assert.equal(b.interval_km, 3000);
    assert.equal(b.enabled, 0);
    assert.equal((await listOverrides(db, 'v1')).length, 1);
    assert.equal(await deleteOverride(db, 'v1', 'engine_oil'), true);
    assert.equal(await deleteOverride(db, 'v1', 'engine_oil'), false);
    assert.equal(await getOverride(db, 'v1', 'engine_oil'), null);
  });

  it('rejects a non-positive override interval and an unknown component', async () => {
    await assert.rejects(
      () => upsertOverride(db, { id: 'o', user_vehicle_id: 'v1', component_code: 'engine_oil', interval_km: 0 }),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
    await assert.rejects(
      () => upsertOverride(db, { id: 'o', user_vehicle_id: 'v1', component_code: 'ghost_part', interval_km: 1000 }),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
  });

  // ---- vehicle maintenance read model -----------------------------------------------------------
  it('returns null for a missing or deleted vehicle', async () => {
    assert.equal(await evaluateVehicleMaintenance(db, 'ghost'), null);
    await softDeleteVehicle(db, 'v1', T0 + 1);
    assert.equal(await evaluateVehicleMaintenance(db, 'v1'), null);
  });

  it('reports motorcycle engine oil as unknown history until a service baseline exists', async () => {
    const m = await evaluateVehicleMaintenance(db, 'v1');
    assert.ok(m);
    const oil = m.items.find((i) => i.componentCode === 'engine_oil');
    assert.ok(oil);
    assert.equal(oil.evaluation.status, 'unknown');
    assert.equal(oil.evaluation.reason, 'no_service_history');
    assert.equal(oil.evaluation.rule?.source, 'estimate'); // 1,500 km local estimate
  });

  it('computes good / due soon / overdue from the ledger since the service baseline', async () => {
    await insertServiceEvent(db, { id: 's1', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'replace', performed_at: T0 });

    await addRide('m1', 500, T0 + 1000);
    let oil = (await evaluateVehicleMaintenance(db, 'v1'))!.items.find((i) => i.componentCode === 'engine_oil')!;
    assert.equal(oil.evaluation.status, 'good'); // 1000 remain of 1500
    assert.equal(oil.evaluation.progress?.usedKm, 500);

    await addRide('m2', 700, T0 + 2000);
    oil = (await evaluateVehicleMaintenance(db, 'v1'))!.items.find((i) => i.componentCode === 'engine_oil')!;
    assert.equal(oil.evaluation.status, 'due_soon'); // 300 remain <= 375 (25%)
    assert.equal(oil.evaluation.progress?.usedKm, 1200);

    await addRide('m3', 300, T0 + 3000);
    oil = (await evaluateVehicleMaintenance(db, 'v1'))!.items.find((i) => i.componentCode === 'engine_oil')!;
    assert.equal(oil.evaluation.status, 'overdue'); // 0 remain
    assert.equal(oil.evaluation.progress?.usedKm, 1500);
  });

  it('does not count ledger entries recorded before the baseline', async () => {
    await addRide('old', 1400, T0 - 1000);
    await insertServiceEvent(db, { id: 's1', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'replace', performed_at: T0 });
    const oil = (await evaluateVehicleMaintenance(db, 'v1'))!.items.find((i) => i.componentCode === 'engine_oil')!;
    assert.equal(oil.evaluation.status, 'good');
    assert.equal(oil.evaluation.progress?.usedKm, 0);
  });

  it('a generic service event does not reset usage (only replace/baseline do)', async () => {
    await insertServiceEvent(db, { id: 's1', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'replace', performed_at: T0 });
    await addRide('m1', 600, T0 + 1000);
    await insertServiceEvent(db, { id: 's2', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'service', performed_at: T0 + 2000 });
    const oil = (await evaluateVehicleMaintenance(db, 'v1'))!.items.find((i) => i.componentCode === 'engine_oil')!;
    assert.equal(oil.evaluation.progress?.usedKm, 600); // the later inspection-style event must not reset
  });

  it('a user override interval wins and a disabled component becomes not applicable', async () => {
    await insertServiceEvent(db, { id: 's1', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'replace', performed_at: T0 });
    await addRide('m1', 1000, T0 + 1);

    await upsertOverride(db, { id: 'o1', user_vehicle_id: 'v1', component_code: 'engine_oil', interval_km: 1000 });
    let oil = (await evaluateVehicleMaintenance(db, 'v1'))!.items.find((i) => i.componentCode === 'engine_oil')!;
    assert.equal(oil.evaluation.rule?.source, 'override');
    assert.equal(oil.evaluation.status, 'overdue'); // 1000 applied, interval 1000

    await upsertOverride(db, { id: 'o1', user_vehicle_id: 'v1', component_code: 'engine_oil', interval_km: 1000, enabled: false });
    oil = (await evaluateVehicleMaintenance(db, 'v1'))!.items.find((i) => i.componentCode === 'engine_oil')!;
    assert.equal(oil.evaluation.status, 'not_applicable');
    assert.equal(oil.evaluation.reason, 'disabled_by_override');
  });

  it('a part install resets usage like a service baseline', async () => {
    await openInstall(db, { id: 'p1', user_vehicle_id: 'v1', component_code: 'engine_oil', installed_at: T0 });
    await addRide('m1', 100, T0 + 1);
    let oil = (await evaluateVehicleMaintenance(db, 'v1'))!.items.find((i) => i.componentCode === 'engine_oil')!;
    assert.equal(oil.evaluation.progress?.usedKm, 100);

    await replaceInstall(db, { id: 'p2', user_vehicle_id: 'v1', component_code: 'engine_oil', installed_at: T0 + 5000 }, T0 + 5000);
    oil = (await evaluateVehicleMaintenance(db, 'v1'))!.items.find((i) => i.componentCode === 'engine_oil')!;
    assert.equal(oil.evaluation.progress?.usedKm, 0); // the new install is the newer baseline
  });

  it('only returns components that apply to the vehicle type', async () => {
    const m = await evaluateVehicleMaintenance(db, 'v1');
    assert.ok(m);
    const codes = m.items.map((i) => i.componentCode);
    assert.ok(codes.includes('engine_oil'));
    assert.ok(codes.includes('drive_chain'));
    assert.ok(!codes.includes('transmission_fluid')); // car/truck/... only
  });
});
