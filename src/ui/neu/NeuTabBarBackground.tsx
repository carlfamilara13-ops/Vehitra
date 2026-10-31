import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNeu } from './useNeu';
import { TAB_BAR_RADIUS } from '../tabBarLayout';

// Floating tab bar surface: one raised neumorphic pill (same colour as the screen). Replaces the
// glass bar; GlassTabBarBackground stays in the repo until the cleanup pass.
export default function NeuTabBarBackground() {
  const n = useNeu();
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, n.raised, { borderRadius: TAB_BAR_RADIUS }]} />;
}
