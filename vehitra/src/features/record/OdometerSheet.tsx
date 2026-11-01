import React, { useEffect, useState } from 'react';
import { Keyboard, Modal, StyleSheet } from 'react-native';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text, TextInput } from '../../ui/neu/NeuText';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { VehicleRow } from '../../data/local/vehicleStore';
import { setVehicleOdometer } from '../../data/local/vehicleStore';
import { getDb } from '../../data/local/db';
import { distanceUnit, formatDistanceKm } from '../../domain/units';
import { parseOdometerKm } from '../parts/partsView';
import { colors, radii, spacing, typography } from '../../ui/theme';
import { usePrefs } from '../../app/prefs';

type Props = {
  visible: boolean;
  /** The vehicle whose reading is being entered. Always the showroom's selected vehicle. */
  vehicle: VehicleRow | null;
  onSaved: () => void;
  onClose: () => void;
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Manual odometer entry for the Record tab. This is the same write path Parts uses —
// parseOdometerKm validates the text and setVehicleOdometer persists it — presented as a
// bottom sheet so a reading can be captured without leaving the Garage. Nothing else about
// the vehicle is editable here; the sheet only owns one field, one save and one close.
export default function OdometerSheet({ visible, vehicle, onSaved, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const prefs = usePrefs();
  const units = prefs.units;
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from the stored reading each time the sheet opens, so a dismissed draft never
  // leaks back in and a reading saved on Parts is reflected immediately.
  useEffect(() => {
    if (!visible) return;
    Keyboard.dismiss();
    setError(null);
    setRaw(vehicle?.odometer_km != null ? String(vehicle.odometer_km) : '');
  }, [visible, vehicle]);

  const save = async () => {
    if (!vehicle || busy) return;
    const parsed = parseOdometerKm(raw);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const db = await getDb();
      await setVehicleOdometer(db, vehicle.id, parsed.value);
      onSaved();
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!vehicle) return null;

  const current =
    vehicle.odometer_km != null
      ? `${formatDistanceKm(vehicle.odometer_km, units)} ${distanceUnit(units)}`
      : 'not set';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={s.root}>
        <TouchableOpacity
          style={s.backdrop}
          activeOpacity={1}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close manual input"
        />
        <View style={[s.sheet, { paddingBottom: spacing.lg + Math.min(insets.bottom, 24) }]}>
          <View style={s.grabber} pointerEvents="none" />
          <View style={s.head}>
            <Text style={typography.heading} accessibilityRole="header">
              Manual Input
            </Text>
            <TouchableOpacity
              style={s.closeBtn}
              onPress={onClose}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Close manual input"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={s.vehicle} numberOfLines={1}>
            Odometer reading for this vehicle. Current: {current}
          </Text>

          <TextInput
            style={s.input}
            value={raw}
            onChangeText={setRaw}
            placeholder="e.g. 12500.5"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            accessibilityLabel={`Odometer reading in ${distanceUnit(units)}`}
          />

          {!!error && <Text style={s.error}>{error}</Text>}

          <View style={s.actions}>
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={onClose}
              disabled={busy}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
            >
              <Text style={s.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.saveBtn, busy && s.saveDisabled]}
              onPress={() => void save()}
              disabled={busy}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              accessibilityLabel="Save odometer reading"
            >
              <Text style={s.saveTxt}>{busy ? 'Saving…' : 'Update'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  closeBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.sm,
  },
  vehicle: { ...typography.caption, marginBottom: spacing.md },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.text,
    ...typography.body,
    minHeight: 48,
  },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.xs },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: spacing.md,
    gap: spacing.md,
  },
  cancelBtn: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.sm,
    borderColor: colors.primary,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cancelTxt: { ...typography.body, color: colors.primaryBright, fontWeight: '600' },
  saveBtn: {
    minWidth: 120,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
  },
  saveDisabled: { opacity: 0.45 },
  saveTxt: { ...typography.body, color: colors.onPrimary, fontWeight: '700' },
});
