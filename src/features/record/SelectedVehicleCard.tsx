import React from 'react';
import type { ColorValue } from 'react-native';
<<<<<<< HEAD
import { StyleSheet } from 'react-native';
import { View, TouchableOpacity } from '../../ui/neu/NeuAuto';
import NeuButton from '../../ui/neu/NeuButton';
import NeuOdometer from '../../ui/neu/NeuOdometer';
import { Text } from '../../ui/neu/NeuText';
=======
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
>>>>>>> 085d579c1634fc5cd9a597346cae31cf95b819b5
import { Ionicons } from '@expo/vector-icons';
import type { VehicleRow } from '../../data/local/vehicleStore';
import { vehicleDisplayName, VEHICLE_TYPE_LABELS } from '../../data/local/vehicleStore';
import type { RideRow } from '../../data/local/ridesStore';
import { formatDistanceM } from '../../domain/units';

import PrimaryButton from '../../ui/PrimaryButton';
import { colors, radii, spacing, typography } from '../../ui/theme';
import { usePrefs } from '../../app/prefs';
import { odometerDisplay, type ConditionTone, type VehicleCondition, type VehicleStat } from './garageView';

type Props = {
  vehicle: VehicleRow;
  /** The ride in progress, or null. Swaps the primary action to Stop without leaving the card. */
  activeRide: RideRow | null;
  /** The vehicle's maintenance condition, derived from its recorded maintenance state. */
  condition: VehicleCondition;
  /** The compact statistics shown under the odometer. Every value is read from stored data. */
  stats: readonly VehicleStat[];
  busy: boolean;
  onStartTracking: () => void;
  onStopTracking: () => void;
  onManualInput: () => void;
  onMaintenance: () => void;
};

// The treatment of each condition: a restrained tinted pill. The label inside carries the
// meaning, so the state never rests on colour alone.
const CONDITION_STYLE: Record<ConditionTone, { bg: ColorValue; border: ColorValue; fg: ColorValue }> = {
<<<<<<< HEAD
  ok: { bg: colors.surfaceRaised, border: 'transparent', fg: colors.successText },
  watch: { bg: colors.surfaceRaised, border: 'transparent', fg: colors.warningText },
  bad: { bg: colors.surfaceRaised, border: 'transparent', fg: colors.dangerText },
  unknown: { bg: colors.surfaceRaised, border: 'transparent', fg: colors.textMuted },
=======
  ok: { bg: 'rgba(77, 255, 196, 0.12)', border: 'rgba(77, 255, 196, 0.34)', fg: colors.successText },
  watch: { bg: 'rgba(255, 196, 107, 0.12)', border: 'rgba(255, 196, 107, 0.35)', fg: colors.warningText },
  bad: { bg: 'rgba(255, 127, 152, 0.14)', border: 'rgba(255, 127, 152, 0.38)', fg: colors.dangerText },
  unknown: { bg: 'rgba(255, 255, 255, 0.05)', border: colors.glassBorder, fg: colors.textMuted },
>>>>>>> 085d579c1634fc5cd9a597346cae31cf95b819b5
};

// The anchor surface under the carousel: who this vehicle is, how it stands, and the actions
// the Record tab owns. Layered glass (shell → blur/fill → sheen → edges) comes from
// GlassSurface; this component only arranges content on top of it.
//
// Reading order, top to bottom: the vehicle and its maintenance condition, the odometer as the
// centrepiece, the statistics that follow from the stored records, the two secondary actions,
// and finally the primary Start Tracking button.
export default function SelectedVehicleCard({
  vehicle,
  activeRide,
  condition,
  stats,
  busy,
  onStartTracking,
  onStopTracking,
  onManualInput,
  onMaintenance,
}: Props) {
  const prefs = usePrefs();
  const easy = prefs.uiMode === 'easy';
  const odo = odometerDisplay(vehicle.odometer_km, prefs.units);
  const typeLabel =
    (VEHICLE_TYPE_LABELS as Record<string, string>)[vehicle.vehicle_type] ?? vehicle.vehicle_type;
  const recording = activeRide != null;
  const conditionStyle = CONDITION_STYLE[condition.tone];

  return (
    <View style={s.card}>
      <View style={s.headRow}>
        <View style={s.headText}>
          <Text style={[typography.heading, easy && s.easyHeading]} numberOfLines={2}>
            {vehicleDisplayName(vehicle)}
          </Text>
          <View style={s.metaRow}>
            {recording && (
              <>
                <View style={s.liveDot} />
                <Text style={s.liveTxt}>Recording</Text>
              </>
            )}
            <Text style={s.meta} numberOfLines={1}>
              {[typeLabel, vehicle.model_year ? String(vehicle.model_year) : null, vehicle.plate]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </View>
        <View
          style={[s.condition, { backgroundColor: conditionStyle.bg, borderColor: conditionStyle.border }]}
          accessible
          accessibilityLabel={`Maintenance condition: ${condition.label}`}
        >
          <View style={[s.conditionDot, { backgroundColor: conditionStyle.fg }]} />
          <Text style={[s.conditionTxt, { color: conditionStyle.fg }]} numberOfLines={1}>
            {condition.label}
          </Text>
        </View>
      </View>

      {/* The odometer is the centrepiece of the card: the figure is centred, the unit sits on
          the baseline beside it, and the label sits centred underneath. The stored reading and
          the unit conversion are unchanged — only the arrangement is. */}
      <View style={s.odoBlock}>
        <NeuOdometer value={odo.value} unit={odo.unit} easy={easy} />
        <Text style={s.odoLabel}>Total odometer</Text>
      </View>

      <View style={s.stats}>
        {stats.map((stat) => (
          <View
            key={stat.key}
            style={s.stat}
            accessible
            accessibilityLabel={`${stat.label}: ${stat.value}`}
          >
            <Text style={s.statLabel} numberOfLines={1}>
              {stat.label}
            </Text>
            <Text
              style={[s.statValue, stat.tone !== 'default' && { color: CONDITION_STYLE[stat.tone].fg }]}
              numberOfLines={1}
            >
              {stat.value}
            </Text>
          </View>
        ))}
      </View>

      {/* The two secondary actions keep their existing flows (the odometer sheet and the Parts
          screen) but step out of the way: a quiet glass row above the primary button. */}
      <View style={s.secondaryRow}>
        <TouchableOpacity
          style={s.secondary}
          onPress={onManualInput}
          disabled={busy}
          activeOpacity={0.75}
          hitSlop={{ top: 2, bottom: 2 }}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          accessibilityLabel="Manual input"
          accessibilityHint="Records an odometer reading for this vehicle"
        >
          <Ionicons
            name="speedometer-outline"
            size={16}
            color={colors.primaryBright}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <Text style={s.secondaryTxt}>Manual Input</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.secondary}
          onPress={onMaintenance}
          disabled={busy}
          activeOpacity={0.75}
          hitSlop={{ top: 2, bottom: 2 }}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          accessibilityLabel="Maintenance"
          accessibilityHint="Opens maintenance for this vehicle"
        >
          <Ionicons
            name="construct-outline"
            size={16}
            color={colors.primaryBright}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <Text style={s.secondaryTxt}>Maintenance</Text>
        </TouchableOpacity>
      </View>

      <View style={s.actions}>
        {recording ? (
          <NeuButton
            variant="danger"
            icon="stop-circle"
            label={`Stop ride (${formatDistanceM(activeRide?.distance_m ?? 0, prefs.units, { decimals: 2 })})`}
            accessibilityLabel="Stop ride"
            accessibilityHint="Stops recording and saves the ride"
            onPress={onStopTracking}
            disabled={busy}
          />
        ) : (
          <PrimaryButton
            label="Start Tracking"
            onPress={onStartTracking}
            accessibilityHint="Starts recording a ride with this vehicle"
          />
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { padding: spacing.lg, backgroundColor: colors.surface, borderRadius: radii.lg },
  headRow: { flexDirection: 'row', alignItems: 'flex-start' },
  headText: { flex: 1, paddingRight: spacing.md },
  easyHeading: { fontSize: 20 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  meta: { ...typography.caption, flexShrink: 1 },
  // The live ride marker keeps its place next to the name now that the badge slot belongs to
  // the maintenance condition.
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
    marginRight: spacing.xs,
  },
  liveTxt: { ...typography.caption, color: colors.successText, fontWeight: '700', marginRight: spacing.xs },
  condition: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  conditionDot: { width: 6, height: 6, borderRadius: 3, marginRight: spacing.xs },
  conditionTxt: { ...typography.caption, fontWeight: '700' },
  odoBlock: { width: '100%', alignItems: 'center', marginTop: spacing.lg, paddingVertical: spacing.md },
  odoRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
  },
  odoValue: { ...typography.metric, fontSize: 44, color: colors.text, flexShrink: 1 },
  easyOdo: { fontSize: 52 },
  odoUnit: {
    ...typography.caption,
    fontSize: 13,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginLeft: spacing.sm,
  },
  odoLabel: { ...typography.kicker, marginTop: 2, textAlign: 'center' },
  stats: { flexDirection: 'row', marginTop: spacing.lg, gap: spacing.sm },
   stat: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: radii.md,
    borderWidth: 0,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  statLabel: { ...typography.caption, fontSize: 12 },
  statValue: { ...typography.label, fontSize: 14, marginTop: 2, textAlign: 'center' },
  secondaryRow: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.sm },
   secondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: radii.md,
    borderWidth: 0,
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  secondaryTxt: { ...typography.label, fontSize: 12, color: colors.text, fontWeight: '600' },
  actions: { marginTop: spacing.md },
  stopBtn: {
    backgroundColor: colors.dangerSolid,
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  stopTxt: { ...typography.body, color: '#FFFFFF', fontWeight: '700', letterSpacing: 0.5 },
  disabled: { opacity: 0.5 },
});
