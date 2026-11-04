import { listAllDeadlines, upsertDeadline } from '../local/deadlineStore';
import type { Db } from '../local/types';
import {
  createVehicle,
  getVehicle,
  listVehicles,
  setVehicleCatalog,
  updateVehicle,
  type VehicleRow,
} from '../local/vehicleStore';
import {
  applyPulledDeletion,
  markPushedSynced,
  markPulledSynced,
} from './marks';
import {
  cloudDeadlineToLocal,
  cloudIsNewer,
  cloudVehicleToLocal,
  localDeadlineToCloud,
  localVehicleToCloud,
} from './mappers';
import { emptyReport, type SyncRemote, type SyncReport, type SyncResolutions } from './types';
import { findSyncConflicts } from './syncReview';

// The sync apply step (v1 scope: vehicles + deadlines; local-first, manual trigger).
//
// Order: PULL then PUSH after an explicit review of divergent shared IDs. The selected side
// wins per record; unrelated IDs are preserved as separate records.
//
// - Every remote call is guarded: network failures leave all local rows untouched and pending,
//   so the next run retries from the same place (no partial state to repair).
// - Rows we cannot honestly represent are reported in `skipped` with a reason, never dropped
//   silently and never guessed at.
// - Raw SELECTs are safe reads; every write goes through the stores or the sync marks module
//   (both queued on the shared serialize FIFO   no nested queue entry anywhere below).

export async function runSync(
  db: Db,
  remote: SyncRemote,
  opts: { now?: number; resolutions?: SyncResolutions } = {},
): Promise<SyncReport> {
  const now = opts.now ?? Date.now();
  const report = emptyReport(now);

  let userId: string | null = null;
  try {
    userId = await remote.getUserId();
  } catch (e) {
    report.ok = false;
    report.reason = 'remote_error';
    report.errors.push(e instanceof Error ? e.message : String(e));
    return report;
  }
  if (!userId) {
    report.ok = false;
    report.reason = 'signed_out';
    return report;
  }

  let models: Awaited<ReturnType<SyncRemote['listCatalogModels']>>;
  try {
    models = await remote.listCatalogModels();
  } catch (e) {
    report.ok = false;
    report.reason = 'remote_error';
    report.errors.push(e instanceof Error ? e.message : String(e));
    return report;
  }
  const modelById = new Map(models.map((m) => [m.id, m]));
  const modelBySlug = new Map(models.map((m) => [m.slug, m]));

  // ---------------------------------------------------------------- PULL vehicles
  let cloudVehicles: Awaited<ReturnType<SyncRemote['listUserVehicles']>> = [];
  try {
    cloudVehicles = await remote.listUserVehicles();
  } catch (e) {
    report.ok = false;
    report.reason = 'remote_error';
    report.errors.push(e instanceof Error ? e.message : String(e));
    return report;
  }

  // Fetch every user-owned table before writing anything. A direct caller that has not
  // reviewed divergent shared IDs is stopped here, before a pull can overwrite local values.
  let cloudDeadlines: Awaited<ReturnType<SyncRemote['listUserDeadlines']>> = [];
  try {
    cloudDeadlines = await remote.listUserDeadlines();
  } catch (e) {
    report.ok = false;
    report.reason = 'remote_error';
    report.errors.push(e instanceof Error ? e.message : String(e));
    return report;
  }

  const localVehicles = await listVehiclesIncludingDeleted(db);
  const localDeadlines = await listAllDeadlines(db);
  const protectedVehicleIds = new Set(
    cloudVehicles.filter((row) => !modelById.has(row.model_id)).map((row) => row.id),
  );
  const protectedDeadlineIds = new Set(
    cloudDeadlines.filter((row) => cloudDeadlineToLocal(row) === null).map((row) => row.id),
  );
  const conflicts = findSyncConflicts(localVehicles, cloudVehicles, models, localDeadlines, cloudDeadlines);
  report.conflicts = conflicts.filter((conflict) => {
    const choice = conflict.table === 'vehicles'
      ? opts.resolutions?.vehicles?.[conflict.id]
      : opts.resolutions?.deadlines?.[conflict.id];
    return choice !== 'local' && choice !== 'account';
  });
  if (report.conflicts.length > 0) {
    report.ok = false;
    report.reason = 'review_required';
    return report;
  }

  const localVehicleById = new Map(localVehicles.map((v) => [v.id, v]));

  for (const row of cloudVehicles) {
    const model = modelById.get(row.model_id) ?? null;
    const pull = cloudVehicleToLocal(row, model);
    if (!pull) {
      report.skipped.push({
        table: 'vehicles',
        id: row.id,
        reason: model ? 'server timestamp unreadable' : 'model not in local catalog',
      });
      continue;
    }
    const local = localVehicleById.get(row.id);
    const resolution = opts.resolutions?.vehicles?.[row.id];
    if (local && resolution === 'local') continue;

    if (!local) {
      if (pull.deletedAtMs != null) {
        // Never create tombstones for vehicles this device never had.
        report.skipped.push({ table: 'vehicles', id: row.id, reason: 'deleted in cloud' });
        continue;
      }
      await createVehicle(
        db,
        {
          id: row.id,
          vehicle_type: pull.vehicleType,
          brand: pull.brandName,
          model: pull.modelName,
          nickname: pull.nickname,
          model_year: pull.modelYear,
          plate: pull.plate,
          odometer_km: null,
          catalog_model_slug: pull.catalogSlug,
          catalog_version: pull.catalogVersion,
        },
        now,
      );
      await markPulledSynced(db, 'vehicles', row.id, row.updated_at, pull.serverUpdatedAtMs, now);
      report.vehicles.pulled++;
      continue;
    }

    if (resolution !== 'account' && !cloudIsNewer(row.updated_at, local.client_updated_at)) continue;

    let changed = false;

    if (pull.deletedAtMs != null) {
      if (local.deleted_at == null) {
        await applyPulledDeletion(db, 'vehicles', row.id, pull.deletedAtMs, row.updated_at, pull.serverUpdatedAtMs, now);
        changed = true;
      }
    } else {
      if (local.deleted_at != null) {
        // Server restored the row: adopt the restore as server truth.
        await applyPulledDeletion(db, 'vehicles', row.id, null, row.updated_at, pull.serverUpdatedAtMs, now);
        changed = true;
      }
      const profileDiffers =
        local.nickname !== pull.nickname ||
        local.plate !== pull.plate ||
        local.model_year !== pull.modelYear;
      const catalogDiffers =
        local.catalog_model_slug !== pull.catalogSlug ||
        (local.catalog_version ?? null) !== pull.catalogVersion;

      if (profileDiffers) {
        await updateVehicle(db, row.id, {
          vehicle_type: local.vehicle_type,
          brand: local.brand,
          model: local.model,
          nickname: pull.nickname,
          model_year: pull.modelYear,
          plate: pull.plate,
          odometer_km: local.odometer_km,
        });
        changed = true;
      }
      if (catalogDiffers) {
        await setVehicleCatalog(db, row.id, pull.catalogSlug, pull.catalogVersion, now);
        changed = true;
      }
    }

    if (changed) {
      await markPulledSynced(db, 'vehicles', row.id, row.updated_at, pull.serverUpdatedAtMs, now);
      report.vehicles.pulled++;
    } else if (local.sync_status !== 'synced') {
      // Identical values with a lingering pending flag: converge instead of pushing a no-op.
      await markPulledSynced(db, 'vehicles', row.id, row.updated_at, pull.serverUpdatedAtMs, now);
    }
  }

  // ---------------------------------------------------------------- PULL deadlines
  const localDeadlineById = new Map(localDeadlines.map((d) => [d.id, d]));

  for (const row of cloudDeadlines) {
    const pull = cloudDeadlineToLocal(row);
    if (!pull) {
      report.skipped.push({ table: 'deadlines', id: row.id, reason: 'cloud values not storable locally' });
      continue;
    }
    const local = localDeadlineById.get(row.id);
    const resolution = opts.resolutions?.deadlines?.[row.id];
    if (local && resolution === 'local') continue;

    if (!local) {
      if (pull.deletedAtMs != null) {
        report.skipped.push({ table: 'deadlines', id: row.id, reason: 'deleted in cloud' });
        continue;
      }
      if (pull.userVehicleId && !(await getVehicle(db, pull.userVehicleId))) {
        report.skipped.push({ table: 'deadlines', id: row.id, reason: 'vehicle missing locally' });
        continue;
      }
      await upsertDeadline(
        db,
        {
          id: row.id,
          kind: pull.kind,
          user_vehicle_id: pull.userVehicleId,
          label: pull.label,
          due_date: pull.dueDate,
          reminder_offsets: pull.offsets,
          enabled: true,
        },
        now,
      );
      await markPulledSynced(db, 'deadlines', row.id, row.updated_at, pull.serverUpdatedAtMs, now);
      report.deadlines.pulled++;
      continue;
    }

    if (resolution !== 'account' && !cloudIsNewer(row.updated_at, local.client_updated_at)) continue;

    if (pull.deletedAtMs != null) {
      if (local.deleted_at == null) {
        await applyPulledDeletion(db, 'deadlines', row.id, pull.deletedAtMs, row.updated_at, pull.serverUpdatedAtMs, now);
        report.deadlines.pulled++;
      }
      continue;
    }

    let changed = false;
    if (local.deleted_at != null) {
      // Server restored a reminder we had deleted locally: adopt the restore, then fall
      // through to apply the live fields too.
      await applyPulledDeletion(db, 'deadlines', row.id, null, row.updated_at, pull.serverUpdatedAtMs, now);
      changed = true;
    }

    const offsetsLocal = JSON.stringify(readOffsets(local.reminder_offsets));
    const offsetsCloud = JSON.stringify(pull.offsets);
    const differs =
      local.kind !== pull.kind ||
      (local.label ?? null) !== pull.label ||
      local.due_date !== pull.dueDate ||
      offsetsLocal !== offsetsCloud ||
      (local.user_vehicle_id ?? null) !== pull.userVehicleId;

    if (differs) {
      if (pull.userVehicleId && !(await getVehicle(db, pull.userVehicleId))) {
        report.skipped.push({ table: 'deadlines', id: row.id, reason: 'vehicle missing locally' });
        continue;
      }
      await upsertDeadline(
        db,
        {
          id: row.id,
          kind: pull.kind,
          user_vehicle_id: pull.userVehicleId,
          label: pull.label,
          due_date: pull.dueDate,
          reminder_offsets: pull.offsets,
          enabled: local.enabled === 1, // device keeps its own toggle
        },
        now,
      );
      changed = true;
    }

    if (changed) {
      await markPulledSynced(db, 'deadlines', row.id, row.updated_at, pull.serverUpdatedAtMs, now);
      report.deadlines.pulled++;
    } else if (local.sync_status !== 'synced') {
      await markPulledSynced(db, 'deadlines', row.id, row.updated_at, pull.serverUpdatedAtMs, now);
    }
  }

  // ---------------------------------------------------------------- PUSH vehicles
  const pendingVehicles = (await db.getAllAsync<VehicleRow>('SELECT * FROM vehicles'))
    .filter((vehicle) => vehicle.sync_status === 'pending' || opts.resolutions?.vehicles?.[vehicle.id] === 'local');
  const vehicleInserts = [];
  const vehiclePushIds: string[] = [];
  for (const v of pendingVehicles) {
    if (protectedVehicleIds.has(v.id)) {
      report.skipped.push({ table: 'vehicles', id: v.id, reason: 'account record uses a catalog model unavailable on this device' });
      continue;
    }
    if (!v.catalog_model_slug) {
      report.skipped.push({ table: 'vehicles', id: v.id, reason: 'no catalog link' });
      continue;
    }
    const model = modelBySlug.get(v.catalog_model_slug);
    if (!model) {
      report.skipped.push({ table: 'vehicles', id: v.id, reason: 'model not in cloud catalog' });
      continue;
    }
    vehicleInserts.push(localVehicleToCloud(v, model.id));
    vehiclePushIds.push(v.id);
  }
  if (vehicleInserts.length > 0) {
    try {
      const error = await remote.upsertUserVehicles(vehicleInserts);
      if (error) {
        report.ok = false;
        report.reason = 'remote_error';
        report.errors.push(`vehicles: ${error}`);
      } else {
        await markPushedSynced(db, 'vehicles', vehiclePushIds, now);
        report.vehicles.pushed = vehiclePushIds.length;
      }
    } catch (e) {
      report.ok = false;
      report.reason = 'remote_error';
      report.errors.push(`vehicles: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---------------------------------------------------------------- PUSH deadlines
  // A vehicle-bound deadline is only valid cloud-side when its vehicle exists there: the
  // cloud FK is (user_vehicle_id, user_id) -> user_vehicles.
  const cloudVehicleIds = new Set(cloudVehicles.map((v) => v.id));
  for (const id of vehiclePushIds) cloudVehicleIds.add(id);

  const allAfterPull = await listAllDeadlines(db);
  const pendingDeadlines = allAfterPull.filter(
    (deadline) => deadline.sync_status === 'pending' || opts.resolutions?.deadlines?.[deadline.id] === 'local',
  );
  const deadlineInserts = [];
  const deadlinePushIds: string[] = [];
  for (const d of pendingDeadlines) {
    if (protectedDeadlineIds.has(d.id)) {
      report.skipped.push({ table: 'deadlines', id: d.id, reason: 'account reminder values cannot be represented locally' });
      continue;
    }
    if (d.user_vehicle_id && !cloudVehicleIds.has(d.user_vehicle_id)) {
      report.skipped.push({ table: 'deadlines', id: d.id, reason: 'vehicle not in cloud' });
      continue;
    }
    deadlineInserts.push(localDeadlineToCloud(d));
    deadlinePushIds.push(d.id);
  }
  if (deadlineInserts.length > 0) {
    try {
      const error = await remote.upsertUserDeadlines(deadlineInserts);
      if (error) {
        report.ok = false;
        report.reason = 'remote_error';
        report.errors.push(`deadlines: ${error}`);
      } else {
        await markPushedSynced(db, 'deadlines', deadlinePushIds, now);
        report.deadlines.pushed = deadlinePushIds.length;
      }
    } catch (e) {
      report.ok = false;
      report.reason = 'remote_error';
      report.errors.push(`deadlines: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return report;
}

async function listVehiclesIncludingDeleted(db: Db): Promise<VehicleRow[]> {
  return db.getAllAsync<VehicleRow>('SELECT * FROM vehicles');
}

function readOffsets(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n) => Number.isFinite(n)) : [];
  } catch {
    return [];
  }
}

