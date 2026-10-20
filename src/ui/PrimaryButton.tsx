import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { colors, radii, spacing, typography } from './theme';
import { usePrefs } from '../app/prefs';

type Props = {
  label: string;
  onPress: () => void;
  /** Solid is the one primary action on a surface; quiet is the bordered secondary inside a card. */
  variant?: 'solid' | 'quiet';
  accessibilityHint?: string;
};

// The dashboard's only two button shapes, kept in one place so the 48dp minimum target and the
// easy-mode label scaling cannot drift apart between sections.
export default function PrimaryButton({ label, onPress, variant = 'solid', accessibilityHint }: Props) {
  const easy = usePrefs().uiMode === 'easy';
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      activeOpacity={0.75}
      style={[variant === 'solid' ? s.solid : s.quiet, easy && s.easyTarget]}
    >
      <Text style={[variant === 'solid' ? s.solidTxt : s.quietTxt, easy && s.easyTxt]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  solid: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  quiet: {
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    // Anchored left on its own row so it reads as a text action rather than a second button.
    alignSelf: 'flex-start',
  },
  solidTxt: { ...typography.body, color: '#FFFFFF', fontWeight: '700' },
  quietTxt: { ...typography.body, color: colors.primaryBright, fontWeight: '600' },
  easyTarget: { minHeight: 52 },
  easyTxt: { fontSize: 17 },
});
