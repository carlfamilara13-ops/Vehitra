import type { VehicleDocumentKind } from '../../domain/vehicleDocuments/documents';
import type { Db } from './types';
import {
  getVehicleDocument,
  saveVehicleDocument,
  type VehicleDocumentRow,
} from './vehicleDocumentStore';

// Replacing a document photo follows the safe order: copy the new image into persistent storage,
// update SQLite, and only then delete the previous app-owned image. If the database write fails,
// the copied file is removed again and the previous record/file stay untouched.

export type VehicleDocumentImageStorage = {
  persist(sourceUri: string, fileName?: string | null): Promise<string>;
  remove(uri: string | null | undefined): void;
};

export type ReplaceVehicleDocumentInput = {
  id: string;
  vehicleId: string;
  kind: VehicleDocumentKind;
  sourceUri: string;
  fileName?: string | null;
};

function removeQuietly(storage: VehicleDocumentImageStorage, uri: string | null | undefined): void {
  try {
    storage.remove(uri);
  } catch {
    // Cleanup must not hide the save error that caused it.
  }
}

export async function replaceVehicleDocumentImage(
  db: Db,
  storage: VehicleDocumentImageStorage,
  input: ReplaceVehicleDocumentInput,
  now = Date.now(),
): Promise<VehicleDocumentRow> {
  const previous = await getVehicleDocument(db, input.vehicleId, input.kind);
  const storedUri = await storage.persist(input.sourceUri, input.fileName);

  try {
    const saved = await saveVehicleDocument(
      db,
      {
        id: input.id,
        vehicleId: input.vehicleId,
        kind: input.kind,
        imageUri: storedUri,
      },
      now,
    );
    if (previous && previous.image_uri !== storedUri) {
      removeQuietly(storage, previous.image_uri);
    }
    return saved;
  } catch (e) {
    removeQuietly(storage, storedUri);
    throw e;
  }
}
