// Pure types for the maintenance domain (Stage 4A: calculation only, no storage, no UI).
// No React/Expo/SQLite/Supabase imports in src/domain.
// Units are explicit in every field name: distances are kilometres (*Km), percentages are 0..100
// unless the name says otherwise. Nothing here is rounded; formatting belongs to the UI.

// Mirrors vehicleStore.VEHICLE_TYPES and the catalog `vehicle_types` codes (supabase migrations).
// Kept as its own list so domain/ never imports from data/local; keep the three in sync.
export const MAINTENANCE_VEHICLE_TYPES = ['motorcycle', 'car', 'bicycle', 'truck', 'bus', 'van', 'other'] as const;
export type VehicleType = (typeof MAINTENANCE_VEHICLE_TYPES)[number];

// Which layer supplied the interval being used (see rules.ts for the precedence order).
export type IntervalSource = 'override' | 'usage' | 'catalog' | 'estimate' | 'none';

// The interval rule in force for one component on one vehicle. Raw values: an invalid value that
// was actually configured is kept here (and reported as reason 'invalid_rule'), never silently fixed.
export type MaintenanceRule = {
  intervalKm: number | null; // null = no layer supplied an interval
  warnRemainingPct: number; // remaining % at or below which the part becomes due soon
  source: IntervalSource;
};

// Candidate interval values before precedence is applied. Absent (null/undefined) layers are skipped.
export type IntervalCandidates = {
  overrideIntervalKm?: number | null; // component_overrides.interval_km (explicit user choice)
  usageIntervalKm?: number | null; // caller-computed interval for the vehicle's usage profile
  catalogIntervalKm?: number | null; // model_components.interval_km at the vehicle's catalog version
  estimateIntervalKm?: number | null; // local unverified estimate (see rules.ts)
  warnRemainingPct?: number | null; // model_components.warn_remaining_pct
};

// good / due soon / overdue are computed from real usage; 'unknown' means the inputs cannot say
// (reason explains which input is missing or invalid)   unknown is never silently mapped to good
// or overdue; 'not_applicable' means the part does not exist for this vehicle (reason explains why).
export type MaintenanceStatus = 'good' | 'due_soon' | 'overdue' | 'unknown' | 'not_applicable';

export type MaintenanceReason =
  | 'not_applicable_to_vehicle_type'
  | 'disabled_by_override'
  | 'no_interval'
  | 'invalid_rule'
  | 'no_service_history'
  | 'missing_odometer'
  | 'invalid_odometer'
  | 'inconsistent_odometer'
  | 'invalid_usage'; // ledger-derived usedKm was negative or not a finite number

// Distance progress for one component. Only ever built from valid inputs: usedKm >= 0 and
// intervalKm > 0, so there is no negative or non-finite progress. remainingKm is negative only
// when the part is genuinely overdue (by that many kilometres); usedPercent can exceed 100 then,
// which is truthful   clamp it when drawing a bar, and use `status` as the authoritative label.
export type DistanceProgress = {
  usedKm: number;
  intervalKm: number;
  remainingKm: number;
  usedPercent: number; // usedKm / intervalKm * 100
  remainingPercent: number; // remainingKm / intervalKm * 100 (<= 0 when overdue)
};

export type ComponentMaintenanceInput = {
  componentCode: string; // component_definitions.code, e.g. 'engine_oil', 'drive_chain', 'front_tire'
  vehicleType: VehicleType;
  appliesToVehicleTypes: readonly VehicleType[]; // component_definitions.applies_to_types
  enabled?: boolean | null; // component_overrides.enabled; absent means enabled
  intervalCandidates?: IntervalCandidates | null;
  currentOdometerKm?: number | null; // current odometer reading
  lastServiceOdometerKm?: number | null; // odometer at the last service/install; null = none recorded
};

// Ledger-based alternative to ComponentMaintenanceInput. `usedKm` is the sum of applied_km recorded
// since the component's baseline (last service / install); it is never an odometer difference, so a
// replaced, corrected or reset odometer cannot corrupt maintenance. `usedKm` absent (null/undefined)
// means no baseline is known yet -> 'unknown' / 'no_service_history', never good or overdue.
export type ComponentUsageInput = {
  componentCode: string;
  vehicleType: VehicleType;
  appliesToVehicleTypes: readonly VehicleType[];
  enabled?: boolean | null;
  intervalCandidates?: IntervalCandidates | null;
  usedKm?: number | null; // sum of applied_km since the baseline; null/undefined = unknown history
};

export type MaintenanceEvaluation = {
  componentCode: string;
  vehicleType: VehicleType;
  status: MaintenanceStatus;
  reason: MaintenanceReason | null; // null exactly when status is good, due_soon or overdue
  rule: MaintenanceRule | null; // null exactly when status is not_applicable
  progress: DistanceProgress | null; // non-null exactly when status is good, due_soon or overdue
};
