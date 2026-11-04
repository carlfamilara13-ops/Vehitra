import { planReminders, type MaintenanceReminderInput, type MaintenanceTimeReminderInput } from '../../domain/reminders/plan';
import { getComponentDefinition } from '../../domain/maintenance/components';
import { latestInstall } from '../../data/local/installStore';
import { latestBaselineServiceEvent } from '../../data/local/serviceStore';
import { listOverrides } from '../../data/local/overrideStore';
import { getModelPack } from '../../data/local/catalogStore';
import { packByCode } from '../../domain/catalog/packs';
import {
  listBatteryStates,
} from '../../data/local/batteryStore';
import { listDeadlines, parseDeadlineOffsets } from '../../data/local/deadlineStore';
import { evaluateVehicleMaintenance } from '../../data/local/maintenanceQuery';
import {
  cancelReminder,
  listReminderSchedule,
  upsertReminder,
  type ReminderScheduleRow,
} from '../../data/local/reminderStore';
import { getAppSettings } from '../../data/local/settingsStore';
import { listVehicles, vehicleDisplayName } from '../../data/local/vehicleStore';
import type { Db } from '../../data/local/types';
import type { NotificationsAdapter } from './notifications';

// The apply layer between the pure planner (domain/reminders/plan) and the platform adapter:
//
//   stores -> planReminders(nowMs) -> diff against the reminder_schedule ledger -> platform
//
// Diffing by the planner's deterministic key means re-running is idempotent: unchanged plans
// keep their platform id, changed plans cancel + re-schedule, stale plans are cancelled. The
// notifications_enabled switch gates the whole step   off means nothing is scheduled, not
// "silently scheduled and not shown".

export type SyncResult = {
  // Adapter could load the native module in this build.
  available: boolean;
  // The notifications_enabled switch was on (plans were computed at all).
  enabled: boolean;
  permissionDenied: boolean;
  // How many live plans the planner produced.
  plans: number;
  scheduled: number; // platform notifications (re)scheduled
  cancelled: number; // ledger entries cancelled (stale plans / switch off / no permission)
  unchanged: number; // ledger already matched the plan
};

type GatheredInputs = Parameters<typeof planReminders>[0];

// Reads every store the planner consumes. Maintenance is evaluated per vehicle (the same read
// model the Parts screen uses) so reminders cover the whole garage, not just the active vehicle.
export async function gatherReminderInputs(db: Db): Promise<Omit<GatheredInputs, 'nowMs'>> {
  const vehicles = await listVehicles(db);
  const names = new Map(vehicles.map((v) => [v.id, vehicleDisplayName(v)]));

  const deadlines = (await listDeadlines(db))
    .filter((d) => d.deleted_at == null)
    .map((d) => ({
      id: d.id,
      kind: d.kind,
      label: d.label,
      dueDate: d.due_date,
      vehicleId: d.user_vehicle_id,
      vehicleName: d.user_vehicle_id ? (names.get(d.user_vehicle_id) ?? null) : null,
      offsetsDays: parseDeadlineOffsets(d.reminder_offsets),
      enabled: d.enabled === 1,
      deletedAt: d.deleted_at,
    }));

  const batteries = (await listBatteryStates(db))
    .filter((b) => names.has(b.user_vehicle_id))
    .map((b) => ({
      vehicleId: b.user_vehicle_id,
      vehicleName: names.get(b.user_vehicle_id) ?? 'Vehicle',
      lastActiveAt: b.last_active_at,
    }));

  const maintenance: MaintenanceReminderInput[] = [];
  const maintenanceTime: MaintenanceTimeReminderInput[] = [];
  for (const v of vehicles) {
    const result = await evaluateVehicleMaintenance(db, v.id);
    if (!result) continue;
    const vehicleName = vehicleDisplayName(v);
    const [overrides, packRows] = await Promise.all([
      listOverrides(db, v.id),
      v.catalog_model_slug ? getModelPack(db, v.catalog_model_slug) : Promise.resolve([]),
    ]);
    const packByComponent = packByCode(packRows);
    for (const override of overrides) {
      if (override.enabled !== 1) continue;
      const intervalDays = override.interval_days ?? packByComponent.get(override.component_code)?.intervalDays ?? null;
      if (intervalDays == null || intervalDays <= 0) continue;
      const [service, install] = await Promise.all([
        latestBaselineServiceEvent(db, v.id, override.component_code),
        latestInstall(db, v.id, override.component_code),
      ]);
      const baselineAt = Math.max(service?.performed_at ?? -Infinity, install?.installed_at ?? -Infinity);
      const component = getComponentDefinition(override.component_code)
        ?? result.items.find((item) => item.componentCode === override.component_code);
      if (Number.isFinite(baselineAt) && component) {
        maintenanceTime.push({
          vehicleId: v.id,
          vehicleName,
          componentCode: override.component_code,
          componentName: component.name,
          baselineAt,
          intervalDays,
        });
      }
    }
    for (const item of result.items) {
      const status = item.evaluation.status;
      if (status === 'due_soon' || status === 'overdue') {
        maintenance.push({
          vehicleId: v.id,
          vehicleName,
          componentCode: item.componentCode,
          componentName: item.name,
          status,
        });
      }
    }
  }

  return { deadlines, batteries, maintenance, maintenanceTime };
}

function cancelLedgerEntry(
  db: Db,
  row: ReminderScheduleRow,
  adapter: NotificationsAdapter,
): Promise<void> {
  const platform =
    row.notification_id != null ? adapter.cancel(row.notification_id) : Promise.resolve();
  return platform.then(() => cancelReminder(db, row.reminder_key));
}

// Computes fresh plans and reconciles ledger + platform against them.
export async function syncReminders(
  db: Db,
  adapter: NotificationsAdapter,
  nowMs = Date.now(),
  requestPermission = true,
): Promise<SyncResult> {
  const settings = await getAppSettings(db);
  const enabled = settings.notifications_enabled === 1;

  const result: SyncResult = {
    available: adapter.available,
    enabled,
    permissionDenied: false,
    plans: 0,
    scheduled: 0,
    cancelled: 0,
    unchanged: 0,
  };

  const ledger = await listReminderSchedule(db);

  if (!enabled) {
    // Switch off: tear down anything scheduled; ledger rows stay auditable as cancelled.
    for (const row of ledger) {
      if (row.status === 'scheduled') {
        await cancelLedgerEntry(db, row, adapter);
        result.cancelled++;
      }
    }
    return result;
  }

  const inputs = await gatherReminderInputs(db);
  const plans = planReminders({ ...inputs, nowMs }).filter((plan) => {
    if (plan.kind === 'deadline') return settings.document_reminders_enabled === 1;
    if (plan.kind === 'battery_idle') return settings.battery_reminders_enabled === 1;
    if (plan.kind === 'maintenance' || plan.kind === 'maintenance_time') {
      return plan.urgency === 'overdue'
        ? settings.maintenance_overdue_enabled === 1
        : settings.maintenance_upcoming_enabled === 1;
    }
    return false;
  });
  result.plans = plans.length;

  const hasPermission = await adapter.ensurePermissions(requestPermission);
  if (!adapter.available || !hasPermission) {
    result.permissionDenied = adapter.available && !hasPermission;
    for (const row of ledger) {
      if (row.status === 'scheduled') {
        await cancelLedgerEntry(db, row, adapter);
        result.cancelled++;
      }
    }
    return result;
  }

  const byKey = new Map(ledger.map((row) => [row.reminder_key, row]));
  const planKeys = new Set(plans.map((p) => p.key));

  // Stale ledger entries (no matching plan) get torn down first so a changed due date never
  // leaves the old notice behind.
  for (const row of ledger) {
    if (row.status === 'scheduled' && !planKeys.has(row.reminder_key)) {
      await cancelLedgerEntry(db, row, adapter);
      result.cancelled++;
      byKey.delete(row.reminder_key);
    }
  }

  for (const plan of plans) {
    const existing = byKey.get(plan.key);
    const matches =
      existing != null &&
      existing.status === 'scheduled' &&
      (existing.fire_at === plan.fireAt || (existing.fire_at <= nowMs && plan.fireAt <= nowMs)) &&
      existing.notification_id != null;

    if (matches) {
      result.unchanged++;
      continue;
    }

    // Fire time changed (or a previous attempt had no platform id): replace, never stack.
    if (existing?.notification_id != null && existing.status === 'scheduled') {
      await adapter.cancel(existing.notification_id);
    }
    const platformId = await adapter.schedule({
      title: plan.title,
      body: plan.body,
      fireAt: plan.fireAt,
      immediate: plan.fireAt <= nowMs,
    });
    await upsertReminder(db, {
      key: plan.key,
      kind: plan.kind,
      userVehicleId: plan.vehicleId,
      fireAt: plan.fireAt,
      notificationId: platformId,
      status: 'scheduled',
    });
    result.scheduled++;
  }

  return result;
}



