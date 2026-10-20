import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { spacing } from './theme';
import GlassSurface from './GlassSurface';

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Blur strength (expo-blur's 0-100 scale). Kept modest: the surface should read as depth. */
  intensity?: number;
};

// The dashboard's hero card. It is the shared GlassSurface with the standard card padding and
// spacing, kept as a named component so the dashboard reads intent ("a card") rather than layout.
export default function GlassCard({ children, style, intensity }: Props) {
  return (
    <GlassSurface style={[s.card, style]} intensity={intensity}>
      {children}
    </GlassSurface>
  );
}

const s = StyleSheet.create({
  card: { padding: spacing.lg, marginBottom: spacing.lg },
});
