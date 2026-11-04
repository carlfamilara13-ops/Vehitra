import React from 'react';
import { Modal, StyleSheet } from 'react-native';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text } from '../../ui/neu/NeuText';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing, typography } from '../../ui/theme';
import {
  RIDE_SORT_LABELS,
  type RideDisplayMode,
  type RideSort,
} from './ridesView';

type Props = {
  visible: boolean;
  onClose: () => void;
  sort: RideSort;
  onSortChange: (sort: RideSort) => void;
  display: RideDisplayMode;
  onDisplayChange: (display: RideDisplayMode) => void;
};

const SORTS: RideSort[] = ['newest', 'oldest', 'longest_distance', 'longest_duration'];

const DISPLAY_OPTIONS: { value: RideDisplayMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'rich', label: 'Rich route cards', icon: 'map-outline' },
  { value: 'compact', label: 'Compact rows', icon: 'reorder-three-outline' },
];

// Overflow menu for the Rides header: sorting and the list display preference live together
// here (sorting is also editable from the filter sheet   both write the same screen state).
// Rendered in a transparent modal so the Android back button and a backdrop tap both dismiss
// it; selections apply immediately and close the menu.
export default function RidesOverflowMenu({
  visible,
  onClose,
  sort,
  onSortChange,
  display,
  onDisplayChange,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.root}>
        <TouchableOpacity
          style={s.backdrop}
          activeOpacity={1}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
        />
        <View style={[s.panel, { top: insets.top + 56 }]}>
          <Text style={s.section} accessibilityRole="header">
            Sort
          </Text>
          {SORTS.map((value) => (
            <MenuItem
              key={value}
              label={RIDE_SORT_LABELS[value]}
              icon="swap-vertical-outline"
              selected={sort === value}
              onPress={() => {
                onSortChange(value);
                onClose();
              }}
            />
          ))}
          <View style={s.divider} />
          <Text style={s.section} accessibilityRole="header">
            Display
          </Text>
          {DISPLAY_OPTIONS.map((option) => (
            <MenuItem
              key={option.value}
              label={option.label}
              icon={option.icon}
              selected={display === option.value}
              onPress={() => {
                onDisplayChange(option.value);
                onClose();
              }}
            />
          ))}
        </View>
      </View>
    </Modal>
  );
}

function MenuItem({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={s.item}
      activeOpacity={0.75}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <Ionicons
        name={icon}
        size={17}
        color={selected ? colors.primaryBright : colors.textMuted}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text style={[s.itemLabel, selected && s.itemLabelSelected]} numberOfLines={1}>
        {label}
      </Text>
      {selected && (
        <Ionicons
          name="checkmark"
          size={17}
          color={colors.primaryBright}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  // Spelled out instead of `StyleSheet.absoluteFillObject`: React Native 0.86 dropped that
  // export (same reason GlassCard writes its own fill).
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  panel: {
    position: 'absolute',
    right: spacing.lg,
    width: 240,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
  },
  section: {
    ...typography.kicker,
    fontSize: 11,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  item: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  itemLabel: { ...typography.body, fontSize: 14, flex: 1, color: colors.textMuted },
  itemLabelSelected: { color: colors.text, fontWeight: '600' },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
});
