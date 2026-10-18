import type { Migration } from '../migrate';

// Local schema v6: database-level maintenance invariants.
//
// These mirror the SEMANTIC checks in supabase/migrations/20261010000300_user_tables.sql (their
// CHECK constraints and the guide_part_installs trigger). SQLite cannot add a CHECK to an existing
// column, or a table-level CHECK, without rebuilding the table, and migrations 001-005 are frozen.
// So the invariants are enforced with BEFORE INSERT/UPDATE triggers using RAISE(ABORT), exactly the
// pattern migration 005 already uses for insert-only / close-only immutability.
//
// IMPORTANT: triggers are not retroactive. Existing rows are never scanned or re-checked, so this
// migration cannot fail on historical data and never rewrites, deletes or fabricates records.
//
// KNOWN LOCAL/CLOUD DISCREPANCY (intentional, deferred):
//   The cloud requires every non-void mileage entry to carry a non-null odo_reading_after
//   (check ((kind = 'void') = (odo_reading_after is null))). Locally, Stage 4B-4 records a ride
//   entry with odo_reading_after = NULL because the running-odometer estimate is not computed yet.
//   Enforcing the cloud biconditional here would reject every ride and break ride finalization, so
//   the `kind <> 'void' => odo_reading_after IS NOT NULL` direction is deliberately NOT enforced.
//   Only the reverse direction (void rows must have a NULL reading) is enforced. The cloud schema
//   is unchanged; this is a ride/ledger + odometer-baseline cloud-sync prerequisite.
export const m006: Migration = {
  version: 6,
  sql: `
    -- ------------------------------------------------------------------ mileage_entries
    -- kind / source whitelists (cloud: kind in (...) and source in (...)).
    CREATE TRIGGER mileage_entries_valid_kind_source
    BEFORE INSERT ON mileage_entries
    WHEN NEW.kind NOT IN ('initial','ride','dashboard_reading','adjustment','odometer_replacement','void')
      OR NEW.source NOT IN ('gps','dashboard_reading','manual_adjustment','estimated','initial')
    BEGIN
      SELECT RAISE(ABORT, 'invalid mileage kind or source');
    END;

    -- void rows: must reference an entry, and carry no distance/reading/offset of their own.
    CREATE TRIGGER mileage_entries_void_rules
    BEFORE INSERT ON mileage_entries
    WHEN (NEW.kind = 'void' AND NEW.voids_entry_id IS NULL)
      OR (NEW.kind <> 'void' AND NEW.voids_entry_id IS NOT NULL)
      OR (NEW.kind = 'void' AND (NEW.odo_reading_after IS NOT NULL OR NEW.applied_km <> 0 OR NEW.odo_offset_delta <> 0))
    BEGIN
      SELECT RAISE(ABORT, 'invalid void mileage entry');
    END;

    -- ride rows carry a gps source and a ride_id; no other kind may carry a ride_id.
    CREATE TRIGGER mileage_entries_ride_rules
    BEFORE INSERT ON mileage_entries
    WHEN (NEW.kind = 'ride' AND (NEW.source <> 'gps' OR NEW.ride_id IS NULL))
      OR (NEW.kind <> 'ride' AND NEW.ride_id IS NOT NULL)
    BEGIN
      SELECT RAISE(ABORT, 'invalid ride mileage entry');
    END;

    -- per-kind source / applied_km / odo_offset_delta rules.
    CREATE TRIGGER mileage_entries_kind_rules
    BEFORE INSERT ON mileage_entries
    WHEN (NEW.kind = 'dashboard_reading' AND NEW.source <> 'dashboard_reading')
      OR (NEW.kind = 'initial' AND (NEW.source <> 'initial' OR NEW.applied_km <> 0))
      OR (NEW.kind = 'odometer_replacement' AND (NEW.source <> 'manual_adjustment' OR NEW.applied_km <> 0))
      OR (NEW.kind = 'adjustment' AND NEW.source NOT IN ('manual_adjustment','estimated'))
      OR (NEW.kind <> 'odometer_replacement' AND NEW.odo_offset_delta <> 0)
    BEGIN
      SELECT RAISE(ABORT, 'invalid mileage entry for its kind');
    END;

    -- a reading that adds no distance (equal or lower) must carry at least one flag.
    -- flags is a JSON array TEXT produced by the store; the empty array is exactly '[]'.
    CREATE TRIGGER mileage_entries_dashboard_flagged
    BEFORE INSERT ON mileage_entries
    WHEN NEW.kind = 'dashboard_reading'
      AND NOT (NEW.applied_km > 0 OR (NEW.flags IS NOT NULL AND NEW.flags <> '[]'))
    BEGIN
      SELECT RAISE(ABORT, 'a dashboard reading with no added distance must carry a flag');
    END;

    -- a void must reference an existing, non-void entry of the SAME vehicle
    -- (cloud: foreign key (voids_entry_id, user_vehicle_id, user_id)).
    CREATE TRIGGER mileage_entries_void_reference
    BEFORE INSERT ON mileage_entries
    WHEN NEW.kind = 'void' AND NEW.voids_entry_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM mileage_entries m
         WHERE m.id = NEW.voids_entry_id
           AND m.user_vehicle_id = NEW.user_vehicle_id
           AND m.kind <> 'void'
      )
    BEGIN
      SELECT RAISE(ABORT, 'a void must reference an existing non-void entry of the same vehicle');
    END;

    -- ------------------------------------------------------------------ service_events
    CREATE TRIGGER service_events_valid_action
    BEFORE INSERT ON service_events
    WHEN NEW.action NOT IN ('replace','clean','lubricate','inspect','service','baseline','void')
    BEGIN
      SELECT RAISE(ABORT, 'invalid service action');
    END;

    CREATE TRIGGER service_events_void_rules
    BEFORE INSERT ON service_events
    WHEN (NEW.action = 'void' AND NEW.voids_event_id IS NULL)
      OR (NEW.action <> 'void' AND NEW.voids_event_id IS NOT NULL)
    BEGIN
      SELECT RAISE(ABORT, 'invalid void service event');
    END;

    -- an explicit baseline is an estimate, never an observed event (cloud: action <> 'baseline' or estimated).
    CREATE TRIGGER service_events_baseline_estimated
    BEFORE INSERT ON service_events
    WHEN NEW.action = 'baseline' AND NEW.estimated = 0
    BEGIN
      SELECT RAISE(ABORT, 'a baseline service event must be estimated');
    END;

    -- a void event must reference an existing, non-void event of the SAME vehicle and component
    -- (cloud: foreign key (voids_event_id, user_vehicle_id, component_id, user_id)).
    CREATE TRIGGER service_events_void_reference
    BEFORE INSERT ON service_events
    WHEN NEW.action = 'void' AND NEW.voids_event_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM service_events s
         WHERE s.id = NEW.voids_event_id
           AND s.user_vehicle_id = NEW.user_vehicle_id
           AND s.component_code = NEW.component_code
           AND s.action <> 'void'
      )
    BEGIN
      SELECT RAISE(ABORT, 'a void event must reference an existing non-void event of the same component');
    END;

    -- ------------------------------------------------------------------ part_installs
    -- removed_at ordering and removal_odo requires a removal time (cloud: two CHECKs).
    CREATE TRIGGER part_installs_valid_removal_insert
    BEFORE INSERT ON part_installs
    WHEN (NEW.removed_at IS NOT NULL AND NEW.removed_at < NEW.installed_at)
      OR (NEW.removal_odo IS NOT NULL AND NEW.removed_at IS NULL)
    BEGIN
      SELECT RAISE(ABORT, 'invalid part install removal data');
    END;

    CREATE TRIGGER part_installs_valid_removal_update
    BEFORE UPDATE ON part_installs
    WHEN (NEW.removed_at IS NOT NULL AND NEW.removed_at < NEW.installed_at)
      OR (NEW.removal_odo IS NOT NULL AND NEW.removed_at IS NULL)
    BEGIN
      SELECT RAISE(ABORT, 'invalid part install removal data');
    END;

    -- an OPEN install may be corrected or closed, but its identity never changes
    -- (cloud guide_part_installs). The closed-install immutability trigger from 005 still applies.
    CREATE TRIGGER part_installs_identity_frozen
    BEFORE UPDATE ON part_installs
    WHEN OLD.removed_at IS NULL
      AND (NEW.id <> OLD.id
        OR NEW.user_vehicle_id <> OLD.user_vehicle_id
        OR NEW.component_code <> OLD.component_code
        OR NEW.created_at <> OLD.created_at)
    BEGIN
      SELECT RAISE(ABORT, 'part install identity cannot change');
    END;

    -- ------------------------------------------------------------------ component_overrides
    -- positive intervals when present (cloud: interval_km/interval_days > 0).
    CREATE TRIGGER component_overrides_valid_interval_insert
    BEFORE INSERT ON component_overrides
    WHEN (NEW.interval_km IS NOT NULL AND NEW.interval_km <= 0)
      OR (NEW.interval_days IS NOT NULL AND NEW.interval_days <= 0)
    BEGIN
      SELECT RAISE(ABORT, 'override interval must be greater than zero');
    END;

    CREATE TRIGGER component_overrides_valid_interval_update
    BEFORE UPDATE ON component_overrides
    WHEN (NEW.interval_km IS NOT NULL AND NEW.interval_km <= 0)
      OR (NEW.interval_days IS NOT NULL AND NEW.interval_days <= 0)
    BEGIN
      SELECT RAISE(ABORT, 'override interval must be greater than zero');
    END;
  `,
};
