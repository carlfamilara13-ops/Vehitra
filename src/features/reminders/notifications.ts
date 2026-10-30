import { Platform } from 'react-native';

// Platform boundary for local reminder notifications.
//
// expo-notifications is required lazily inside try/catch so the JS bundle keeps working where
// the native module is missing or stale (tests, web, a dev client built before the module was
// added). When unavailable, scheduling becomes a no-op and `available` lets the UI say so —
// the reminder_schedule ledger is always the source of truth either way.
//
// Honesty rules:
// - notifications are local-only; nothing leaves the device;
// - exact delivery time is not guaranteed (OS doze/batching) — that is the OS contract, not a bug;
// - a native rebuild is required after adding expo-notifications before any of this fires.

const REMINDER_CHANNEL_ID = 'vehitra-reminders';

export type ReminderNotification = {
  title: string;
  body: string;
  fireAt: number; // ms epoch
};

export type NotificationsAdapter = {
  // False when the native module could not be loaded in this build.
  available: boolean;
  // Returns false when the user (or OS) denied notification permission.
  ensurePermissions(): Promise<boolean>;
  // Schedules one notification; resolves to the platform id (or null when unavailable).
  schedule(n: ReminderNotification): Promise<string | null>;
  cancel(platformId: string): Promise<void>;
  cancelAll(): Promise<void>;
};

type ExpoNotificationsModule = typeof import('expo-notifications');

function loadModule(): ExpoNotificationsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as ExpoNotificationsModule;
  } catch {
    return null;
  }
}

export function createNotificationsAdapter(): NotificationsAdapter {
  const mod = loadModule();
  const available = mod != null;

  if (mod) {
    // Foreground presentation: show the banner/list instead of silently dropping the
    // notification while the app is open. Unknown module shape -> leave the default alone.
    try {
      mod.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
    } catch {
      // Handler shape mismatch on an older module — notifications still work in background.
    }
  }

  return {
    available,

    async ensurePermissions() {
      if (!mod) return false;
      try {
        if (Platform.OS === 'android') {
          await mod.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
            name: 'Vehitra reminders',
            description: 'Maintenance, document expiry, and battery inactivity reminders.',
            importance: mod.AndroidImportance.DEFAULT,
            sound: 'default',
            enableVibrate: true,
            vibrationPattern: [0, 250, 250, 250],
          });
        }
        const current = await mod.getPermissionsAsync();
        if (current.granted || current.status === 'granted') return true;
        const asked = await mod.requestPermissionsAsync();
        return asked.granted || asked.status === 'granted';
      } catch {
        return false;
      }
    },

    async schedule(n) {
      if (!mod) return null;
      try {
        return await mod.scheduleNotificationAsync({
          content: { title: n.title, body: n.body },
          trigger: {
            type: mod.SchedulableTriggerInputTypes.DATE,
            date: new Date(n.fireAt),
            ...(Platform.OS === 'android' ? { channelId: REMINDER_CHANNEL_ID } : {}),
          },
        });
      } catch {
        return null;
      }
    },

    async cancel(platformId) {
      if (!mod) return;
      try {
        await mod.cancelScheduledNotificationAsync(platformId);
      } catch {
        // Already gone — cancelling twice is not an error worth surfacing.
      }
    },

    async cancelAll() {
      if (!mod) return;
      try {
        await mod.cancelAllScheduledNotificationsAsync();
      } catch {
        // Same as above: nothing scheduled is a fine end state.
      }
    },
  };
}
