import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './neu/NeuText';
import { colors, radii, spacing, typography } from './theme';

// Honest empty state for screens whose backend does not exist yet.
export default function Placeholder({ title, message }: { title: string; message: string }) {
  return (
    <View style={s.card}>
      <Text style={s.title}>{title}</Text>
      <Text style={s.message}>{message}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  title: { ...typography.heading, fontSize: 16, marginBottom: spacing.sm },
  message: { ...typography.body, color: colors.textMuted, lineHeight: 20 },
});
