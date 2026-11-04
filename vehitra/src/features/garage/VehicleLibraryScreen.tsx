
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, ImageBackground, StyleSheet } from 'react-native';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text } from '../../ui/neu/NeuText';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { getDb } from '../../data/local/db';
import {
  hasGenericModels,
  listCatalogBrands,
  listCatalogModels,
  getModelPack,
  replaceCatalogIndex,
  replaceModelPack,
  type CatalogBrandRow,
  type CatalogModelRow,
} from '../../data/local/catalogStore';
import { getAppSettings } from '../../data/local/settingsStore';
import { downloadCatalogIndex, downloadModelPack } from '../../data/remote/catalog';
import { cacheCatalogModelImage } from '../../data/remote/modelImage';
import { hasSupabaseConfig } from '../../data/remote/client';
import { getComponentDefinition } from '../../domain/maintenance/components';
import type { CatalogPackRow } from '../../domain/catalog/packs';
import { formatDistanceKm, type Units } from '../../domain/units';
import Screen from '../../ui/Screen';
import { colors, radii, spacing, typography } from '../../ui/theme';
import { VEHICLE_TYPE_LABELS } from '../../data/local/vehicleStore';
import type { RootTabParamList } from '../../app/RootNavigator';

const VEHICLE_LIBRARY_CATEGORIES = [
  {
    type: 'motorcycle',
    name: 'Motorcycle',
    description: 'Two wheels. Endless freedom.',
    image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR9pOHBAJiVufg6pBRCw_wgwdjpauMtQuML9kLjEr-qJbdrHoP7q2WUbkPH&s=10',
  },
  {
    type: 'car',
    name: 'Car',
    description: 'Your everyday drive.',
    image: 'https://us-west-2.graphassets.com/ALxjZdtQIQOudrzeO6hSgz/81CPq1IeSZqyF3k4pvI7',
  },
  {
    type: 'bicycle',
    name: 'Bicycle',
    description: 'Every ride starts somewhere.',
    image: 'https://shop.fairdalebikes.com/cdn/shop/collections/2024_Elevator_Bike_2_2048x2048.jpg?v=1722278837',
  },
  {
    type: 'truck',
    name: 'Truck',
    description: 'Built for the long haul.',
    image: 'https://www.inland-group.ca/wp-content/uploads/2026/03/kenworth-c580-announced.webp',
  },
  {
    type: 'bus',
    name: 'Bus',
    description: 'Keep every journey moving.',
    image: 'https://www.daimlertruck.com/fileadmin/press/6/1/D613028/cms.jpeg',
  },
  {
    type: 'van',
    name: 'Van',
    description: 'Ready for every destination.',
    image: 'https://imgcdn.zigwheels.ph/large/gallery/exterior/24/3912/mitsubishi-versa-van-front-angle-low-view-973950.jpg',
  },
] as const;

type Props = BottomTabScreenProps<RootTabParamList, 'VehicleLibrary'>;

// Sentinel for generic models.
const GENERIC = '__generic__';

type DownloadState =
  | { status: 'idle' | 'busy' }
  | { status: 'done'; version: number }
  | { status: 'error'; message: string };

type CatalogSyncState =
  | { status: 'idle' | 'busy' }
  | { status: 'done'; brands: number; models: number }
  | { status: 'error'; message: string };

export default function VehicleLibraryScreen({ navigation }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [brandSlug, setBrandSlug] = useState<string | null | undefined>(undefined);
  const [brands, setBrands] = useState<CatalogBrandRow[]>([]);
  const [genericAvailable, setGenericAvailable] = useState(false);
  const [models, setModels] = useState<CatalogModelRow[]>([]);
  const [model, setModel] = useState<CatalogModelRow | null>(null);
  const [pack, setPack] = useState<CatalogPackRow[]>([]);
  const [brandName, setBrandName] = useState<string | null>(null);
  const [units, setUnits] = useState<Units>('metric');
  const [loading, setLoading] = useState(false);
  const [download, setDownload] = useState<DownloadState>({ status: 'idle' });
  const [sync, setSync] = useState<CatalogSyncState>({ status: 'idle' });

  const syncingRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;

      (async () => {
        try {
          const db = await getDb();
          const settings = await getAppSettings(db);

          if (alive) setUnits(settings.units);
        } catch {
          // Units are cosmetic; defaults are fine if the read fails.
        }
      })();

      return () => {
        alive = false;
      };
    }, []),
  );

  // Type chosen → reset downstream choices and load brands.
  const pickType = useCallback(async (t: string) => {
    setType(t);
    setBrandSlug(undefined);
    setBrands([]);
    setGenericAvailable(false);
    setModels([]);
    setModel(null);
    setPack([]);
    setBrandName(null);
    setDownload({ status: 'idle' });
    setError(null);
    setLoading(true);

    try {
      const db = await getDb();

      const [list, hasGeneric] = await Promise.all([
        listCatalogBrands(db, t),
        hasGenericModels(db, t),
      ]);

      setBrands(list);
      setGenericAvailable(hasGeneric);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Brand chosen → load models.
  const pickBrand = useCallback(
    async (slug: string | null, name: string | null) => {
      if (!type) return;

      setBrandSlug(slug);
      setBrandName(name);
      setModels([]);
      setModel(null);
      setPack([]);
      setDownload({ status: 'idle' });
      setError(null);
      setLoading(true);

      try {
        const db = await getDb();
        setModels(await listCatalogModels(db, type, slug));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [type],
  );

  // Model chosen → load its pack.
  // Automatically downloads the pack if it is missing locally.
  const pickModel = useCallback(async (m: CatalogModelRow) => {
    setModel(m);
    setDownload({ status: 'idle' });
    setError(null);
    setLoading(true);

    try {
      const db = await getDb();
      try { await cacheCatalogModelImage(db, m.slug); } catch { /* Rule selection can still use its local fallback. */ }
      let packRows = await getModelPack(db, m.slug);

      if (packRows.length === 0 && hasSupabaseConfig()) {
        const result = await downloadModelPack(m.slug);

        if (result.ok && result.rows.length > 0) {
          await replaceModelPack(db, result.rows);
          packRows = await getModelPack(db, m.slug);
          setDownload({ status: 'done', version: result.version });
        }
      }

      setPack(packRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Manually refresh the selected model's maintenance pack.
  const refreshPack = useCallback(async () => {
    if (!model) return;

    setDownload({ status: 'busy' });

    try {
      const db = await getDb();
      const result = await downloadModelPack(model.slug);

      if (!result.ok) {
        setDownload({ status: 'error', message: result.message });
        return;
      }

      if (result.rows.length === 0) {
        setDownload({
          status: 'error',
          message: 'The catalog has no rules for this model yet.',
        });
        return;
      }

      await replaceModelPack(db, result.rows);
      setPack(await getModelPack(db, model.slug));
      setDownload({ status: 'done', version: result.version });
    } catch (e) {
      setDownload({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [model]);

  // Sync the public vehicle catalog.
  const syncCatalog = useCallback(async () => {
    if (syncingRef.current) return;

    syncingRef.current = true;
    setSync({ status: 'busy' });

    try {
      const result = await downloadCatalogIndex();

      if (!result.ok) {
        setSync({ status: 'error', message: result.message });
        return;
      }

      const db = await getDb();
      const counts = await replaceCatalogIndex(
        db,
        result.brands,
        result.models,
      );

      // Refresh the currently selected type and brand.
      if (type) {
        const [nextBrands, hasGeneric] = await Promise.all([
          listCatalogBrands(db, type),
          hasGenericModels(db, type),
        ]);

        setBrands(nextBrands);
        setGenericAvailable(hasGeneric);

        if (brandSlug !== undefined) {
          const nextModels = await listCatalogModels(db, type, brandSlug);
          setModels(nextModels);

          if (model && !nextModels.some((m) => m.slug === model.slug)) {
            setModel(null);
            setPack([]);
          }
        }
      }

      setSync({ status: 'done', ...counts });
    } catch (e) {
      setSync({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      syncingRef.current = false;
    }
  }, [brandSlug, model, type]);

  // Use the selected catalog model.
  const useModel = useCallback(() => {
    if (!model || !type) return;

    navigation.navigate('VehicleForm', {
      catalogModelSlug: model.slug,
      presetType: type,
      presetBrand: brandName ?? undefined,
      presetModel: model.name,
    });
  }, [model, type, brandName, navigation]);

  // Reset the library selection.
  const reset = useCallback(() => {
    setType(null);
    setBrandSlug(undefined);
    setBrands([]);
    setGenericAvailable(false);
    setModels([]);
    setModel(null);
    setPack([]);
    setBrandName(null);
    setDownload({ status: 'idle' });
    setError(null);
    setLoading(false);
  }, []);

  // Return to the initial library screen whenever this screen gains focus.
  useFocusEffect(
    useCallback(() => {
      reset();
    }, [reset]),
  );

  const goBack = useCallback(() => {
    if (model) {
      setModel(null);
      setPack([]);
      setDownload({ status: 'idle' });
      return;
    }

    if (brandSlug !== undefined) {
      setBrandSlug(undefined);
      setBrandName(null);
      setModels([]);
      return;
    }

    if (type !== null) {
      reset();
      return;
    }

    navigation.navigate('Garage');
  }, [model, brandSlug, type, reset, navigation]);

  const crumb = [
    type
      ? VEHICLE_TYPE_LABELS[type as keyof typeof VEHICLE_TYPE_LABELS] ?? type
      : null,
    brandName,
    model?.name,
  ]
    .filter(Boolean)
    .join('  ›  ');

  return (
    <Screen
      scroll
      contentStyle={{ paddingBottom: spacing.xxl + 80 }}
      title="Vehicle library"
      subtitle={crumb.length ? crumb : 'Pick a type, then a brand and model'}
      right={
        <View style={s.headerActions}>
          <TouchableOpacity
            style={s.syncBtn}
            onPress={() => void syncCatalog()}
            disabled={sync.status === 'busy'}
            accessibilityRole="button"
            accessibilityLabel="Sync catalog"
          >
            {sync.status === 'busy' ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={s.syncBtnTxt}>↻ Sync</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={s.backBtn}
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Back one step"
          >
            <Text style={s.backBtnTxt}>‹ Back</Text>
          </TouchableOpacity>
        </View>
      }
    >
      {sync.status === 'error' && (
        <View style={s.errorCard}>
          <Text style={s.errorTxt}>
            Sync notice: {sync.message}
          </Text>
        </View>
      )}

      {!!error && (
        <View style={s.errorCard}>
          <Text style={s.errorTxt}>{error}</Text>
        </View>
      )}

      {loading && (
        <ActivityIndicator color={colors.primary} style={s.loading} />
      )}

      {/* Initial vehicle category selection */}
      {!loading && type === null && (
        <>
          <Text style={s.stepHint}>Choose your vehicle</Text>

          <View style={s.categoryGrid}>
            {VEHICLE_LIBRARY_CATEGORIES.map((category) => (
              <TouchableOpacity
                key={category.type}
                style={s.categoryCard}
                onPress={() => void pickType(category.type)}
                accessibilityRole="button"
                accessibilityLabel={`Choose ${category.name}`}
              >
                <ImageBackground
                  source={{ uri: category.image }}
                  style={s.categoryImage}
                  imageStyle={s.categoryImageStyle}
                  resizeMode="cover"
                >
                  <View style={s.categoryText}>
                    <Text style={s.categoryTitle}>{category.name}</Text>
                    <Text style={s.categoryDescription}>
                      {category.description}
                    </Text>
                  </View>
                </ImageBackground>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {/* Brand selection */}
      {!loading && type !== null && brandSlug === undefined && (
        <>
          <Text style={s.stepHint}>Brand</Text>

          {brands.map((b) => (
            <TouchableOpacity
              key={b.slug}
              style={s.row}
              onPress={() => void pickBrand(b.slug, b.name)}
              accessibilityRole="button"
              accessibilityLabel={`Brand ${b.name}`}
            >
              <Text style={s.rowTxt}>{b.name}</Text>
              <Text style={s.chevron}>›</Text>
            </TouchableOpacity>
          ))}

          {genericAvailable && (
            <TouchableOpacity
              style={s.row}
              onPress={() => void pickBrand(null, 'Other')}
              accessibilityRole="button"
              accessibilityLabel="Other brand"
            >
              <Text style={s.rowTxt}>Other …</Text>
              <Text style={s.chevron}>›</Text>
            </TouchableOpacity>
          )}

          {brands.length === 0 && !genericAvailable && (
            <Text style={s.muted}>
              No catalog models for this type yet.
            </Text>
          )}
        </>
      )}

      {/* Model selection */}
      {!loading && brandSlug !== undefined && model === null && (
        <>
          <Text style={s.stepHint}>Model</Text>

          {models.map((m) => (
            <TouchableOpacity
              key={m.slug}
              style={s.row}
              onPress={() => void pickModel(m)}
              accessibilityRole="button"
              accessibilityLabel={`Model ${m.name}`}
            >
              <Text style={s.rowTxt}>{m.name}</Text>
              <Text style={s.chevron}>›</Text>
            </TouchableOpacity>
          ))}

          {models.length === 0 && (
            <Text style={s.muted}>
              No models in this brand yet.
            </Text>
          )}
        </>
      )}

      {/* Maintenance pack confirmation */}
      {!loading && model !== null && (
        <>
          <Text style={s.stepHint}>
            Maintenance rules for {model.name}
          </Text>

          {pack.length === 0 ? (
            <Text style={s.muted}>
              No resource-pack rules for this model yet — maintenance will stay
              &quot;unknown&quot; until history exists. You can still add the
              vehicle.
            </Text>
          ) : (
            pack.map((r) => {
              const def = getComponentDefinition(r.componentCode);

              return (
                <View
                  key={`${r.modelSlug}:${r.componentCode}:${r.version}`}
                  style={s.packRow}
                >
                  <Text style={s.packName}>
                    {def?.name ?? r.componentCode}
                  </Text>

                  <Text style={s.packValue}>
                    {r.intervalKm != null
                      ? `Every ${formatDistanceKm(r.intervalKm, units)}${r.intervalDays != null ? ` / ${r.intervalDays} days` : ''}`
                      : r.intervalDays != null
                        ? `Every ${r.intervalDays} days`
                        : 'Interval not set'}
                    {r.reviewStatus === 'draft' ? ' · draft' : ' · reviewed'}
                  </Text>
                </View>
              );
            })
          )}

          <Text style={s.honesty}>
            Pack values are catalog data with review status shown above — never
            manufacturer recommendations. Your own overrides always win.
          </Text>

          <View style={s.downloadBox}>
            {download.status === 'busy' ? (
              <ActivityIndicator color={colors.primary} />
            ) : download.status === 'done' ? (
              <Text style={s.downloadDone}>
                Updated from the catalog (version {download.version}).
              </Text>
            ) : download.status === 'error' ? (
              <Text style={s.errorTxt}>
                Refresh failed: {download.message} — using local data.
              </Text>
            ) : null}

            <TouchableOpacity
              style={[s.btn, !hasSupabaseConfig() && s.btnDisabled]}
              onPress={() => void refreshPack()}
              disabled={download.status === 'busy' || !hasSupabaseConfig()}
              accessibilityRole="button"
              accessibilityState={{
                disabled:
                  download.status === 'busy' || !hasSupabaseConfig(),
              }}
            >
              <Text style={s.btnTxt}>
                {hasSupabaseConfig()
                  ? 'Refresh rules from catalog'
                  : 'Cloud catalog not configured'}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={s.btnPrimary}
            onPress={useModel}
            accessibilityRole="button"
          >
            <Text style={s.btnPrimaryTxt}>Use this model</Text>
          </TouchableOpacity>
        </>
      )}

      {/* Manual vehicle entry */}
      <TouchableOpacity
        style={s.btnGhost}
        onPress={() =>
          navigation.navigate(
            'VehicleForm',
            type ? { presetType: type } : undefined,
          )
        }
        accessibilityRole="button"
      >
        <Text style={s.btnGhostTxt}>
          Enter vehicle details manually
        </Text>
      </TouchableOpacity>
    </Screen>
  );
}

const s = StyleSheet.create({
  loading: {
    marginTop: spacing.xl,
  },

  stepHint: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },

  // Original two-column category layout.
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },

  categoryCard: {
    width: '48.5%',
    aspectRatio: 0.95,
    marginBottom: spacing.md,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },

  categoryImage: {
    flex: 1,
    justifyContent: 'flex-end',
  },

  categoryImageStyle: {
    borderRadius: radii.md,
  },

  categoryText: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },

  categoryTitle: {
    ...typography.body,
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 18,
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },

  categoryDescription: {
    ...typography.caption,
    color: '#FFFFFF',
    marginTop: spacing.xs,
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },

  // Catalog rows.
  row: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  rowTxt: {
    ...typography.body,
    color: colors.text,
  },

  chevron: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 18,
  },

  // Maintenance pack.
  packRow: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },

  packName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },

  packValue: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },

  honesty: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 18,
    marginTop: spacing.sm,
  },

  muted: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.sm,
    lineHeight: 20,
  },

  downloadBox: {
    marginTop: spacing.md,
  },

  downloadDone: {
    ...typography.caption,
    color: colors.primary,
    marginBottom: spacing.sm,
  },

  // Error message.
  errorCard: {
    backgroundColor: colors.surface,
    borderColor: colors.danger,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },

  errorTxt: {
    ...typography.body,
    color: colors.danger,
  },

  // Buttons.
  btn: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },

  btnDisabled: {
    opacity: 0.6,
  },

  btnTxt: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },

  btnPrimary: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },

  btnPrimaryTxt: {
    ...typography.body,
    color: colors.onPrimary,
    fontWeight: '700',
  },

  btnGhost: {
    backgroundColor: 'transparent',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },

  btnGhostTxt: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },

  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },

  syncBtn: {
    borderColor: colors.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  syncBtnTxt: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },

  backBtn: {
    borderColor: colors.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },

  backBtnTxt: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
});
