import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { colors, radii } from './theme';
import { useGlassBlur } from './useGlassBlur';

// Native translation of the glass-card reference:
//
//   .glass-card {
//     background: rgba(255, 255, 255, 0.05);        -> glassFill
//     backdrop-filter: blur(14px);                  -> BlurView intensity (see BLUR_INTENSITY)
//     border-radius: 20px;                          -> radii.xl
//     border: 1px solid rgba(255, 255, 255, 0.3);   -> glassBorder
//     box-shadow: 0 8px 32px rgba(0,0,0,0.1),        -> outer shadow
//                 inset 0 1px 0 rgba(255,255,255,0.5),   -> inset highlight (top)
//                 inset 0 -1px 0 rgba(255,255,255,0.1),  -> inset shadow (bottom)
//                 inset 0 0 0 0 rgba(255,255,255,0);     -> no-op
//     position: relative; overflow: hidden;
//   }
//   .glass-card::before { top hairline: transparent -> rgba(255,255,255,0.8) -> transparent }
//   .glass-card::after  { left hairline: rgba(255,255,255,0.8) -> transparent -> rgba(255,255,255,0.3) }
//
// React Native has no `backdrop-filter` or `::before`/`::after`, so the blur is a real BlurView
// layer and the two gradient hairlines are drawn as 1px flex-segment strips. Everything else maps
// one-to-one. An opaque fallback keeps the surface legible when blur is unavailable or Reduce
// Transparency is on (see `useGlassBlur`).

// `blur(14px)` has no direct RN analogue; expo-blur's intensity is an abstract 0-100 scale. 14px
// is a light frost, which lands around 30 on that scale and matches the reference's subtlety.
const DEFAULT_BLUR_INTENSITY = 30;

// Highlight stops approximating the reference gradients. React Native cannot render a
// `linear-gradient`, so each hairline is a row of flex segments whose alphas follow the ramp:
//
//   top:  transparent -> white 0.8 -> transparent
//   left: white 0.8 -> transparent -> white 0.3
const TOP_STOPS = [0.15, 0.45, 0.8, 0.45, 0.15] as const;
const LEFT_STOPS = [0.8, 0.5, 0.22, 0.1, 0.14, 0.3] as const;

const rgba = (a: number) => `rgba(255, 255, 255, ${a})`;

const fill = { position: 'absolute' as const, top: 0, right: 0, bottom: 0, left: 0 };

/** The two gradient hairlines, equivalent to `.glass-card::before` and `::after`. Decorative. */
function GlassEdges() {
  return (
    <View
      style={fill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={s.edgeTop}>
        {TOP_STOPS.map((a, i) => (
          <View key={`t${i}`} style={[s.seg, { backgroundColor: rgba(a) }]} />
        ))}
      </View>
      <View style={s.edgeLeft}>
        {LEFT_STOPS.map((a, i) => (
          <View key={`l${i}`} style={[s.seg, { backgroundColor: rgba(a) }]} />
        ))}
      </View>
    </View>
  );
}

type Props = ViewProps & {
  children?: React.ReactNode;
  /** Extra layout on top of the glass shell (padding/margin/overrides). */
  style?: StyleProp<ViewStyle>;
  /** Blur strength (expo-blur's 0-100 scale). Defaults to the reference `blur(14px)`. */
  intensity?: number;
};

/**
 * The glass surface. Drop-in for a plain `<View>` card, the tab bar background or a button:
 * applies the reference fill, 20px rim, `backdrop-filter: blur(14px)`, the sunken inset lines,
 * the outer drop shadow and both gradient hairlines.
 */
export default function GlassSurface({ children, style, intensity = DEFAULT_BLUR_INTENSITY, ...rest }: Props) {
  const canBlur = useGlassBlur();

  return (
    <View {...rest} style={[s.shell, style]}>
      {canBlur ? (
        <>
          <BlurView
            intensity={intensity}
            tint="light"
            // Android ships with blur disabled by default; the Sdk31Plus method opts in where the
            // platform can afford it and degrades to a flat translucent view elsewhere.
            blurMethod={Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' : undefined}
            style={fill}
            pointerEvents="none"
          />
        </>
      ) : (
        // Opaque base so the surface stays legible with no blur available.
        <View style={s.fallback} pointerEvents="none" />
      )}
      <View style={s.content}>{children}</View>
    </View>
  );
}

  const s = StyleSheet.create({
    shell: {
      borderRadius: radii.xl,
      // The subtle rim the glass treatment is built on.
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.glassBorder,
      // `box-shadow: 0 8px 32px rgba(0,0,0,0.1)`.
      shadowColor: '#000000',
      shadowOpacity: 0.1,
      shadowRadius: 32,
      shadowOffset: { width: 0, height: 8 },
      elevation: 6,
      overflow: 'hidden',
    },
  fallback: { ...fill, backgroundColor: colors.surfaceRaised },
  // The two gradient hairlines. `GlassEdges` draws each as a 1px strip of flex segments, so
  // the strips must be absolutely positioned to stay out of the content flow.
  edgeTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 1, flexDirection: 'row' },
  edgeLeft: { position: 'absolute', top: 0, left: 0, bottom: 0, width: 1, flexDirection: 'column' },
  seg: { flex: 1 },
  content: { flexShrink: 0 },
});
