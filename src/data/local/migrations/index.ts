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

export const MIGRATIONS: Migration[] = [m001, m002, m003, m004, m005, m006, m007, m008, m009, m010];
