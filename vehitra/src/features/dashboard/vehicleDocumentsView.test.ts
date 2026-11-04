import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { VehicleDocumentRow } from '../../data/local/vehicleDocumentStore';
import {
  EMPTY_VEHICLE_DOCUMENTS,
  selectVehicleDocuments,
  withSavedVehicleDocument,
  type VehicleDocumentsState,
} from './vehicleDocumentsView';

function row(
  vehicleId: string,
  kind: 'or' | 'cr',
  imageUri: string,
  now = 1,
): VehicleDocumentRow {
  return {
    id: `${vehicleId}-${kind}`,
    user_vehicle_id: vehicleId,
    kind,
    image_uri: imageUri,
    created_at: now,
    updated_at: now,
  };
}

const V1_OR = row('v1', 'or', 'file:///v1-or.jpg');
const V1_CR = row('v1', 'cr', 'file:///v1-cr.jpg');
const V2_OR = row('v2', 'or', 'file:///v2-or.jpg');
const V2_CR = row('v2', 'cr', 'file:///v2-cr.jpg');

describe('vehicle documents view', () => {
  it('shows the rows read for the active vehicle', () => {
    const state: VehicleDocumentsState = {
      vehicleId: 'v2',
      rows: [V2_OR, V2_CR],
      failed: false,
      loaded: true,
    };

    const view = selectVehicleDocuments(state, 'v2');
    assert.deepEqual(view.rows.map((r) => r.image_uri), ['file:///v2-or.jpg', 'file:///v2-cr.jpg']);
    assert.equal(view.loading, false);
    assert.equal(view.unavailable, false);
  });

  it('never shows the previous vehicle’s photos while the new vehicle is loading', () => {
    // v1 was loaded, then the active vehicle changed to v2 before the refresh finished.
    const state: VehicleDocumentsState = {
      vehicleId: 'v1',
      rows: [V1_OR, V1_CR],
      failed: false,
      loaded: true,
    };

    const view = selectVehicleDocuments(state, 'v2');
    assert.deepEqual(view.rows, []);
    assert.equal(view.loading, true);
    assert.equal(view.unavailable, false);
  });

  it('shows empty states for a vehicle with no documents even when another has both', () => {
    const v1Loaded: VehicleDocumentsState = {
      vehicleId: 'v1',
      rows: [V1_OR, V1_CR],
      failed: false,
      loaded: true,
    };
    const v2Loaded: VehicleDocumentsState = {
      vehicleId: 'v2',
      rows: [],
      failed: false,
      loaded: true,
    };

    assert.equal(selectVehicleDocuments(v1Loaded, 'v1').rows.length, 2);
    const empty = selectVehicleDocuments(v2Loaded, 'v2');
    assert.deepEqual(empty.rows, []);
    assert.equal(empty.loading, false);
    assert.equal(empty.unavailable, false);
  });

  it('has no active vehicle and no rows before the first read', () => {
    const view = selectVehicleDocuments(EMPTY_VEHICLE_DOCUMENTS, null);
    assert.deepEqual(view.rows, []);
    assert.equal(view.loading, false);
    assert.equal(view.unavailable, false);
  });

  it('reports an unreadable wallet only for the matching vehicle', () => {
    const failed: VehicleDocumentsState = {
      vehicleId: 'v2',
      rows: [],
      failed: true,
      loaded: true,
    };

    assert.equal(selectVehicleDocuments(failed, 'v2').unavailable, true);
    assert.equal(selectVehicleDocuments(failed, 'v1').unavailable, false);
  });

  it('a saved OR replaces only that kind for the same vehicle', () => {
    const state: VehicleDocumentsState = {
      vehicleId: 'v1',
      rows: [V1_OR, V1_CR],
      failed: false,
      loaded: true,
    };

    const replaced = withSavedVehicleDocument(state, 'v1', row('v1', 'or', 'file:///v1-or-new.jpg', 9));
    const rows = selectVehicleDocuments(replaced, 'v1').rows;

    assert.deepEqual(
      rows.map((r) => [r.kind, r.image_uri]),
      [
        ['cr', 'file:///v1-cr.jpg'],
        ['or', 'file:///v1-or-new.jpg'],
      ],
    );
    assert.equal(replaced.vehicleId, 'v1');
    // Same kind order as a fresh read: CR then OR.
  });
  it('a saved row for another vehicle drops the stale vehicle’s rows', () => {
    // The vehicle switched while the picker was open; the save belongs to the new vehicle.
    const stale: VehicleDocumentsState = {
      vehicleId: 'v1',
      rows: [V1_OR, V1_CR],
      failed: false,
      loaded: true,
    };

    const saved = withSavedVehicleDocument(stale, 'v2', V2_OR);
    const rows = selectVehicleDocuments(saved, 'v2').rows;

    assert.deepEqual(rows.map((r) => r.image_uri), ['file:///v2-or.jpg']);
  });
});
