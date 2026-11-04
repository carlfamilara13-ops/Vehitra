
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

type NeuViewProps = ViewProps & {
  accentGradient?: boolean;
};

type NeuTouchableOpacityProps = TouchableOpacityProps & {
  accentGradient?: boolean;
};

export function resolveSurface(
  style: StyleProp<ViewStyle> | undefined,
  n: Neu,
  accentGradient = false,
): StyleProp<ViewStyle> {
  if (accentGradient) {
    const depth = n.surface('raisedSubtle');
    const { backgroundColor: _backgroundColor, ...shadow } = depth;

    return [
      style,
      { backgroundColor: 'transparent' },
      shadow,
    ];
  }

  if (!style) return style;

  const f = StyleSheet.flatten(style) as ViewStyle | undefined;
  if (!f) return style;

  const bg = f.backgroundColor;

  const topR =
    typeof f.borderTopLeftRadius === 'number'
      ? f.borderTopLeftRadius
      : 0;

  const r = Math.max(
    typeof f.borderRadius === 'number' ? f.borderRadius : 0,
    topR,
  );

  if (!bg || r < 8) return style;

  let depth: ViewStyle | null = null;

  if (bg === colors.surface) {
    depth = r >= 16 ? n.raised : n.raisedSubtle;
  } else if (
    bg === colors.surfaceRaised ||
    bg === colors.primaryTint ||
    bg === colors.warningSurface
  ) {
    depth = n.insetField;
  } else if (bg === colors.dangerSolid) {
    depth = n.raisedSubtle;
  }

  if (!depth) return style;

  const soft: ViewStyle =
    f.borderColor === colors.border
      ? { borderColor: 'transparent' }
      : f.borderTopColor === colors.border
        ? { borderTopColor: 'transparent' }
        : {};

  return [style, depth, soft];
}

export const View = React.forwardRef<RNView, NeuViewProps>(
  function NeuView(
    { style, children, accentGradient = false, ...rest },
    ref,
  ) {
    const n = useNeu();

    const flat = StyleSheet.flatten(style) as ViewStyle | undefined;

    const radius =
      typeof flat?.borderRadius === 'number'
        ? flat.borderRadius
        : 0;

    return (
      <RNView
        ref={ref}
        {...rest}
        style={[
          resolveSurface(style, n, accentGradient),
          accentGradient && { overflow: 'hidden' },
        ]}
      >
        {accentGradient ? <AccentGradient radius={radius} /> : null}
        {children}
      </RNView>
    );
  },
);

export const TouchableOpacity = React.forwardRef<
  React.ElementRef<typeof RNTouchableOpacity>,
  NeuTouchableOpacityProps
>(function NeuTouchable(
  { style, children, accentGradient = false, ...rest },
  ref,
) {
  const n = useNeu();

  const flat = StyleSheet.flatten(style) as ViewStyle | undefined;

  const radius =
    typeof flat?.borderRadius === 'number'
      ? flat.borderRadius
      : 0;

  return (
    <RNTouchableOpacity
      ref={ref}
      {...rest}
      style={[
        resolveSurface(style, n, accentGradient),
        accentGradient && { overflow: 'hidden' },
      ]}
    >
      {accentGradient ? <AccentGradient radius={radius} /> : null}
      {children}
    </RNTouchableOpacity>
  );
});

export const Pressable = React.forwardRef<RNView, PressableProps>(
  function NeuPressable({ style, ...rest }, ref) {
    const n = useNeu();

    const resolvedStyle =
      typeof style === 'function'
        ? (state: { pressed: boolean; hovered?: boolean }) =>
            resolveSurface(
              style(state as never) as StyleProp<ViewStyle>,
              n,
            )
        : resolveSurface(style as StyleProp<ViewStyle>, n);

    return (
      <RNPressable
        ref={ref}
        {...rest}
        style={resolvedStyle as PressableProps['style']}
      />
    );
  },
);
