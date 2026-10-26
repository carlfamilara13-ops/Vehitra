import type { TextStyle } from 'react-native';

// Shared design tokens. Colors mirror the palette already used by the ride screen
// (dark background, card, blue accent, light text, muted text) so the app reads as one product.
export const colors = {
  background: '#05070D',
  surface: '#0B0F1A',
  surfaceRaised: '#111726',
  border: '#1B2333',
  primary: '#1E6BFF',
  primaryPressed: '#1653CC',
  // Lighter cut of `primary`, for primary-coloured text and icons drawn on the dark surfaces.
  // `primary` lands at ~4.2:1 against `surface` — under the 4.5:1 needed for small text — while
  // this sits at ~6:1, so emphasis stays readable instead of decorative.
  primaryBright: '#4D8DFF',
  text: '#E8EEFF',
  textMuted: '#8A96B5',
  danger: '#C62828',
  warningSurface: '#3A2A00',
  warningText: '#F2C879',
  success: '#2E7D32',
  // Lighter cuts of `success` / `danger`, for status LABELS drawn on the near-black ground.
  // The dark fills above are for chips and buttons; as text they sit under the 4.5:1 needed
  // for small type, while these clear it (~9:1 and ~6:1 against `background`).
  successText: '#5FD37A',
  dangerText: '#F87171',
  // Tinted wash for emphasis (active tab, selected row). Keeps "active" from depending on a hue
  // change alone, and stays legible against the near-black background at small sizes.
  primaryTint: 'rgba(30, 107, 255, 0.16)',
  // Glass surface layers
  glassFill: 'transparent',
  glassPanel: 'transparent',
  glassSheen: 'rgba(255, 255, 255, 0.08)',
  glassBorder: 'rgba(255, 255, 255, 0.3)',
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
