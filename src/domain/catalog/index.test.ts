import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCatalogIndex,
  type CatalogIndexBrand,
  type CatalogIndexModel,
} from './index';

const brands: CatalogIndexBrand[] = [
  { slug: 'honda', name: 'Honda' },
  { slug: 'yamaha', name: 'Yamaha' },
];

const model = (over: Partial<CatalogIndexModel> = {}): CatalogIndexModel => ({
  slug: 'honda-click-125',
  brandSlug: 'honda',
  vehicleType: 'motorcycle',
  name: 'Click 125',
  isGeneric: false,
  sortOrder: 100,
  ...over,
});

describe('catalog index validation', () => {
  it('accepts a consistent branded and generic index', () => {
    const errors = validateCatalogIndex(brands, [
      model(),
      model({ slug: 'generic-car', brandSlug: null, vehicleType: 'car', name: 'Other car', isGeneric: true }),
    ]);
    assert.deepEqual(errors, []);
  });

  it('rejects empty indexes, duplicate slugs and blank names', () => {
    assert.ok(validateCatalogIndex([], []).some((e) => e.includes('no active models')));
    const errors = validateCatalogIndex(
      [...brands, { slug: 'honda', name: '' }],
      [model(), model()],
    );
    assert.ok(errors.some((e) => e.includes('duplicate brand slug')));
    assert.ok(errors.some((e) => e.includes('duplicate model slug')));
    assert.ok(errors.some((e) => e.includes('name is required')));
  });

  it('rejects unknown brands and inconsistent generic flags', () => {
    const errors = validateCatalogIndex(brands, [
      model({ brandSlug: 'kawasaki' }),
      model({ slug: 'generic-bike', brandSlug: 'honda', isGeneric: true }),
      model({ slug: 'generic-car', brandSlug: null, isGeneric: false }),
    ]);
    assert.ok(errors.some((e) => e.includes('unknown brand kawasaki')));
    assert.equal(errors.filter((e) => e.includes('generic models have no brand')).length, 2);
  });

  it('rejects missing vehicle types and invalid sort orders', () => {
    const errors = validateCatalogIndex(brands, [
      model({ vehicleType: ' ' }),
      model({ slug: 'honda-beat', sortOrder: -1 }),
      model({ slug: 'honda-adv', sortOrder: Number.NaN }),
    ]);
    assert.ok(errors.some((e) => e.includes('vehicle type is required')));
    assert.equal(errors.filter((e) => e.includes('sort order')).length, 2);
  });
});
