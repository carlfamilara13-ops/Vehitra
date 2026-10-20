import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { isNativeBlurViewAvailable } from './nativeBlur';

// Shared gate for every frosted surface in the app, so a new one cannot honour one condition and
// forget the other:
//
// - `expo-blur` is a native module, so the running binary must actually contain it. A dev client
//   built before the package existed resolves the JavaScript but has no `ExpoBlurView` view
//   manager, and mounting the blur view then crashes Fabric (see `nativeBlur.ts`).
// - Reduce Transparency is an explicit "do not blur" request on iOS. Android exposes no system
//   switch, and expo-blur's Android methods fall back to a flat translucent view on older SDKs,
//   so callers pair this with an opaque base that guarantees legibility either way.
export function useGlassBlur(): boolean {
  // Reduce Transparency is a live setting: a user can flip it while the app is open, so it is
  // subscribed to rather than read once at startup.
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    let mounted = true;
    // `isReduceTransparencyEnabled` is iOS-only and is not present in the React Native type
    // definitions shipped here, so it is probed rather than called directly.
    const info = AccessibilityInfo as unknown as {
      isReduceTransparencyEnabled?: () => Promise<boolean>;
    };
    if (typeof info.isReduceTransparencyEnabled !== 'function') return;
    info
      .isReduceTransparencyEnabled()
      .then((value) => {
        if (mounted) setReduceTransparency(!!value);
      })
      .catch(() => {
        // No answer means no reduction reported; the surface simply keeps its frosted look.
      });
    return () => {
      mounted = false;
    };
  }, []);

  // The probe is a read-only registry lookup, so it only has to run once per mount.
  const blurAvailable = useMemo(() => isNativeBlurViewAvailable(), []);

  return blurAvailable && !reduceTransparency;
}
