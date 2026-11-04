import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DeadlineRow } from '../local/deadlineStore';
import type { VehicleRow } from '../local/vehicleStore';
import type { CatalogModelInfo, CloudVehicleRow } from './types';
import { findPossibleDuplicateVehicles, findSyncConflicts } from './syncReview';

const model: CatalogModelInfo = {
  id: 'model-1', slug: 'honda-click-125', vehicleType: 'motorcycle', brandName: 'Honda', modelName: 'Click 125',
};

function localVehicle(overrides: Partial<VehicleRow> = {}): VehicleRow {
  return {
    id: 'local-1', vehicle_type: 'motorcycle', brand: 'Honda', model: 'Click 125',
    nickname: 'Blue', model_year: 2024, plate: 'ABC-123', odometer_km: 100,
    catalog_model_slug: model.slug, catalog_version: 1, created_at: 1, updated_at: 1,
    client_updated_at: 1, deleted_at: null, sync_status: 'pending', server_updated_at: null,
    ...overrides,
  };
}

function cloudVehicle(overrides: Partial<CloudVehicleRow> = {}): CloudVehicleRow {
  return {
    id: 'account-1', model_id: model.id, catalog_version: 1, nickname: 'Red', plate: 'ABC123',
    model_year: 2024, client_updated_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null, ...overrides,
  };
}

describe('sync merge review', () => {
  it('flags shared IDs whose vehicle profile values differ', () => {
    const account = cloudVehicle({ id: 'local-1' });
    const conflicts = findSyncConflicts(
      [localVehicle()], [account], [model], [], [],
    );
    assert.deepEqual(conflicts, [{ table: 'vehicles', id: 'local-1', fields: ['nickname', 'plate'] }]);
  });

  it('does not treat a shared vehicle name as duplicate identity', () => {
    const local = localVehicle({ plate: null });
    const account = cloudVehicle({ id: 'account-2', nickname: 'Blue', plate: null });
    assert.deepEqual(findPossibleDuplicateVehicles([local], [account], [model]), []);
  });

  it('suggests a possible duplicate only when plate, model, and year all match', () => {
    const local = localVehicle({ id: 'local-1' });
    const account = cloudVehicle({ id: 'account-2' });
    const candidates = findPossibleDuplicateVehicles([local], [account], [model]);
    assert.deepEqual(candidates, [{
      localId: 'local-1', accountId: 'account-2',
      localLabel: 'Blue (2024)', accountLabel: 'Red (2024)',
    }]);
  });

  it('does not flag identical shared reminder values as a conflict', () => {
    const local: DeadlineRow = {
      id: 'deadline-1', user_vehicle_id: 'local-1', kind: 'registration', label: null,
      due_date: '2027-01-01', reminder_offsets: '[30,7,3,0]', enabled: 1, deleted_at: null,
      created_at: 1, updated_at: 1, client_updated_at: 1, sync_status: 'pending', server_updated_at: null,
    };
    const conflicts = findSyncConflicts(
      [], [], [], [local], [{
        id: local.id, user_vehicle_id: local.user_vehicle_id, kind: local.kind, label: local.label,
        due_date: local.due_date, reminder_offsets_days: [30, 7, 3, 0],
        client_updated_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null,
      }],
    );
    assert.deepEqual(conflicts, []);
  });
});
