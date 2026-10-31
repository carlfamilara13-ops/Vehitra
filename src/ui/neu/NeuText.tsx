import React from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps, type TextStyle } from 'react-native';
import { INTER, interWeight } from './neuTheme';
import { resolveSurface } from './NeuAuto';
import { useNeu } from './useNeu';
import { colors } from '../theme';

// Drop-in replacements for RN Text / TextInput that render Inter. Custom fonts on Android are one
// family per weight (fontWeight alone cannot select a bundled weight), so the requested weight is
// resolved to the matching Inter family. An explicit non-Inter fontFamily (the wordmark) is kept.
function resolve(style: TextProps['style'], n: ReturnType<typeof useNeu>): TextStyle {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const { fontWeight, ...rest } = flat;
  const colorMap: Array<[unknown, string]> = [
    [colors.text, n.c.text],
    [colors.textMuted, n.c.textMuted],
    [colors.background, n.c.bg],
    [colors.surface, n.c.surface],
    [colors.surfaceRaised, n.c.surface],
    [colors.border, n.c.shadowDark],
    [colors.primary, n.c.accent],
    [colors.primaryPressed, n.c.accent],
    [colors.onPrimary, n.c.onAccent],
    [colors.primaryBright, n.c.accentText],
    [colors.danger, n.c.danger],
    [colors.dangerText, n.c.danger],
    [colors.success, n.c.success],
    [colors.successText, n.c.success],
    [colors.warningText, n.c.warning],
  ];
  const themedColor = colorMap.find(([token]) => token === flat.color)?.[1];
  return { ...rest, color: themedColor ?? flat.color, fontFamily: flat.fontFamily ?? INTER[interWeight(fontWeight)] };
}

export const Text = React.forwardRef<RNText, TextProps>(function NeuText({ style, ...rest }, ref) {
  const n = useNeu();
  return <RNText ref={ref} {...rest} style={resolve(style, n)} />;
});

export const TextInput = React.forwardRef<RNTextInput, TextInputProps>(function NeuTextInput({ style, ...rest }, ref) {
  // Inputs declared with the legacy surface tokens become inset fields (paired inner shadows).
  const n = useNeu();
  const flat = resolveSurface(style as never, n) as TextInputProps['style'];
  return <RNTextInput ref={ref} placeholderTextColor={n.c.textDisabled} selectionColor={n.c.accent} {...rest} style={resolve(flat as TextProps['style'], n)} />;
});
