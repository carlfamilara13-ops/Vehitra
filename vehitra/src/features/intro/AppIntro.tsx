import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useReduceMotion } from '../../ui/neu/useReduceMotion';
import { INTRO, markIntroPlayed } from './introTiming';

const LOGO = require('../../../assets/intro/intro-logo.png');
const BG = '#02060F';
const BLUE = '#0AB4FF';

type Props = { onDone: () => void };

/**
 * App-opening overlay. Renders on top of the real app (which is already mounted and
 * interactive underneath) with pointerEvents="none", so it never blocks input or
 * delays startup. It unmounts itself when finished.
 */
export default function AppIntro({ onDone }: Props) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const [glowId] = useState(() => `introGlow${Math.random().toString(36).slice(2, 8)}`);

  const logoOpacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const overlay = useRef(new Animated.Value(1)).current;

  // Logo box adapts to any screen: 62% of the shorter side, square (asset is 1:1).
  const size = Math.min(width, height) * 0.62;
  const glowSize = size * 1.5;

  useEffect(() => {
    markIntroPlayed();
    const native = { useNativeDriver: true };
    const ease = Easing.out(Easing.cubic);

    let anim: Animated.CompositeAnimation;
    if (reduceMotion) {
      // Respect the OS setting: no zoom or pulse, just a short fade in/out.
      anim = Animated.sequence([
        Animated.timing(logoOpacity, { toValue: 1, duration: 200, ...native }),
        Animated.delay(INTRO.reducedMotionTotal - 400),
        Animated.timing(overlay, { toValue: 0, duration: 200, ...native }),
      ]);
    } else {
      anim = Animated.sequence([
        Animated.parallel([
          Animated.timing(logoOpacity, { toValue: 1, duration: INTRO.appear, easing: ease, ...native }),
          Animated.timing(glow, { toValue: 0.55, duration: INTRO.appear, ...native }),
        ]),
        // Beat: glow swells and the logo gives a small thump.
        Animated.parallel([
          Animated.sequence([
            Animated.timing(glow, { toValue: 1, duration: INTRO.pulse * 0.4, ...native }),
            Animated.timing(glow, { toValue: 0.6, duration: INTRO.pulse * 0.6, ...native }),
          ]),
          Animated.sequence([
            Animated.timing(scale, { toValue: 1.07, duration: INTRO.pulse * 0.4, easing: ease, ...native }),
            Animated.timing(scale, { toValue: 1, duration: INTRO.pulse * 0.6, easing: Easing.inOut(Easing.quad), ...native }),
          ]),
        ]),
        // Zoom in until the V fills the screen; overlay dissolves during the zoom.
        Animated.parallel([
          Animated.timing(scale, {
            toValue: INTRO.zoomScale,
            duration: INTRO.zoom,
            easing: Easing.in(Easing.cubic),
            ...native,
          }),
          Animated.sequence([
            Animated.delay(INTRO.fadeStartsAt - INTRO.appear - INTRO.pulse),
            Animated.timing(overlay, { toValue: 0, duration: INTRO.fade, easing: Easing.out(Easing.quad), ...native }),
          ]),
        ]),
      ]);
    }

    anim.start(({ finished }) => {
      if (finished) onDone();
    });
    // Safety net: never leave the overlay mounted if an animation callback is dropped.
    const guard = setTimeout(onDone, 3000);
    return () => {
      clearTimeout(guard);
      anim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.root, { opacity: overlay }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[styles.center, { opacity: glow, width: glowSize, height: glowSize }]}>
        <Svg width={glowSize} height={glowSize}>
          <Defs>
            <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={BLUE} stopOpacity="0.38" />
              <Stop offset="0.5" stopColor={BLUE} stopOpacity="0.12" />
              <Stop offset="1" stopColor={BLUE} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect width={glowSize} height={glowSize} fill={`url(#${glowId})`} />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.center, { opacity: logoOpacity, transform: [{ scale }] }]}>
        <Image source={LOGO} style={{ width: size, height: size }} resizeMode="contain" />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  center: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
