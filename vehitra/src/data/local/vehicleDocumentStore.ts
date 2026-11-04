import {
  isVehicleDocumentKind,
  type VehicleDocumentKind,
} from '../../domain/vehicleDocuments/documents';
import { serialize } from './serialize';
import type { Db } from './types';
import { getVehicle, VehicleNotFoundError } from './vehicleStore';

// Vehicle OR/CR photo records (schema v13). Device-only and local-first: the image files stay in
// the app document directory and this table is deliberately excluded from cloud sync. One row per
// vehicle and kind; saving again updates that row.

export type VehicleDocumentRow = {
  id: string;
  user_vehicle_id: string;
  kind: VehicleDocumentKind;
  image_uri: string;
  created_at: number;
  updated_at: number;
};

export type SaveVehicleDocumentInput = {
  id: string;
  vehicleId: string;
  kind: VehicleDocumentKind;
  imageUri: string;
};

export class VehicleDocumentValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors[0] ?? 'Invalid vehicle document');
    this.name = 'VehicleDocumentValidationError';
  }
}

export function listVehicleDocuments(db: Db, vehicleId: string): Promise<VehicleDocumentRow[]> {
  return db.getAllAsync<VehicleDocumentRow>(
    'SELECT * FROM vehicle_documents WHERE user_vehicle_id = ? ORDER BY kind ASC',
    vehicleId,
  );
}

export function getVehicleDocument(
  db: Db,
  vehicleId: string,
  kind: VehicleDocumentKind,
): Promise<VehicleDocumentRow | null> {
  return db.getFirstAsync<VehicleDocumentRow>(
    'SELECT * FROM vehicle_documents WHERE user_vehicle_id = ? AND kind = ?',
    vehicleId,
    kind,
  );
}

// Upsert by (vehicle, kind): the unique pair is the duplicate guard. A replacement keeps the
// original row id and created_at, and never touches the other document kind or another vehicle.
export function saveVehicleDocument(
  db: Db,
  input: SaveVehicleDocumentInput,
  now = Date.now(),
): Promise<VehicleDocumentRow> {
  return serialize(async () => {
    const errors: string[] = [];
    if (!input.id.trim()) errors.push('Document id is required.');
    if (!input.vehicleId.trim()) errors.push('Vehicle is required.');
    if (!isVehicleDocumentKind(input.kind)) errors.push('Choose OR or CR.');
    if (!input.imageUri.trim()) errors.push('Document image is required.');
    if (errors.length) throw new VehicleDocumentValidationError(errors);

    const vehicle = await getVehicle(db, input.vehicleId);
    if (!vehicle) throw new VehicleNotFoundError(input.vehicleId);

    await db.runAsync(
      `INSERT INTO vehicle_documents
         (id, user_vehicle_id, kind, image_uri, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_vehicle_id, kind) DO UPDATE SET
         image_uri = excluded.image_uri,
         updated_at = excluded.updated_at`,
      input.id,
      input.vehicleId,
      input.kind,
      input.imageUri,
      now,
      now,
    );

    const saved = await getVehicleDocument(db, input.vehicleId, input.kind);
    if (!saved) throw new VehicleDocumentValidationError(['Could not save the document photo.']);
    return saved;
  });
}
