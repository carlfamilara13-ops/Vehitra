
import React, { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { useNeu } from './useNeu';

export default function AccentGradient({
  radius = 0,
}: {
  radius?: number;
}) {
  const n = useNeu();

  const gradientId = `vehitraAccent-${useId().replace(/:/g, '')}`;

  return (
    <Svg
      pointerEvents="none"
      width="115%"
      height="100%"
      style={StyleSheet.absoluteFill}
    >
      <Defs>
        <LinearGradient
          id={gradientId}
          x1="0"
          y1="0"
          x2="1"
          y2="0"
        >
          <Stop offset="0" stopColor={n.c.accent} />
          <Stop offset="1" stopColor={n.c.accentEnd} />
        </LinearGradient>
      </Defs>

      <Rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        rx={radius}
        fill={`url(#${gradientId})`}
      />
    </Svg>
  );
}
