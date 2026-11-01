  import { Platform, type ViewStyle } from 'react-native';
  import { SHADOW_PRESETS, withAlpha, type NeuColors, type ShadowPresetName } from './neuTheme';

  // RN `boxShadow` (New Architecture): outset needs Android 9 (API 28), inset needs Android 10
  // (API 29). iOS supports both. Below that we fall back to a flat surface plus a hairline edge so
  // the screen never breaks.
  function supports(inset: boolean): boolean {
    if (Platform.OS !== 'android') return true;
    const v = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
    return v >= (inset ? 29 : 28);
  }

  /**
   * Paired light/dark shadow style for a preset. Light source is top-left: the dark shadow falls
   * bottom-right, the light highlight top-left. Insets reverse the pair so the surface reads as dished.
   */
  export function neuShadow(c: NeuColors, preset: ShadowPresetName): ViewStyle {
    const p = SHADOW_PRESETS[preset];
    if (!supports(p.inset)) {
      return { borderWidth: 1, borderColor: withAlpha(c.shadowDark, p.inset ? 0.9 : 0.5) };
    }
    const dark = withAlpha(c.shadowDark, p.opacity);
    const light = withAlpha(c.shadowLight, p.opacity);
    const o = p.offset;
    return {
      boxShadow: [
        { offsetX: o, offsetY: o, blurRadius: p.blur, color: p.inset ? light : dark, inset: p.inset },
        { offsetX: -o, offsetY: -o, blurRadius: p.blur, color: p.inset ? dark : light, inset: p.inset },
      ],
    };
  }
