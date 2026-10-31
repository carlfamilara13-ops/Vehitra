import React, { useEffect, useState } from 'react';
import { Keyboard, Modal, ScrollView, StyleSheet } from 'react-native';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text, TextInput } from '../../ui/neu/NeuText';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing, typography } from '../../ui/theme';
import { useNeu } from '../../ui/neu/useNeu';
import {
  DEFAULT_RIDE_FILTERS,
  RIDE_SORT_LABELS,
  RIDE_STATUS_LABELS,
  dateRangeError,
  distanceRangeError,
  parseDayInput,
  parseDistanceInput,
  type RideFilters,
  type RideSort,
  type RideStatusValue,
  type VehicleOption,
  type VehicleSelection,
} from './ridesView';

type Props = {
  visible: boolean;
  /** The committed filters. The sheet seeds its draft from these each time it opens. */
  filters: RideFilters;
  vehicleOptions: VehicleOption[];
  onApply: (filters: RideFilters) => void;
  onClose: () => void;
};

const STATUS_ORDER: RideStatusValue[] = ['finished', 'recovered', 'recording'];
const SORT_ORDER: RideSort[] = ['newest', 'oldest', 'longest_distance', 'longest_duration'];

function sameVehicle(a: VehicleSelection, b: VehicleSelection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'vehicle' && b.kind === 'vehicle') return a.id === b.id;
  return true;
}

// Native-feeling filter sheet built on the platform Modal (slide + Android back = dismiss), so
// no new dependency is introduced. The sheet always edits a DRAFT: changes can be made freely,
// Apply commits them, Reset puts the draft back to the defaults, and dismissing the sheet —
// backdrop tap or back button — throws the draft away and keeps the committed filters. Nothing
// here writes to the database, so no ride can be modified from this screen.
export default function RideFilterSheet({ visible, filters, vehicleOptions, onApply, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const n = useNeu();

  const [statuses, setStatuses] = useState<RideStatusValue[]>(filters.statuses);
  const [vehicle, setVehicle] = useState<VehicleSelection>(filters.vehicle);
  const [sort, setSort] = useState<RideSort>(filters.sort);
  const [fromText, setFromText] = useState(filters.fromDay ?? '');
  const [toText, setToText] = useState(filters.toDay ?? '');
  const [minText, setMinText] = useState(filters.minKm != null ? String(filters.minKm) : '');
  const [maxText, setMaxText] = useState(filters.maxKm != null ? String(filters.maxKm) : '');

  // Re-seed the draft every time the sheet opens, so a dismissed draft never leaks back in.
  useEffect(() => {
    if (!visible) return;
    Keyboard.dismiss();
    setStatuses(filters.statuses);
    setVehicle(filters.vehicle);
    setSort(filters.sort);
    setFromText(filters.fromDay ?? '');
    setToText(filters.toDay ?? '');
    setMinText(filters.minKm != null ? String(filters.minKm) : '');
    setMaxText(filters.maxKm != null ? String(filters.maxKm) : '');
  }, [visible, filters]);

  const dateError = dateRangeError(fromText, toText);
  const distanceError = distanceRangeError(minText, maxText);
  const canApply = !dateError && !distanceError;

  const reset = () => {
    setStatuses(DEFAULT_RIDE_FILTERS.statuses);
    setVehicle(DEFAULT_RIDE_FILTERS.vehicle);
    setSort(DEFAULT_RIDE_FILTERS.sort);
    setFromText('');
    setToText('');
    setMinText('');
    setMaxText('');
  };

  const apply = () => {
    if (!canApply) return;
    const from = parseDayInput(fromText);
    const to = parseDayInput(toText);
    const min = parseDistanceInput(minText);
    const max = parseDistanceInput(maxText);
    if (!from.ok || !to.ok || !min.ok || !max.ok) return;
    onApply({
      statuses: [...statuses],
      fromDay: from.value,
      toDay: to.value,
      vehicle,
      minKm: min.value,
      maxKm: max.value,
      sort,
    });
  };

  const toggleStatus = (value: RideStatusValue) =>
    setStatuses((current) =>
      current.includes(value) ? current.filter((s) => s !== value) : [...current, value],
    );

  const showVehicles = vehicleOptions.some((option) => option.selection.kind === 'vehicle');

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
          accessibilityLabel="Close filters"
        />
        <View style={[s.sheet, { backgroundColor: n.c.surface, borderTopColor: n.c.shadowDark, paddingBottom: spacing.lg + Math.min(insets.bottom, 24) }]}>
          <View style={s.grabber} pointerEvents="none" />
          <View style={s.head}>
            <Text style={typography.heading} accessibilityRole="header">
              Filters
            </Text>
            <TouchableOpacity
              style={s.closeBtn}
              onPress={onClose}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Close filters"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={s.fieldLabel}>Status</Text>
            <View style={[s.chips, { backgroundColor: n.c.surface }]}>
              <Chip
                label="Any"
                selected={statuses.length === 0}
                onPress={() => setStatuses([])}
              />
              {STATUS_ORDER.map((value) => (
                <Chip
                  key={value}
                  label={RIDE_STATUS_LABELS[value]}
                  selected={statuses.includes(value)}
                  onPress={() => toggleStatus(value)}
                />
              ))}
            </View>

            <Text style={s.fieldLabel}>Date range</Text>
            <View style={s.inputRow}>
              <TextInput
                style={[s.input, s.inputHalf]}
                value={fromText}
                onChangeText={setFromText}
                placeholder="From 2026-01-01"
                placeholderTextColor={colors.textMuted}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="From date, format YYYY-MM-DD"
              />
              <TextInput
                style={[s.input, s.inputHalf]}
                value={toText}
                onChangeText={setToText}
                placeholder="To 2026-12-31"
                placeholderTextColor={colors.textMuted}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="To date, format YYYY-MM-DD"
              />
            </View>
            {!!dateError && <Text style={s.error}>{dateError}</Text>}

            {showVehicles && (
              <>
                <Text style={s.fieldLabel}>Vehicle</Text>
                <View style={[s.chips, { backgroundColor: n.c.surface }]}>
                  <Chip
                    label="Any vehicle"
                    selected={vehicle.kind === 'any'}
                    onPress={() => setVehicle({ kind: 'any' })}
                  />
                  {vehicleOptions.map((option) => {
                    const key =
                      option.selection.kind === 'vehicle'
                        ? option.selection.id
                        : option.selection.kind;
                    return (
                      <Chip
                        key={key}
                        label={option.label}
                        selected={sameVehicle(vehicle, option.selection)}
                        onPress={() => setVehicle(option.selection)}
                      />
                    );
                  })}
                </View>
              </>
            )}

            <Text style={s.fieldLabel}>Distance (km)</Text>
            <View style={s.inputRow}>
              <TextInput
                style={[s.input, s.inputHalf]}
                value={minText}
                onChangeText={setMinText}
                placeholder="Min"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                accessibilityLabel="Minimum distance in kilometres"
              />
              <TextInput
                style={[s.input, s.inputHalf]}
                value={maxText}
                onChangeText={setMaxText}
                placeholder="Max"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                accessibilityLabel="Maximum distance in kilometres"
              />
            </View>
            {!!distanceError && <Text style={s.error}>{distanceError}</Text>}

            <Text style={s.fieldLabel}>Sort by</Text>
            <View style={[s.chips, { backgroundColor: n.c.surface }]}>
              {SORT_ORDER.map((value) => (
                <Chip
                  key={value}
                  label={RIDE_SORT_LABELS[value]}
                  selected={sort === value}
                  onPress={() => setSort(value)}
                />
              ))}
            </View>
          </ScrollView>

          <View style={s.actions}>
            <TouchableOpacity
              style={s.resetBtn}
              onPress={reset}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Reset filters"
              accessibilityHint="Restores the default filter values without changing any rides"
            >
              <Text style={s.resetTxt}>Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.applyBtn, !canApply && s.applyDisabled]}
              onPress={apply}
              disabled={!canApply}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canApply }}
              accessibilityLabel="Apply filters"
            >
              <Text style={s.applyTxt}>Apply filters</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[s.chip, selected && s.chipSelected]}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <Text style={[s.chipTxt, selected && s.chipTxtSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  // Spelled out: React Native 0.86 dropped `StyleSheet.absoluteFillObject`.
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0, 0, 0, 0.55)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: '88%',
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
  scroll: { flexGrow: 0 },
  scrollContent: { paddingBottom: spacing.md },
  fieldLabel: { ...typography.label, marginTop: spacing.md, marginBottom: spacing.xs },
  chips: {
    backgroundColor: colors.surface, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceRaised,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { ...typography.caption, color: colors.textMuted },
  chipTxtSelected: { color: colors.onPrimary, fontWeight: '700' },
  inputRow: { flexDirection: 'row', gap: spacing.sm },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.text,
    ...typography.body,
    fontSize: 14,
  },
  inputHalf: { flex: 1, minWidth: 0 },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.xs },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    gap: spacing.md,
  },
  resetBtn: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.sm,
    borderColor: colors.primary,
    borderWidth: StyleSheet.hairlineWidth,
  },
  resetTxt: { ...typography.body, color: colors.primaryBright, fontWeight: '600' },
  applyBtn: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
  },
  applyDisabled: { opacity: 0.45 },
  applyTxt: { ...typography.body, color: colors.onPrimary, fontWeight: '700' },
});
