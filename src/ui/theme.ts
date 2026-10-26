import type { TextStyle } from 'react-native';

// Shared design tokens mirrored from the web console palette: deep navy surfaces, neon green
// primary actions, cyan accent text, and light text. Solid primary buttons use `primaryInk`.
export const colors = {
  background: '#0A0A1A',
  surface: '#11152A',
  surfaceRaised: '#171C35',
  border: '#252C4A',
  primary: '#00FF87',
  primaryPressed: '#00D96F',
  primaryInk: '#041810',
  // Cyan accent used by the web console for links, selected states, and secondary emphasis.
  primaryBright: '#60EFFF',
  text: '#E9F1FF',
  textMuted: '#93A0BF',
  danger: '#FF7F98',
  dangerSolid: '#A50F31',
  warningSurface: '#2B210D',
  warningText: '#FFC46B',
  success: '#4DFFC4',
  successText: '#7BFFD8',
  dangerText: '#FF7F98',
  // Tinted wash for emphasis (active tab, selected row). Keeps "active" from depending on a hue
  // change alone, and stays legible against the near-black background at small sizes.
  primaryTint: 'rgba(0, 255, 135, 0.14)',
  // Glass surface layers
  glassFill: 'transparent',
  glassPanel: 'transparent',
  glassSheen: 'rgba(255, 255, 255, 0.08)',
  glassBorder: 'rgba(205, 222, 255, 0.28)',
} as const;

// Display face for titles, headings and metrics. Loaded in App.tsx through expo-font; while a
// family has not resolved yet React Native falls back to the system font, so a slow or failed
// load degrades instead of blocking the UI.
export const fonts = {
  display: 'Rajdhani_700Bold',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  // 20px, the glass-card reference radius.
  xl: 20,
  pill: 999,
} as const;

// Shared motion durations, in milliseconds. Short by design: the dashboard only animates the
// few things that genuinely change state (a card flip, a page title), so the timings stay
// tokens rather than being re-invented per screen.
export const motion = {
  fast: 120,
  base: 200,
  slow: 320,
} as const;

export const typography: Record<
  'title' | 'heading' | 'metric' | 'wordmark' | 'kicker' | 'body' | 'label' | 'caption',
  TextStyle
> = {
  // The display styles carry their weight in the loaded family itself, so they set no
  // `fontWeight`: asking a system for a weight the family does not define drops back to regular
  // on Android. On a device that has not finished loading fonts they render in the system font.
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.text },
  heading: { fontFamily: fonts.display, fontSize: 18, color: colors.text },
  metric: { fontFamily: fonts.display, fontSize: 26, color: colors.text },
  // Brand wordmark. Wide tracking is what separates a logotype from a heading, so this is the
  // only place the display face is tracked out.
  wordmark: { fontFamily: fonts.display, fontSize: 26, letterSpacing: 2, color: colors.text },
  // Small uppercase section label. Deliberately neutral so the live/recording state can raise
  // it to `primaryBright` without a second token.
  kicker: {
    fontFamily: fonts.display,
    fontSize: 13,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  body: { fontSize: 15, fontWeight: '400', color: colors.text },
  label: { fontSize: 13, fontWeight: '600', color: colors.text },
  caption: { fontSize: 12, fontWeight: '400', color: colors.textMuted },
};
