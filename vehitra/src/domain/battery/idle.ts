// Pure battery idle rules. The app cannot measure battery condition; it only tracks how long
// the user has gone without confirming the battery was in use, and turns that elapsed time into
// a deterministic, testable indication level. Thresholds are explicit constants so the Dashboard
// wording and any scheduled reminder always agree.

export const IDLE_WATCH_DAYS = 3; // at this many idle days: worth checking
export const IDLE_WARN_DAYS = 7; // at this many idle days: strong warning (one week)

export type BatteryIdleLevel = 'ok' | 'watch' | 'warn';

export const BATTERY_IDLE_LEVEL_LABELS: Record<BatteryIdleLevel, string> = {
  ok: 'In use recently',
  watch: 'Idle — worth a check',
  warn: 'Idle over a week',
};

const MS_PER_DAY = 86_400_000;

// Whole elapsed days since the last confirmed active date. Negative clock skew is clamped to 0;
// a non-finite timestamp yields null (unknown, never "just used").
export function batteryIdleDays(lastActiveAtMs: number, nowMs: number): number | null {
  if (!Number.isFinite(lastActiveAtMs) || !Number.isFinite(nowMs)) return null;
  const diff = nowMs - lastActiveAtMs;
  if (diff <= 0) return 0;
  return Math.floor(diff / MS_PER_DAY);
}

// Level from elapsed whole days. ok < 3 <= watch < 7 <= warn.
export function batteryIdleLevel(idleDays: number | null): BatteryIdleLevel {
  if (idleDays == null || !Number.isFinite(idleDays)) return 'ok';
  if (idleDays >= IDLE_WARN_DAYS) return 'warn';
  if (idleDays >= IDLE_WATCH_DAYS) return 'watch';
  return 'ok';
}
