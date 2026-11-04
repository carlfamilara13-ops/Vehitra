import type { VehicleDocumentRow } from '../../data/local/vehicleDocumentStore';

// OR/CR rows are tagged with the vehicle they were read for. The wallet only shows rows whose tag
// matches the current active vehicle, so switching vehicles can never flash the previous vehicle's
// photo, and a vehicle with no rows still gets its own empty state.

export type VehicleDocumentsState = {
  vehicleId: string | null;
  rows: VehicleDocumentRow[];
  failed: boolean;
  loaded: boolean;
};

export type VehicleDocumentsView = {
  rows: VehicleDocumentRow[];
  loading: boolean;
  unavailable: boolean;
};

export const EMPTY_VEHICLE_DOCUMENTS: VehicleDocumentsState = {
  vehicleId: null,
  rows: [],
  failed: false,
  loaded: false,
};

export function selectVehicleDocuments(
  state: VehicleDocumentsState,
  activeVehicleId: string | null,
): VehicleDocumentsView {
  const matches = state.vehicleId === activeVehicleId;
  return {
    rows: matches ? state.rows : [],
    // A vehicle with no tag match has not been read yet: show the loading state, not empty photos
    // from the vehicle that was active a moment ago.
    loading: !!activeVehicleId && (!state.loaded || !matches),
    unavailable: matches && state.loaded && state.failed,
  };
}

// A saved row only belongs with rows read for the same vehicle. Keeping stale rows when the tag
// differs would let an old vehicle's other document kind survive the switch.
export function withSavedVehicleDocument(
  state: VehicleDocumentsState,
  vehicleId: string,
  saved: VehicleDocumentRow,
): VehicleDocumentsState {
  const sameVehicle = state.vehicleId === vehicleId;
  return {
    vehicleId,
    rows: [
      ...(sameVehicle ? state.rows.filter((row) => row.kind !== saved.kind) : []),
      saved,
    ].sort((a, b) => a.kind.localeCompare(b.kind)),
    failed: false,
    loaded: true,
  };
}
