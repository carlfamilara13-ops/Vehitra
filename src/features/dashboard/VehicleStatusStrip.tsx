import React from 'react';
import type { ColorValue } from 'react-native';
import { StyleSheet } from 'react-native';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text } from '../../ui/neu/NeuText';
import { Ionicons } from '@expo/vector-icons';
import type { MaintenanceStatus } from '../../domain/maintenance/types';
import type { BatteryIdleLevel } from '../../domain/battery/idle';
import { colors, radii, spacing, typography } from '../../ui/theme';
import { usePrefs } from '../../app/prefs';

export type StatusTone = 'ok' | 'watch' | 'bad' | 'unknown';

export type StatusStripItem = {
  key: string;
  label: string;
  /** Short value or state; never blank — an unrecorded value says so. */
  detail: string;
  tone: StatusTone;
  icon: keyof typeof Ionicons.glyphMap;
};

type Props = {
  vehicleName: string | null;
  items: readonly StatusStripItem[];
  onOpenVehicle: () => void;
};

const TONE_COLOR: Record<StatusTone, ColorValue> = {
  ok: colors.success,
  watch: colors.warningText,
  bad: colors.danger,
  unknown: colors.textMuted,
};

// Maps the maintenance evaluation to a strip tone. Unknown is never folded into "good": the
// maintenance rules deliberately refuse to call an unmeasurable check healthy, and the strip
// keeps that distinction visible.
export function maintenanceTone(status: MaintenanceStatus): StatusTone {
  if (status === 'overdue') return 'bad';
  if (status === 'due_soon') return 'watch';
  if (status === 'good') return 'ok';
  return 'unknown';
}

export function batteryTone(level: BatteryIdleLevel): StatusTone {
  if (level === 'warn') return 'bad';
  if (level === 'watch') return 'watch';
  return 'ok';
}

// Section 6, the closing strip: a compact read-out of the active vehicle's maintenance health
// and battery check-in. Each cell carries an icon and a text label, so state never rests on
// colour alone.
export default function VehicleStatusStrip({ vehicleName, items, onOpenVehicle }: Props) {
  const easy = usePrefs().uiMode === 'easy';
  return (
    <View style={s.card}>
      <View style={s.headRow}>
        <View style={s.headText}>
          <Text style={typography.heading}>Vehicle status</Text>
          <Text style={s.subject}>{vehicleName ?? 'No active vehicle'}</Text>
        </View>
        <TouchableOpacity
          onPress={onOpenVehicle}
          accessibilityRole="button"
          accessibilityLabel="Open this vehicle"
          accessibilityHint="Opens the vehicle in the garage"
          activeOpacity={0.75}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={s.open}
        >
          <Text style={s.openText}>Open</Text>
          <Ionicons
            name="chevron-forward"
            size={14}
            color={colors.primaryBright}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </TouchableOpacity>
      </View>
      <View style={s.strip}>
        {items.map((item) => (
          <View
            key={item.key}
            style={s.item}
            accessible
            accessibilityLabel={`${item.label}: ${item.detail}`}
          >
            <View style={s.icon}>
              <Ionicons
                name={item.icon}
                size={easy ? 22 : 20}
                color={TONE_COLOR[item.tone]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            </View>
            <Text style={s.itemLabel} numberOfLines={1}>
              {item.label}
            </Text>
            <Text style={[s.itemDetail, { color: TONE_COLOR[item.tone] }]} numberOfLines={2}>
              {item.detail}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headText: { flex: 1 },
  subject: { ...typography.caption, marginTop: 2 },
  open: { flexDirection: 'row', alignItems: 'center' },
  openText: { ...typography.label, color: colors.primaryBright },
  strip: { flexDirection: 'row', marginTop: spacing.md },
  item: { flex: 1, alignItems: 'center' },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  itemLabel: { ...typography.caption },
  itemDetail: { ...typography.caption, textAlign: 'center', marginTop: 2, lineHeight: 15 },
});
