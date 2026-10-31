import { useMemo } from 'react';
import { type TextStyle, type ViewStyle } from 'react-native';
import { INTER, NEU_COLORS, NEU_RADII, NEU_SPACING, type NeuColors, type NeuMode, type ShadowPresetName } from './neuTheme';
import { neuShadow } from './neuShadow';
import { usePrefsSafe } from './usePrefsSafe';

export type Neu = {
  mode: NeuMode;
  c: NeuColors;
  /** Surface + shadow for a preset, e.g. n.surface('raised'). */
  surface: (preset: ShadowPresetName) => ViewStyle;
  raised: ViewStyle;
  raisedSubtle: ViewStyle;
  insetField: ViewStyle;
  insetTrack: ViewStyle;
  insetDeep: ViewStyle;
  type: Record<'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'label' | 'caption', TextStyle>;
  radii: typeof NEU_RADII;
  spacing: typeof NEU_SPACING;
};

export function useNeu(): Neu {
  const { appearance } = usePrefsSafe();
  const mode: NeuMode = appearance;
  return useMemo(() => {
    const c = NEU_COLORS[mode];
    const surface = (preset: ShadowPresetName): ViewStyle => ({ backgroundColor: c.surface, ...neuShadow(c, preset) });
    return {
      mode,
      c,
      surface,
      raised: surface('raised'),
      raisedSubtle: surface('raisedSubtle'),
      insetField: surface('insetField'),
      insetTrack: surface('insetTrack'),
      insetDeep: surface('insetDeep'),
      type: {
        display: { fontFamily: INTER[700], fontSize: 34, color: c.text, fontVariant: ['tabular-nums'] },
        title: { fontFamily: INTER[700], fontSize: 24, color: c.text },
        heading: { fontFamily: INTER[600], fontSize: 18, color: c.text },
        body: { fontFamily: INTER[400], fontSize: 15, color: c.text },
        bodyStrong: { fontFamily: INTER[600], fontSize: 15, color: c.text },
        label: { fontFamily: INTER[500], fontSize: 13, color: c.text },
        caption: { fontFamily: INTER[400], fontSize: 12, color: c.textMuted },
      },
      radii: NEU_RADII,
      spacing: NEU_SPACING,
    };
  }, [mode]);
}
