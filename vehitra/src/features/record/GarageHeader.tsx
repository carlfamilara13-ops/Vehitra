import React from 'react';
import { StyleSheet } from 'react-native';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text } from '../../ui/neu/NeuText';
import { Ionicons } from '@expo/vector-icons';

import { colors, radii, spacing, typography } from '../../ui/theme';
import { usePrefs } from '../../app/prefs';

type Props = {
  onAddVehicle: () => void;
};

// "Add Vehicle" — the Record header's primary creation action, rendered into Screen's right
// slot beside the page title. It is a glass button like every other button in the app
// (Touch control → GlassSurface material), so the header action and the card actions read
// as the same material rather than a floating solid chip.
export default function GarageHeader({ onAddVehicle }: Props) {
  const easy = usePrefs().uiMode === 'easy';
  return (
    <TouchableOpacity
      onPress={onAddVehicle}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel="Add vehicle"
      accessibilityHint="Opens the vehicle library to add a vehicle"
      style={s.press}
    >
      <View style={[s.btn, easy && s.easyBtn]}>
        <View style={s.row}>
          <Ionicons
            name="add"
            size={easy ? 22 : 20}
            color={colors.primaryBright}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <Text style={[s.label, easy && s.easyLabel]}>Add Vehicle</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  press: { borderRadius: radii.md },
  btn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    // The shared 5% glass fill alone is thin over the dark background; a small dark wash
    // underneath keeps the label legible without turning the button into a solid chip.
    backgroundColor: colors.surface,
    borderRadius: radii.md,
  },
  easyBtn: { minHeight: 48 },
  row: { flexDirection: 'row', alignItems: 'center' },
  label: { ...typography.label, color: colors.text, fontWeight: '600', marginLeft: spacing.xs },
  easyLabel: { fontSize: 15 },
});
