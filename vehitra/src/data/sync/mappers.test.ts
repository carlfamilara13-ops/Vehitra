import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cloudDeadlineToLocal,
  cloudIsNewer,
  cloudVehicleToLocal,
  epochFromIso,
  isoFromEpoch,
  localDeadlineToCloud,
  localVehicleToCloud,
} from './mappers';
import type { CatalogModelInfo, CloudDeadlineRow, CloudVehicleRow } from './types';

const MODEL: CatalogModelInfo = {
  id: 'm-1',
  slug: 'honda-tmx-125',
  vehicleType: 'motorcycle',
  brandName: 'Honda',
  modelName: 'TMX 125',
};

const localVehicle = {
  id: 'v1',
  vehicle_type: 'motorcycle',
  brand: 'Honda',
  model: 'TMX 125',
  nickname: 'Delivery bike',
  model_year: 2024,
  plate: 'ABC-1234',
  odometer_km: 12345.6,
  catalog_model_slug: 'honda-tmx-125',
  catalog_version: 1,
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_100_000,
  client_updated_at: 1_700_000_200_000,
  deleted_at: null,
  sync_status: 'pending',
  server_updated_at: null,
} as const;

describe('sync mappers', () => {
  it('converts epoch ms and ISO timestamps both ways', () => {
    const ms = Date.UTC(2026, 9, 18, 3, 30, 0);
    const iso = isoFromEpoch(ms);
    assert.ok(iso);
    assert.equal(epochFromIso(iso), ms);
    assert.equal(isoFromEpoch(null), null);
    assert.equal(isoFromEpoch(Number.NaN), null);
    assert.equal(epochFromIso(null), null);
    assert.equal(epochFromIso('not-a-date'), null);
  });

  it('lets the cloud win only when strictly newer (ties go to the device)', () => {
    const t = Date.UTC(2026, 9, 18);
    assert.equal(cloudIsNewer(new Date(t + 1).toISOString(), t), true);
    assert.equal(cloudIsNewer(new Date(t).toISOString(), t), false);
    assert.equal(cloudIsNewer(new Date(t - 1).toISOString(), t), false);
    assert.equal(cloudIsNewer('garbage', t), false);
  });

  it('builds a vehicle push payload with only cloud columns', () => {
    const payload = localVehicleToCloud({ ...localVehicle }, 'm-1');
    assert.deepEqual(payload, {
      id: 'v1',
      model_id: 'm-1',
      catalog_version: 1,
      nickname: 'Delivery bike',
      plate: 'ABC-1234',
      model_year: 2024,
      client_updated_at: new Date(1_700_000_200_000).toISOString(),
      deleted_at: null,
    });
    // Local-only columns must never ride along.
    assert.ok(!('odometer_km' in payload));
    assert.ok(!('vehicle_type' in payload));
    assert.ok(!('brand' in payload));
  });

  it('turns a soft-deleted vehicle into a tombstone payload', () => {
    const payload = localVehicleToCloud(
      { ...localVehicle, deleted_at: 1_700_000_300_000 },
      'm-1',
    );
    assert.equal(payload.deleted_at, new Date(1_700_000_300_000).toISOString());
  });

  it('builds a deadline push payload with offsets as an int array', () => {
    const payload = localDeadlineToCloud({
      id: 'd1',
      user_vehicle_id: 'v1',
      kind: 'registration',
      label: 'Plates',
      due_date: '2026-12-31',
      reminder_offsets: '[30,7]',
      enabled: 1,
      deleted_at: null,
      created_at: 1,
      updated_at: 2,
      client_updated_at: 3,
      sync_status: 'pending',
      server_updated_at: null,
    } as never);
    assert.deepEqual(payload.reminder_offsets_days, [30, 7]);
    assert.equal(payload.due_date, '2026-12-31');
    assert.equal(payload.deleted_at, null);
    assert.ok(!('enabled' in payload));
  });

  it('defaults empty or unreadable deadline offsets to the standard notice set', () => {
    const payload = localDeadlineToCloud({
      id: 'd2',
      user_vehicle_id: null,
      kind: 'license',
      label: null,
      due_date: '2027-01-01',
      reminder_offsets: 'not json',
      enabled: 0,
      deleted_at: null,
      created_at: 1,
      updated_at: 2,
      client_updated_at: 3,
      sync_status: 'pending',
      server_updated_at: null,
    } as never);
    assert.deepEqual(payload.reminder_offsets_days, [30, 7, 3, 0]);
    assert.equal(payload.user_vehicle_id, null);
  });

  it('maps a cloud vehicle row onto local shared fields', () => {
    const row: CloudVehicleRow = {
      id: 'v9',
      model_id: 'm-1',
      catalog_version: 2,
      nickname: 'Other device name',
      plate: 'XYZ-9',
      model_year: 2021,
      client_updated_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
      deleted_at: null,
    };
    const pull = cloudVehicleToLocal(row, MODEL);
    assert.ok(pull);
    assert.equal(pull.nickname, 'Other device name');
    assert.equal(pull.plate, 'XYZ-9');
    assert.equal(pull.modelYear, 2021);
    assert.equal(pull.deletedAtMs, null);
    assert.equal(pull.serverUpdatedAtMs, Date.parse('2026-10-02T00:00:00.000Z'));
    assert.equal(pull.catalogSlug, 'honda-tmx-125');
    assert.equal(pull.catalogVersion, 2);
    // Pull-create fields come from the local catalog model.
    assert.equal(pull.vehicleType, 'motorcycle');
    assert.equal(pull.brandName, 'Honda');
    assert.equal(pull.modelName, 'TMX 125');
  });

  it('refuses a cloud vehicle whose model the local catalog does not know', () => {
    const row = {
      id: 'v9',
      model_id: 'unknown',
      catalog_version: 1,
      nickname: null,
      plate: null,
      model_year: null,
      client_updated_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
      deleted_at: null,
    } satisfies CloudVehicleRow;
    assert.equal(cloudVehicleToLocal(row, null), null);
    assert.equal(cloudVehicleToLocal(row, MODEL)?.nickname, null);
  });

  it('maps a cloud deadline and rejects values local cannot store', () => {
    const row: CloudDeadlineRow = {
      id: 'd9',
      user_vehicle_id: 'v1',
      kind: 'insurance',
      label: 'Third party',
      due_date: '2027-03-01',
      reminder_offsets_days: [14, 7, 0],
      client_updated_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
      deleted_at: null,
    };
    const pull = cloudDeadlineToLocal(row);
    assert.ok(pull);
    assert.equal(pull.kind, 'insurance');
    assert.deepEqual(pull.offsets, [14, 7, 0]);
    assert.equal(pull.userVehicleId, 'v1');

    assert.equal(cloudDeadlineToLocal({ ...row, kind: 'passport' }), null);
    assert.equal(cloudDeadlineToLocal({ ...row, due_date: '2027-02-31' }), null);
    assert.equal(cloudDeadlineToLocal({ ...row, updated_at: 'nope' }), null);
    // Null/invalid offsets fall back to the standard notice set.
    assert.deepEqual(cloudDeadlineToLocal({ ...row, reminder_offsets_days: null })?.offsets, [30, 7, 3, 0]);
    // Malformed numbers are filtered out.
    assert.deepEqual(
      cloudDeadlineToLocal({ ...row, reminder_offsets_days: [7, Number.NaN as never] })?.offsets,
      [7],
    );
  });
});
