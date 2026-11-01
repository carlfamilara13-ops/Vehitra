import React from 'react';
import { StyleSheet, View } from 'react-native';
import { TAB_BAR_RADIUS } from './tabBarLayout';
import GlassSurface from './GlassSurface';

// The floating bar's surface, rendered as the navigator's `tabBarBackground`.
//
// It reuses the shared GlassSurface rather than re-implementing the stack, so the pill is the same
// glass material as every card and button: the reference fill, the 20px-style rim (overridden here
// to the bar's own radius), the `backdrop-filter: blur(14px)` blur, the inset and gradient
// hairlines. The outer wrapper carries the floating shadow and does not clip, because a clipped
// layer drops its own shadow on iOS; GlassSurface clips its own blur and hairline layers to the
// pill's silhouette.
export default function GlassTabBarBackground() {
  return (
    <View style={s.shadow} pointerEvents="none">
      <GlassSurface style={s.bar} />
    </View>
  );
}

const fill = { position: 'absolute' as const, top: 0, right: 0, bottom: 0, left: 0 };

const s = StyleSheet.create({
  // `borderRadius` here is what gives the shadow its shape: with no `shadowPath` iOS derives the
  // shadow from the composited alpha of the layer tree, i.e. from the clipped pill below.
  shadow: {
    ...fill,
    borderRadius: TAB_BAR_RADIUS,
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  // The shared glass shell, sized to the bar and given the bar's own radius.
  bar: { ...fill, borderRadius: TAB_BAR_RADIUS },
});
