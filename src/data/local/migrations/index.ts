import type { Migration } from '../migrate';
import { m001 } from './001_init';
import { m002 } from './002_ride_integrity';

export const MIGRATIONS: Migration[] = [m001, m002];
