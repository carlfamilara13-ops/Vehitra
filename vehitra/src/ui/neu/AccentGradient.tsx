import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useNeu } from './useNeu';

/** Soft electric-to-royal blue fill for primary actions and highlighted states. */
export default function AccentGradient({ radius = 0 }: { radius?: number }) {
  const n = useNeu();
  return (
    <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="vehitraAccentGradient" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={n.c.accent} />
          <Stop offset="1" stopColor={n.c.accentEnd} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" rx={radius} fill="url(#vehitraAccentGradient)" />
    </Svg>
  );
}
