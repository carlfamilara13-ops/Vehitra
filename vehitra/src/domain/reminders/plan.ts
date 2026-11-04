// Pure reminder planning. Turns stored deadlines, battery idle state and maintenance status
// into a deterministic list of reminder instances with stable keys. Nothing here talks to
// storage, React or the notification platform   the scheduler feeds it rows and applies the
// result, so every rule (thresholds, offsets, urgency, dedupe keys) is unit-testable.
//
// Honesty rules encoded here:
// - a reminder only exists for data the user actually entered (no inferred deadlines);
// - battery reminders are idle-time notices, never battery-health claims;
// - maintenance reminders mirror the evaluator's due_soon/overdue statuses only   unknown
//   history never produces a "you're fine" reminder.

import { batteryIdleLevel, IDLE_WATCH_DAYS, IDLE_WARN_DAYS } from '../battery/idle';
import {
  daysUntilDateOnly,
  deadlinePhase,
  formatDateOnly,
  nextOffsetDays,
  reminderKey,
} from './dates';

export type ReminderUrgency = 'overdue' | 'due_soon' | 'info';

export type ReminderPlan = {
  key: string;
  kind: 'deadline' | 'battery_idle' | 'maintenance' | 'maintenance_time';
  subjectId: string; // deadline id, or "vehicleId:componentCode" / vehicle id
  vehicleId: string | null;
  title: string;
  body: string;
  fireAt: number; // ms epoch when this reminder becomes relevant (clamped to now when overdue)
  urgency: ReminderUrgency;
};

export type DeadlineReminderInput = {
  id: string;
  kind: string; // registration | license | insurance | inspection | custom
  label: string | null;
  dueDate: string; // YYYY-MM-DD
  vehicleId: string | null;
  vehicleName: string | null;
  offsetsDays: readonly number[];
  enabled: boolean;
  deletedAt: number | null;
};

export type BatteryReminderInput = {
  vehicleId: string;
  vehicleName: string;
  lastActiveAt: number;
};

export type MaintenanceReminderInput = {
  vehicleId: string;
  vehicleName: string;
  componentCode: string;
  componentName: string;
  status: 'due_soon' | 'overdue';
};

export type MaintenanceTimeReminderInput = {
  vehicleId: string;
  vehicleName: string;
  componentCode: string;
  componentName: string;
  baselineAt: number;
  intervalDays: number;
};

const KIND_LABELS: Record<string, string> = {
  registration: 'Registration expiry',
  license: "Driver's licence expiry",
  insurance: 'Insurance expiry',
  inspection: 'Inspection expiry',
  custom: 'Reminder',
};

const MS_PER_DAY = 86_400_000;

// One plan per live deadline whose next offset notice has arrived (or that is overdue).
export function planDeadlineReminders(
  deadlines: readonly DeadlineReminderInput[],
  nowMs: number,
): ReminderPlan[] {
  const plans: ReminderPlan[] = [];
  for (const d of deadlines) {
    if (!d.enabled || d.deletedAt != null) continue;
    const daysUntil = daysUntilDateOnly(d.dueDate, nowMs);
    const phase = deadlinePhase(daysUntil, Math.max(0, ...d.offsetsDays, 0));
    if (phase === 'none' || phase === 'upcoming') continue;

    const offset = nextOffsetDays(daysUntil, d.offsetsDays);
    // Overdue or no applicable offset still gets a plan: the deadline itself is the trigger.
    const fireAtBase = offset != null ? dueMinusOffset(d.dueDate, offset) : nowMs;
    // Never schedule in the past: a notice whose day already arrived fires immediately, while a
    // future notice keeps its exact future time.
    const fireAt = Math.max(fireAtBase, nowMs);
    // Key includes the offset's fire date: each notice stage is its own reminder instance, and
    // the scheduler cancels stale keys when the due date changes.
    const fireDate = formatDateOnly(fireAtBase);
    const kindLabel = KIND_LABELS[d.kind] ?? 'Reminder';
    const subject = d.label ? `${kindLabel}   ${d.label}` : kindLabel;
    const scope = d.vehicleName ? ` for ${d.vehicleName}` : '';

    plans.push({
      key: reminderKey('deadline', d.id, fireDate),
      kind: 'deadline',
      subjectId: d.id,
      vehicleId: d.vehicleId,
      title: phase === 'overdue' ? `${subject} has passed` : subject,
      body:
        phase === 'overdue'
          ? `${d.dueDate} has passed${scope}. Update the date or renew to clear this reminder.`
          : `Expires ${d.dueDate}${scope}.`,
      fireAt,
      urgency: phase === 'overdue' ? 'overdue' : 'due_soon',
    });
  }
  return plans;
}

function dueMinusOffset(dueDate: string, offset: number): number {
  // dueDate local midnight minus offset days, computed from the stored string directly so the
  // planner never depends on the ambient clock.
  const [y, m, d] = dueDate.split('-').map(Number);
  const dueMs = new Date(y, m - 1, d).getTime();
  return dueMs - offset * MS_PER_DAY;
}

// One plan per tracked vehicle at the highest reached idle threshold (warn beats watch).
export function planBatteryReminders(
  batteries: readonly BatteryReminderInput[],
  nowMs: number,
): ReminderPlan[] {
  const plans: ReminderPlan[] = [];
  for (const b of batteries) {
    if (!Number.isFinite(b.lastActiveAt)) continue;
    const idleDays = Math.max(0, Math.floor((nowMs - b.lastActiveAt) / MS_PER_DAY));
    const level = batteryIdleLevel(idleDays);
    if (level === 'ok') continue;
    const thresholdDays = level === 'warn' ? IDLE_WARN_DAYS : IDLE_WATCH_DAYS;
    const fireAt = Math.min(b.lastActiveAt + thresholdDays * MS_PER_DAY, nowMs);
    plans.push({
      key: reminderKey('battery_idle', b.vehicleId, level),
      kind: 'battery_idle',
      subjectId: b.vehicleId,
      vehicleId: b.vehicleId,
      title: level === 'warn' ? 'Battery idle over a week' : 'Battery idle   worth a check',
      body:
        `No battery use recorded for ${b.vehicleName} in ${idleDays} days. ` +
        'If it has been used, record it to clear this. Vehitra cannot measure battery health.',
      fireAt,
      urgency: level === 'warn' ? 'due_soon' : 'info',
    });
  }
  return plans;
}

// One plan per component the evaluator marked due_soon or overdue. Stable key per
// (vehicle, component) so refreshing status updates the same reminder instead of stacking.
export function planMaintenanceReminders(
  items: readonly MaintenanceReminderInput[],
  nowMs: number,
): ReminderPlan[] {
  return items.map((m) => ({
    key: reminderKey('maintenance', `${m.vehicleId}:${m.componentCode}`, 'current'),
    kind: 'maintenance' as const,
    subjectId: `${m.vehicleId}:${m.componentCode}`,
    vehicleId: m.vehicleId,
    title:
      m.status === 'overdue'
        ? `${m.componentName} maintenance is overdue`
        : `${m.componentName} maintenance is coming up`,
    body: `${m.componentName} on ${m.vehicleName} is marked ${m.status === 'overdue' ? 'overdue' : 'due soon'} in Parts.`,
    fireAt: nowMs,
    urgency: m.status === 'overdue' ? ('overdue' as const) : ('due_soon' as const),
  }));
}

// A user-configured time interval is evaluated separately from distance maintenance. It only
// produces notices when a valid replacement/baseline date exists; catalog and estimate intervals
// are not treated as time rules. The warning window is 25% of the configured interval (at least
// one calendar day), matching the default maintenance warning proportion.
export function planMaintenanceTimeReminders(
  items: readonly MaintenanceTimeReminderInput[],
  nowMs: number,
): ReminderPlan[] {
  const plans: ReminderPlan[] = [];
  for (const item of items) {
    if (!Number.isFinite(item.baselineAt) || !Number.isInteger(item.intervalDays) || item.intervalDays <= 0) continue;
    const due = new Date(item.baselineAt);
    due.setHours(0, 0, 0, 0);
    due.setDate(due.getDate() + item.intervalDays);
    const dueAt = due.getTime();
    const dueDate = formatDateOnly(dueAt);
    const daysUntil = daysUntilDateOnly(dueDate, nowMs);
    if (daysUntil == null) continue;
    const warningDays = Math.max(1, Math.ceil(item.intervalDays * 0.25));
    if (daysUntil > warningDays) continue;

    const warningAt = new Date(dueAt);
    warningAt.setDate(warningAt.getDate() - warningDays);
    const overdue = daysUntil <= 0;
    plans.push({
      key: reminderKey('maintenance_time', `${item.vehicleId}:${item.componentCode}`, dueDate),
      kind: 'maintenance_time',
      subjectId: `${item.vehicleId}:${item.componentCode}`,
      vehicleId: item.vehicleId,
      title: overdue ? `${item.componentName} time service is overdue` : `${item.componentName} time service is coming up`,
      body: `${item.componentName} on ${item.vehicleName} is based on your ${item.intervalDays}-day interval; due ${dueDate}.`,
      fireAt: Math.max(warningAt.getTime(), nowMs),
      urgency: overdue ? 'overdue' : 'due_soon',
    });
  }
  return plans;
}

// All plans, sorted by urgency then fire time then key (deterministic order).
export function planReminders(input: {
  deadlines: readonly DeadlineReminderInput[];
  batteries: readonly BatteryReminderInput[];
  maintenance: readonly MaintenanceReminderInput[];
  maintenanceTime?: readonly MaintenanceTimeReminderInput[];
  nowMs: number;
}): ReminderPlan[] {
  const urgencyRank: Record<ReminderUrgency, number> = { overdue: 0, due_soon: 1, info: 2 };
  return [
    ...planDeadlineReminders(input.deadlines, input.nowMs),
    ...planBatteryReminders(input.batteries, input.nowMs),
    ...planMaintenanceReminders(input.maintenance, input.nowMs),
    ...planMaintenanceTimeReminders(input.maintenanceTime ?? [], input.nowMs),
  ].sort(
    (a, b) =>
      urgencyRank[a.urgency] - urgencyRank[b.urgency] ||
      a.fireAt - b.fireAt ||
      a.key.localeCompare(b.key),
  );
}
