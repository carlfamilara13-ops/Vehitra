// Neumorphic Soft UI tokens for Vehitra.
//
// Neutral surface family is taken verbatim from the costachung/neumorphic reference
// (Sources/Neumorphic/ColorExtension.swift): background and every surface share ONE colour and
// depth comes only from a paired light (top-left) / dark (bottom-right) shadow. Accent and status
// colours are Vehitra's own. Pure data: no React Native imports, so it is unit-testable.

export type NeuMode = 'light' | 'dark';

export type NeuColors = {
  bg: string;
  surface: string;
  shadowLight: string;
  shadowDark: string;
  text: string;
  textMuted: string;
  textDisabled: string;
  accent: string;
  accentEnd: string;
  accentText: string;
  onAccent: string;
  success: string;
  warning: string;
  danger: string;
  onDanger: string;
};

export const NEU_COLORS: Record<NeuMode, NeuColors> = {
  light: {
    bg: '#E8EDF4',
    surface: '#E8EDF4',
    shadowLight: '#FFFFFF',
    shadowDark: '#D1D9E6',
    text: '#1F2430',
    textMuted: '#595E6B',
    textDisabled: '#9AA1AF',
    accent: '#1672FF',
    accentEnd: '#4939D6',
    accentText: '#175DCC',
    onAccent: '#FFFFFF',
    success: '#008A5B',
    warning: '#A45D00',
    danger: '#C51F43',
    onDanger: '#FFFFFF',
  },
  dark: {
    bg: '#202228',
    surface: '#202228',
    shadowLight: '#30343D',
    shadowDark: '#15171B',
    text: '#E8E8E8',
    textMuted: '#A3A7B3',
    textDisabled: '#6B6F7A',
    accent: '#3B82FF',
    accentEnd: '#5B48F2',
    accentText: '#75A6FF',
    onAccent: '#0B0D12',
    success: '#48E39A',
    warning: '#FFD166',
    danger: '#FF5C7A',
    onDanger: '#0B0D12',
  },
};

export type ShadowPresetName =
  | 'raised'
  | 'raisedSubtle'
  | 'raisedPressed'
  | 'insetDeep'
  | 'insetField'
  | 'insetTrack';

export type ShadowPreset = {
  inset: boolean;
  offset: number;
  blur: number;
  /** Multiplier on the shadow colour alpha (reference "subtle" preset uses 0.65). */
  opacity: number;
};

// Starting geometry. SwiftUI radius ~ half a CSS blur, so the reference 6/3 becomes offset 6, blur 12;
// subtle 3/2 becomes 3 / 6. Inset values mirror the reference spread/radius pairs. Calibrate on device.
export const SHADOW_PRESETS: Record<ShadowPresetName, ShadowPreset> = {
  raised: { inset: false, offset: 6, blur: 12, opacity: 1 },
  raisedSubtle: { inset: false, offset: 3, blur: 6, opacity: 0.65 },
  raisedPressed: { inset: false, offset: 2, blur: 4, opacity: 1 },
  insetDeep: { inset: true, offset: 6, blur: 12, opacity: 1 },
  insetField: { inset: true, offset: 2, blur: 4, opacity: 1 },
  insetTrack: { inset: true, offset: 3, blur: 4, opacity: 1 },
};

export const NEU_SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const NEU_RADII = { sm: 10, md: 16, lg: 22, xl: 30, pill: 999 } as const;
export const NEU_MOTION = { fast: 120, base: 200, slow: 320 } as const;

export const INTER = {
  400: 'Inter_400Regular',
  500: 'Inter_500Medium',
  600: 'Inter_600SemiBold',
  700: 'Inter_700Bold',
} as const;
export type InterWeight = keyof typeof INTER;

/** Maps any CSS-style fontWeight to the nearest loaded Inter weight. */
export function interWeight(weight: string | number | undefined): InterWeight {
  if (weight === undefined || weight === 'normal') return 400;
  if (weight === 'bold') return 700;
  const n = typeof weight === 'number' ? weight : parseInt(weight, 10);
  if (!Number.isFinite(n)) return 400;
  if (n < 450) return 400;
  if (n < 550) return 500;
  if (n < 650) return 600;
  return 700;
}

/** '#RRGGBB' + alpha 0..1 -> 'rgba(r,g,b,a)'. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
