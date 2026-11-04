import { Appearance } from 'react-native';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getDb } from '../data/local/db';
import { getAppSettings, type UnitsPref, type UiMode, type AppearancePreference } from '../data/local/settingsStore';

// App preferences as reactive state (units, interface mode, and appearance). Settings writes through the
// store, then calls reload() so every consumer re-renders from the single app_settings row.
// Until the row loads the defaults are shown, matching the store defaults   never a flash of
// a value the device would not actually use.

export type Prefs = {
  units: UnitsPref;
  uiMode: UiMode;
  appearance: AppearancePreference;
  ready: boolean;
  reload: () => Promise<void>;
};

const PrefsContext = createContext<Prefs | null>(null);

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [units, setUnits] = useState<UnitsPref>('metric');
  const [uiMode, setUiMode] = useState<UiMode>('standard');
  const [appearance, setAppearance] = useState<AppearancePreference>('dark');
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    try {
      const row = await getAppSettings(await getDb());
      setUnits(row.units);
      setUiMode(row.ui_mode);
      setAppearance(row.appearance);
      Appearance.setColorScheme(row.appearance);
    } catch {
      // Keep the defaults rather than blocking the UI on a settings read; the screens that
      // actually persist preferences surface their own errors.
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<Prefs>(
    () => ({ units, uiMode, appearance, ready, reload }),
    [units, uiMode, appearance, ready, reload],
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): Prefs {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used inside <PrefsProvider>.');
  return ctx;
}
