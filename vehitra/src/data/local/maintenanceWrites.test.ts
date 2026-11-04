import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import { createVehicle, setVehicleOdometer } from './vehicleStore';
import { insertMileageEntry } from './mileageStore';
import { insertServiceEvent } from './serviceStore';
import { listInstalls, replaceInstall } from './installStore';
import { createCustomPart } from './customPartStore';
import { deleteOverride, listOverrides, upsertOverride } from './overrideStore';
import { MaintenanceValidationError } from './maintenanceErrors';
import { evaluateVehicleMaintenance, type ComponentMaintenance } from './maintenanceQuery';
import type { Db } from './types';

// Stage 4C write behaviors: the interactions the Parts screen relies on. Each evaluation is a fresh
// read (the same call the screen makes after a write), so these also cover the "refresh" contract.

const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);

const component = (items: ComponentMaintenance[], code: string): ComponentMaintenance => {
  const found = items.find((i) => i.componentCode === code);
  assert.ok(found, `expected component ${code}`);
  return found;
};

describe('maintenance writes (Stage 4C)', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  const addRide = (vehicleId: string, id: string, km: number, at: number) =>
    insertMileageEntry(db, { id, user_vehicle_id: vehicleId, kind: 'ride', source: 'gps', applied_km: km, ride_id: id }, at);

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
    await createVehicle(db, { id: 'v1', vehicle_type: 'motorcycle' }, T0);
  });

  it('keeps a custom interval on one vehicle only', async () => {
    await createVehicle(db, { id: 'v2', vehicle_type: 'motorcycle' }, T0);
    await insertServiceEvent(db, { id: 's1', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'replace', performed_at: T0 });
    await insertServiceEvent(db, { id: 's2', user_vehicle_id: 'v2', component_code: 'engine_oil', action: 'replace', performed_at: T0 });
    await addRide('v1', 'r1', 1000, T0 + 1);

    await upsertOverride(db, { id: 'o1', user_vehicle_id: 'v1', component_code: 'engine_oil', interval_km: 1000 });

    const v1oil = component((await evaluateVehicleMaintenance(db, 'v1'))!.items, 'engine_oil');
    assert.equal(v1oil.evaluation.rule?.source, 'override');
    assert.equal(v1oil.evaluation.rule?.intervalKm, 1000);
    assert.equal(v1oil.evaluation.status, 'overdue'); // 1000 applied against a 1000 interval

    const v2oil = component((await evaluateVehicleMaintenance(db, 'v2'))!.items, 'engine_oil');
    assert.equal(v2oil.evaluation.rule?.source, 'estimate'); // 1,500 km local estimate, not the v1 override
    assert.equal(v2oil.evaluation.progress?.usedKm, 0);

    assert.deepEqual((await listOverrides(db, 'v1')).map((o) => o.component_code), ['engine_oil']);
    assert.equal((await listOverrides(db, 'v2')).length, 0);
  });

  it('includes custom parts in the existing interval, status, and history system', async () => {
    const custom = await createCustomPart(db, {
      id: 'custom-1', user_vehicle_id: 'v1', component_code: 'custom_auxlight', name: 'Auxiliary light', category: 'electrical',
    }, T0);
    const newPart = (await evaluateVehicleMaintenance(db, 'v1'))!.items.find((part) => part.componentCode === custom.component_code);
    assert.ok(newPart);
    assert.equal(newPart.evaluation.status, 'unknown');
    assert.equal(newPart.evaluation.reason, 'no_interval');
    await upsertOverride(db, { id: 'custom-interval', user_vehicle_id: 'v1', component_code: custom.component_code, interval_km: 500 }, T0);
    await replaceInstall(db, {
      id: 'custom-install', user_vehicle_id: 'v1', component_code: custom.component_code,
      installed_at: T0, install_odo: 1000,
    }, T0);
    await addRide('v1', 'custom-ride', 600, T0 + 1);

    const item = (await evaluateVehicleMaintenance(db, 'v1'))!.items.find((part) => part.componentCode === custom.component_code);
    assert.ok(item);
    assert.equal(item.name, 'Auxiliary light');
    assert.equal(item.evaluation.rule?.source, 'override');
    assert.equal(item.evaluation.status, 'overdue');
    assert.equal(item.evaluation.progress?.usedKm, 600);
    assert.equal((await listInstalls(db, 'v1', custom.component_code)).length, 1);
  });

  it('an explicit baseline resets only its own component', async () => {
    await addRide('v1', 'r1', 600, T0 + 1);
    // Give drive_chain an interval so it is classifiable at all; it still has no baseline.
    await upsertOverride(db, { id: 'o-chain', user_vehicle_id: 'v1', component_code: 'drive_chain', interval_km: 1000 });
    await insertServiceEvent(db, {
      id: 'b1', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'baseline', performed_at: T0 + 100, estimated: true,
    });

    const model = (await evaluateVehicleMaintenance(db, 'v1'))!;
    const oil = component(model.items, 'engine_oil');
    assert.equal(oil.evaluation.status, 'good'); // usage restarts at the baseline (0 since)
    assert.equal(oil.evaluation.progress?.usedKm, 0);

    const chain = component(model.items, 'drive_chain');
    assert.equal(chain.evaluation.status, 'unknown'); // a different component is untouched
    assert.equal(chain.evaluation.reason, 'no_service_history');
    assert.equal(chain.evaluation.progress, null);
  });

  it('replacing a part resets only its component', async () => {
    // Both components need an interval to be classifiable (engine_oil has an estimate; drive_chain
    // needs an override). Each gets its own baseline: drive_chain a replace event, engine_oil an install.
    await upsertOverride(db, { id: 'o-chain', user_vehicle_id: 'v1', component_code: 'drive_chain', interval_km: 1000 });
    await insertServiceEvent(db, { id: 'c1', user_vehicle_id: 'v1', component_code: 'drive_chain', action: 'replace', performed_at: T0 });
    await replaceInstall(db, { id: 'p1', user_vehicle_id: 'v1', component_code: 'engine_oil', installed_at: T0 }, T0);
    await addRide('v1', 'r1', 500, T0 + 1000);

    let model = (await evaluateVehicleMaintenance(db, 'v1'))!;
    assert.equal(component(model.items, 'engine_oil').evaluation.progress?.usedKm, 500);
    assert.equal(component(model.items, 'drive_chain').evaluation.progress?.usedKm, 500);

    await replaceInstall(db, { id: 'p2', user_vehicle_id: 'v1', component_code: 'engine_oil', installed_at: T0 + 5000 }, T0 + 5000);

    model = (await evaluateVehicleMaintenance(db, 'v1'))!;
    assert.equal(component(model.items, 'engine_oil').evaluation.progress?.usedKm, 0); // reset
    assert.equal(component(model.items, 'drive_chain').evaluation.progress?.usedKm, 500); // unchanged
  });

  it('a generic service never resets usage or clears unknown history', async () => {
    // No baseline yet: a generic service is not a baseline, so the component stays unknown.
    await insertServiceEvent(db, { id: 's1', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'service', performed_at: T0 });
    let oil = component((await evaluateVehicleMaintenance(db, 'v1'))!.items, 'engine_oil');
    assert.equal(oil.evaluation.status, 'unknown');
    assert.equal(oil.evaluation.reason, 'no_service_history');

    // With a real baseline, a later generic service must not restart the count either.
    await insertServiceEvent(db, { id: 's2', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'replace', performed_at: T0 + 10 });
    await addRide('v1', 'r1', 600, T0 + 1000);
    await insertServiceEvent(db, { id: 's3', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'service', performed_at: T0 + 2000 });
    oil = component((await evaluateVehicleMaintenance(db, 'v1'))!.items, 'engine_oil');
    assert.equal(oil.evaluation.progress?.usedKm, 600);
  });

  it('unknown history stays unknown until an explicit baseline or replacement', async () => {
    await setVehicleOdometer(db, 'v1', 9000, T0 + 1);
    let oil = component((await evaluateVehicleMaintenance(db, 'v1'))!.items, 'engine_oil');
    assert.equal(oil.evaluation.status, 'unknown'); // the odometer alone changes nothing
    assert.equal(oil.evaluation.reason, 'no_service_history');

    await insertServiceEvent(db, { id: 'b1', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'baseline', performed_at: T0 + 2, estimated: true });
    oil = component((await evaluateVehicleMaintenance(db, 'v1'))!.items, 'engine_oil');
    assert.equal(oil.evaluation.status, 'good');
    assert.equal(oil.evaluation.progress?.usedKm, 0);
  });

  it('recalculates maintenance progress immediately from a corrected odometer', async () => {
    await setVehicleOdometer(db, 'v1', 2000, T0 + 1);
    await insertServiceEvent(db, {
      id: 's1', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'replace',
      performed_at: T0, odo_at: 1000,
    });

    let oil = component((await evaluateVehicleMaintenance(db, 'v1'))!.items, 'engine_oil');
    assert.equal(oil.evaluation.progress?.usedKm, 1000);
    assert.equal(oil.evaluation.status, 'good');

    await setVehicleOdometer(db, 'v1', 2200, T0 + 2);
    oil = component((await evaluateVehicleMaintenance(db, 'v1'))!.items, 'engine_oil');
    assert.equal(oil.evaluation.progress?.usedKm, 1200);
    assert.equal(oil.evaluation.status, 'due_soon');

    await setVehicleOdometer(db, 'v1', 2600, T0 + 3);
    oil = component((await evaluateVehicleMaintenance(db, 'v1'))!.items, 'engine_oil');
    assert.equal(oil.evaluation.progress?.usedKm, 1600);
    assert.equal(oil.evaluation.status, 'overdue');
  });

  it('reflects a write on the next read (the screen refresh contract)', async () => {
    assert.equal(component((await evaluateVehicleMaintenance(db, 'v1'))!.items, 'engine_oil').evaluation.status, 'unknown');

    await insertServiceEvent(db, { id: 's1', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'replace', performed_at: T0 });
    assert.equal(component((await evaluateVehicleMaintenance(db, 'v1'))!.items, 'engine_oil').evaluation.status, 'good');

    await addRide('v1', 'r1', 1600, T0 + 1000); // above the 1,500 km estimate
    assert.equal(component((await evaluateVehicleMaintenance(db, 'v1'))!.items, 'engine_oil').evaluation.status, 'overdue');
  });

  it('deleting an override restores the next-precedence rule', async () => {
    await insertServiceEvent(db, { id: 's1', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'replace', performed_at: T0 });
    await addRide('v1', 'r1', 1000, T0 + 1);

    await upsertOverride(db, { id: 'o1', user_vehicle_id: 'v1', component_code: 'engine_oil', interval_km: 900 });
    let oil = component((await evaluateVehicleMaintenance(db, 'v1'))!.items, 'engine_oil');
    assert.equal(oil.evaluation.rule?.source, 'override');
    assert.equal(oil.evaluation.rule?.intervalKm, 900);
    assert.equal(oil.evaluation.status, 'overdue'); // 1000 used against a 900 override

    assert.equal(await deleteOverride(db, 'v1', 'engine_oil'), true);
    oil = component((await evaluateVehicleMaintenance(db, 'v1'))!.items, 'engine_oil');
    assert.equal(oil.evaluation.rule?.source, 'estimate'); // falls back to the 1,500 km local estimate
    assert.equal(oil.evaluation.rule?.intervalKm, 1500);
    assert.equal(oil.evaluation.status, 'good'); // 1000 of 1500
  });

  it('deleting the only interval reports no_interval', async () => {
    // drive_chain has no estimate or catalog interval, so the override is its only interval source.
    await upsertOverride(db, { id: 'o1', user_vehicle_id: 'v1', component_code: 'drive_chain', interval_km: 900 });
    let chain = component((await evaluateVehicleMaintenance(db, 'v1'))!.items, 'drive_chain');
    assert.equal(chain.evaluation.rule?.source, 'override');

    assert.equal(await deleteOverride(db, 'v1', 'drive_chain'), true);
    chain = component((await evaluateVehicleMaintenance(db, 'v1'))!.items, 'drive_chain');
    assert.equal(chain.evaluation.status, 'unknown');
    assert.equal(chain.evaluation.reason, 'no_interval');
    assert.equal(chain.evaluation.rule?.source, 'none');
    assert.equal(chain.evaluation.progress, null);
  });

  it('rejects a future-dated service event or install and writes nothing', async () => {
    const future = Date.now() + 10 * 24 * 60 * 60 * 1000;
    await assert.rejects(
      () => insertServiceEvent(db, { id: 'f1', user_vehicle_id: 'v1', component_code: 'engine_oil', action: 'baseline', performed_at: future, estimated: true }),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
    await assert.rejects(
      () => replaceInstall(db, { id: 'f2', user_vehicle_id: 'v1', component_code: 'engine_oil', installed_at: future }),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );

    const oil = component((await evaluateVehicleMaintenance(db, 'v1'))!.items, 'engine_oil');
    assert.equal(oil.evaluation.status, 'unknown'); // no baseline was created
    assert.equal(oil.evaluation.reason, 'no_service_history');
    assert.equal((await listOverrides(db, 'v1')).length, 0);
  });
});
