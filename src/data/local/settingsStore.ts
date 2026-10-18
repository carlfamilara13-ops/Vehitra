import { serialize } from './serialize';
import type { Db } from './types';
import { MaintenanceValidationError } from './maintenanceErrors';

// App preferences (schema v8): a single row (id = 1). `units` only changes display formatting —
// every stored distance stays in kilometres, so ledgers, intervals and odometers are unaffected
// by the preference. `ui_mode` is the accessibility/simple-mode preference (larger controls,
// plainer wording); it never infers ability from age. `notifications_enabled` gates reminder
// scheduling only — turning it off never affects local data.

export type UnitsPref = 'metric' | 'imperial';
export type UiMode = 'standard' | 'easy';

export type AppSettingsRow = {
  id: number;
  units: UnitsPref;
  ui_mode: UiMode;
  notifications_enabled: number;
  created_at: number;
  updated_at: number;
  client_updated_at: number;
  sync_status: string;
};

export type AppSettingsPatch = {
  units?: UnitsPref;
  ui_mode?: UiMode;
  notifications_enabled?: boolean;
};

const SETTINGS_ID = 1;

const DEFAULTS: AppSettingsRow = {
  id: SETTINGS_ID,
  units: 'metric',
  ui_mode: 'standard',
  notifications_enabled: 1,
  created_at: 0,
  updated_at: 0,
  client_updated_at: 0,
  sync_status: 'pending',
};

// Plain read (never queued — must not be called from inside another serialize task).
async function readAppSettings(db: Db): Promise<AppSettingsRow | null> {
  return db.getFirstAsync<AppSettingsRow>('SELECT * FROM app_settings WHERE id = ?', SETTINGS_ID);
}

// Reads the settings row, creating it on first use so callers never handle null.
export function getAppSettings(db: Db): Promise<AppSettingsRow> {
  return serialize(async () => {
    const row = await readAppSettings(db);
    if (row) return row;
    await db.runAsync(
      `INSERT INTO app_settings (id, units, ui_mode, notifications_enabled, created_at, updated_at, client_updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      SETTINGS_ID, DEFAULTS.units, DEFAULTS.ui_mode, DEFAULTS.notifications_enabled,
      Date.now(), Date.now(), Date.now(),
    );
    const created = await readAppSettings(db);
    if (!created) throw new MaintenanceValidationError(['Could not create app settings.']);
    return created;
  });
}

export function updateAppSettings(db: Db, patch: AppSettingsPatch, now = Date.now()): Promise<AppSettingsRow> {
  // Entirely inside one queue slot: the reads here are the plain helper (serialize is FIFO, so
  // calling the queued getAppSettings from within this task would deadlock).
  return serialize(async () => {
    const current = (await readAppSettings(db)) ?? DEFAULTS;
    const errors: string[] = [];
    const units = patch.units ?? current.units;
    const uiMode = patch.ui_mode ?? current.ui_mode;
    const notifications = patch.notifications_enabled ?? current.notifications_enabled !== 0;
    if (units !== 'metric' && units !== 'imperial') errors.push('Unknown units preference.');
    if (uiMode !== 'standard' && uiMode !== 'easy') errors.push('Unknown interface mode.');
    if (errors.length) throw new MaintenanceValidationError(errors);
    await db.runAsync(
      `UPDATE app_settings
          SET units = ?, ui_mode = ?, notifications_enabled = ?,
              updated_at = ?, client_updated_at = ?, sync_status = 'pending'
        WHERE id = ?`,
      units, uiMode, notifications ? 1 : 0, now, now, SETTINGS_ID,
    );
    const updated = await readAppSettings(db);
    if (!updated) throw new MaintenanceValidationError(['Could not update app settings.']);
    return updated;
  });
}
