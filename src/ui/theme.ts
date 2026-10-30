import { DynamicColorIOS, Platform, PlatformColor, type ColorValue } from 'react-native';

// Shared semantic colors. Android resolves app-defined DayNight theme attributes, while iOS uses
// native dynamic colors. Because these tokens remain dynamic ColorValues, existing StyleSheet
// declarations across all screens follow Appearance.setColorScheme without per-screen rewrites.
function themedColor(token: string, light: string, dark: string): ColorValue {
  if (Platform.OS === 'android') return PlatformColor(`?attr/vehitra${token}`);
  if (Platform.OS === 'ios') return DynamicColorIOS({ light, dark });
  return dark;
}

export const colors = {
  background: themedColor('Background', '#F3F6FC', '#0A0A1A'),
  surface: themedColor('Surface', '#FFFFFF', '#11152A'),
  surfaceRaised: themedColor('SurfaceRaised', '#EEF2FA', '#171C35'),
  border: themedColor('Border', '#D7DFEE', '#252C4A'),
  primary: themedColor('Primary', '#1E6BFF', '#1E6BFF'),
  primaryPressed: themedColor('PrimaryPressed', '#1556D6', '#1653CC'),
  primaryInk: themedColor('PrimaryInk', '#FFFFFF', '#FFFFFF'),
  primaryBright: themedColor('PrimaryBright', '#1459DB', '#60EFFF'),
  text: themedColor('Text', '#18233D', '#E9F1FF'),
  textMuted: themedColor('TextMuted', '#596983', '#93A0BF'),
  danger: themedColor('Danger', '#C5284A', '#FF7F98'),
  dangerSolid: themedColor('DangerSolid', '#A50F31', '#A50F31'),
  warningSurface: themedColor('WarningSurface', '#FFF3D8', '#2B210D'),
  warningText: themedColor('WarningText', '#8B5200', '#FFC46B'),
  success: themedColor('Success', '#087D59', '#4DFFC4'),
  successText: themedColor('SuccessText', '#087D59', '#7BFFD8'),
  dangerText: themedColor('DangerText', '#B51F3E', '#FF7F98'),
  primaryTint: themedColor('PrimaryTint', '#E5EEFF', '#16264A'),
  // Transparent panels stay transparent in both schemes; their outline and sheen adapt.
  glassFill: 'transparent',
  glassPanel: 'transparent',
  glassSheen: themedColor('GlassSheen', 'rgba(255,255,255,0.58)', 'rgba(255,255,255,0.08)'),
  glassBorder: themedColor('GlassBorder', 'rgba(75,101,145,0.24)', 'rgba(205,222,255,0.28)'),
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
  import('react-native').TextStyle
> = {
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.text },
  heading: { fontFamily: fonts.display, fontSize: 18, color: colors.text },
  metric: { fontFamily: fonts.display, fontSize: 26, color: colors.text },
  wordmark: { fontFamily: fonts.display, fontSize: 26, letterSpacing: 2, color: colors.text },
  kicker: { fontFamily: fonts.display, fontSize: 13, letterSpacing: 1.8, textTransform: 'uppercase', color: colors.textMuted },
  body: { fontSize: 15, fontWeight: '400', color: colors.text },
  label: { fontSize: 13, fontWeight: '600', color: colors.text },
  caption: { fontSize: 12, fontWeight: '400', color: colors.textMuted },
};
