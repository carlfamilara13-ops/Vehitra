// Pure date-only helpers for deadline reminders. Due dates are stored as 'YYYY-MM-DD' local
// calendar strings (never epochs) so an expiry never shifts with timezone; every function here
// takes an explicit `now` so reminder logic is deterministic and unit-testable.

export const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const REMINDER_OFFSET_CHOICES = [0, 1, 2, 3, 5, 7, 14, 30, 60, 90] as const;

export type DeadlinePhase = 'overdue' | 'due_soon' | 'upcoming' | 'none';

// 'YYYY-MM-DD' -> ms epoch of local midnight, or null when malformed/impossible.
export function parseDateOnly(raw: string): number | null {
  const m = DATE_ONLY_RE.exec(raw.trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d.getTime();
}

// ms epoch -> 'YYYY-MM-DD' in local time.
export function formatDateOnly(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Calendar days from local midnight today until the due date's local midnight.
// Negative = overdue. Non-finite inputs -> null (unknown).
export function daysUntilDateOnly(dueDate: string, nowMs: number): number | null {
  const due = parseDateOnly(dueDate);
  if (due == null || !Number.isFinite(nowMs)) return null;
  const now = new Date(nowMs);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((due - today) / 86_400_000);
}

// Phase from days remaining. `dueSoonDays` is the earliest offset still considered "coming up"
// (e.g. 30 when the reminder set includes a 30-day notice). Past due -> overdue; today (0) is
// due_soon; beyond the window -> 'upcoming' (exists, but nothing to show yet); null -> 'none'.
export function deadlinePhase(daysUntil: number | null, dueSoonDays = 30): DeadlinePhase {
  if (daysUntil == null || !Number.isFinite(daysUntil)) return 'none';
  if (daysUntil < 0) return 'overdue';
  if (daysUntil <= Math.max(0, dueSoonDays)) return 'due_soon';
  return 'upcoming';
}

// Earliest offset day at or before `daysUntil` (the notice the user would next receive), or
// null when no configured offset still applies.
export function nextOffsetDays(daysUntil: number | null, offsets: readonly number[]): number | null {
  if (daysUntil == null || !Number.isFinite(daysUntil)) return null;
  const applicable = offsets.filter((o) => Number.isFinite(o) && o >= 0 && o <= daysUntil);
  if (applicable.length === 0) return null;
  return Math.max(...applicable);
}

// ms epoch (local midnight of the offset day) when a reminder for (dueDate, offset) fires, or
// null when the offset does not apply or the date is invalid.
export function reminderFireAt(dueDate: string, offsetDays: number): number | null {
  const due = parseDateOnly(dueDate);
  if (due == null || !Number.isFinite(offsetDays) || offsetDays < 0) return null;
  return due - offsetDays * 86_400_000;
}

// Deterministic key for one reminder instance. Same inputs always produce the same key, so a
// reschedule can find and cancel the previous notification instead of stacking a duplicate.
export function reminderKey(kind: string, subjectId: string | null, fireDate: string): string {
  return `${kind}:${subjectId ?? '-'}:${fireDate}`;
}

// The nearest reminder a user should still see: enabled AND not soft-deleted, earliest due
// date first (ISO 'YYYY-MM-DD' compares lexicographically). Shared by any screen that reads
// listAllDeadlines (which deliberately includes disabled and deleted rows for sync), so the
// UI applies the same visibility rule as the Deadlines screen and the scheduler.
export function pickNextReminder<
  T extends { due_date: string; enabled: number; deleted_at: number | null },
>(rows: readonly T[]): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.enabled !== 1 || r.deleted_at != null) continue;
    if (!best || r.due_date < best.due_date) best = r;
  }
  return best;
}
