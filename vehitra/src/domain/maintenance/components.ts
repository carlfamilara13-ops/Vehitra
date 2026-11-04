// Local component catalogue   a CODE MIRROR of supabase/seed.sql `component_definitions`.
//
// Why here and not in the database: the cloud catalogue (component_definitions / model_components)
// is not downloaded yet, and the maintenance records are stored locally against a component CODE so
// offline work needs no cloud round-trip. Interval thresholds still live in the domain rules layer
// (rules.ts) and any user override; this file only says which parts exist and on which vehicle types.
//
// IMPORTANT: keep in sync with supabase/seed.sql. The real catalogue, per-model intervals and the
// code/uuid mapping belong to a later catalog+sync step; do not invent intervals here.
// See docs/ARCHITECTURE_NOTES.md (§2 catalog vs user data, §3 catalog versioning).

import type { VehicleType } from './types';

export type ComponentDefinition = {
  code: string; // component_definitions.code, e.g. 'engine_oil'
  name: string; // component_definitions.name
  category: string; // component_definitions.category
  allowedActions: readonly string[]; // component_definitions.allowed_actions
  appliesToVehicleTypes: readonly VehicleType[]; // component_definitions.applies_to_types
};

// Exactly the 15 seeded definitions, with allowed_actions and applies_to_types copied verbatim from
// supabase/seed.sql. A service action recorded for a component must be one of its allowed_actions,
// except the generic actions below.
export const LOCAL_COMPONENT_DEFINITIONS: readonly ComponentDefinition[] = [
  { code: 'engine_oil', name: 'Engine Oil', category: 'engine', allowedActions: ['replace'], appliesToVehicleTypes: ['motorcycle', 'car', 'truck', 'bus', 'van', 'other'] },
  { code: 'oil_filter', name: 'Oil Filter', category: 'engine', allowedActions: ['replace'], appliesToVehicleTypes: ['car', 'truck', 'bus', 'van', 'other'] },
  { code: 'air_filter', name: 'Air Filter', category: 'engine', allowedActions: ['clean', 'replace'], appliesToVehicleTypes: ['motorcycle', 'car', 'truck', 'bus', 'van', 'other'] },
  { code: 'spark_plug', name: 'Spark Plug', category: 'engine', allowedActions: ['inspect', 'replace'], appliesToVehicleTypes: ['motorcycle', 'car', 'other'] },
  { code: 'coolant', name: 'Coolant', category: 'fluids', allowedActions: ['inspect', 'replace'], appliesToVehicleTypes: ['motorcycle', 'car', 'truck', 'bus', 'van', 'other'] },
  { code: 'front_brake_pads', name: 'Front Brake Pads', category: 'brakes', allowedActions: ['inspect', 'replace'], appliesToVehicleTypes: ['motorcycle', 'car', 'bicycle', 'truck', 'bus', 'van', 'other'] },
  { code: 'rear_brake_pads', name: 'Rear Brake Pads', category: 'brakes', allowedActions: ['inspect', 'replace'], appliesToVehicleTypes: ['motorcycle', 'car', 'bicycle', 'truck', 'bus', 'van', 'other'] },
  { code: 'brake_fluid', name: 'Brake Fluid', category: 'fluids', allowedActions: ['replace'], appliesToVehicleTypes: ['motorcycle', 'car', 'truck', 'bus', 'van', 'other'] },
  { code: 'front_tire', name: 'Front Tire', category: 'wheels_tires', allowedActions: ['inspect', 'replace'], appliesToVehicleTypes: ['motorcycle', 'car', 'bicycle', 'truck', 'bus', 'van', 'other'] },
  { code: 'rear_tire', name: 'Rear Tire', category: 'wheels_tires', allowedActions: ['inspect', 'replace'], appliesToVehicleTypes: ['motorcycle', 'car', 'bicycle', 'truck', 'bus', 'van', 'other'] },
  { code: 'battery', name: 'Battery', category: 'electrical', allowedActions: ['inspect', 'replace'], appliesToVehicleTypes: ['motorcycle', 'car', 'truck', 'bus', 'van', 'other'] },
  { code: 'drive_chain', name: 'Drive Chain', category: 'transmission', allowedActions: ['clean', 'lubricate', 'replace'], appliesToVehicleTypes: ['motorcycle', 'bicycle', 'other'] },
  { code: 'gear_oil', name: 'Gear Oil', category: 'fluids', allowedActions: ['replace'], appliesToVehicleTypes: ['motorcycle', 'other'] },
  { code: 'cvt_belt', name: 'CVT Belt', category: 'transmission', allowedActions: ['inspect', 'replace'], appliesToVehicleTypes: ['motorcycle'] },
  { code: 'transmission_fluid', name: 'Transmission Fluid', category: 'fluids', allowedActions: ['replace'], appliesToVehicleTypes: ['car', 'truck', 'bus', 'van', 'other'] },
];

// Generic actions that apply to every component regardless of its catalogue allowed_actions:
// 'service' is an undifferentiated log entry, 'baseline' establishes an explicit usage baseline and
// 'void' cancels an earlier event. They are validated by the service store, not by the catalogue.
export const GENERIC_COMPONENT_ACTIONS = ['service', 'baseline', 'void'] as const;

// May `action` be recorded against `componentCode`? Unknown component or unknown action -> false.
export function isActionAllowedForComponent(action: string, componentCode: string): boolean {
  const def = getComponentDefinition(componentCode);
  if (!def) return false;
  if ((GENERIC_COMPONENT_ACTIONS as readonly string[]).includes(action)) return true;
  return def.allowedActions.includes(action);
}

const BY_CODE: Readonly<Record<string, ComponentDefinition>> = Object.fromEntries(
  LOCAL_COMPONENT_DEFINITIONS.map((d) => [d.code, d]),
);

export function getComponentDefinition(code: string): ComponentDefinition | null {
  return BY_CODE[code] ?? null;
}

// Components that apply to a vehicle type, in catalogue (seed) order.
export function componentsForVehicleType(vehicleType: VehicleType): ComponentDefinition[] {
  return LOCAL_COMPONENT_DEFINITIONS.filter((d) =>
    (d.appliesToVehicleTypes as readonly string[]).includes(vehicleType),
  );
}
