import { Directory, File, Paths } from 'expo-file-system';
import type { Db } from '../local/types';
import { getCatalogModelImage, saveCatalogModelImage, setCatalogModelImageStoragePath } from '../local/catalogStore';
import { getPublicSupabase, hasSupabaseConfig } from './client';

const BUCKET = 'vehitra-catalog-images';

function pathKey(path: string): string {
  let hash = 2166136261;
  for (let i = 0; i < path.length; i += 1) hash = Math.imul(hash ^ path.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

/** Fetch the current public model image into app documents so it remains available offline. */
export async function cacheCatalogModelImage(db: Db, modelSlug: string): Promise<string | null> {
  let image = await getCatalogModelImage(db, modelSlug);
  if (hasSupabaseConfig()) {
    try {
      const { data, error } = await getPublicSupabase()
        .from('vehicle_models')
        .select('image:assets!vehicle_models_image_asset_id_fkey(storage_path)')
        .eq('slug', modelSlug)
        .eq('active', true)
        .maybeSingle();
      if (!error && data) {
        const relation = data.image as { storage_path: string } | { storage_path: string }[] | null;
        const remotePath = Array.isArray(relation) ? relation[0]?.storage_path ?? null : relation?.storage_path ?? null;
        await setCatalogModelImageStoragePath(db, modelSlug, remotePath);
        image = await getCatalogModelImage(db, modelSlug);
      }
    } catch {
      // Keep the last public catalog index reference and its offline image.
    }
  }
  if (!image.storagePath) return null;
  if (image.localUri && new File(image.localUri).exists) return image.localUri;
  if (!hasSupabaseConfig()) return image.localUri;

  const directory = new Directory(Paths.document, 'catalog-model-images');
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  const ext = /\.(jpe?g|png|webp)$/i.exec(image.storagePath)?.[1]?.toLowerCase() ?? 'img';
  const destination = new File(directory, `${modelSlug.replace(/[^a-zA-Z0-9_-]/g, '_')}-${pathKey(image.storagePath)}.${ext}`);
  if (!destination.exists) {
    const url = getPublicSupabase().storage.from(BUCKET).getPublicUrl(image.storagePath).data.publicUrl;
    try {
      const downloaded = await File.downloadFileAsync(url, destination, { idempotent: true });
      if (!downloaded.size || downloaded.size > 8 * 1024 * 1024) {
        downloaded.delete();
        throw new Error('Vehicle image download is empty or exceeds the 8 MB limit.');
      }
    } catch (error) {
      if (destination.exists) destination.delete();
      throw error;
    }
  }
  await saveCatalogModelImage(db, modelSlug, image.storagePath, destination.uri);
  return destination.uri;
}
