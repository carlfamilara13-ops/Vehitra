import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Rajdhani_700Bold } from '@expo-google-fonts/rajdhani';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import RootNavigator from './RootNavigator';
import { PrefsProvider, usePrefs } from './prefs';

function AppShell() {
  const { appearance } = usePrefs();

  return (
    <>
      <StatusBar style={appearance === 'light' ? 'dark' : 'light'} />
      <RootNavigator />
    </>
  );
}

export default function App() {
  // Fonts are polish, not a gate. The app renders immediately and React Native
  // substitutes the system font until the display family resolves.
  const [, fontError] = useFonts({
    Rajdhani_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontError) {
      console.warn(
        'Display font failed to load; the system font is standing in.',
        fontError
      );
    }
  }, [fontError]);

  return (
    <SafeAreaProvider>
      <PrefsProvider>
        <AppShell />
      </PrefsProvider>
    </SafeAreaProvider>
  );
}