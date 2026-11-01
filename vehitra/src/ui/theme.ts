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
  background: themedColor('Background', '#E8EDF4', '#202228'),
  surface: themedColor('Surface', '#E8EDF4', '#202228'),
  surfaceRaised: themedColor('SurfaceRaised', '#E8EDF4', '#202228'),
  border: themedColor('Border', '#C9D2E0', '#15171B'),
  primary: themedColor('Primary', '#1672FF', '#3B82FF'),
  primaryPressed: themedColor('PrimaryPressed', '#125DCE', '#316BE0'),
  primaryInk: themedColor('PrimaryInk', '#FFFFFF', '#0B0D12'),
  primaryBright: themedColor('PrimaryBright', '#175DCC', '#75A6FF'),
  text: themedColor('Text', '#1C2430', '#F1F3F7'),
  textMuted: themedColor('TextMuted', '#515C6E', '#B6BECC'),
  danger: themedColor('Danger', '#C51F43', '#FF5C7A'),
  dangerSolid: themedColor('DangerSolid', '#A50F31', '#A50F31'),
  warningSurface: themedColor('WarningSurface', '#F3E6CC', '#3B372C'),
  warningText: themedColor('WarningText', '#A45D00', '#FFD166'),
  success: themedColor('Success', '#008A5B', '#48E39A'),
  successText: themedColor('SuccessText', '#008A5B', '#48E39A'),
  dangerText: themedColor('DangerText', '#C51F43', '#FF5C7A'),
  primaryTint: themedColor('PrimaryTint', '#D8E7FF', '#252E43'),
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
  // Brand wordmark only (VEHITRA). All other UI text is Inter, see ./neu/neuTheme.ts.
  display: 'Rajdhani_700Bold',
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
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
  sm: 10,
  md: 16,
  lg: 22,
  xl: 30,
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
  title: { fontFamily: fonts.bold, fontSize: 24, color: colors.text },
  heading: { fontFamily: fonts.semibold, fontSize: 18, color: colors.text },
  metric: { fontFamily: fonts.bold, fontSize: 26, color: colors.text, fontVariant: ['tabular-nums'] },
  wordmark: { fontFamily: fonts.display, fontSize: 26, letterSpacing: 2, color: colors.text },
  kicker: { fontFamily: fonts.semibold, fontSize: 13, color: colors.textMuted },
  body: { fontSize: 15, fontWeight: '400', color: colors.text },
  label: { fontSize: 13, fontWeight: '600', color: colors.text },
  caption: { fontSize: 12, fontWeight: '400', color: colors.textMuted },
};
