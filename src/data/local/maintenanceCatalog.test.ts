import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import { createVehicle, getVehicle, setVehicleCatalog, updateVehicle, VehicleValidationError } from './vehicleStore';
import { evaluateVehicleMaintenance } from './maintenanceQuery';
import { replaceModelPack } from './catalogStore';
import { insertServiceEvent } from './serviceStore';
import { upsertOverride } from './overrideStore';
import { insertMileageEntry } from './mileageStore';
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
    await createVehicle(
      db,
      { id: 'v1', vehicle_type: 'motorcycle', catalog_model_slug: 'honda-click-125', catalog_version: 1 },
      T0,
    );
    await setupHistory(db);
    const result = await evaluateVehicleMaintenance(db, 'v1');
    const tire = item(result!.items, 'front_tire');
    // pack row exists only for engine_oil; front_tire has no layer -> honest no_interval
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
    await createVehicle(
      db,
      { id: 'v1', vehicle_type: 'car', catalog_model_slug: 'toyota-vios', catalog_version: 1 },
      T0,
    );
    await setupHistory(db);
    const result = await evaluateVehicleMaintenance(db, 'v1');
    const oil = item(result!.items, 'engine_oil');
    // cars: no pack interval and no local estimate -> honestly no interval
    assert.equal(oil.evaluation.rule?.source, 'none');
    assert.equal(oil.evaluation.status, 'unknown');
    assert.equal(oil.catalog, null);
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
