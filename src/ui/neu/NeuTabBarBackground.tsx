import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNeu } from './useNeu';
import { TAB_BAR_CONFIG } from '../tabBarLayout';

export default function NeuTabBarBackground() {
  const n = useNeu();

  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        n.insetField,
        {
          borderRadius: TAB_BAR_CONFIG.cornerRadius,
        },
      ]}
    />
  );
}