import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, TextInput } from './NeuText';
import { useNeu } from './useNeu';
import { usePrefsSafe } from './usePrefsSafe';
import { NeuSurface } from './NeuSurface';
import type { TextInputProps } from 'react-native';

/** Inset text field. Focus = accent edge, error = danger edge (never colour alone: pass `error` text). */
export function NeuInput({
  label,
  error,
  icon,
  style,
  ...rest
}: TextInputProps & { label?: string; error?: string; icon?: keyof typeof Ionicons.glyphMap; style?: StyleProp<ViewStyle> }) {
  const n = useNeu();
  const easy = usePrefsSafe().uiMode === 'easy';
  const [focus, setFocus] = React.useState(false);
  const edge = error ? n.c.danger : focus ? n.c.accent : 'transparent';
  return (
    <View style={style}>
      {!!label && <Text style={[n.type.label, { color: n.c.textMuted, marginBottom: n.spacing.xs, marginLeft: n.spacing.xs }]}>{label}</Text>}
      <NeuSurface
        preset="insetField"
        radius={n.radii.md}
        style={{ flexDirection: 'row', alignItems: 'center', minHeight: easy ? 56 : 48, paddingHorizontal: n.spacing.md, borderWidth: 1.5, borderColor: edge }}
      >
        {icon ? <Ionicons name={icon} size={18} color={n.c.textMuted} style={{ marginRight: n.spacing.sm }} /> : null}
        <TextInput
          placeholderTextColor={n.c.textDisabled}
          selectionColor={n.c.accent}
          {...rest}
          onFocus={(e) => {
            setFocus(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            rest.onBlur?.(e);
          }}
          style={{ flex: 1, minHeight: 44, color: n.c.text, fontSize: easy ? 17 : 15 }}
        />
      </NeuSurface>
      {!!error && (
        <Text style={[n.type.caption, { color: n.c.danger, marginTop: n.spacing.xs, marginLeft: n.spacing.xs }]}>{error}</Text>
      )}
    </View>
  );
}

export function NeuSearch(props: TextInputProps & { style?: StyleProp<ViewStyle> }) {
  return <NeuInput icon="search" returnKeyType="search" {...props} />;
}

/** Segmented control: inset track, raised thumb on the selected option. */
export function NeuSegmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { value: T; label: string; icon?: keyof typeof Ionicons.glyphMap }[];
  value: T;
  onChange: (v: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const n = useNeu();
  const easy = usePrefsSafe().uiMode === 'easy';
  return (
    <NeuSurface preset="insetTrack" radius={n.radii.md} style={[{ flexDirection: 'row', padding: 4, gap: 4 }, style]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={[
              { flex: 1, minHeight: easy ? 48 : 40, borderRadius: n.radii.sm + 2, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 8 },
              on ? n.surface('raisedSubtle') : null,
            ]}
          >
            {o.icon ? <Ionicons name={o.icon} size={16} color={on ? n.c.accentText : n.c.textMuted} /> : null}
            <Text style={{ fontSize: easy ? 15 : 13, fontWeight: on ? '700' : '500', color: on ? n.c.accentText : n.c.textMuted }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </NeuSurface>
  );
}

/** Toggle: inset track, raised knob; accent knob glyph when on. Label is the caller's row text. */
export function NeuToggle({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const n = useNeu();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={{ minWidth: 56, minHeight: 44, justifyContent: 'center', opacity: disabled ? 0.55 : 1 }}
    >
      <NeuSurface preset="insetTrack" radius={16} style={{ width: 56, height: 32, justifyContent: 'center', padding: 3, alignItems: value ? 'flex-end' : 'flex-start' }}>
        <NeuSurface
          preset="raisedSubtle"
          radius={13}
          style={{ width: 26, height: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: value ? n.c.accent : n.c.surface }}
        >
          {value ? <Ionicons name="checkmark" size={14} color={n.c.onAccent} /> : null}
        </NeuSurface>
      </NeuSurface>
    </Pressable>
  );
}

export type NeuTone = 'accent' | 'success' | 'warning' | 'danger';

/** Progress: inset track + flat fill. Pair with text; value is 0..1. */
export function NeuProgress({ value, tone = 'accent', label, style }: { value: number; tone?: NeuTone; label?: string; style?: StyleProp<ViewStyle> }) {
  const n = useNeu();
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const color = tone === 'accent' ? n.c.accent : n.c[tone];
  return (
    <NeuSurface
      preset="insetTrack"
      radius={8}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
      style={[{ height: 14, padding: 3, overflow: 'hidden' }, style]}
    >
      <View style={{ width: `${v * 100}%`, height: '100%', borderRadius: 5, backgroundColor: color, minWidth: v > 0 ? 6 : 0 }} />
    </NeuSurface>
  );
}

/** Chip: raised when idle, inset + accent text when selected. */
export function NeuChip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  const n = useNeu();
  const easy = usePrefsSafe().uiMode === 'easy';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={[
        { minHeight: easy ? 48 : 44, paddingHorizontal: n.spacing.md, borderRadius: n.radii.pill, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
        selected ? n.surface('insetField') : n.surface('raisedSubtle'),
      ]}
    >
      {icon ? <Ionicons name={icon} size={16} color={selected ? n.c.accentText : n.c.textMuted} /> : null}
      <Text style={{ fontSize: 13, fontWeight: selected ? '700' : '500', color: selected ? n.c.accentText : n.c.text }}>{label}</Text>
    </Pressable>
  );
}

const BADGE: Record<'good' | 'warning' | 'danger' | 'neutral' | 'info', { icon: keyof typeof Ionicons.glyphMap }> = {
  good: { icon: 'checkmark-circle' },
  warning: { icon: 'alert-circle' },
  danger: { icon: 'close-circle' },
  neutral: { icon: 'ellipse-outline' },
  info: { icon: 'information-circle' },
};

/** Status badge: always icon + text, so state never depends on colour alone. */
export function NeuBadge({ label, kind = 'neutral' }: { label: string; kind?: keyof typeof BADGE }) {
  const n = useNeu();
  const color = kind === 'good' ? n.c.success : kind === 'warning' ? n.c.warning : kind === 'danger' ? n.c.danger : kind === 'info' ? n.c.accentText : n.c.textMuted;
  return (
    <NeuSurface preset="insetField" radius={n.radii.pill} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' }}>
      <Ionicons name={BADGE[kind].icon} size={14} color={color} />
      <Text style={{ fontSize: 12, fontWeight: '600', color }}>{label}</Text>
    </NeuSurface>
  );
}
