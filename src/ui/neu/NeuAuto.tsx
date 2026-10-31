import React from 'react';
import {
  Pressable as RNPressable,
  StyleSheet,
  TouchableOpacity as RNTouchableOpacity,
  View as RNView,
  type PressableProps,
  type StyleProp,
  type TouchableOpacityProps,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { colors } from '../theme';
import { useNeu, type Neu } from './useNeu';
import AccentGradient from './AccentGradient';

// Neumorphic "surface resolver" for existing screens.
//
// Screens declare cards, rows, chips and wells with the shared legacy tokens (`colors.surface`,
// `colors.surfaceRaised`, `colors.primaryTint`). Those tokens now all equal the neumorphic base
// colour, so on their own they would be flat. These drop-in View / TouchableOpacity / Pressable
// wrappers add the paired light/dark depth by role:
//
//   colors.surface       + corner radius  -> raised (radius >= 16) or raised-subtle (smaller; rows/chips)
//   colors.surfaceRaised + corner radius  -> inset well (fields, tracks, icon wells, quiet buttons)
//   colors.primaryTint   + corner radius  -> inset well keeping the accent tint (selected state)
//   colors.primary       + corner radius  -> accent button with the paired raised shadow
//
// and soften hairline borders so depth, not outline, carries the shape. Anything else is passed
// through untouched, so maps, photos and document artwork never receive shadows. Add the style
// roles in one place (here) instead of re-deriving shadows per screen.
export function resolveSurface(style: StyleProp<ViewStyle> | undefined, n: Neu): StyleProp<ViewStyle> {
  if (!style) return style;
  const f = StyleSheet.flatten(style) as ViewStyle | undefined;
  if (!f) return style;
  const bg = f.backgroundColor;
  if (bg === colors.primary) {
    const depth = n.surface('raisedSubtle');
    const { backgroundColor: _backgroundColor, ...shadow } = depth;
    return [style, { backgroundColor: 'transparent' }, shadow];
  }
  const topR = typeof f.borderTopLeftRadius === 'number' ? f.borderTopLeftRadius : 0;
  const r = Math.max(typeof f.borderRadius === 'number' ? f.borderRadius : 0, topR);
  if (!bg || r < 8) return style;
  let depth: ViewStyle | null = null;
  if (bg === colors.surface) depth = r >= 16 ? n.raised : n.raisedSubtle;
  else if (bg === colors.surfaceRaised || bg === colors.primaryTint || bg === colors.warningSurface) depth = n.insetField;
  else if (bg === colors.primary || bg === colors.dangerSolid) depth = n.raisedSubtle;
  if (!depth) return style;
  const soft: ViewStyle = f.borderColor === colors.border ? { borderColor: 'transparent' } : f.borderTopColor === colors.border ? { borderTopColor: 'transparent' } : {};
  return [style, depth, soft];
}

export const View = React.forwardRef<RNView, ViewProps>(function NeuView({ style, children, ...rest }, ref) {
  const n = useNeu();
  const flat = StyleSheet.flatten(style) as ViewStyle | undefined;
  const gradient = flat?.backgroundColor === colors.primary;
  const radius = typeof flat?.borderRadius === 'number' ? flat.borderRadius : 0;
  return <RNView ref={ref} {...rest} style={resolveSurface(style, n)}>{gradient ? <AccentGradient radius={radius} /> : null}{children}</RNView>;
});

export const TouchableOpacity = React.forwardRef<React.ElementRef<typeof RNTouchableOpacity>, TouchableOpacityProps>(function NeuTouchable(
  { style, children, ...rest },
  ref,
) {
  const n = useNeu();
  const flat = StyleSheet.flatten(style) as ViewStyle | undefined;
  const gradient = flat?.backgroundColor === colors.primary;
  const radius = typeof flat?.borderRadius === 'number' ? flat.borderRadius : 0;
  return <RNTouchableOpacity ref={ref} {...rest} style={resolveSurface(style, n)}>{gradient ? <AccentGradient radius={radius} /> : null}{children}</RNTouchableOpacity>;
});

export const Pressable = React.forwardRef<RNView, PressableProps>(function NeuPressable({ style, ...rest }, ref) {
  const n = useNeu();
  const s = typeof style === 'function' ? (st: { pressed: boolean; hovered?: boolean }) => resolveSurface(style(st as never) as StyleProp<ViewStyle>, n) : resolveSurface(style as StyleProp<ViewStyle>, n);
  return <RNPressable ref={ref} {...rest} style={s as PressableProps['style']} />;
});
