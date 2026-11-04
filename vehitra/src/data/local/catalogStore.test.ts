
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import {
  catalogSummary,
  getCatalogModel,
  getCatalogModelImage,
  getModelPack,
  hasGenericModels,
  listCatalogBrands,
  listCatalogModels,
  replaceCatalogIndex,
  replaceModelPack,
  saveCatalogModelImage,
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
    assert.deepEqual(moto, ['honda', 'yamaha', 'suzuki', 'kawasaki']);

    const car = (await listCatalogBrands(db, 'car')).map((b) => b.slug);
    assert.deepEqual(car, ['toyota']);

    assert.deepEqual(await listCatalogBrands(db, 'hoverboard'), []);
  });

  it('lists branded models per brand and generic models separately', async () => {
    const honda = (await listCatalogModels(db, 'motorcycle', 'honda')).map((m) => m.slug);
    assert.deepEqual(honda, [
      'honda-adv-160',
      'honda-beat',
      'honda-click-125',
      'honda-tmx-125',
      'honda-xrm-125',
    ]);

    const generic = (await listCatalogModels(db, 'motorcycle', null)).map((m) => m.slug);
    assert.deepEqual(generic, ['generic-motorcycle']);

    assert.deepEqual(await listCatalogModels(db, 'car', 'honda'), []);

    for (const m of await listCatalogModels(db, 'car', null)) {
      assert.equal(m.brand_slug, null);
      assert.equal(m.is_generic, 1);
    }
  });

  it('replaces the brand/model index without deleting local rows', async () => {
    const counts = await replaceCatalogIndex(
      db,
      [
        { slug: 'honda', name: 'Honda Motorcycles' },
        { slug: 'cfmoto', name: 'CFMOTO' },
      ],
      [
        {
          slug: 'honda-click-125',
          brandSlug: 'honda',
          vehicleType: 'motorcycle',
          name: 'Click 125',
          isGeneric: false,
          sortOrder: 100,
          imageStoragePath: null,
        },
        {
          slug: 'cfmoto-450mt',
          brandSlug: 'cfmoto',
          vehicleType: 'motorcycle',
          name: '450MT',
          isGeneric: false,
          sortOrder: 50,
          imageStoragePath: null,
        },
        {
          slug: 'generic-motorcycle',
          brandSlug: null,
          vehicleType: 'motorcycle',
          name: 'Other motorcycle',
          isGeneric: true,
          sortOrder: 900,
          imageStoragePath: null,
        },
      ],
    );

    assert.deepEqual(counts, { brands: 2, models: 3 });

    const brands = await listCatalogBrands(db, 'motorcycle');
    assert.deepEqual(brands.map((b) => b.slug), ['honda', 'cfmoto']);
    assert.equal(brands.find((b) => b.slug === 'honda')?.name, 'Honda Motorcycles');
    assert.equal(brands.find((b) => b.slug === 'honda')?.sort_order, 10);
    assert.equal(brands.find((b) => b.slug === 'cfmoto')?.sort_order, 100);

    const honda = (await listCatalogModels(db, 'motorcycle', 'honda')).map((m) => m.slug);
    assert.deepEqual(honda, ['honda-click-125']);

    const cfmoto = (await listCatalogModels(db, 'motorcycle', 'cfmoto')).map((m) => m.slug);
    assert.deepEqual(cfmoto, ['cfmoto-450mt']);

    assert.equal((await getCatalogModel(db, 'honda-beat'))?.active, 0);
    assert.equal((await getCatalogModel(db, 'yamaha-nmax'))?.active, 0);
  });

  it('rejects an invalid index atomically', async () => {
    await assert.rejects(
      () =>
        replaceCatalogIndex(
          db,
          [{ slug: 'honda', name: 'Honda' }],
          [
            {
              slug: 'honda-click-125',
              brandSlug: 'honda',
              vehicleType: 'motorcycle',
              name: 'Click 125',
              isGeneric: false,
              sortOrder: 100,
              imageStoragePath: null,
            },
            {
              slug: 'unknown-brand',
              brandSlug: 'missing',
              vehicleType: 'motorcycle',
              name: 'Unknown',
              isGeneric: false,
              sortOrder: 100,
              imageStoragePath: null,
            },
          ],
        ),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );

    assert.equal((await getCatalogModel(db, 'honda-click-125'))?.active, 1);
    assert.equal((await getCatalogModel(db, 'honda-beat'))?.active, 1);
  });

  it('keeps a model image cache tied to its versioned public storage path', async () => {
    await replaceCatalogIndex(db, [{ slug: 'honda', name: 'Honda' }], [
      {
        slug: 'honda-click-125',
        brandSlug: 'honda',
        vehicleType: 'motorcycle',
        name: 'Click 125',
        isGeneric: false,
        sortOrder: 100,
        imageStoragePath: 'model-id/image-v1.webp',
      },
    ]);

    await saveCatalogModelImage(
      db,
      'honda-click-125',
      'model-id/image-v1.webp',
      'file:///cache/model-v1.img',
    );

    assert.deepEqual(await getCatalogModelImage(db, 'honda-click-125'), {
      storagePath: 'model-id/image-v1.webp',
      localUri: 'file:///cache/model-v1.img',
    });

    await replaceCatalogIndex(db, [{ slug: 'honda', name: 'Honda' }], [
      {
        slug: 'honda-click-125',
        brandSlug: 'honda',
        vehicleType: 'motorcycle',
        name: 'Click 125',
        isGeneric: false,
        sortOrder: 100,
        imageStoragePath: 'model-id/image-v2.webp',
      },
    ]);

    assert.deepEqual(await getCatalogModelImage(db, 'honda-click-125'), {
      storagePath: 'model-id/image-v2.webp',
      localUri: null,
    });
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

    assert.deepEqual(await getModelPack(db, 'toyota-vios'), []);
    assert.deepEqual(await getModelPack(db, 'unknown-model'), []);

    assert.equal((await getCatalogModel(db, 'honda-click-125'))?.vehicle_type, 'motorcycle');
    assert.equal(await getCatalogModel(db, 'unknown'), null);
  });

  it('replaces only the requested model/version pack atomically', async () => {
    await replaceModelPack(
      db,
      [
        packRow(),
        packRow({
          componentCode: 'front_tire',
          intervalKm: 8000,
          warnRemainingPct: 20,
        }),
      ],
      T0,
    );

    let pack = await getModelPack(db, 'honda-click-125', 1);
    assert.equal(pack.length, 2);

    // Invalid row: the entire pack change is refused.
    await assert.rejects(
      () =>
        replaceModelPack(
          db,
          [
            packRow(),
            packRow({
              componentCode: 'front_tire',
              intervalKm: 0,
            }),
          ],
          T0 + 1,
        ),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );

    pack = await getModelPack(db, 'honda-click-125', 1);
    assert.equal(pack.length, 2);
    assert.equal(
      pack.find((r) => r.componentCode === 'front_tire')?.intervalKm,
      8000,
    );

    // A pack covering multiple models is refused.
    await assert.rejects(
      () =>
        replaceModelPack(
          db,
          [
            packRow(),
            packRow({
              modelSlug: 'honda-beat',
              componentCode: 'engine_oil',
            }),
          ],
          T0 + 2,
        ),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );

    // A pack covering multiple versions is refused.
    await assert.rejects(
      () =>
        replaceModelPack(
          db,
          [
            packRow({ version: 1 }),
            packRow({ version: 2, componentCode: 'front_tire' }),
          ],
          T0 + 2,
        ),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );

    // Replacing version 1 removes rows dropped from version 1 only.
    await replaceModelPack(
      db,
      [packRow({ intervalKm: 2000 })],
      T0 + 3,
    );

    pack = await getModelPack(db, 'honda-click-125', 1);
    assert.equal(pack.length, 1);
    assert.equal(pack[0].intervalKm, 2000);
    assert.equal(pack[0].provenance, 'bundled');
  });

  it('preserves older pack versions when a newer version is downloaded', async () => {
    // Version 1 contains engine oil and front tire.
    await replaceModelPack(
      db,
      [
        packRow({ version: 1, intervalKm: 1500 }),
        packRow({
          version: 1,
          componentCode: 'front_tire',
          intervalKm: 8000,
        }),
      ],
      T0,
    );

    // Version 2 has a different component list and interval.
    await replaceModelPack(
      db,
      [
        packRow({
          version: 2,
          intervalKm: 2000,
        }),
        packRow({
          version: 2,
          componentCode: 'air_filter',
          intervalKm: 6000,
        }),
      ],
      T0 + 1,
    );

    const version1 = await getModelPack(db, 'honda-click-125', 1);
    const version2 = await getModelPack(db, 'honda-click-125', 2);

    assert.deepEqual(
      version1.map((row) => row.componentCode),
      ['engine_oil', 'front_tire'],
    );
    assert.equal(version1.find((row) => row.componentCode === 'engine_oil')?.intervalKm, 1500);

    assert.deepEqual(
      version2.map((row) => row.componentCode),
      ['air_filter', 'engine_oil'],
    );
    assert.equal(version2.find((row) => row.componentCode === 'engine_oil')?.intervalKm, 2000);

    // Without an explicit version, the latest stored version is returned.
    const latest = await getModelPack(db, 'honda-click-125');
    assert.deepEqual(
      latest.map((row) => row.componentCode),
      ['air_filter', 'engine_oil'],
    );
    assert.equal(latest.find((row) => row.componentCode === 'engine_oil')?.intervalKm, 2000);
  });

  it('upserts a single row for targeted remote refresh', async () => {
    await upsertCatalogComponent(
      db,
      packRow({
        intervalKm: 1800,
        reviewStatus: 'reviewed',
        provenance: 'remote',
        sourceNote: 'Reviewed by admin.',
      }),
      T0,
    );

    let pack = await getModelPack(db, 'honda-click-125', 1);
    assert.equal(pack[0].intervalKm, 1800);
    assert.equal(pack[0].reviewStatus, 'reviewed');
    assert.equal(pack[0].provenance, 'remote');

    await upsertCatalogComponent(
      db,
      packRow({ intervalKm: 1500 }),
      T0 + 1,
    );

    pack = await getModelPack(db, 'honda-click-125', 1);
    assert.equal(pack.length, 1);
    assert.equal(pack[0].intervalKm, 1500);

    await assert.rejects(
      () => upsertCatalogComponent(db, packRow({ warnRemainingPct: 150 })),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
  });

  it('summarizes catalog size for diagnostics', async () => {
    const summary = await catalogSummary(db);

    assert.equal(summary.brands, 5);
    assert.equal(summary.models, 21);
    assert.equal(summary.packRows, 13);
  });
});
