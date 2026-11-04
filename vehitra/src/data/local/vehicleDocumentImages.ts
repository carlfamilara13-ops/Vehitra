import { Directory, File, Paths } from 'expo-file-system';
import type { VehicleDocumentKind } from '../../domain/vehicleDocuments/documents';

// OR/CR image files. Image picker results live in a cache directory that Android may clear, so the
// chosen image is copied into the app's document directory and only that stable file:// URI is
// stored in SQLite. The image never leaves the device.

const DOCUMENT_DIR = 'vehicle-documents';

function documentRoot(): Directory {
  return new Directory(Paths.document, DOCUMENT_DIR);
}

function vehicleDirectory(vehicleId: string): Directory {
  const safeId = vehicleId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'vehicle';
  return new Directory(Paths.document, DOCUMENT_DIR, safeId);
}

function extensionFor(fileName?: string | null, sourceUri?: string): string {
  const match = /\.(jpe?g|png|webp|heic|heif)$/i.exec(fileName ?? sourceUri ?? '');
  return match?.[0]?.toLowerCase() ?? '.jpg';
}

export async function persistVehicleDocumentImage(
  sourceUri: string,
  vehicleId: string,
  kind: VehicleDocumentKind,
  fileName?: string | null,
): Promise<string> {
  if (!sourceUri.trim()) throw new Error('Document image is required.');
  const directory = vehicleDirectory(vehicleId);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  const suffix = Math.random().toString(36).slice(2, 10);
  const destination = new File(
    directory,
    `${kind}-${Date.now()}-${suffix}${extensionFor(fileName, sourceUri)}`,
  );
  const source = new File(sourceUri);
  await source.copy(destination);
  return destination.uri;
}

/** Deletes a document image only when it is one of ours; external picker URIs are left alone. */
export function deleteVehicleDocumentImage(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const directory = documentRoot();
    const base = directory.uri.endsWith('/') ? directory.uri : `${directory.uri}/`;
    if (!uri.startsWith(base)) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A stale or already-removed file must not block saving or replacing a document.
  }
}
