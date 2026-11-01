import type { Migration } from '../migrate';

// Local schema v4: a vehicle-name snapshot per ride, local-first.
// The name is captured when a ride starts so history keeps naming the vehicle even after that
// vehicle is renamed or removed. Existing rides are backfilled best-effort from whatever vehicle
// rows are still present (including soft-deleted ones); rides with no vehicle, or whose vehicle
// row is gone, keep a NULL name and display as "No vehicle".
//
// The SQL name rule mirrors vehicleDisplayName() in vehicleStore.ts exactly:
//   nickname -> "brand model" (trimmed) -> vehicle-type label.
// A separate migration (not an edit of 001-003) so a phone that already has v1/v2/v3 upgrades in place.
export const m004: Migration = {
  version: 4,
  sql: `
    ALTER TABLE rides ADD COLUMN vehicle_name TEXT;

    UPDATE rides
       SET vehicle_name = (
         SELECT COALESCE(
           NULLIF(TRIM(COALESCE(v.nickname, '')), ''),
           NULLIF(TRIM(COALESCE(v.brand, '') || ' ' || COALESCE(v.model, '')), ''),
           CASE v.vehicle_type
             WHEN 'motorcycle' THEN 'Motorcycle'
             WHEN 'car'        THEN 'Car'
             WHEN 'bicycle'    THEN 'Bicycle'
             WHEN 'truck'      THEN 'Truck'
             WHEN 'bus'        THEN 'Bus'
             WHEN 'van'        THEN 'Van'
             WHEN 'other'      THEN 'Other'
             ELSE v.vehicle_type
           END
         )
         FROM vehicles v
         WHERE v.id = rides.user_vehicle_id
       )
     WHERE rides.user_vehicle_id IS NOT NULL;
  `,
};
