import React, { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Rajdhani_700Bold } from '@expo-google-fonts/rajdhani';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
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
  // Fonts are polish, not a gate. The app renders immediately and React Native substitutes the
  // system font until the display family resolves, so a slow or failed load can never leave the
  // user staring at a blank screen.
<<<<<<< HEAD
  const [, fontError] = useFonts({ Rajdhani_700Bold, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
=======
  const [, fontError] = useFonts({ Rajdhani_700Bold });
  const colorScheme = useColorScheme();
>>>>>>> 085d579c1634fc5cd9a597346cae31cf95b819b5

  useEffect(() => {
    if (fontError) {
      console.warn('Display font failed to load; the system font is standing in.', fontError);
    }
  }, [fontError]);

  return (
    <SafeAreaProvider>
<<<<<<< HEAD
      <PrefsProvider>
        <AppShell />
      </PrefsProvider>
=======
      <StatusBar style={colorScheme === 'light' ? 'dark' : 'light'} />
      <RootNavigator />
>>>>>>> 085d579c1634fc5cd9a597346cae31cf95b819b5
    </SafeAreaProvider>
  );
}
