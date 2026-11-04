import type { Migration } from '../migrate';
import { m001 } from './001_init';
import { m002 } from './002_ride_integrity';
import { m003 } from './003_vehicle';
import { m004 } from './004_ride_vehicle_name';
import { m005 } from './005_maintenance';
import { m006 } from './006_maintenance_invariants';
import { m007 } from './007_accessories_battery';
import { m008 } from './008_deadlines_settings';
import { m009 } from './009_vehicle_catalog';
import { m010 } from './010_driver_profile';
import { m011 } from './011_notification_preferences';
import { m012 } from './012_appearance';
import { m013 } from './013_vehicle_documents';
import { m014 } from './014_driver_profile_back_photo';
import { m015 } from './015_driver_profile_license_fields';
import { m016 } from './016_tracking_notifications';
import { m017 } from './017_catalog_time_intervals';
import { m018 } from './018_custom_parts';
import { m019 } from './019_catalog_model_images';

export const MIGRATIONS: Migration[] = [
  m001, m002, m003, m004, m005, m006, m007, m008, m009, m010, m011, m012, m013, m014, m015, m016, m017, m018, m019,
];
