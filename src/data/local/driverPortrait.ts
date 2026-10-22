import { Directory, File, Paths } from 'expo-file-system';

// Portrait files for the personal driver profile. Image picker results live in a cache
// directory that Android may clear, so the chosen image is copied into the app's document
// directory and only that stable file:// URI is stored in SQLite. The image never leaves the
// device.

const PORTRAIT_DIR = 'driver-profile';

function portraitDirectory(): Directory {
  return new Directory(Paths.document, PORTRAIT_DIR);
}

function extensionFor(fileName?: string | null): string {
  const match = /\.(jpe?g|png|webp|heic)$/i.exec(fileName ?? '');
  return match?.[0]?.toLowerCase() ?? '.jpg';
}

export async function persistPortrait(sourceUri: string, fileName?: string | null): Promise<string> {
  const directory = portraitDirectory();
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  const suffix = Math.random().toString(36).slice(2, 10);
  const destination = new File(directory, `portrait-${Date.now()}-${suffix}${extensionFor(fileName)}`);
  const source = new File(sourceUri);
  await source.copy(destination);
  return destination.uri;
}

/** Deletes a portrait only when it is one of ours; external picker URIs are left alone. */
export function deletePortrait(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const directory = portraitDirectory();
    const base = directory.uri.endsWith('/') ? directory.uri : `${directory.uri}/`;
    if (!uri.startsWith(base)) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A stale or already-removed file must not block closing the form or saving the profile.
  }
}
