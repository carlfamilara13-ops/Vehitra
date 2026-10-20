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
  text: '#E8EEFF',
  textMuted: '#8A96B5',
  danger: '#C62828',
  warningSurface: '#3A2A00',
  warningText: '#F2C879',
  success: '#2E7D32',
  // Glass surface layers, lifted straight from the glass-card reference:
  // `background: rgba(255,255,255,0.05)` and `border: 1px solid rgba(255,255,255,0.3)`.
  // Kept as tokens so every card, the tab bar and the buttons share one material.
  glassFill: 'rgba(255, 255, 255, 0.05)',
  glassBorder: 'rgba(255, 255, 255, 0.3)',
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

export const typography: Record<'title' | 'heading' | 'body' | 'label' | 'caption', TextStyle> = {
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text },
  body: { fontSize: 15, fontWeight: '400', color: colors.text },
  label: { fontSize: 13, fontWeight: '600', color: colors.text },
  caption: { fontSize: 12, fontWeight: '400', color: colors.textMuted },
};
