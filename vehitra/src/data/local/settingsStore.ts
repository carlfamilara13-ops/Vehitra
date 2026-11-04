import { serialize } from './serialize';
import type { Db } from './types';
import { MaintenanceValidationError } from './maintenanceErrors';

// App preferences (schema v16): display preferences and local notification controls.
export type UnitsPref = 'metric' | 'imperial';
export type UiMode = 'standard' | 'easy';
export type AppearancePreference = 'dark' | 'light';

export type AppSettingsRow = {
  id: number;
  units: UnitsPref;
  ui_mode: UiMode;
  appearance: AppearancePreference;
  notifications_enabled: number;
  maintenance_upcoming_enabled: number;
  maintenance_overdue_enabled: number;
  document_reminders_enabled: number;
  battery_reminders_enabled: number;
  movement_reminders_enabled: number;
  stationary_ride_reminders_enabled: number;
  created_at: number;
  updated_at: number;
  client_updated_at: number;
  sync_status: string;
};

export type AppSettingsPatch = {
  units?: UnitsPref;
  ui_mode?: UiMode;
  appearance?: AppearancePreference;
  notifications_enabled?: boolean;
  maintenance_upcoming_enabled?: boolean;
  maintenance_overdue_enabled?: boolean;
  document_reminders_enabled?: boolean;
  battery_reminders_enabled?: boolean;
  movement_reminders_enabled?: boolean;
  stationary_ride_reminders_enabled?: boolean;
};

const SETTINGS_ID = 1;

const DEFAULTS: AppSettingsRow = {
  id: SETTINGS_ID,
  units: 'metric',
  ui_mode: 'standard',
  appearance: 'dark',
  notifications_enabled: 1,
  maintenance_upcoming_enabled: 1,
  maintenance_overdue_enabled: 1,
  document_reminders_enabled: 1,
  battery_reminders_enabled: 1,
  movement_reminders_enabled: 0,
  stationary_ride_reminders_enabled: 1,
  created_at: 0,
  updated_at: 0,
  client_updated_at: 0,
  sync_status: 'pending',
};

async function readAppSettings(db: Db): Promise<AppSettingsRow | null> {
  return db.getFirstAsync<AppSettingsRow>('SELECT * FROM app_settings WHERE id = ?', SETTINGS_ID);
}

export function getAppSettings(db: Db): Promise<AppSettingsRow> {
  return serialize(async () => {
    const row = await readAppSettings(db);
    if (row) return row;
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO app_settings (id, units, ui_mode, notifications_enabled, created_at, updated_at, client_updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      SETTINGS_ID, DEFAULTS.units, DEFAULTS.ui_mode, DEFAULTS.notifications_enabled, now, now, now,
    );
    const created = await readAppSettings(db);
    if (!created) throw new MaintenanceValidationError(['Could not create app settings.']);
    return created;
  });
}

export function updateAppSettings(db: Db, patch: AppSettingsPatch, now = Date.now()): Promise<AppSettingsRow> {
  return serialize(async () => {
    const current = (await readAppSettings(db)) ?? DEFAULTS;
    const errors: string[] = [];
    const units = patch.units ?? current.units;
    const uiMode = patch.ui_mode ?? current.ui_mode;
    const appearance = patch.appearance ?? current.appearance;
    const notifications = patch.notifications_enabled ?? current.notifications_enabled !== 0;
    const upcoming = patch.maintenance_upcoming_enabled ?? current.maintenance_upcoming_enabled !== 0;
    const overdue = patch.maintenance_overdue_enabled ?? current.maintenance_overdue_enabled !== 0;
    const documents = patch.document_reminders_enabled ?? current.document_reminders_enabled !== 0;
    const battery = patch.battery_reminders_enabled ?? current.battery_reminders_enabled !== 0;
    const movement = patch.movement_reminders_enabled ?? current.movement_reminders_enabled !== 0;
    const stationary = patch.stationary_ride_reminders_enabled ?? current.stationary_ride_reminders_enabled !== 0;
    if (units !== 'metric' && units !== 'imperial') errors.push('Unknown units preference.');
    if (uiMode !== 'standard' && uiMode !== 'easy') errors.push('Unknown interface mode.');
    if (appearance !== 'dark' && appearance !== 'light') errors.push('Unknown appearance preference.');
    if (errors.length) throw new MaintenanceValidationError(errors);
    await db.runAsync(
      `UPDATE app_settings
          SET units = ?, ui_mode = ?, notifications_enabled = ?, appearance = ?,
              maintenance_upcoming_enabled = ?, maintenance_overdue_enabled = ?,
              document_reminders_enabled = ?, battery_reminders_enabled = ?,
              movement_reminders_enabled = ?, stationary_ride_reminders_enabled = ?,
              updated_at = ?, client_updated_at = ?, sync_status = 'pending'
        WHERE id = ?`,
      units, uiMode, notifications ? 1 : 0, appearance, upcoming ? 1 : 0, overdue ? 1 : 0,
      documents ? 1 : 0, battery ? 1 : 0, movement ? 1 : 0, stationary ? 1 : 0, now, now, SETTINGS_ID,
    );
    const updated = await readAppSettings(db);
    if (!updated) throw new MaintenanceValidationError(['Could not update app settings.']);
    return updated;
  });
}
