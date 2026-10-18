import { componentsForVehicleType } from '../../domain/maintenance/components';
import { establishUsageBaseline } from '../../domain/maintenance/baseline';
import { evaluateUsage } from '../../domain/maintenance/status';
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

// Read model for the Parts screen: for one vehicle, evaluate every component that applies to its
// vehicle type, using the local ledger for usage. Nothing is cached; this runs on demand.
//
// Usage for a component = Σ applied_km of non-voided ledger entries AFTER its baseline. The baseline
// is the later of the last effective service event and the last part install. With no baseline the
// component is 'unknown' (explicitly, never good/overdue) — see evaluateUsage.
//
// Interval precedence (domain rules.resolveMaintenanceRule): user override > usage > catalog >
// estimate. The catalog layer comes from the vehicle's resource pack (catalog_model_components,
// loaded only when the vehicle was chosen through the vehicle library); its review status and
// provenance travel to the UI so draft data is labelled as such. Vehicles without a catalog
// link simply skip that layer and behave exactly as before.

export type ComponentMaintenance = {
  componentCode: string;
  name: string;
  category: string;
  evaluation: MaintenanceEvaluation;
  // Provenance of the catalog rule row used for this component, when the vehicle has a pack.
  // null = no pack row (the evaluation's rule.source then says override/estimate/none).
  catalog: Pick<CatalogPackRow, 'reviewStatus' | 'provenance' | 'sourceNote' | 'intervalKm'> | null;
};

export type VehicleMaintenance = {
  vehicle: VehicleRow;
  items: ComponentMaintenance[];
};

// The later baseline by (at, id). part_installs have no client_created_at column, so their install
// time is the wall-clock `installed_at`; service events use `performed_at`. Both are compared against
// the ledger's client_created_at ordering.
async function resolveBaseline(db: Db, userVehicleId: string, componentCode: string): Promise<LedgerBaseline | null> {
  const [service, install] = await Promise.all([
    latestBaselineServiceEvent(db, userVehicleId, componentCode),
    latestInstall(db, userVehicleId, componentCode),
  ]);
  const best = establishUsageBaseline([
    service ? { at: service.performed_at, id: service.id } : null,
    install ? { at: install.installed_at, id: install.id } : null,
  ]);
  return best;
}

export async function evaluateVehicleMaintenance(db: Db, userVehicleId: string): Promise<VehicleMaintenance | null> {
  const vehicle = await getVehicle(db, userVehicleId);
  if (!vehicle) return null;

  const vehicleType = vehicle.vehicle_type as VehicleType;
  const definitions = componentsForVehicleType(vehicleType);
  const overrides = await listOverrides(db, userVehicleId);
  const overrideByCode = new Map(overrides.map((o) => [o.component_code, o]));

  // Resource pack for this vehicle's catalog model (empty when there is no link or no pack).
  const packRows = vehicle.catalog_model_slug ? await getModelPack(db, vehicle.catalog_model_slug) : [];
  const packByComponent = packByCode(packRows);

  const items: ComponentMaintenance[] = [];
  for (const def of definitions) {
    const override = overrideByCode.get(def.code);
    const pack = packByComponent.get(def.code) ?? null;
    const baseline = await resolveBaseline(db, userVehicleId, def.code);
    const usedKm = baseline ? await sumAppliedKmSince(db, userVehicleId, baseline) : null;

    const evaluation = evaluateUsage({
      componentCode: def.code,
      vehicleType,
      appliesToVehicleTypes: def.appliesToVehicleTypes,
      enabled: override ? override.enabled !== 0 : undefined,
      intervalCandidates: {
        overrideIntervalKm: override?.interval_km ?? null,
        catalogIntervalKm: pack?.intervalKm ?? null,
        warnRemainingPct: pack?.warnRemainingPct ?? null,
      },
      usedKm,
    });

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
    });
  }

  return { vehicle, items };
}
