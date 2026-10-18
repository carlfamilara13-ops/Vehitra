import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  componentsForVehicleType,
  getComponentDefinition,
  LOCAL_COMPONENT_DEFINITIONS,
} from './components';

describe('local component catalogue (mirror of supabase/seed.sql)', () => {
  it('holds the 15 seeded definitions with unique codes', () => {
    assert.equal(LOCAL_COMPONENT_DEFINITIONS.length, 15);
    const codes = LOCAL_COMPONENT_DEFINITIONS.map((d) => d.code);
    assert.equal(new Set(codes).size, codes.length);
    assert.ok(codes.includes('engine_oil'));
    assert.ok(codes.includes('drive_chain'));
    assert.ok(codes.includes('transmission_fluid'));
  });

  it('looks up by code and returns null for an unknown one', () => {
    assert.equal(getComponentDefinition('engine_oil')?.name, 'Engine Oil');
    assert.equal(getComponentDefinition('engine_oil')?.category, 'engine');
    assert.equal(getComponentDefinition('ghost_part'), null);
  });

  it('filters by vehicle type using applies_to_types, in catalogue order', () => {
    const bicycle = componentsForVehicleType('bicycle').map((d) => d.code);
    assert.deepEqual(bicycle, ['front_brake_pads', 'rear_brake_pads', 'front_tire', 'rear_tire', 'drive_chain']);

    const moto = componentsForVehicleType('motorcycle').map((d) => d.code);
    assert.ok(moto.includes('engine_oil'));
    assert.ok(moto.includes('cvt_belt'));
    assert.ok(moto.includes('drive_chain'));

    const car = componentsForVehicleType('car').map((d) => d.code);
    assert.ok(car.includes('engine_oil'));
    assert.ok(car.includes('transmission_fluid'));
    assert.ok(!car.includes('drive_chain')); // chain is motorcycle/bicycle/other only
    assert.ok(!car.includes('cvt_belt'));
  });

  it('a part never applies to a type it is not listed for', () => {
    assert.deepEqual(componentsForVehicleType('bicycle').filter((d) => d.code === 'engine_oil'), []);
    assert.deepEqual(componentsForVehicleType('car').filter((d) => d.code === 'gear_oil'), []);
  });
});
