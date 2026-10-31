import React, { useCallback, useMemo, useState } from 'react';
<<<<<<< HEAD
import { ActivityIndicator, type ColorValue, Alert, StyleSheet } from 'react-native';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text, TextInput } from '../../ui/neu/NeuText';
=======
import {
  ActivityIndicator,
  type ColorValue,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
>>>>>>> 085d579c1634fc5cd9a597346cae31cf95b819b5
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import * as Crypto from 'expo-crypto';
import { getDb } from '../../data/local/db';
import {
  getActiveVehicle,
  getVehicle,
  vehicleDisplayName,
} from '../../data/local/vehicleStore';
import {
  createAccessory,
  listAccessories,
  softDeleteAccessory,
  updateAccessory,
  type AccessoryRow,
} from '../../data/local/accessoryStore';
import {
  getBatteryState,
  recordBatteryUse,
  type BatteryStateRow,
} from '../../data/local/batteryStore';
import {
  BATTERY_IDLE_LEVEL_LABELS,
  batteryIdleDays,
  batteryIdleLevel,
} from '../../domain/battery/idle';
import Screen from '../../ui/Screen';
import Placeholder from '../../ui/Placeholder';
import { colors, radii, spacing, typography } from '../../ui/theme';
import type { RootTabParamList } from '../../app/RootNavigator';

type Props = BottomTabScreenProps<RootTabParamList, 'Equipment'>;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Text input -> epoch ms. Empty means "no date"; anything not YYYY-MM-DD is invalid so a typo
// never silently drops the date (the store rejects future dates itself).
function parseYmd(text: string): number | 'invalid' | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const m = DATE_RE.exec(trimmed);
  if (!m) return 'invalid';
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(ms)) return 'invalid';
  return ms;
}

function ymd(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type FormState = {
  id: string | null;
  name: string;
  brand: string;
  model: string;
  installedAt: string;
  notes: string;
};

const emptyForm: FormState = { id: null, name: '', brand: '', model: '', installedAt: '', notes: '' };

// Per-vehicle equipment: descriptive accessories plus a manual battery check-in. Accessories
// deliberately carry no intervals or status (the data layer forbids it) — this screen is a list,
// not a scheduler. Battery idle is computed from the single "last in use" timestamp.
export default function EquipmentScreen({ navigation, route }: Props) {
  const vehicleId = route.params?.vehicleId ?? null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vehicleName, setVehicleName] = useState('');
  const [resolvedVehicleId, setResolvedVehicleId] = useState<string | null>(null);
  const [accessories, setAccessories] = useState<AccessoryRow[]>([]);
  const [battery, setBattery] = useState<BatteryStateRow | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDb();
      const vehicle = vehicleId ? await getVehicle(db, vehicleId) : await getActiveVehicle(db);
      if (!vehicle) {
        setResolvedVehicleId(null);
        setVehicleName('');
        setAccessories([]);
        setBattery(null);
        setError(vehicleId ? 'Vehicle not found.' : 'No active vehicle. Pick one in the Garage first.');
        return;
      }
      const [list, batt] = await Promise.all([
        listAccessories(db, vehicle.id),
        getBatteryState(db, vehicle.id),
      ]);
      setResolvedVehicleId(vehicle.id);
      setVehicleName(vehicleDisplayName(vehicle));
      setAccessories(list);
      setBattery(batt);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => setLoading(false));
    }, [refresh]),
  );

  const batteryView = useMemo(() => {
    if (!battery) return null;
    const days = batteryIdleDays(battery.last_active_at, Date.now());
    const level = batteryIdleLevel(days);
    return { days, level, label: BATTERY_IDLE_LEVEL_LABELS[level] };
  }, [battery]);

  const markBatteryUse = useCallback(async () => {
    if (!resolvedVehicleId) return;
    try {
      const db = await getDb();
      await recordBatteryUse(db, resolvedVehicleId, Date.now(), battery?.note ?? null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [resolvedVehicleId, battery, refresh]);

  const saveAccessory = useCallback(async () => {
    if (!form || !resolvedVehicleId) return;
    const installed = parseYmd(form.installedAt);
    if (installed === 'invalid') {
      setError('Installation date must be YYYY-MM-DD (e.g. 2026-03-12).');
      return;
    }
    setSaving(true);
    try {
      const db = await getDb();
      const input = {
        user_vehicle_id: resolvedVehicleId,
        name: form.name,
        brand: form.brand.trim() || null,
        model: form.model.trim() || null,
        installed_at: installed,
        notes: form.notes.trim() || null,
      };
      if (form.id) {
        await updateAccessory(db, form.id, { ...input, id: form.id });
      } else {
        await createAccessory(db, { ...input, id: Crypto.randomUUID() });
      }
      setForm(null);
      setError(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [form, resolvedVehicleId, refresh]);

  const removeAccessory = useCallback(
    (row: AccessoryRow) => {
      Alert.alert('Remove accessory', `Remove "${row.name}" from this vehicle?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                const db = await getDb();
                await softDeleteAccessory(db, row.id);
                await refresh();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            })();
          },
        },
      ]);
    },
    [refresh],
  );

  const startEdit = useCallback((row: AccessoryRow) => {
    setForm({
      id: row.id,
      name: row.name,
      brand: row.brand ?? '',
      model: row.model ?? '',
      installedAt: row.installed_at != null ? ymd(row.installed_at) : '',
      notes: row.notes ?? '',
    });
  }, []);

  if (loading) {
    return (
      <Screen title="Equipment" scroll={false}>
        <ActivityIndicator color={colors.primary} style={s.loading} />
      </Screen>
    );
  }

  if (!resolvedVehicleId) {
    return (
      <Screen title="Equipment">
        <Placeholder
          title="No vehicle selected"
          message={error ?? 'Pick a vehicle in the Garage, then open its equipment from the vehicle card.'}
        />
        <TouchableOpacity style={s.btnGhost} onPress={() => navigation.navigate('Garage')} accessibilityRole="button">
          <Text style={s.btnGhostTxt}>Go to Garage</Text>
        </TouchableOpacity>
      </Screen>
    );
  }

  const levelColors: Record<string, { bg: ColorValue; fg: ColorValue }> = {
    ok: { bg: colors.surfaceRaised, fg: colors.textMuted },
    watch: { bg: colors.warningSurface, fg: colors.warningText },
    warn: { bg: 'rgba(255, 127, 152, 0.14)', fg: colors.danger },
  };

  return (
    <Screen title="Equipment" subtitle={vehicleName} keyboardShouldPersistTaps="handled">
      {!!error && (
        <View style={s.errorCard}>
          <Text style={s.errorTxt}>{error}</Text>
        </View>
      )}

      <View style={s.card}>
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>Battery</Text>
          {batteryView && (
            <View style={[s.badge, { backgroundColor: levelColors[batteryView.level].bg }]}>
              <Text style={[s.badgeTxt, { color: levelColors[batteryView.level].fg }]}>
                {batteryView.label}
              </Text>
            </View>
          )}
        </View>
        {!battery ? (
          <Text style={s.muted}>
            Not tracked yet. Tap when the battery is in use so idle days can be counted.
          </Text>
        ) : (
          <>
            <Text style={s.muted}>
              Last in use {new Date(battery.last_active_at).toLocaleDateString()}
              {batteryView?.days != null ? ` · ${batteryView.days} day${batteryView.days === 1 ? '' : 's'} idle` : ''}
              .
            </Text>
            {!!battery.note && <Text style={s.note}>Note: {battery.note}</Text>}
          </>
        )}
        <TouchableOpacity
          style={s.btnPrimary}
          onPress={() => void markBatteryUse()}
          accessibilityRole="button"
          accessibilityLabel="Battery in use today"
        >
          <Text style={s.btnPrimaryTxt}>Battery in use today</Text>
        </TouchableOpacity>
        <Text style={s.fineprint}>
          Manual check-in only — Vehitra cannot read your battery. Idle days count from this tap.
        </Text>
      </View>

      <View style={s.card}>
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>Accessories</Text>
          {!form && (
            <TouchableOpacity
              style={s.btnGhostSm}
              onPress={() => setForm({ ...emptyForm })}
              accessibilityRole="button"
              accessibilityLabel="Add accessory"
            >
              <Text style={s.btnGhostSmTxt}>+ Add</Text>
            </TouchableOpacity>
          )}
        </View>

        {accessories.length === 0 && !form && (
          <Text style={s.muted}>
            No accessories yet — things like mounts, chargers or helmets you want to keep track of.
          </Text>
        )}

        {accessories.map((row) => (
          <View key={row.id} style={s.row}>
            <View style={s.rowText}>
              <Text style={s.rowTitle}>{row.name}</Text>
              {[row.brand, row.model].filter(Boolean).join(' · ') && (
                <Text style={s.muted}>{[row.brand, row.model].filter(Boolean).join(' · ')}</Text>
              )}
              {row.installed_at != null && (
                <Text style={s.muted}>Installed {ymd(row.installed_at)}</Text>
              )}
              {!!row.notes && <Text style={s.note}>{row.notes}</Text>}
            </View>
            <View style={s.rowActions}>
              <TouchableOpacity style={s.btnGhostSm} onPress={() => startEdit(row)} accessibilityRole="button">
                <Text style={s.btnGhostSmTxt}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.btnGhostSm}
                onPress={() => removeAccessory(row)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${row.name}`}
              >
                <Text style={[s.btnGhostSmTxt, { color: colors.danger }]}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {form && (
          <View style={s.form}>
            <Field
              label="Name"
              value={form.name}
              onChangeText={(t) => setForm({ ...form, name: t })}
              placeholder="e.g. Phone mount"
            />
            <Field
              label="Brand"
              value={form.brand}
              onChangeText={(t) => setForm({ ...form, brand: t })}
              placeholder="Optional"
            />
            <Field
              label="Model"
              value={form.model}
              onChangeText={(t) => setForm({ ...form, model: t })}
              placeholder="Optional"
            />
            <Field
              label="Installed (YYYY-MM-DD)"
              value={form.installedAt}
              onChangeText={(t) => setForm({ ...form, installedAt: t })}
              placeholder="Optional"
            />
            <Field
              label="Notes"
              value={form.notes}
              onChangeText={(t) => setForm({ ...form, notes: t })}
              placeholder="Optional"
            />
            <View style={s.formActions}>
              <TouchableOpacity
                style={s.btnPrimary}
                onPress={() => void saveAccessory()}
                disabled={saving}
                accessibilityRole="button"
              >
                <Text style={s.btnPrimaryTxt}>{saving ? 'Saving…' : form.id ? 'Save changes' : 'Add accessory'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnGhost} onPress={() => setForm(null)} accessibilityRole="button">
                <Text style={s.btnGhostTxt}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Screen>
  );
}

function Field({
  label,
  ...input
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        {...input}
        style={s.input}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="sentences"
      />
    </View>
  );
}

const s = StyleSheet.create({
  loading: { marginTop: spacing.xl },
  errorCard: {
    backgroundColor: colors.surface,
    borderColor: colors.danger,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  errorTxt: { ...typography.body, color: colors.danger },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { ...typography.heading, fontSize: 16 },
  badge: { borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginLeft: spacing.sm },
  badgeTxt: { ...typography.caption, fontWeight: '700' },
  muted: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 20 },
  note: { ...typography.caption, marginTop: spacing.xs, lineHeight: 18 },
  fineprint: { ...typography.caption, marginTop: spacing.sm, lineHeight: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  rowText: { flex: 1 },
  rowTitle: { ...typography.body, fontWeight: '600' },
  rowActions: { flexDirection: 'row', marginLeft: spacing.sm },
  form: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  field: { marginBottom: spacing.md },
  fieldLabel: { ...typography.label, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.text,
    ...typography.body,
  },
  formActions: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  btnPrimary: {
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
  },
  btnPrimaryTxt: { ...typography.body, color: colors.onPrimary, fontWeight: '700' },
  btnGhost: {
    backgroundColor: colors.surface,

    alignSelf: 'flex-start',
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginRight: spacing.md,
  },
  btnGhostTxt: { ...typography.body, color: colors.primary, fontWeight: '600' },
  btnGhostSm: {
    backgroundColor: colors.surface,

    borderRadius: radii.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    marginLeft: spacing.sm,
  },
  btnGhostSmTxt: { ...typography.caption, color: colors.primary, fontWeight: '600' },
});
