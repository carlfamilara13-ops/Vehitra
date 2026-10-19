import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getDb } from '../data/local/db';
import { getAppSettings, type UnitsPref, type UiMode } from '../data/local/settingsStore';

// App preferences as reactive state (units + interface mode). Settings writes through the
// store, then calls reload() so every consumer re-renders from the single app_settings row.
// Until the row loads the defaults are shown, matching the store defaults — never a flash of
// a value the device would not actually use.

export type Prefs = {
  units: UnitsPref;
  uiMode: UiMode;
  ready: boolean;
  reload: () => Promise<void>;
};

const PrefsContext = createContext<Prefs | null>(null);

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [units, setUnits] = useState<UnitsPref>('metric');
  const [uiMode, setUiMode] = useState<UiMode>('standard');
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    try {
      const row = await getAppSettings(await getDb());
      setUnits(row.units);
      setUiMode(row.ui_mode);
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
    () => ({ units, uiMode, ready, reload }),
    [units, uiMode, ready, reload],
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): Prefs {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used inside <PrefsProvider>.');
  return ctx;
}
