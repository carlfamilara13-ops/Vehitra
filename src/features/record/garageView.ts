import { DEADLINE_KIND_LABELS, type DeadlineRow } from '../../data/local/deadlineStore';
import type { ComponentMaintenance } from '../../data/local/maintenanceQuery';
import { daysUntilDateOnly, pickNextReminder } from '../../domain/reminders/dates';
import { distanceUnit, formatDistanceKm, type Units } from '../../domain/units';
import type { MaintenanceStatus } from '../../domain/maintenance/types';

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
// selected id is not in the list — e.g. it was deleted on another screen).
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
  if (odometerKm == null || !Number.isFinite(odometerKm)) return { value: '—', unit };
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
// are deliberately excluded here — this card is about the selected machine).
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
