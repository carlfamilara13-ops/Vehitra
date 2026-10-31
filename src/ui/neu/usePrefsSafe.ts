import { usePrefs, type Prefs } from '../../app/prefs';

// Components that use preferences outside normal screen flows can keep a sensible default. The
// app shell normally provides these values through PrefsProvider.
export function usePrefsSafe(): Pick<Prefs, 'uiMode' | 'appearance'> {
  try {
    return usePrefs();
  } catch {
    return { uiMode: 'standard', appearance: 'dark' };
  }
}
