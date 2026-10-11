import * as Location from 'expo-location';
import { PermissionsAndroid, Platform } from 'react-native';
import type { PermissionState } from './permissionPolicy';

export type { PermissionState };

// Asks for permissions. Order matters on Android: foreground location first, then background location,
// then notifications (the foreground-service notification is hidden on Android 13+ without it).
export async function ensurePermissions(): Promise<PermissionState> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    return {
      foreground: false, background: false, notifications: false,
      foregroundCanAskAgain: fg.canAskAgain, backgroundCanAskAgain: true,
    };
  }
  const bg = await Location.requestBackgroundPermissionsAsync();
  let notifications = true;
  if (Platform.OS === 'android' && Platform.Version >= 33) {
    const r = await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as never);
    notifications = r === PermissionsAndroid.RESULTS.GRANTED;
  }
  return {
    foreground: true,
    background: bg.status === 'granted',
    notifications,
    foregroundCanAskAgain: fg.canAskAgain,
    backgroundCanAskAgain: bg.canAskAgain,
  };
}

// Reads the CURRENT location permissions without showing any dialog.
export async function readLocationPermissions(): Promise<{ foreground: boolean; background: boolean }> {
  const fg = await Location.getForegroundPermissionsAsync();
  const bg = await Location.getBackgroundPermissionsAsync();
  return { foreground: fg.status === 'granted', background: bg.status === 'granted' };
}
