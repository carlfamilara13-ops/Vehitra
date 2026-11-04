import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import { createVehicle } from './vehicleStore';
import { createCustomPart, listCustomParts } from './customPartStore';
import type { Db } from './types';

const T0 = Date.UTC(2026, 9, 10);

describe('custom vehicle parts', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
    await createVehicle(db, { id: 'v1', vehicle_type: 'motorcycle' }, T0);
    await createVehicle(db, { id: 'v2', vehicle_type: 'car' }, T0);
  });

  it('stores a custom part only under its selected vehicle', async () => {
    const saved = await createCustomPart(db, {
      id: 'part-1', user_vehicle_id: 'v1', component_code: 'custom_part1', name: 'Auxiliary light', category: 'electrical',
    }, T0);
    assert.equal(saved.name, 'Auxiliary light');
    assert.deepEqual((await listCustomParts(db, 'v1')).map((p) => p.component_code), ['custom_part1']);
    assert.equal((await listCustomParts(db, 'v2')).length, 0);
  });

  it('rejects empty names, unsupported categories, and duplicate names', async () => {
    await assert.rejects(() => createCustomPart(db, {
      id: 'empty', user_vehicle_id: 'v1', component_code: 'custom_empty', name: '  ', category: 'engine',
    }));
    await assert.rejects(() => createCustomPart(db, {
      id: 'bad-category', user_vehicle_id: 'v1', component_code: 'custom_bad', name: 'Part', category: 'unknown',
    }));
    await createCustomPart(db, {
      id: 'part-1', user_vehicle_id: 'v1', component_code: 'custom_part1', name: 'Auxiliary light', category: 'electrical',
    }, T0);
    await assert.rejects(() => createCustomPart(db, {
      id: 'part-2', user_vehicle_id: 'v1', component_code: 'custom_part2', name: 'auxiliary LIGHT', category: 'electrical',
    }, T0));
  });
});
