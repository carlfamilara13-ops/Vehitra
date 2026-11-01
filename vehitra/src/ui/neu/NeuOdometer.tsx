import React from 'react';
import { View } from 'react-native';
import { Text } from './NeuText';
import { NeuSurface } from './NeuSurface';
import { useNeu } from './useNeu';

/**
 * Odometer drum readout: every digit sits in its own recessed cell, like the counter behind an
 * instrument cluster, while separators stay outside the cells. Purely presentational: it takes
 * the already-formatted string (e.g. "12,345.6"), so unit conversion and stored data are untouched.
 */
export default function NeuOdometer({ value, unit, easy }: { value: string; unit: string; easy?: boolean }) {
  const n = useNeu();
  const chars = Array.from(value);
  const h = easy ? 64 : 56;
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${value} ${unit}`}
      style={{ width: '100%', alignItems: 'center' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 6, width: '100%' }} importantForAccessibility="no-hide-descendants">
        {chars.map((ch, i) =>
          /\d/.test(ch) ? (
            <NeuSurface
              key={i}
              preset="insetField"
              radius={n.radii.sm}
              style={{ flexShrink: 1, flexGrow: 0, width: easy ? 40 : 36, minWidth: 20, height: h, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: easy ? 34 : 30, fontWeight: '700', color: n.c.text, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
                {ch}
              </Text>
            </NeuSurface>
          ) : (
            <Text key={i} style={{ fontSize: 26, fontWeight: '700', color: n.c.textMuted, paddingBottom: 6 }}>
              {ch}
            </Text>
          ),
        )}
        <Text style={{ fontSize: 15, fontWeight: '600', color: n.c.accentText, paddingBottom: 8, marginLeft: 2 }}>{unit}</Text>
      </View>
    </View>
  );
}
