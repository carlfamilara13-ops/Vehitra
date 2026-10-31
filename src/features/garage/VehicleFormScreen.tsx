import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text, TextInput } from '../../ui/neu/NeuText';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import * as Crypto from 'expo-crypto';
import { getDb } from '../../data/local/db';
import { odometerInputLabel } from '../../domain/units';
import { usePrefs } from '../../app/prefs';
import {
  createVehicle,
  getVehicle,
  listVehicles,
  setActiveVehicle,
  softDeleteVehicle,
  updateVehicle,
  validateVehicleInput,
  VEHICLE_TYPE_LABELS,
  VEHICLE_TYPES,
  type VehicleInput,
  type VehicleType,
} from '../../data/local/vehicleStore';
import { getCatalogModel, getModelPack } from '../../data/local/catalogStore';
import Screen from '../../ui/Screen';
import { colors, radii, spacing, typography } from '../../ui/theme';
import type { RootTabParamList } from '../../app/RootNavigator';

type Props = BottomTabScreenProps<RootTabParamList, 'VehicleForm'>;

const numOrNull = (raw: string): number | null => {
  const t = raw.trim();
  return t.length ? Number(t) : null;
};

// Add or edit one vehicle. Only the type is required; everything else can stay blank for a
// generic/custom vehicle. Saves to the local store; the first vehicle added becomes active.
export default function VehicleFormScreen({ route, navigation }: Props) {
  const prefs = usePrefs();
  const editId = route.params?.id;
  const isEdit = !!editId;
  // Chosen through the vehicle library: preserved for the whole session even if the user backs
  // out and returns — kept in state so a re-render never loses the linkage.
  const catalogSlug = route.params?.catalogModelSlug ?? null;

  const [loading, setLoading] = useState(!!editId);
  const [type, setType] = useState<string>(route.params?.presetType ?? 'motorcycle');
  const [nickname, setNickname] = useState('');
  const [brand, setBrand] = useState(route.params?.presetBrand ?? '');
  const [model, setModel] = useState(route.params?.presetModel ?? '');
  const [year, setYear] = useState('');
  const [plate, setPlate] = useState('');
  const [odometer, setOdometer] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadDone, setLoadDone] = useState(!editId);
  // Human description of the catalog link ("Click 125 — draft pack rules"), when one exists.
  const [catalogNotice, setCatalogNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!editId) return;
    let alive = true;
    (async () => {
      try {
        const db = await getDb();
        const v = await getVehicle(db, editId);
        if (!alive) return;
        if (!v) {
          setErrors(['This vehicle is no longer in your garage.']);
          return;
        }
        setType(v.vehicle_type);
        setNickname(v.nickname ?? '');
        setBrand(v.brand ?? '');
        setModel(v.model ?? '');
        setYear(v.model_year != null ? String(v.model_year) : '');
        setPlate(v.plate ?? '');
        setOdometer(v.odometer_km != null ? String(v.odometer_km) : '');
        if (v.catalog_model_slug) {
          const cm = await getCatalogModel(db, v.catalog_model_slug);
          if (alive && cm) setCatalogNotice(`${cm.name} (${cm.slug}) — rules from its resource pack`);
        }
      } catch (e) {
        if (alive) setErrors([e instanceof Error ? e.message : String(e)]);
      } finally {
        if (alive) setLoadDone(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [editId]);

  // Library-picked model: resolve its name for the notice (presets above already prefilled
  // the plain fields on first render).
  useEffect(() => {
    if (editId || !catalogSlug) return;
    let alive = true;
    (async () => {
      try {
        const db = await getDb();
        const cm = await getCatalogModel(db, catalogSlug);
        if (alive && cm) setCatalogNotice(`${cm.name} (${cm.slug}) — rules from its resource pack`);
      } catch {
        // notice is decorative; saving still validates the link
      }
    })();
    return () => {
      alive = false;
    };
  }, [editId, catalogSlug]);

  const onSave = useCallback(async () => {
    const input = {
      vehicle_type: type,
      nickname,
      brand,
      model,
      model_year: year.trim() ? Number(year.trim()) : null,
      plate,
      odometer_km: odometer.trim() ? Number(odometer.trim()) : null,
    };
    const problems = validateVehicleInput(input);
    if (problems.length) {
      setErrors(problems);
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      const db = await getDb();
      if (editId) {
        await updateVehicle(db, editId, input);
      } else {
        // Attach the library linkage only if the model still exists and matches the chosen
        // type — the form stays usable without it (manual entry never requires a catalog model).
        let catalog: { catalog_model_slug: string; catalog_version: number } | null = null;
        if (catalogSlug) {
          const cm = await getCatalogModel(db, catalogSlug);
          if (!cm) {
            setErrors(['That catalog model is no longer available. Save again without it, or pick the model again.']);
            setSaving(false);
            return;
          }
          if (cm.vehicle_type !== type) {
            setErrors([`That model is a ${VEHICLE_TYPE_LABELS[cm.vehicle_type as VehicleType] ?? cm.vehicle_type}. Change the vehicle type back, or go to the library to pick a matching model.`]);
            setSaving(false);
            return;
          }
          const rows = await getModelPack(db, catalogSlug);
          const version = rows.reduce((max, r) => Math.max(max, r.version), 1);
          catalog = { catalog_model_slug: catalogSlug, catalog_version: version };
        }
        const id = Crypto.randomUUID();
        await createVehicle(db, { id, ...input, ...catalog });
        const all = await listVehicles(db);
        if (all.length === 1) await setActiveVehicle(db, id);
      }
      navigation.navigate('Garage');
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
      setSaving(false);
    }
  }, [editId, type, nickname, brand, model, year, plate, odometer, catalogSlug, navigation]);

  const doDelete = useCallback(async () => {
    if (!editId) return;
    setSaving(true);
    try {
      const db = await getDb();
      await softDeleteVehicle(db, editId);
      navigation.navigate('Garage');
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
      setSaving(false);
    }
  }, [editId, navigation]);

  const confirmDelete = useCallback(() => {
    Alert.alert('Remove vehicle', 'This removes the vehicle from your garage. Ride records are not affected.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void doDelete() },
    ]);
  }, [doDelete]);

  if (!loadDone) {
    return (
      <Screen title="Edit vehicle" scroll={false} keyboardShouldPersistTaps="handled">
        <ActivityIndicator color={colors.primary} style={s.loading} />
      </Screen>
    );
  }

  return (
    <Screen
      title={editId ? 'Edit vehicle' : 'Add vehicle'}
      subtitle="Stored on this device — works offline"
      keyboardShouldPersistTaps="handled"
    >
      <Text style={s.label}>Vehicle type</Text>
      <View style={s.chips}>
        {VEHICLE_TYPES.map((t) => {
          const selected = t === type;
          return (
            <TouchableOpacity
              key={t}
              style={[s.chip, selected && s.chipSelected]}
              onPress={() => setType(t)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={VEHICLE_TYPE_LABELS[t]}
            >
              <Text style={[s.chipTxt, selected && s.chipTxtSelected]}>{VEHICLE_TYPE_LABELS[t]}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Field label="Nickname" value={nickname} onChangeText={setNickname} placeholder="e.g. Daily rider" />
      <Field label="Brand" value={brand} onChangeText={setBrand} placeholder="Optional" />
      <Field label="Model" value={model} onChangeText={setModel} placeholder="Optional" />
      <Field
        label="Year"
        value={year}
        onChangeText={setYear}
        placeholder="Optional"
        keyboardType="number-pad"
        maxLength={4}
      />
      <Field
        label="Plate"
        value={plate}
        onChangeText={setPlate}
        placeholder="Optional"
        autoCapitalize="characters"
        maxLength={20}
      />
      <Field
        label={odometerInputLabel(prefs.units)}
        value={odometer}
        onChangeText={setOdometer}
        placeholder="Optional"
        keyboardType="number-pad"
      />

      {!!catalogNotice && (
        <View style={s.catalogBox}>
          <Text style={s.catalogTxt}>{catalogNotice}</Text>
          <Text style={s.catalogSub}>
            Maintenance intervals come from this model&apos;s resource pack (draft catalog data — not
            manufacturer recommendations) until you set your own.
          </Text>
        </View>
      )}

      {errors.length > 0 && (
        <View style={s.errors}>
          {errors.map((e, i) => (
            <Text key={i} style={s.errorTxt}>• {e}</Text>
          ))}
        </View>
      )}

      <TouchableOpacity
        style={[s.btn, saving && s.btnDisabled]}
        onPress={() => void onSave()}
        disabled={saving}
        accessibilityRole="button"
        accessibilityState={{ disabled: saving }}
      >
        <Text style={s.btnTxt}>{saving ? 'Saving…' : editId ? 'Save changes' : 'Add vehicle'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={s.btnGhost}
        onPress={() => navigation.navigate('Garage')}
        accessibilityRole="button"
      >
        <Text style={s.btnGhostTxt}>Cancel</Text>
      </TouchableOpacity>

      {!!editId && (
        <TouchableOpacity style={s.removeBtn} onPress={confirmDelete} accessibilityRole="button">
          <Text style={s.removeTxt}>Remove vehicle</Text>
        </TouchableOpacity>
      )}
    </Screen>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  maxLength?: number;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        autoCorrect={false}
        maxLength={maxLength}
        accessibilityLabel={label}
      />
    </View>
  );
}

const s = StyleSheet.create({
  loading: { marginTop: spacing.xl },
  label: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  chips: {
    backgroundColor: colors.surface, flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm },
  chip: {
    borderColor: 'transparent',
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.surfaceRaised },
  chipTxt: { ...typography.body, color: colors.textMuted },
  chipTxtSelected: { color: colors.primary, fontWeight: '700' },
  field: { marginTop: spacing.md },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 15,
  },
  errors: {
    borderColor: colors.danger,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  catalogBox: {
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
  },
  catalogTxt: { ...typography.body, color: colors.text, fontWeight: '600' },
  catalogSub: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 18 },
  errorTxt: { ...typography.body, color: colors.danger, marginBottom: spacing.xs },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  btnDisabled: { opacity: 0.6 },
  btnTxt: { ...typography.body, color: colors.onPrimary, fontWeight: '700' },
  btnGhost: {
    backgroundColor: colors.surface,

    borderRadius: radii.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  btnGhostTxt: { ...typography.body, color: colors.primary, fontWeight: '600' },
  removeBtn: { alignSelf: 'center', marginTop: spacing.xl },
  removeTxt: { ...typography.body, color: colors.danger, fontWeight: '600' },
});
