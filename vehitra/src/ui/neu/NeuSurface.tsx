import React from 'react';
import { View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { useNeu } from './useNeu';
import type { ShadowPresetName } from './neuTheme';

type Props = ViewProps & {
  preset?: ShadowPresetName | 'flat';
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/** Base neumorphic surface: same colour as the background, depth from the shadow pair only. */
export function NeuSurface({ preset = 'raised', radius, style, children, ...rest }: Props) {
  const n = useNeu();
  const base: ViewStyle = preset === 'flat' ? { backgroundColor: n.c.surface } : n.surface(preset);
  return (
    <View {...rest} style={[base, { borderRadius: radius ?? n.radii.lg }, style]}>
      {children}
    </View>
  );
}

/** Standard card: raised surface with the shared padding. Do not nest NeuCards. */
export function NeuCard({ style, subtle, ...rest }: Props & { subtle?: boolean }) {
  const n = useNeu();
  return <NeuSurface {...rest} preset={subtle ? 'raisedSubtle' : 'raised'} style={[{ padding: n.spacing.lg }, style]} />;
}

/** Recessed well for inputs, tracks, readouts and selected states. */
export function NeuWell({ style, preset = 'insetField', ...rest }: Props) {
  return <NeuSurface {...rest} preset={preset} radius={rest.radius} style={style} />;
}
