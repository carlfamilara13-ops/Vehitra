import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing, typography } from '../../ui/theme';
import { usePrefs } from '../../app/prefs';

type Props = {
  onPressProfile: () => void;
};

// Dashboard header: brand wordmark on the left, account action on the right. Kept separate from
// the shared Screen header because this is the one screen whose title is the product itself.
export default function DashboardHeader({ onPressProfile }: Props) {
  const easy = usePrefs().uiMode === 'easy';
  return (
    <View style={s.root}>
      <Text style={[typography.wordmark, easy && s.easyWordmark]}>VEHITRA</Text>
      <TouchableOpacity
        onPress={onPressProfile}
        accessibilityRole="button"
        accessibilityLabel="Open your account"
        accessibilityHint="Opens profile and sign-in"
        activeOpacity={0.75}
        // The glyph is 28dp, so the hit area is padded out to the platform minimum rather than
        // shrinking the icon to meet it.
        style={[s.profile, easy && s.easyProfile]}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons
          name="person-circle-outline"
          size={easy ? 30 : 28}
          color={colors.primaryBright}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  profile: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  easyWordmark: { fontSize: 30 },
  easyProfile: { width: 52, height: 52 },
});
