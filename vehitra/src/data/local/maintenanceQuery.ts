import { componentsForVehicleType, getComponentDefinition, type ComponentDefinition } from '../../domain/maintenance/components';
import { establishUsageBaseline } from '../../domain/maintenance/baseline';
import { evaluateComponent, evaluateUsage } from '../../domain/maintenance/status';
import type { MaintenanceEvaluation, VehicleType } from '../../domain/maintenance/types';
import type { CatalogPackRow } from '../../domain/catalog/packs';
import { packByCode } from '../../domain/catalog/packs';
import { latestInstall } from './installStore';
import { getModelPack } from './catalogStore';
import { sumAppliedKmSince, type LedgerBaseline } from './mileageStore';
import { listOverrides } from './overrideStore';
import { latestBaselineServiceEvent } from './serviceStore';
import type { Db } from './types';
import { getVehicle, type VehicleRow } from './vehicleStore';
import { MaintenanceValidationError } from './maintenanceErrors';
import { listCustomParts } from './customPartStore';

// Read model for the Parts screen: for one vehicle, evaluate its maintenance components.
//
// When both current and baseline odometer readings are available, usage is their difference. If a
// baseline has no odometer reading, fall back to Σ applied_km of non-voided ledger entries after it.
// With no baseline the component is 'unknown' (explicitly, never good/overdue).
//
// Catalog-linked vehicles read standard components exclusively from their downloaded model pack
// (catalog_model_components at the vehicle's assigned catalog_version). Generic components that
// merely apply to the vehicle type are NOT added. Unlinked/manual vehicles use all components that
// apply to the vehicle type, exactly as before. User-created custom parts and per-vehicle overrides
// are always vehicle-scoped and never shared.
//
// Interval precedence (domain rules.resolveMaintenanceRule): user override > usage > catalog >
// estimate. The catalog layer comes from the vehicle's resource pack; its review status and
// provenance travel to the UI so draft data is labelled as such.

export type ComponentMaintenance = {
  componentCode: string;
  name: string;
  category: string;
  evaluation: MaintenanceEvaluation;
  // Provenance of the catalog rule row used for this component, when the vehicle has a pack.
  // null = no pack row (the evaluation's rule.source then says override/estimate/none).
  catalog: Pick<CatalogPackRow, 'reviewStatus' | 'provenance' | 'sourceNote' | 'intervalKm'> | null;
  allowedActions?: readonly string[];
};

export type VehicleMaintenance = {
  vehicle: VehicleRow;
  items: ComponentMaintenance[];
};

// The later baseline by (at, id). part_installs have no client_created_at column, so their install
// time is the wall-clock `installed_at`; service events use `performed_at`. Both are compared against
// the ledger's client_created_at ordering.
async function resolveBaseline(
  db: Db,
  userVehicleId: string,
  componentCode: string,
): Promise<(LedgerBaseline & { odometerKm: number | null }) | null> {
  const [service, install] = await Promise.all([
    latestBaselineServiceEvent(db, userVehicleId, componentCode),
    latestInstall(db, userVehicleId, componentCode),
  ]);
  const candidates = [
    service ? { at: service.performed_at, id: service.id, odometerKm: service.odo_at } : null,
    install ? { at: install.installed_at, id: install.id, odometerKm: install.install_odo } : null,
  ];
  const best = establishUsageBaseline(candidates);
  if (!best) return null;
  const selected = candidates.find((candidate) => candidate?.at === best.at && candidate.id === best.id);
  return { ...best, odometerKm: selected?.odometerKm ?? null };
}

export async function evaluateVehicleMaintenance(db: Db, userVehicleId: string): Promise<VehicleMaintenance | null> {
  const vehicle = await getVehicle(db, userVehicleId);
  if (!vehicle) return null;

  // A vehicle linked to a catalog model must have an assigned catalog version so it reads
  // the exact pack version it was linked to, never a silent fallback to the latest.
  if (vehicle.catalog_model_slug != null && vehicle.catalog_version == null) {
    throw new MaintenanceValidationError([
      'Vehicle is linked to a catalog model but has no assigned catalog version.',
    ]);
  }

  const vehicleType = vehicle.vehicle_type as VehicleType;
  const isCatalogLinked = vehicle.catalog_model_slug != null;

  // Resource pack for this vehicle's catalog model (empty when there is no link or no pack).
  // The vehicle's assigned catalog_version is honored so two vehicles of the same model can
  // legitimately read different pack versions.
  const packRows = vehicle.catalog_model_slug
    ? await getModelPack(db, vehicle.catalog_model_slug, vehicle.catalog_version)
    : [];
  const packByComponent = packByCode(packRows);

  // Standard components: catalog-linked vehicles read exclusively from their downloaded pack.
  // Unlinked/manual vehicles use all components that apply to the vehicle type.
  let standardDefinitions: ComponentDefinition[];
  if (isCatalogLinked) {
    standardDefinitions = packRows
      .map((row) => getComponentDefinition(row.componentCode))
      .filter((def): def is ComponentDefinition => def != null);
  } else {
    standardDefinitions = componentsForVehicleType(vehicleType);
  }

  const customParts = await listCustomParts(db, userVehicleId);
  const overrides = await listOverrides(db, userVehicleId);
  const overrideByCode = new Map(overrides.map((o) => [o.component_code, o]));

  const items: ComponentMaintenance[] = [];
  for (const def of standardDefinitions) {
    const override = overrideByCode.get(def.code);
    const pack = packByComponent.get(def.code) ?? null;
    const baseline = await resolveBaseline(db, userVehicleId, def.code);
    const usedKm = baseline ? await sumAppliedKmSince(db, userVehicleId, baseline) : null;

    const evaluationInput = {
      componentCode: def.code,
      vehicleType,
      appliesToVehicleTypes: def.appliesToVehicleTypes,
      enabled: override ? override.enabled !== 0 : undefined,
      intervalCandidates: {
        overrideIntervalKm: override?.interval_km ?? null,
        catalogIntervalKm: pack?.intervalKm ?? null,
        warnRemainingPct: pack?.warnRemainingPct ?? null,
      },
    };
    const evaluation = vehicle.odometer_km != null && baseline?.odometerKm != null
      ? evaluateComponent({
          ...evaluationInput,
          currentOdometerKm: vehicle.odometer_km,
          lastServiceOdometerKm: baseline.odometerKm,
        })
      : evaluateUsage({ ...evaluationInput, usedKm });

    items.push({
      componentCode: def.code,
      name: def.name,
      category: def.category,
      evaluation,
      catalog: pack
        ? {
            reviewStatus: pack.reviewStatus,
            provenance: pack.provenance,
            sourceNote: pack.sourceNote,
            intervalKm: pack.intervalKm,
          }
        : null,
      allowedActions: def.allowedActions,
    });
  }

  // User-created parts share the same maintenance evaluator, service ledger, install history,
  // overrides, and reminder refresh path as catalog components. They have no catalog estimate.
  for (const part of customParts) {
    const override = overrideByCode.get(part.component_code);
    const baseline = await resolveBaseline(db, userVehicleId, part.component_code);
    const usedKm = baseline ? await sumAppliedKmSince(db, userVehicleId, baseline) : null;
    const evaluationInput = {
      componentCode: part.component_code,
      vehicleType,
      appliesToVehicleTypes: [vehicleType],
      enabled: override ? override.enabled !== 0 : undefined,
      intervalCandidates: { overrideIntervalKm: override?.interval_km ?? null },
    };
    const evaluation = vehicle.odometer_km != null && baseline?.odometerKm != null
      ? evaluateComponent({ ...evaluationInput, currentOdometerKm: vehicle.odometer_km, lastServiceOdometerKm: baseline.odometerKm })
      : evaluateUsage({ ...evaluationInput, usedKm });
    items.push({
      componentCode: part.component_code,
      name: part.name,
      category: part.category,
      evaluation,
      catalog: null,
      allowedActions: ['inspect', 'replace'],
    });
  }

  return { vehicle, items };
}
