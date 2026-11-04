import { DEADLINE_KIND_LABELS, type DeadlineRow } from '../../data/local/deadlineStore';
import type { ComponentMaintenance } from '../../data/local/maintenanceQuery';
import { daysUntilDateOnly, pickNextReminder } from '../../domain/reminders/dates';
import { distanceUnit, formatDistanceKm, type Units } from '../../domain/units';
import type { MaintenanceStatus } from '../../domain/maintenance/types';
import { summarize, type StatusCounts } from '../parts/partsView';

// Pure view logic for the Record tab's Garage experience. Everything here is side-effect free so
// the carousel index, odometer display, maintenance line and per-vehicle reminder can be tested
// without a database or a device.

// Maps a horizontal scroll offset to the centered page. Round rather than floor so the page
// flips at the halfway point, and clamp so a bounce past either end cannot escape the list.
export function pageForOffset(offsetX: number, pageWidth: number, count: number): number {
  if (count <= 0 || !Number.isFinite(pageWidth) || pageWidth <= 0) return 0;
  const raw = Math.round(offsetX / pageWidth);
  return Math.min(count - 1, Math.max(0, raw));
}

// Index of the shared active vehicle inside the garage list; 0 when nothing is selected (or the
// selected id is not in the list   e.g. it was deleted on another screen).
export function selectedVehicleIndex(
  vehicles: readonly { id: string }[],
  activeId: string | null,
): number {
  if (!activeId) return 0;
  const i = vehicles.findIndex((v) => v.id === activeId);
  return i < 0 ? 0 : i;
}

// The schema has no vehicle-image column, so every vehicle shows a deliberate type-based
// fallback rather than a photo. Names come from the FontAwesome5 solid set already shipped with
// @expo/vector-icons; `other` uses a generic car silhouette instead of a "missing" glyph.
export function vehicleTypeIcon(vehicleType: string): string {
  switch (vehicleType) {
    case 'motorcycle':
      return 'motorcycle';
    case 'car':
      return 'car';
    case 'bicycle':
      return 'bicycle';
    case 'truck':
      return 'truck';
    case 'bus':
      return 'bus';
    case 'van':
      return 'shuttle-van';
    default:
      return 'car-side';
  }
}

// Large odometer figure and its smaller unit label, split for the glass card. A missing reading
// is an em dash with the unit still shown, so the slot never collapses and "not set" is honest.
export function odometerDisplay(
  odometerKm: number | null,
  units: Units,
): { value: string; unit: string } {
  const unit = distanceUnit(units);
  if (odometerKm == null || !Number.isFinite(odometerKm)) return { value: ' ', unit };
  const full = formatDistanceKm(odometerKm, units);
  const sp = full.lastIndexOf(' ');
  if (sp < 0) return { value: full, unit };
  return { value: full.slice(0, sp), unit: full.slice(sp + 1) };
}

// One-line maintenance condition for the selected vehicle, mirroring the Dashboard's wording so
// the same evaluation never reads two ways. Unknown is kept distinct from good.
export function maintenanceLine(
  items: readonly Pick<ComponentMaintenance, 'evaluation'>[],
): string | null {
  const usable = items.filter((i) => i.evaluation.status !== 'not_applicable');
  if (usable.length === 0) return null;
  const count = (status: MaintenanceStatus) =>
    usable.filter((i) => i.evaluation.status === status).length;
  const overdue = count('overdue');
  const dueSoon = count('due_soon');
  const unknown = count('unknown');
  if (overdue > 0) return `${overdue} overdue`;
  if (dueSoon > 0) return `${dueSoon} due soon`;
  if (unknown > 0) return `${unknown} unknown`;
  return 'Up to date';
}

// The nearest visible reminder attached to one vehicle (licence/custom rows are user-level and
// are deliberately excluded here   this card is about the selected machine).
export function nextReminderForVehicle(
  deadlines: readonly DeadlineRow[],
  vehicleId: string | null,
): DeadlineRow | null {
  if (!vehicleId) return null;
  return pickNextReminder(deadlines.filter((d) => d.user_vehicle_id === vehicleId));
}

// Plain-language line for that reminder, or null when there is nothing due to show.
export function reminderSummaryLine(
  deadline: DeadlineRow | null,
  nowMs: number,
): string | null {
  if (!deadline) return null;
  const days = daysUntilDateOnly(deadline.due_date, nowMs);
  if (days == null) return null;
  const kind =
    (DEADLINE_KIND_LABELS as Record<string, string>)[deadline.kind] ?? deadline.kind;
  if (days < 0) return `${kind} expired`;
  if (days === 0) return `${kind} due today`;
  if (days <= 30) return `${kind} due in ${days} day${days === 1 ? '' : 's'}`;
  return null;
}

// ---------------------------------------------------------------------------------------
// Maintenance condition badge (Record tab)
//
// A four-way label derived from the SAME per-component evaluations the Parts screen shows.
// Nothing is inferred: the label is a summary of the recorded maintenance state only. The
// vehicle's age, odometer reading and type never enter into it, and a vehicle with no usable
// maintenance records is never called GOOD.
//
//   DUE      at least one component is overdue.
//   SERVICE  no overdue component, but at least one is due soon.
//   UNKNOWN  no overdue and no due-soon component, but at least one component's state could
//            not be determined (no service history, no interval, an invalid rule)   or there
//            is no applicable component at all, so there is nothing to judge.
//   GOOD     every applicable component is up to date.
//
// The precedence is the same worst-first order the Dashboard's maintenance line uses, so the
// badge and the line never disagree.
// ---------------------------------------------------------------------------------------

export type ConditionTone = 'ok' | 'watch' | 'bad' | 'unknown';
export type ConditionLabel = 'GOOD' | 'SERVICE' | 'DUE' | 'UNKNOWN';

export type VehicleCondition = {
  label: ConditionLabel;
  tone: ConditionTone;
  /** The counts the label was derived from, so the card can show the same numbers. */
  counts: StatusCounts;
};

// The plain reading of each condition label, for a screen reader and for any tooltip. The
// short labels stay on screen; this is what they mean.
export const CONDITION_DESCRIPTIONS: Record<ConditionLabel, string> = {
  GOOD: 'Maintenance up to date',
  SERVICE: 'Maintenance due soon',
  DUE: 'Maintenance overdue',
  UNKNOWN: 'Maintenance condition unknown',
};

export function maintenanceCondition(
  items: readonly Pick<ComponentMaintenance, 'evaluation'>[],
): VehicleCondition {
  const counts = summarize(items.map((i) => i.evaluation.status));
  // Components that do not apply to this vehicle type say nothing about its condition.
  const usable = counts.total - counts.not_applicable;
  if (usable === 0) return { label: 'UNKNOWN', tone: 'unknown', counts };
  if (counts.overdue > 0) return { label: 'DUE', tone: 'bad', counts };
  if (counts.due_soon > 0) return { label: 'SERVICE', tone: 'watch', counts };
  // An undetermined component means "up to date" cannot be claimed for the whole vehicle.
  if (counts.unknown > 0) return { label: 'UNKNOWN', tone: 'unknown', counts };
  return { label: 'GOOD', tone: 'ok', counts };
}

// ---------------------------------------------------------------------------------------
// Compact vehicle statistics (Record tab)
//
// One row of two or three cells, each one a fact the app already holds. A cell is omitted
// when there is nothing behind it; a cell that has no value says so plainly ("Not set")
// rather than showing a placeholder or an invented figure.
// ---------------------------------------------------------------------------------------

export type VehicleStat = {
  key: string;
  label: string;
  value: string;
  tone: ConditionTone | 'default';
};

// Short names for the reminder kinds, so a stat cell stays one readable word wide.
const REMINDER_STAT_LABELS: Record<string, string> = {
  registration: 'Registration',
  license: 'Licence',
  insurance: 'Insurance',
  inspection: 'Inspection',
  custom: 'Reminder',
};

// The next reminder as one compact cell: the kind as the label, the distance as the value.
export function reminderStat(deadline: DeadlineRow | null, nowMs: number): VehicleStat | null {
  if (!deadline) return null;
  const days = daysUntilDateOnly(deadline.due_date, nowMs);
  if (days == null) return null;
  const label = deadline.label?.trim() || REMINDER_STAT_LABELS[deadline.kind] || 'Reminder';
  if (days < 0) return { key: 'reminder', label, value: 'Overdue', tone: 'bad' };
  if (days === 0) return { key: 'reminder', label, value: 'Today', tone: 'watch' };
  if (days === 1) return { key: 'reminder', label, value: 'Tomorrow', tone: 'watch' };
  if (days <= 30) {
    return { key: 'reminder', label, value: `In ${days} days`, tone: 'watch' };
  }
  return { key: 'reminder', label, value: `In ${days} days`, tone: 'default' };
}

// The stat row for the selected vehicle: how its maintenance stands, the next reminder and
// the model year. Every value comes from stored records; nothing is estimated.
export function vehicleStats(input: {
  items: readonly Pick<ComponentMaintenance, 'evaluation'>[];
  reminder: DeadlineRow | null;
  nowMs: number;
  modelYear: number | null;
}): VehicleStat[] {
  const condition = maintenanceCondition(input.items);
  const stats: VehicleStat[] = [
    {
      key: 'maintenance',
      label: 'Maintenance',
      value: maintenanceLine(input.items) ?? 'No records',
      tone: condition.tone,
    },
  ];

  const reminder = reminderStat(input.reminder, input.nowMs);
  if (reminder) stats.push(reminder);

  stats.push({
    key: 'year',
    label: 'Year',
    value: input.modelYear != null ? String(input.modelYear) : 'Not set',
    tone: 'default',
  });

  return stats;
}
