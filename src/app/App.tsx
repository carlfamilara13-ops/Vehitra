import React, { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Rajdhani_700Bold } from '@expo-google-fonts/rajdhani';
import RootNavigator from './RootNavigator';

export default function App() {
  // Fonts are polish, not a gate. The app renders immediately and React Native substitutes the
  // system font until the display family resolves, so a slow or failed load can never leave the
  // user staring at a blank screen.
  const [, fontError] = useFonts({ Rajdhani_700Bold });
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (fontError) {
      console.warn('Display font failed to load; the system font is standing in.', fontError);
    }
  }, [fontError]);

  return (
    <SafeAreaProvider>
      <StatusBar style={colorScheme === 'light' ? 'dark' : 'light'} />
      <RootNavigator />
    </SafeAreaProvider>
  );
}
