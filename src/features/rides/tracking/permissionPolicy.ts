// Pure permission rules (no React Native / Expo imports) so they can be unit-tested.
export type PermissionState = {
  foreground: boolean;
  background: boolean;
  notifications: boolean;
  foregroundCanAskAgain: boolean;
  backgroundCanAskAgain: boolean;
};

export type PermissionVerdict =
  | { canStart: true; warnings: string[] }
  | { canStart: false; reason: 'foreground' | 'background'; message: string; canAskAgain: boolean; warnings: string[] };

export const BACKGROUND_EXPLANATION =
  'Vehitra records your ride while the screen is off or the app is in the background. ' +
  'That needs location access set to "Allow all the time". Without it a ride can silently stop recording, ' +
  'so Vehitra will not start one.';

// A ride is only started when BOTH foreground and background location are granted.
// A denied notification permission is a visible warning, not a blocker (the service still runs, but its
// notification is hidden on Android 13+).
export function evaluatePermissions(p: PermissionState): PermissionVerdict {
  const warnings: string[] = [];
  if (!p.notifications) {
    warnings.push('Notifications are off, so the "recording" notification is hidden. Recording still works.');
  }
  if (!p.foreground) {
    return {
      canStart: false,
      reason: 'foreground',
      message: 'Vehitra needs location access to record a ride.',
      canAskAgain: p.foregroundCanAskAgain,
      warnings,
    };
  }
  if (!p.background) {
    return {
      canStart: false,
      reason: 'background',
      message: BACKGROUND_EXPLANATION,
      canAskAgain: p.backgroundCanAskAgain,
      warnings,
    };
  }
  return { canStart: true, warnings };
}
