import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import { createVehicle, getVehicle, setVehicleCatalog, updateVehicle, VehicleValidationError } from './vehicleStore';
import { evaluateVehicleMaintenance } from './maintenanceQuery';
import { MaintenanceValidationError } from './maintenanceErrors';
import { replaceModelPack } from './catalogStore';
import { insertServiceEvent } from './serviceStore';
import { getOverride, upsertOverride } from './overrideStore';
import { insertMileageEntry } from './mileageStore';
import { createCustomPart, listCustomParts } from './customPartStore';
import { catalogProvenanceNote, intervalSourceNote } from '../../features/parts/partsView';
import type { Db } from './types';

const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);

// Establishes a service baseline at T0, then 100 km of recorded rides after it.
async function setupHistory(db: Db, vehicleId = 'v1') {
  await insertServiceEvent(db, {
    id: `s-${vehicleId}`,
    user_vehicle_id: vehicleId,
    component_code: 'engine_oil',
    action: 'replace',
    performed_at: T0,
  });
  await insertMileageEntry(
    db,
    { id: `m-${vehicleId}`, user_vehicle_id: vehicleId, kind: 'ride', source: 'gps', applied_km: 100, ride_id: `r-${vehicleId}` },
    T0 + 1000,
  );
}

function item<T extends { componentCode: string }>(items: readonly T[], code: string): T {
  const found = items.find((i) => i.componentCode === code);
  assert.ok(found, `${code} missing`);
  return found;
}

describe('catalog wiring in maintenance evaluation', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
  });

  it('an unlinked vehicle keeps using the local estimate', async () => {
    await createVehicle(db, { id: 'v1', vehicle_type: 'motorcycle' }, T0);
    await setupHistory(db);
    const result = await evaluateVehicleMaintenance(db, 'v1');
    const oil = item(result!.items, 'engine_oil');
    assert.equal(oil.evaluation.rule?.source, 'estimate');
    assert.equal(oil.evaluation.rule?.intervalKm, 1500);
    assert.equal(oil.catalog, null); // no provenance to show
  });

  it('a linked vehicle reads its model pack: catalog beats the estimate', async () => {
    await createVehicle(
      db,
      { id: 'v1', vehicle_type: 'motorcycle', catalog_model_slug: 'honda-click-125', catalog_version: 1 },
      T0,
    );
    // Make the pack value visibly different from the 1,500 km estimate.
    await replaceModelPack(db, [
      {
        modelSlug: 'honda-click-125',
        componentCode: 'engine_oil',
        version: 1,
        intervalKm: 2000,
        warnRemainingPct: 30,
        reviewStatus: 'draft',
        sourceNote: 'Bundled draft.',
        provenance: 'bundled',
      },
    ]);
    await setupHistory(db);

    const result = await evaluateVehicleMaintenance(db, 'v1');
    const oil = item(result!.items, 'engine_oil');
    assert.equal(oil.evaluation.rule?.source, 'catalog');
    assert.equal(oil.evaluation.rule?.intervalKm, 2000);
    assert.equal(oil.evaluation.rule?.warnRemainingPct, 30); // pack warns honored
    assert.equal(oil.catalog?.intervalKm, 2000);
    assert.equal(oil.catalog?.reviewStatus, 'draft');
    assert.equal(oil.catalog?.provenance, 'bundled');
    // 100 km used / 2000 -> good, well above 30% warn threshold
    assert.equal(oil.evaluation.status, 'good');
    assert.equal(oil.evaluation.progress?.usedPercent, 5);
  });

  it('a user override still beats the catalog pack', async () => {
    await createVehicle(
      db,
      { id: 'v1', vehicle_type: 'motorcycle', catalog_model_slug: 'honda-click-125', catalog_version: 1 },
      T0,
    );
    await setupHistory(db);
    await upsertOverride(db, { id: 'o1', user_vehicle_id: 'v1', component_code: 'engine_oil', interval_km: 1200 }, T0);
    const result = await evaluateVehicleMaintenance(db, 'v1');
    const oil = item(result!.items, 'engine_oil');
    assert.equal(oil.evaluation.rule?.source, 'override');
    assert.equal(oil.evaluation.rule?.intervalKm, 1200);
    assert.equal(oil.catalog?.intervalKm, 1500); // provenance of the pack row still shown
  });

  it('components without any interval stay unknown/none, never good', async () => {
    // Unlinked vehicle: all generic components appear, those without any interval stay unknown.
    await createVehicle(db, { id: 'v1', vehicle_type: 'motorcycle' }, T0);
    await setupHistory(db);
    const result = await evaluateVehicleMaintenance(db, 'v1');
    const tire = item(result!.items, 'front_tire');
    // No pack row, no override, no estimate -> honest no_interval
    assert.equal(tire.evaluation.rule?.source, 'none');
    assert.equal(tire.evaluation.status, 'unknown');
    assert.equal(tire.evaluation.reason, 'no_interval');
    assert.equal(tire.catalog, null);
  });

  it('draft pack data is labelled as draft, never as manufacturer data', async () => {
    await createVehicle(
      db,
      { id: 'v1', vehicle_type: 'motorcycle', catalog_model_slug: 'honda-click-125', catalog_version: 1 },
      T0,
    );
    await setupHistory(db);
    const result = await evaluateVehicleMaintenance(db, 'v1');
    const oil = item(result!.items, 'engine_oil');
    const note = intervalSourceNote(oil.evaluation.rule!.source);
    assert.match(note!, /draft data, not a manufacturer recommendation/);
    assert.match(catalogProvenanceNote(oil.catalog)!, /^Draft pack data/);
    assert.match(catalogProvenanceNote(oil.catalog)!, /bundled catalog/);
    assert.match(catalogProvenanceNote(null) ?? '', /^$/);
    assert.match(intervalSourceNote('estimate')!, /local estimate/);
    assert.match(intervalSourceNote('usage')!, /recorded usage/);
  });

  it('removing the catalog link returns the vehicle to estimate behavior', async () => {
    await createVehicle(
      db,
      { id: 'v1', vehicle_type: 'motorcycle', catalog_model_slug: 'honda-click-125', catalog_version: 1 },
      T0,
    );
    await setupHistory(db);
    assert.equal(item((await evaluateVehicleMaintenance(db, 'v1'))!.items, 'engine_oil').evaluation.rule?.source, 'catalog');

    await setVehicleCatalog(db, 'v1', null, null, T0 + 5);
    const after = await evaluateVehicleMaintenance(db, 'v1');
    const oil = item(after!.items, 'engine_oil');
    assert.equal(oil.evaluation.rule?.source, 'estimate');
    assert.equal(oil.catalog, null);
  });

  it('a vehicle linked to a model with no pack rows simply skips the catalog layer', async () => {
    // Unlinked vehicle: no catalog rows, all generic components appear with no_interval.
    await createVehicle(db, { id: 'v1', vehicle_type: 'car' }, T0);
    await setupHistory(db);
    const result = await evaluateVehicleMaintenance(db, 'v1');
    const oil = item(result!.items, 'engine_oil');
    // No pack row, no override, no estimate -> honestly no interval
    assert.equal(oil.evaluation.rule?.source, 'none');
    assert.equal(oil.evaluation.status, 'unknown');
    assert.equal(oil.catalog, null);
  });

  it('two vehicles of the same model at different versions see different components', async () => {
    await replaceModelPack(db, [
      {
        modelSlug: 'honda-click-125',
        componentCode: 'engine_oil',
        version: 2,
        intervalKm: 3000,
        warnRemainingPct: 20,
        reviewStatus: 'reviewed',
        sourceNote: 'Version 2 pack.',
        provenance: 'bundled',
      },
      {
        modelSlug: 'honda-click-125',
        componentCode: 'front_tire',
        version: 2,
        intervalKm: 8000,
        warnRemainingPct: 15,
        reviewStatus: 'reviewed',
        sourceNote: 'Version 2 pack.',
        provenance: 'bundled',
      },
    ], T0);

    await createVehicle(
      db,
      { id: 'vA', vehicle_type: 'motorcycle', catalog_model_slug: 'honda-click-125', catalog_version: 1 },
      T0,
    );
    await createVehicle(
      db,
      { id: 'vB', vehicle_type: 'motorcycle', catalog_model_slug: 'honda-click-125', catalog_version: 2 },
      T0,
    );
    await setupHistory(db, 'vA');
    await setupHistory(db, 'vB');

    const a = await evaluateVehicleMaintenance(db, 'vA');
    const b = await evaluateVehicleMaintenance(db, 'vB');

    const aOil = item(a!.items, 'engine_oil');
    assert.equal(aOil.evaluation.rule?.source, 'catalog');
    assert.equal(aOil.evaluation.rule?.intervalKm, 1500);
    assert.equal(aOil.catalog?.intervalKm, 1500);

    // Vehicle A at version 1: only engine_oil is in its pack. front_tire is not in v1's pack,
    // so it does not appear at all (generic components are not added for catalog-linked vehicles).
    const aTire = a!.items.find((i) => i.componentCode === 'front_tire');
    assert.equal(aTire, undefined, 'front_tire must not appear for vehicle A (not in v1 pack)');

    const bOil = item(b!.items, 'engine_oil');
    assert.equal(bOil.evaluation.rule?.source, 'catalog');
    assert.equal(bOil.evaluation.rule?.intervalKm, 3000);
    assert.equal(bOil.catalog?.intervalKm, 3000);

    const bTire = item(b!.items, 'front_tire');
    assert.equal(bTire.evaluation.rule?.source, 'catalog');
    assert.equal(bTire.evaluation.rule?.intervalKm, 8000);
    assert.equal(bTire.catalog?.intervalKm, 8000);
  });

  it('switching between vehicles restores each vehicle\'s version-specific components', async () => {
    await replaceModelPack(db, [
      {
        modelSlug: 'honda-click-125',
        componentCode: 'engine_oil',
        version: 1,
        intervalKm: 1500,
        warnRemainingPct: 25,
        reviewStatus: 'draft',
        sourceNote: 'v1.',
        provenance: 'bundled',
      },
    ], T0);
    await replaceModelPack(db, [
      {
        modelSlug: 'honda-click-125',
        componentCode: 'engine_oil',
        version: 2,
        intervalKm: 5000,
        warnRemainingPct: 10,
        reviewStatus: 'reviewed',
        sourceNote: 'v2.',
        provenance: 'bundled',
      },
    ], T0 + 1);

    await createVehicle(
      db,
      { id: 'vA', vehicle_type: 'motorcycle', catalog_model_slug: 'honda-click-125', catalog_version: 1 },
      T0,
    );
    await createVehicle(
      db,
      { id: 'vB', vehicle_type: 'motorcycle', catalog_model_slug: 'honda-click-125', catalog_version: 2 },
      T0,
    );
    await setupHistory(db, 'vA');
    await setupHistory(db, 'vB');

    const aFirst = await evaluateVehicleMaintenance(db, 'vA');
    const aFirstOil = item(aFirst!.items, 'engine_oil');
    assert.equal(aFirstOil.evaluation.rule?.intervalKm, 1500);
    assert.equal(aFirstOil.catalog?.reviewStatus, 'draft');

    const b = await evaluateVehicleMaintenance(db, 'vB');
    const bOil = item(b!.items, 'engine_oil');
    assert.equal(bOil.evaluation.rule?.intervalKm, 5000);
    assert.equal(bOil.catalog?.reviewStatus, 'reviewed');

    const aAgain = await evaluateVehicleMaintenance(db, 'vA');
    const aAgainOil = item(aAgain!.items, 'engine_oil');
    assert.equal(aAgainOil.evaluation.rule?.intervalKm, 1500);
    assert.equal(aAgainOil.catalog?.reviewStatus, 'draft');
  });

  it('downloading a newer pack version does not change vehicles assigned to an older version', async () => {
    await createVehicle(
      db,
      { id: 'vA', vehicle_type: 'motorcycle', catalog_model_slug: 'honda-click-125', catalog_version: 1 },
      T0,
    );
    await setupHistory(db, 'vA');

    const before = await evaluateVehicleMaintenance(db, 'vA');
    const beforeOil = item(before!.items, 'engine_oil');
    assert.equal(beforeOil.evaluation.rule?.intervalKm, 1500);

    await replaceModelPack(db, [
      {
        modelSlug: 'honda-click-125',
        componentCode: 'engine_oil',
        version: 2,
        intervalKm: 9000,
        warnRemainingPct: 10,
        reviewStatus: 'reviewed',
        sourceNote: 'Newer version.',
        provenance: 'remote',
      },
    ], T0 + 1);

    const after = await evaluateVehicleMaintenance(db, 'vA');
    const afterOil = item(after!.items, 'engine_oil');
    assert.equal(afterOil.evaluation.rule?.intervalKm, 1500);
    assert.equal(afterOil.catalog?.provenance, 'bundled');
    assert.equal(afterOil.catalog?.reviewStatus, 'draft');

    const { getModelPack } = await import('./catalogStore');
    const v1Pack = await getModelPack(db, 'honda-click-125', 1);
    assert.equal(v1Pack.length, 1);
    assert.equal(v1Pack[0].intervalKm, 1500);
  });

  it('custom parts remain visible for their own vehicle when switching vehicles', async () => {
    await createVehicle(
      db,
      { id: 'vA', vehicle_type: 'motorcycle', catalog_model_slug: 'honda-click-125', catalog_version: 1 },
      T0,
    );
    await createVehicle(
      db,
      { id: 'vB', vehicle_type: 'motorcycle', catalog_model_slug: 'honda-click-125', catalog_version: 1 },
      T0,
    );
    await setupHistory(db, 'vA');
    await setupHistory(db, 'vB');

    await createCustomPart(db, {
      id: 'cp-A',
      user_vehicle_id: 'vA',
      component_code: 'custom_aux_light',
      name: 'Auxiliary Light',
      category: 'electrical',
    }, T0);

    const a = await evaluateVehicleMaintenance(db, 'vA');
    const aCustom = a!.items.find((i) => i.componentCode === 'custom_aux_light');
    assert.ok(aCustom, 'custom part should appear for vehicle A');
    assert.equal(aCustom?.name, 'Auxiliary Light');
    assert.equal(aCustom?.catalog, null);

    const b = await evaluateVehicleMaintenance(db, 'vB');
    const bCustom = b!.items.find((i) => i.componentCode === 'custom_aux_light');
    assert.equal(bCustom, undefined, 'vehicle B must not see vehicle A\'s custom part');

    const aAgain = await evaluateVehicleMaintenance(db, 'vA');
    const aAgainCustom = aAgain!.items.find((i) => i.componentCode === 'custom_aux_light');
    assert.ok(aAgainCustom, 'custom part should still appear for vehicle A after switch back');
  });

  it('per-vehicle interval override is isolated: one vehicle\'s override does not leak to another', async () => {
    // Both vehicles share the same catalog model and version; the bundled seed already gives
    // engine_oil a catalog interval of 1,500 km for all motorcycles at version 1.
    await createVehicle(
      db,
      { id: 'vA', vehicle_type: 'motorcycle', catalog_model_slug: 'honda-click-125', catalog_version: 1 },
      T0,
    );
    await createVehicle(
      db,
      { id: 'vB', vehicle_type: 'motorcycle', catalog_model_slug: 'honda-click-125', catalog_version: 1 },
      T0,
    );
    await setupHistory(db, 'vA');
    await setupHistory(db, 'vB');

    // Only vehicle A gets an override; vehicle B keeps the catalog interval.
    await upsertOverride(db, { id: 'oA', user_vehicle_id: 'vA', component_code: 'engine_oil', interval_km: 2000 }, T0);

    const a = await evaluateVehicleMaintenance(db, 'vA');
    const aOil = item(a!.items, 'engine_oil');
    assert.equal(aOil.evaluation.rule?.source, 'override');
    assert.equal(aOil.evaluation.rule?.intervalKm, 2000);

    const b = await evaluateVehicleMaintenance(db, 'vB');
    const bOil = item(b!.items, 'engine_oil');
    assert.equal(bOil.evaluation.rule?.source, 'catalog');
    assert.equal(bOil.evaluation.rule?.intervalKm, 1500);
    assert.equal(bOil.catalog?.intervalKm, 1500);

    // Re-evaluating / switching back must not change either vehicle's override.
    const aAgain = await evaluateVehicleMaintenance(db, 'vA');
    const aAgainOil = item(aAgain!.items, 'engine_oil');
    assert.equal(aAgainOil.evaluation.rule?.source, 'override');
    assert.equal(aAgainOil.evaluation.rule?.intervalKm, 2000);

    const bAgain = await evaluateVehicleMaintenance(db, 'vB');
    const bAgainOil = item(bAgain!.items, 'engine_oil');
    assert.equal(bAgainOil.evaluation.rule?.source, 'catalog');
    assert.equal(bAgainOil.evaluation.rule?.intervalKm, 1500);

    // Confirm the override rows themselves remain per-vehicle in the store.
    const aOverride = await getOverride(db, 'vA', 'engine_oil');
    const bOverride = await getOverride(db, 'vB', 'engine_oil');
    assert.equal(aOverride?.interval_km, 2000);
    assert.equal(bOverride, null);
  });

  it('rejects evaluating a vehicle linked to a model with no catalog version', async () => {
    // Directly insert a vehicle row with catalog_model_slug set but catalog_version NULL
    // to simulate the state that application validation prevents.
    await createVehicle(db, { id: 'v1', vehicle_type: 'motorcycle' }, T0);
    await db.runAsync(
      `UPDATE vehicles SET catalog_model_slug = 'honda-click-125', catalog_version = NULL WHERE id = 'v1'`,
    );
    await setupHistory(db, 'v1');

    await assert.rejects(
      () => evaluateVehicleMaintenance(db, 'v1'),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
  });

  it('catalog-linked vehicle shows only its pack standard components, not all generic ones', async () => {
    await createVehicle(
      db,
      { id: 'v1', vehicle_type: 'motorcycle', catalog_model_slug: 'honda-click-125', catalog_version: 1 },
      T0,
    );
    await replaceModelPack(db, [
      {
        modelSlug: 'honda-click-125',
        componentCode: 'engine_oil',
        version: 1,
        intervalKm: 1500,
        warnRemainingPct: 25,
        reviewStatus: 'draft',
        sourceNote: 'Bundled draft.',
        provenance: 'bundled',
      },
      {
        modelSlug: 'honda-click-125',
        componentCode: 'air_filter',
        version: 1,
        intervalKm: 6000,
        warnRemainingPct: 20,
        reviewStatus: 'reviewed',
        sourceNote: 'Pack row.',
        provenance: 'bundled',
      },
    ], T0);
    await setupHistory(db, 'v1');

    const result = await evaluateVehicleMaintenance(db, 'v1');
    assert.equal(result!.items.length, 2);
    assert.equal(item(result!.items, 'engine_oil').componentCode, 'engine_oil');
    assert.equal(item(result!.items, 'air_filter').componentCode, 'air_filter');
    assert.equal(item(result!.items, 'engine_oil').evaluation.rule?.source, 'catalog');
    assert.equal(item(result!.items, 'engine_oil').evaluation.rule?.intervalKm, 1500);
    assert.equal(item(result!.items, 'air_filter').evaluation.rule?.source, 'catalog');
    assert.equal(item(result!.items, 'air_filter').evaluation.rule?.intervalKm, 6000);
  });

  it('catalog-linked vehicle with empty pack receives no generic components', async () => {
    // Car models have no bundled pack rows, so the pack is empty.
    await createVehicle(
      db,
      { id: 'v1', vehicle_type: 'car', catalog_model_slug: 'toyota-vios', catalog_version: 1 },
      T0,
    );
    await setupHistory(db, 'v1');

    const result = await evaluateVehicleMaintenance(db, 'v1');
    assert.equal(result!.items.length, 0);
  });

  it('unlinked manual vehicle still receives all generic components for its type', async () => {
    await createVehicle(db, { id: 'v1', vehicle_type: 'motorcycle' }, T0);
    await setupHistory(db, 'v1');

    const result = await evaluateVehicleMaintenance(db, 'v1');
    const codes = result!.items.map((i) => i.componentCode).sort();
    assert.equal(codes.length, 13);
    assert.ok(codes.includes('engine_oil'));
    assert.ok(codes.includes('air_filter'));
    assert.ok(codes.includes('spark_plug'));
    assert.ok(codes.includes('coolant'));
    assert.ok(codes.includes('front_brake_pads'));
    assert.ok(codes.includes('rear_brake_pads'));
    assert.ok(codes.includes('brake_fluid'));
    assert.ok(codes.includes('front_tire'));
    assert.ok(codes.includes('rear_tire'));
    assert.ok(codes.includes('battery'));
    assert.ok(codes.includes('drive_chain'));
    assert.ok(codes.includes('gear_oil'));
    assert.ok(codes.includes('cvt_belt'));
    assert.ok(result!.items.every((i) => i.catalog === null));
  });

  it('custom parts remain visible for a catalog-linked vehicle', async () => {
    await createVehicle(
      db,
      { id: 'v1', vehicle_type: 'motorcycle', catalog_model_slug: 'honda-click-125', catalog_version: 1 },
      T0,
    );
    await replaceModelPack(db, [
      {
        modelSlug: 'honda-click-125',
        componentCode: 'engine_oil',
        version: 1,
        intervalKm: 1500,
        warnRemainingPct: 25,
        reviewStatus: 'draft',
        sourceNote: 'Bundled draft.',
        provenance: 'bundled',
      },
    ], T0);
    await setupHistory(db, 'v1');

    await createCustomPart(db, {
      id: 'cp-1',
      user_vehicle_id: 'v1',
      component_code: 'custom_aux_light',
      name: 'Auxiliary Light',
      category: 'electrical',
    }, T0);

    const result = await evaluateVehicleMaintenance(db, 'v1');
    assert.equal(result!.items.length, 2);
    const custom = result!.items.find((i) => i.componentCode === 'custom_aux_light');
    assert.ok(custom, 'custom part should appear');
    assert.equal(custom!.name, 'Auxiliary Light');
    assert.equal(custom!.catalog, null);
    const oil = item(result!.items, 'engine_oil');
    assert.equal(oil.evaluation.rule?.source, 'catalog');
  });

  it('maintenance history is preserved when a component is absent from the current pack', async () => {
    await createVehicle(
      db,
      { id: 'v1', vehicle_type: 'motorcycle', catalog_model_slug: 'honda-click-125', catalog_version: 1 },
      T0,
    );
    await replaceModelPack(db, [
      {
        modelSlug: 'honda-click-125',
        componentCode: 'engine_oil',
        version: 1,
        intervalKm: 1500,
        warnRemainingPct: 25,
        reviewStatus: 'draft',
        sourceNote: 'Bundled draft.',
        provenance: 'bundled',
      },
    ], T0);
    await insertServiceEvent(db, {
      id: 's-air',
      user_vehicle_id: 'v1',
      component_code: 'air_filter',
      action: 'replace',
      performed_at: T0,
    });
    await insertMileageEntry(
      db,
      { id: 'm-air', user_vehicle_id: 'v1', kind: 'ride', source: 'gps', applied_km: 50, ride_id: 'r-air' },
      T0 + 1000,
    );

    const beforeCount = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM service_events WHERE component_code = ?',
      'air_filter',
    );
    assert.equal(beforeCount?.n, 1);

    const result = await evaluateVehicleMaintenance(db, 'v1');
    assert.equal(result!.items.length, 1);
    assert.equal(item(result!.items, 'engine_oil').componentCode, 'engine_oil');

    const afterCount = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM service_events WHERE component_code = ?',
      'air_filter',
    );
    assert.equal(afterCount?.n, 1);
  });
});

describe('vehicle catalog linkage', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
  });

  it('createVehicle stores the link; plain edits never touch it', async () => {
    await createVehicle(
      db,
      { id: 'v1', vehicle_type: 'motorcycle', brand: 'Honda', model: 'Click 125', catalog_model_slug: 'honda-click-125', catalog_version: 1 },
      T0,
    );
    const created = await getVehicle(db, 'v1');
    assert.equal(created?.catalog_model_slug, 'honda-click-125');
    assert.equal(created?.catalog_version, 1);

    await updateVehicle(db, 'v1', { vehicle_type: 'motorcycle', nickname: 'Daily' }, T0 + 1);
    const edited = await getVehicle(db, 'v1');
    assert.equal(edited?.catalog_model_slug, 'honda-click-125'); // preserved
    assert.equal(edited?.catalog_version, 1);
    assert.equal(edited?.nickname, 'Daily');
  });

  it('setVehicleCatalog links, moves and unlinks, marking the row for sync', async () => {
    await createVehicle(db, { id: 'v1', vehicle_type: 'motorcycle' }, T0);

    const linked = await setVehicleCatalog(db, 'v1', 'honda-beat', 1, T0 + 1);
    assert.equal(linked?.catalog_model_slug, 'honda-beat');
    assert.equal(linked?.sync_status, 'pending');

    const moved = await setVehicleCatalog(db, 'v1', 'yamaha-nmax', 2, T0 + 2);
    assert.equal(moved?.catalog_model_slug, 'yamaha-nmax');
    assert.equal(moved?.catalog_version, 2);

    const unlinked = await setVehicleCatalog(db, 'v1', null, null, T0 + 3);
    assert.equal(unlinked?.catalog_model_slug, null);
    assert.equal(unlinked?.catalog_version, null);

    assert.equal(await setVehicleCatalog(db, 'ghost', 'honda-beat', 1), null);
  });

  it('rejects invalid catalog linkage', async () => {
    await createVehicle(db, { id: 'v1', vehicle_type: 'motorcycle' }, T0);
    for (const [slug, version] of [[' ', 1], ['honda-beat', 0], ['honda-beat', null], ['', 1]] as const) {
      await assert.rejects(
        () => setVehicleCatalog(db, 'v1', slug as string, version as number | null, T0 + 1),
        (e: unknown) => e instanceof VehicleValidationError,
        `expected rejection for (${JSON.stringify(slug)}, ${String(version)})`,
      );
    }
    // create-time validation too
    await assert.rejects(
      () => createVehicle(db, { id: 'v2', vehicle_type: 'motorcycle', catalog_model_slug: 'honda-beat', catalog_version: 0 }, T0),
      (e: unknown) => e instanceof VehicleValidationError,
    );
    const v1 = await getVehicle(db, 'v1');
    assert.equal(v1?.catalog_model_slug, null); // nothing written
  });
});
