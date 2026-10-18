import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import {
  catalogSummary,
  getCatalogModel,
  getModelPack,
  hasGenericModels,
  listCatalogBrands,
  listCatalogModels,
  replaceModelPack,
  upsertCatalogComponent,
} from './catalogStore';
import { MaintenanceValidationError } from './maintenanceErrors';
import type { Db } from './types';
import type { CatalogPackRow } from '../../domain/catalog/packs';

const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);

const packRow = (over: Partial<CatalogPackRow> = {}): CatalogPackRow => ({
  modelSlug: 'honda-click-125',
  componentCode: 'engine_oil',
  version: 1,
  intervalKm: 1500,
  warnRemainingPct: 25,
  reviewStatus: 'draft',
  sourceNote: 'Project spec estimate.',
  provenance: 'bundled',
  ...over,
});

describe('local catalog store', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
  });

  it('brands are scoped to the vehicle type', async () => {
    const moto = (await listCatalogBrands(db, 'motorcycle')).map((b) => b.slug);
    assert.deepEqual(moto, ['honda', 'yamaha', 'suzuki', 'kawasaki']); // no toyota
    const car = (await listCatalogBrands(db, 'car')).map((b) => b.slug);
    assert.deepEqual(car, ['toyota']);
    assert.deepEqual(await listCatalogBrands(db, 'hoverboard'), []);
  });

  it('lists branded models per brand and generic models separately', async () => {
    const honda = (await listCatalogModels(db, 'motorcycle', 'honda')).map((m) => m.slug);
    // ordered by (sort_order, name): ADV 160, Beat, Click 125, TMX 125, XRM 125
    assert.deepEqual(honda, ['honda-adv-160', 'honda-beat', 'honda-click-125', 'honda-tmx-125', 'honda-xrm-125']);
    const generic = (await listCatalogModels(db, 'motorcycle', null)).map((m) => m.slug);
    assert.deepEqual(generic, ['generic-motorcycle']);
    assert.deepEqual(await listCatalogModels(db, 'car', 'honda'), []);
    // generic rows never carry a brand (DB trigger enforces it too)
    for (const m of await listCatalogModels(db, 'car', null)) {
      assert.equal(m.brand_slug, null);
      assert.equal(m.is_generic, 1);
    }
  });

  it('reports whether an "Other …" choice exists for the type', async () => {
    assert.equal(await hasGenericModels(db, 'motorcycle'), true);
    assert.equal(await hasGenericModels(db, 'car'), true);
    assert.equal(await hasGenericModels(db, 'hoverboard'), false);
  });

  it('refuses inconsistent generic/brand rows at the database level', async () => {
    await assert.rejects(() =>
      db.runAsync(
        `INSERT INTO catalog_models (slug, brand_slug, vehicle_type, name, is_generic)
         VALUES ('bad-generic', 'honda', 'motorcycle', 'Bad', 1)`,
      ),
    );
    await assert.rejects(() =>
      db.runAsync(
        `INSERT INTO catalog_models (slug, brand_slug, vehicle_type, name, is_generic)
         VALUES ('bad-branded', NULL, 'motorcycle', 'Bad', 0)`,
      ),
    );
  });

  it('ships a draft engine-oil pack row for every motorcycle model only', async () => {
    const click = await getModelPack(db, 'honda-click-125');
    assert.equal(click.length, 1);
    assert.equal(click[0].componentCode, 'engine_oil');
    assert.equal(click[0].intervalKm, 1500);
    assert.equal(click[0].reviewStatus, 'draft');
    assert.equal(click[0].provenance, 'bundled');
    assert.ok(click[0].sourceNote && click[0].sourceNote.length > 0);

    assert.deepEqual(await getModelPack(db, 'toyota-vios'), []); // cars have no interval yet
    assert.deepEqual(await getModelPack(db, 'unknown-model'), []);
    assert.equal((await getCatalogModel(db, 'honda-click-125'))?.vehicle_type, 'motorcycle');
    assert.equal(await getCatalogModel(db, 'unknown'), null);
  });

  it('replaces a whole pack atomically, rejecting invalid rows without partial writes', async () => {
    await replaceModelPack(
      db,
      [packRow(), packRow({ componentCode: 'front_tire', intervalKm: 8000, warnRemainingPct: 20 })],
      T0,
    );
    let pack = await getModelPack(db, 'honda-click-125');
    assert.equal(pack.length, 2);

    // invalid row -> the whole pack change is refused, old rows untouched
    await assert.rejects(
      () => replaceModelPack(db, [packRow(), packRow({ componentCode: 'front_tire', intervalKm: 0 })], T0 + 1),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
    pack = await getModelPack(db, 'honda-click-125');
    assert.equal(pack.length, 2);
    assert.equal(pack.find((r) => r.componentCode === 'front_tire')?.intervalKm, 8000);

    // a replacement covering more than one model is refused (one-model download contract)
    await assert.rejects(
      () =>
        replaceModelPack(
          db,
          [packRow(), packRow({ modelSlug: 'honda-beat', componentCode: 'engine_oil' })],
          T0 + 2,
        ),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );

    // a genuine replacement removes rows that were dropped
    await replaceModelPack(db, [packRow({ intervalKm: 2000 })], T0 + 3);
    pack = await getModelPack(db, 'honda-click-125');
    assert.equal(pack.length, 1);
    assert.equal(pack[0].intervalKm, 2000);
    assert.equal(pack[0].provenance, 'bundled');
  });

  it('upserts a single row for targeted remote refresh', async () => {
    await upsertCatalogComponent(
      db,
      packRow({ intervalKm: 1800, reviewStatus: 'reviewed', provenance: 'remote', sourceNote: 'Reviewed by admin.' }),
      T0,
    );
    let pack = await getModelPack(db, 'honda-click-125');
    assert.equal(pack[0].intervalKm, 1800);
    assert.equal(pack[0].reviewStatus, 'reviewed');
    assert.equal(pack[0].provenance, 'remote');

    await upsertCatalogComponent(db, packRow({ intervalKm: 1500 }), T0 + 1);
    pack = await getModelPack(db, 'honda-click-125');
    assert.equal(pack.length, 1); // same (model, component, version) -> updated, not duplicated
    assert.equal(pack[0].intervalKm, 1500);

    await assert.rejects(
      () => upsertCatalogComponent(db, packRow({ warnRemainingPct: 150 })),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
  });

  it('summarizes catalog size for diagnostics', async () => {
    const s = await catalogSummary(db);
    assert.equal(s.brands, 5);
    assert.equal(s.models, 21);
    // one engine-oil draft row per motorcycle model (12 branded + generic-motorcycle = 13)
    assert.equal(s.packRows, 13);
  });
});
