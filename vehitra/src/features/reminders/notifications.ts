import { Platform } from 'react-native';

const REMINDER_CHANNEL_ID = 'vehitra-reminders';
export const STATIONARY_RIDE_CATEGORY = 'vehitra-stationary-ride';
export const STATIONARY_RIDE_ACTIONS = {
  remindLater: 'stationary-remind-later',
  stopForRide: 'stationary-stop-for-ride',
} as const;

export type ReminderNotification = {
  title: string;
  body: string;
  fireAt: number;
  immediate?: boolean;
  categoryIdentifier?: string;
  data?: Record<string, string>;
};

export type NotificationsAdapter = {
  available: boolean;
  ensurePermissions(requestIfNeeded?: boolean): Promise<boolean>;
  schedule(n: ReminderNotification): Promise<string | null>;
  cancel(platformId: string): Promise<void>;
  dismiss?(platformId: string): Promise<void>;
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
  let categorySetup: Promise<void> | null = null;

  const prepareCategories = async () => {
    if (!mod) return;
    if (!categorySetup) {
      categorySetup = mod.setNotificationCategoryAsync(STATIONARY_RIDE_CATEGORY, [
        { identifier: STATIONARY_RIDE_ACTIONS.remindLater, buttonTitle: 'Remind me later' },
        { identifier: STATIONARY_RIDE_ACTIONS.stopForRide, buttonTitle: 'Stop reminding for this ride' },
      ]).then(() => undefined).catch(() => undefined);
    }
    await categorySetup;
  };

  if (mod) {
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
      // Notifications still work in the background if foreground handler setup is unavailable.
    }
  }

  return {
    available,

    async ensurePermissions(requestIfNeeded = true) {
      if (!mod) return false;
      try {
        if (Platform.OS === 'android') {
          await mod.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
            name: 'Vehitra reminders',
            description: 'Maintenance, document expiry, and ride reminders.',
            importance: mod.AndroidImportance.DEFAULT,
            enableVibrate: true,
            vibrationPattern: [0, 250, 250, 250],
          });
        }
        const current = await mod.getPermissionsAsync();
        const granted = current.granted || current.status === 'granted';
        if (!granted) {
          if (!requestIfNeeded) return false;
          const asked = await mod.requestPermissionsAsync();
          if (!(asked.granted || asked.status === 'granted')) return false;
        }
        await prepareCategories();
        return true;
      } catch {
        return false;
      }
    },

    async schedule(n) {
      if (!mod) return null;
      try {
        if (n.categoryIdentifier === STATIONARY_RIDE_CATEGORY) await prepareCategories();
        return await mod.scheduleNotificationAsync({
          content: {
            title: n.title,
            body: n.body,
            ...(n.categoryIdentifier ? { categoryIdentifier: n.categoryIdentifier } : {}),
            ...(n.data ? { data: n.data } : {}),
          },
          trigger: n.immediate ? null : {
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
        // Already gone is a normal end state.
      }
    },

    async dismiss(platformId) {
      if (!mod) return;
      try {
        await mod.dismissNotificationAsync(platformId);
      } catch {
        // It may not have been delivered yet.
      }
    },

    async cancelAll() {
      if (!mod) return;
      try {
        await mod.cancelAllScheduledNotificationsAsync();
      } catch {
        // Nothing scheduled is a fine end state.
      }
    },
  };
}

export async function prepareNotificationCategories(): Promise<void> {
  const adapter = createNotificationsAdapter();
  if (adapter.available) {
    // Registration is idempotent. A harmless permission check creates the platform channel too.
    await adapter.ensurePermissions(false);
  }
}



