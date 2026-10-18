// Pure presentation helpers for the Parts overview (Stage 4B-6, read-only).
//
// These translate the maintenance domain's evaluation into labels/tone and do the search,
// counting and progress maths. They hold no React/Expo/SQLite imports so they can be unit
// tested with node:test; the screen only draws the results. Nothing here invents data: a
// status, reason, rule or progress value comes from the domain evaluator unchanged.

import type { MaintenanceReason, MaintenanceStatus } from '../../domain/maintenance/types';

// UI tone for a status. The screen maps a tone to a colour; keep the semantic split here so the
// summary counts and the per-component badges always agree.
export type StatusTone = 'good' | 'due' | 'overdue' | 'unknown' | 'off';

export const STATUS_LABELS: Record<MaintenanceStatus, string> = {
  good: 'Good',
  due_soon: 'Due soon',
  overdue: 'Overdue',
  unknown: 'Unknown',
  not_applicable: 'Not applicable',
};

export const STATUS_TONES: Record<MaintenanceStatus, StatusTone> = {
  good: 'good',
  due_soon: 'due',
  overdue: 'overdue',
  unknown: 'unknown',
  not_applicable: 'off',
};

// Plain-language explanation for why a component is not classified as good/due/overdue.
// 'unknown' must read as "we do not know yet", never as "fine".
export const REASON_LABELS: Record<MaintenanceReason, string> = {
  not_applicable_to_vehicle_type: 'Not used by this vehicle type.',
  disabled_by_override: 'Turned off for this vehicle.',
  no_interval: 'No replacement interval is set, so no status can be shown.',
  invalid_rule: 'The interval for this component is invalid.',
  no_service_history: 'No service or install recorded yet.',
  missing_odometer: 'No odometer reading available.',
  invalid_odometer: 'The odometer reading is invalid.',
  inconsistent_odometer: 'The odometer reading is inconsistent.',
  invalid_usage: 'The recorded usage total is invalid.',
};

export const CATEGORY_LABELS: Record<string, string> = {
  engine: 'Engine',
  fluids: 'Fluids',
  brakes: 'Brakes',
  wheels_tires: 'Wheels & tires',
  electrical: 'Electrical',
  transmission: 'Transmission',
};

export function categoryLabel(code: string): string {
  return CATEGORY_LABELS[code] ?? code;
}

export function reasonLabel(reason: MaintenanceReason | null): string | null {
  return reason ? REASON_LABELS[reason] : null;
}

// Human note about where the replacement interval came from. The estimate wording is deliberate:
// local estimates are NOT manufacturer recommendations, and catalog values carry their review
// status (draft values are explicitly not manufacturer data).
export function intervalSourceNote(source: string): string | null {
  switch (source) {
    case 'estimate':
      return 'Interval is a local estimate, not a manufacturer recommendation.';
    case 'catalog':
      return 'From this model\'s resource pack — draft data, not a manufacturer recommendation.';
    case 'usage':
      return 'Interval based on your recorded usage profile.';
    case 'override':
      return 'User configured — not a manufacturer recommendation.';
    default:
      return null;
  }
}

// Extra provenance line for a component whose rule came from a catalog pack row.
export function catalogProvenanceNote(
  catalog: { reviewStatus: string; provenance: string; sourceNote: string | null } | null,
): string | null {
  if (!catalog) return null;
  const review = catalog.reviewStatus === 'reviewed' ? 'Reviewed pack data' : 'Draft pack data — pending review';
  const origin =
    catalog.provenance === 'remote' ? ' (downloaded catalog)' : catalog.provenance === 'admin' ? ' (admin published)' : ' (bundled catalog)';
  return review + origin;
}

export type StatusCounts = {
  total: number;
  good: number;
  due_soon: number;
  overdue: number;
  unknown: number;
  not_applicable: number;
};

// Count components by status. Unknown is kept separate from good on purpose.
export function summarize(statuses: Iterable<MaintenanceStatus>): StatusCounts {
  const counts: StatusCounts = {
    total: 0,
    good: 0,
    due_soon: 0,
    overdue: 0,
    unknown: 0,
    not_applicable: 0,
  };
  for (const status of statuses) {
    counts.total += 1;
    counts[status] += 1;
  }
  return counts;
}

// Case-insensitive search over the component's display name and its catalog code.
export function matchesQuery(component: { componentCode: string; name: string }, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  return component.name.toLowerCase().includes(query) || component.componentCode.toLowerCase().includes(query);
}

// Fraction of the track to fill (0..1). Clamps an overdue component (>100%) so the bar never
// overflows its track; the status label stays authoritative.
export function progressFraction(usedPercent: number): number {
  if (!Number.isFinite(usedPercent) || usedPercent <= 0) return 0;
  if (usedPercent >= 100) return 1;
  return usedPercent / 100;
}

// Whole metres-free kilometre text for the UI: at most one decimal, no trailing ".0".
export function formatKm(km: number): string {
  const rounded = Math.round(km * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

// "used of interval km" line for a component that has distance progress.
export function usageLine(usedKm: number, intervalKm: number, remainingKm: number): string {
  const px = Math.max(0, Math.round((usedKm / intervalKm) * 100));
  const left =
    remainingKm > 0
      ? `${formatKm(remainingKm)} km left`
      : remainingKm === 0
        ? 'at the interval now'
        : `${formatKm(-remainingKm)} km over`;
  return `${formatKm(usedKm)} of ${formatKm(intervalKm)} km (${px}%) · ${left}`;
}

// ---------------------------------------------------------------- form input parsing (Stage 4C)
//
// Pure parsers for the Parts forms. They only decide whether a typed value is usable and convert it;
// the store validates again, so these are for immediate feedback, not a substitute for store checks.
// Precision is preserved (no rounding) because odometer/interval are REAL kilometres.

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

// A user-typed odometer reading. Blank, non-finite or negative are rejected.
export function parseOdometerKm(raw: string): ParseResult<number> {
  const t = raw.trim();
  if (!t) return { ok: false, error: 'Enter an odometer reading.' };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'Odometer must be zero or greater.' };
  return { ok: true, value: n };
}

// An optional odometer reading: blank is allowed and becomes null.
export function parseOptionalOdometerKm(raw: string): ParseResult<number | null> {
  if (!raw.trim()) return { ok: true, value: null };
  return parseOdometerKm(raw);
}

// A user-typed distance interval. Blank, non-finite or non-positive are rejected.
export function parseIntervalKm(raw: string): ParseResult<number> {
  const t = raw.trim();
  if (!t) return { ok: false, error: 'Enter an interval in kilometres.' };
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'Interval must be greater than zero.' };
  return { ok: true, value: n };
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// A YYYY-MM-DD date as local midnight. Rejects malformed strings, impossible dates (2026-02-30) and
// dates after today. The value is local midnight, so comparing it to the current instant is
// timezone-safe: today's local midnight is never after now, but any later calendar day is. Future
// days are refused so a service or baseline cannot be dated ahead of today (which would read as no
// usage yet and mask a due/overdue part).
export function parseDateInput(raw: string, now: Date = new Date()): ParseResult<number> {
  const m = DATE_RE.exec(raw.trim());
  if (!m) return { ok: false, error: 'Enter the date as YYYY-MM-DD.' };
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return { ok: false, error: 'That date does not exist.' };
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d.getTime() > today.getTime()) return { ok: false, error: 'Date cannot be in the future.' };
  return { ok: true, value: d.getTime() };
}

// The local calendar date as YYYY-MM-DD, used to prefill the date field.
export function todayInput(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
