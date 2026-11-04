import React, { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
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
import { refreshLocalReminders } from '../features/reminders/refresh';
import { syncMovementMonitor } from '../features/reminders/movementMonitor';
import { handleLocalNotificationResponse } from '../features/reminders/notificationActions';
import { PrefsProvider, usePrefs } from './prefs';
import AppIntro from '../features/intro/AppIntro';
import { shouldPlayIntro } from '../features/intro/introTiming';

function AppShell() {
  const { appearance } = usePrefs();
  // Decided once per cold start; the overlay sits above the already-mounted app.
  const [showIntro, setShowIntro] = useState(shouldPlayIntro);

  return (
    <>
      <StatusBar style={appearance === 'light' ? 'dark' : 'light'} />
      <RootNavigator />
      {showIntro ? <AppIntro onDone={() => setShowIntro(false)} /> : null}
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

  useEffect(() => {
    let alive = true;
    const handled = new Set<string>();
    const handleResponse = async (response: Notifications.NotificationResponse) => {
      const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
      if (handled.has(key)) return;
      handled.add(key);
      try {
        await handleLocalNotificationResponse(response);
      } catch (error) {
        console.warn('Could not apply notification action.', error);
      } finally {
        try {
          await Notifications.clearLastNotificationResponseAsync();
        } catch {
          // The response may already have been cleared by the platform.
        }
      }
    };

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void handleResponse(response);
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (alive && response) void handleResponse(response);
    }).catch(() => undefined);

    const refresh = async () => {
      await refreshLocalReminders();
      await syncMovementMonitor();
    };
    void refresh().catch((error) => console.warn('Could not refresh local reminders.', error));
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh().catch((error) => console.warn('Could not refresh local reminders.', error));
      }
    });

    return () => {
      alive = false;
      responseSubscription.remove();
      appStateSubscription.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <PrefsProvider>
        <AppShell />
      </PrefsProvider>
    </SafeAreaProvider>
  );
}