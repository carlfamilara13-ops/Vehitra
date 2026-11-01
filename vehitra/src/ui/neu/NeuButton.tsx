import React, { useState } from 'react';
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './NeuText';
import { useNeu } from './useNeu';
import { usePrefsSafe } from './usePrefsSafe';
import { useReduceMotion } from './useReduceMotion';
import { withAlpha } from './neuTheme';
import AccentGradient from './AccentGradient';

export type NeuButtonVariant = 'soft' | 'accent' | 'danger' | 'quiet';

type Props = {
  label: string;
  onPress: () => void;
  variant?: NeuButtonVariant;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  /** Fill the row width (default true). */
  block?: boolean;
};

// Reference SoftDynamicButtonStyle: raised at rest, inset while pressed, 0.97 scale (skipped under
// reduce-motion), >=44dp target (48 here, 52 in Easy Mode), disabled = no shadow + outline + 55% text.
export default function NeuButton({
  label,
  onPress,
  variant = 'soft',
  icon,
  disabled,
  loading,
  accessibilityHint,
  accessibilityLabel,
  style,
  block = true,
}: Props) {
  const n = useNeu();
  const easy = usePrefsSafe().uiMode === 'easy';
  const reduce = useReduceMotion();
  const [pressed, setPressed] = useState(false);
  const off = !!disabled || !!loading;
  const filled = variant === 'accent' || variant === 'danger';
  const fill = variant === 'accent' ? n.c.accent : variant === 'danger' ? n.c.danger : n.c.surface;
  const ink = off
    ? withAlpha(filled ? n.c.text : n.c.text, 0.55)
    : variant === 'accent'
      ? n.c.onAccent
      : variant === 'danger'
        ? n.c.onDanger
        : variant === 'quiet'
          ? n.c.accentText
          : n.c.text;
  const shadow = off
    ? { borderWidth: 1, borderColor: n.c.shadowDark }
    : variant === 'quiet'
      ? pressed
        ? n.surface('insetField')
        : {}
      : pressed
        ? n.surface('insetField')
        : n.surface('raised');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        {
          minHeight: easy ? 52 : 48,
          borderRadius: n.radii.md,
          paddingHorizontal: n.spacing.lg,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: n.spacing.sm,
          backgroundColor: off ? n.c.surface : variant === 'accent' ? 'transparent' : fill,
          alignSelf: block ? 'stretch' : 'flex-start',
          position: 'relative',
          transform: [{ scale: pressed && !reduce ? 0.97 : 1 }],
        },
        shadow,
        style,
      ]}
    >
      {variant === 'accent' && !off ? <AccentGradient radius={n.radii.md} /> : null}
      {loading ? (
        <ActivityIndicator color={ink} />
      ) : icon ? (
        <Ionicons name={icon} size={easy ? 22 : 20} color={ink} />
      ) : null}
      <Text style={{ fontSize: easy ? 17 : 15, fontWeight: '600', color: ink }}>{label}</Text>
    </Pressable>
  );
}

export function NeuIconButton({
  icon,
  onPress,
  label,
  accent,
  size = 48,
  disabled,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
  accent?: boolean;
  size?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const n = useNeu();
  const easy = usePrefsSafe().uiMode === 'easy';
  const reduce = useReduceMotion();
  const [pressed, setPressed] = useState(false);
  const d = Math.max(size, easy ? 52 : 44);
  const bg = accent ? n.c.accent : n.c.surface;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      hitSlop={6}
      style={[
        {
          width: d,
          height: d,
          borderRadius: d / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: bg,
          transform: [{ scale: pressed && !reduce ? 0.95 : 1 }],
        },
        disabled ? { borderWidth: 1, borderColor: n.c.shadowDark } : pressed ? n.surface('insetField') : n.surface('raised'),
        style,
      ]}
    >
      <Ionicons
        name={icon}
        size={Math.round(d * 0.46)}
        color={disabled ? n.c.textDisabled : accent ? n.c.onAccent : n.c.accentText}
      />
    </Pressable>
  );
}

export function NeuDivider() {
  const n = useNeu();
  return <View style={{ height: 1, backgroundColor: n.c.shadowDark, opacity: 0.5, marginVertical: n.spacing.sm }} />;
}
