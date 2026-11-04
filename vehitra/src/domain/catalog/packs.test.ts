import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { packByCode, validateCatalogPack, type CatalogPackRow } from './packs';

const row = (over: Partial<CatalogPackRow> = {}): CatalogPackRow => ({
  modelSlug: 'honda-click-125',
  componentCode: 'engine_oil',
  version: 1,
  intervalKm: 1500,
  warnRemainingPct: 25,
  reviewStatus: 'draft',
  sourceNote: 'Unverified.',
  provenance: 'bundled',
  ...over,
});

describe('catalog resource pack validation', () => {
  it('accepts a valid bundled pack', () => {
    assert.deepEqual(validateCatalogPack([row()]), []);
  });

  it('rejects unknown component codes', () => {
    const errs = validateCatalogPack([row({ componentCode: 'flux_capacitor' })]);
    assert.equal(errs.length, 1);
    assert.match(errs[0], /unknown component code/);
  });

  it('rejects non-positive or non-finite intervals', () => {
    assert.equal(validateCatalogPack([row({ intervalKm: 0 })]).length, 1);
    assert.equal(validateCatalogPack([row({ intervalKm: -5 })]).length, 1);
    assert.equal(validateCatalogPack([row({ intervalKm: Number.NaN })]).length, 1);
    // null interval is valid   it means "not set, pending review"
    assert.deepEqual(validateCatalogPack([row({ intervalKm: null })]), []);
  });

  it('rejects out-of-range warn percentages and bad enums', () => {
    assert.equal(validateCatalogPack([row({ warnRemainingPct: 101 })]).length, 1);
    assert.equal(validateCatalogPack([row({ warnRemainingPct: -1 })]).length, 1);
    assert.equal(validateCatalogPack([row({ reviewStatus: 'approved' as never })]).length, 1);
    assert.equal(validateCatalogPack([row({ provenance: 'made_up' as never })]).length, 1);
  });

  it('rejects duplicate (model, component, version) rows and empty slugs', () => {
    assert.equal(validateCatalogPack([row(), row()]).length, 1);
    assert.equal(validateCatalogPack([row({ modelSlug: ' ' })]).length, 1);
    assert.equal(validateCatalogPack([row({ version: 0 })]).length, 1);
  });

  it('indexes rows by component code for the evaluator', () => {
    const map = packByCode([row(), row({ componentCode: 'front_tire', intervalKm: null })]);
    assert.equal(map.size, 2);
    assert.equal(map.get('engine_oil')?.intervalKm, 1500);
    assert.equal(map.get('front_tire')?.intervalKm, null);
  });
});
