import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
import { hasSupabaseConfig } from '../../data/remote/client';
import { getComponentDefinition } from '../../domain/maintenance/components';
import type { CatalogPackRow } from '../../domain/catalog/packs';
import { formatDistanceKm, type Units } from '../../domain/units';
import Screen from '../../ui/Screen';
import { colors, radii, spacing, typography } from '../../ui/theme';
import { VEHICLE_TYPES, VEHICLE_TYPE_LABELS } from '../../data/local/vehicleStore';
import type { RootTabParamList } from '../../app/RootNavigator';

type Props = BottomTabScreenProps<RootTabParamList, 'VehicleLibrary'>;

// Sentinel for the last brand row: the "Other …" generic models (brand_slug is null).
const GENERIC = '__generic__';

type DownloadState = { status: 'idle' | 'busy' } | { status: 'done'; version: number } | { status: 'error'; message: string };
type CatalogSyncState =
  | { status: 'idle' | 'busy' }
  | { status: 'done'; brands: number; models: number }
  | { status: 'error'; message: string };

// Vehicle library: type → brand → model → confirm. Reads only the local catalog tables, so it
// works fully offline; a pack refresh against the cloud catalog is an explicit extra action whose
// result is always reported. The final step hands the chosen model to VehicleForm as presets —
// the form still owns saving (and the user can still enter every detail manually).
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

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          const db = await getDb();
          const s = await getAppSettings(db);
          if (alive) setUnits(s.units);
        } catch {
          // units are cosmetic here; defaults are fine if the read fails
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
    setModel(null);
    setPack([]);
    setBrandName(null);
    setDownload({ status: 'idle' });
    setError(null);
    setLoading(true);
    try {
      const db = await getDb();
      const [list, hasGeneric] = await Promise.all([listCatalogBrands(db, t), hasGenericModels(db, t)]);
      setBrands(list);
      setGenericAvailable(hasGeneric);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Brand chosen (or the generic step) → load models.
  const pickBrand = useCallback(
    async (slug: string | null, name: string | null) => {
      if (!type) return;
      setBrandSlug(slug);
      setBrandName(name);
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

  // Model chosen → load its pack for the confirmation step.
  const pickModel = useCallback(async (m: CatalogModelRow) => {
    setModel(m);
    setDownload({ status: 'idle' });
    setError(null);
    setLoading(true);
    try {
      const db = await getDb();
      setPack(await getModelPack(db, m.slug));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

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
        setDownload({ status: 'error', message: 'The catalog has no rules for this model yet.' });
        return;
      }
      await replaceModelPack(db, result.rows);
      setPack(await getModelPack(db, model.slug));
      setDownload({ status: 'done', version: result.version });
    } catch (e) {
      setDownload({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [model]);

  const syncCatalog = useCallback(async () => {
    if (sync.status === 'busy') return;
    setSync({ status: 'busy' });
    try {
      const result = await downloadCatalogIndex();
      if (!result.ok) {
        setSync({ status: 'error', message: result.message });
        return;
      }
      const db = await getDb();
      const counts = await replaceCatalogIndex(db, result.brands, result.models);
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
      setSync({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [brandSlug, model, sync.status, type]);

  const useModel = useCallback(() => {
    if (!model || !type) return;
    navigation.navigate('VehicleForm', {
      catalogModelSlug: model.slug,
      presetType: type,
      presetBrand: brandName ?? undefined,
      presetModel: model.name,
    });
  }, [model, type, brandName, navigation]);

  const reset = () => {
    setType(null);
    setBrandSlug(undefined);
    setModel(null);
    setPack([]);
    setBrandName(null);
    setDownload({ status: 'idle' });
    setError(null);
  };

  const crumb = [type ? VEHICLE_TYPE_LABELS[type as keyof typeof VEHICLE_TYPE_LABELS] ?? type : null, brandName, model?.name]
    .filter(Boolean)
    .join('  ›  ');

  return (
    <Screen
      title="Vehicle library"
      subtitle={crumb.length ? crumb : 'Pick a type, then a brand and model'}
      right={
        <TouchableOpacity
          style={s.backBtn}
          onPress={() => (model ? setModel(null) : brandSlug !== undefined ? setBrandSlug(undefined) : reset())}
          accessibilityRole="button"
          accessibilityLabel="Back one step"
        >
          <Text style={s.backBtnTxt}>‹ Back</Text>
        </TouchableOpacity>
      }
    >
      {!!error && (
        <View style={s.errorCard}>
          <Text style={s.errorTxt}>{error}</Text>
        </View>
      )}

      {loading && <ActivityIndicator color={colors.primary} style={s.loading} />}

      {!loading && type === null && (
        <>
          <Text style={s.stepHint}>Vehicle type</Text>
          <View style={s.chips}>
            {VEHICLE_TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                style={s.chip}
                onPress={() => void pickType(t)}
                accessibilityRole="button"
                accessibilityLabel={VEHICLE_TYPE_LABELS[t]}
              >
                <Text style={s.chipTxt}>{VEHICLE_TYPE_LABELS[t]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

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
            <Text style={s.muted}>No catalog models for this type yet.</Text>
          )}
        </>
      )}

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
          {models.length === 0 && <Text style={s.muted}>No models in this brand yet.</Text>}
        </>
      )}

      {!loading && model !== null && (
        <>
          <Text style={s.stepHint}>Maintenance rules for {model.name}</Text>
          {pack.length === 0 ? (
            <Text style={s.muted}>
              No resource-pack rules for this model yet — maintenance will stay &quot;unknown&quot; until history
              exists. You can still add the vehicle.
            </Text>
          ) : (
            pack.map((r) => {
              const def = getComponentDefinition(r.componentCode);
              return (
                <View key={`${r.modelSlug}:${r.componentCode}:${r.version}`} style={s.packRow}>
                  <Text style={s.packName}>{def?.name ?? r.componentCode}</Text>
                  <Text style={s.packValue}>
                    {r.intervalKm != null ? `Every ${formatDistanceKm(r.intervalKm, units)}` : 'Interval not set'}
                    {r.reviewStatus === 'draft' ? ' · draft' : ' · reviewed'}
                  </Text>
                </View>
              );
            })
          )}
          <Text style={s.honesty}>
            Pack values are catalog data with review status shown above — never manufacturer
            recommendations. Your own overrides always win.
          </Text>

          <View style={s.downloadBox}>
            {download.status === 'busy' ? (
              <ActivityIndicator color={colors.primary} />
            ) : download.status === 'done' ? (
              <Text style={s.downloadDone}>Updated from the catalog (version {download.version}).</Text>
            ) : download.status === 'error' ? (
              <Text style={s.errorTxt}>Refresh failed: {download.message} — using local data.</Text>
            ) : null}
            <TouchableOpacity
              style={[s.btn, !hasSupabaseConfig() && s.btnDisabled]}
              onPress={() => void refreshPack()}
              disabled={download.status === 'busy' || !hasSupabaseConfig()}
              accessibilityRole="button"
              accessibilityState={{ disabled: download.status === 'busy' || !hasSupabaseConfig() }}
            >
              <Text style={s.btnTxt}>
                {hasSupabaseConfig() ? 'Refresh rules from catalog' : 'Cloud catalog not configured'}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={s.btnPrimary} onPress={useModel} accessibilityRole="button">
            <Text style={s.btnPrimaryTxt}>Use this model</Text>
          </TouchableOpacity>
        </>
      )}

      <TouchableOpacity
        style={s.btnGhost}
        onPress={() => navigation.navigate('VehicleForm', type ? { presetType: type } : undefined)}
        accessibilityRole="button"
      >
        <Text style={s.btnGhostTxt}>Enter vehicle details manually</Text>
      </TouchableOpacity>
    </Screen>
  );
}

const s = StyleSheet.create({
  loading: { marginTop: spacing.xl },
  stepHint: { ...typography.label, color: colors.textMuted, marginBottom: spacing.sm, marginTop: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  chipTxt: { ...typography.body, color: colors.textMuted },
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
  rowTxt: { ...typography.body, color: colors.text },
  chevron: { ...typography.body, color: colors.textMuted, fontSize: 18 },
  packRow: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  packName: { ...typography.body, color: colors.text, fontWeight: '600' },
  packValue: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  honesty: { ...typography.caption, color: colors.textMuted, lineHeight: 18, marginTop: spacing.sm },
  muted: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 20 },
  downloadBox: { marginTop: spacing.md },
  downloadDone: { ...typography.caption, color: colors.primary, marginBottom: spacing.sm },
  errorCard: {
    borderColor: colors.danger,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorTxt: { ...typography.body, color: colors.danger },
  btn: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  btnDisabled: { opacity: 0.6 },
  btnTxt: { ...typography.body, color: colors.text, fontWeight: '700' },
  btnPrimary: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  btnPrimaryTxt: { ...typography.body, color: colors.primaryInk, fontWeight: '700' },
  btnGhost: {
    borderColor: colors.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  btnGhostTxt: { ...typography.body, color: colors.primary, fontWeight: '600' },
  backBtn: {
    borderColor: colors.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  backBtnTxt: { ...typography.body, color: colors.primary, fontWeight: '600' },
});
