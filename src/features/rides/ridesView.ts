// Pure view logic for the Rides screen: search, quick and advanced filtering, sorting,
// saved-ride totals, vehicle options and page slicing. No React/Expo/SQLite imports, so it can
// be unit tested with node:test and the screen only draws what these functions return.
//
// Nothing here recomputes a ride's stored numbers: rows arrive unchanged from ridesStore and are
// only selected, ordered and counted. Distance filters and form inputs speak kilometres — the
// same convention as the odometer editor — while every stored value stays in metres.

import type { RideRow } from '../../data/local/ridesStore';
import { decodePolyline, type LatLon } from '../../domain/ride/polyline';
import type { Route } from '../../domain/ride/route';

export type RideSort = 'newest' | 'oldest' | 'longest_distance' | 'longest_duration';
export type RideDisplayMode = 'rich' | 'compact';
export type QuickStatus = 'all' | 'finished' | 'recovered';
export type RideStatusValue = RideRow['status'];

// The vehicle filter only offers values that exist on ride rows: a stored vehicle id, or the
// explicit "no vehicle" case for rides recorded without one.
export type VehicleSelection =
  | { kind: 'any' }
  | { kind: 'none' }
  | { kind: 'vehicle'; id: string };

export type RideFilters = {
  statuses: RideStatusValue[]; // empty = every status
  fromDay: string | null; // 'YYYY-MM-DD', inclusive local day
  toDay: string | null; // 'YYYY-MM-DD', inclusive local day
  vehicle: VehicleSelection;
  minKm: number | null; // forms accept kilometres; comparisons convert to metres
  maxKm: number | null;
  sort: RideSort;
};

// How many rows the list materialises per batch, and how many rows are read from SQLite in one
// go. The cap mirrors the guardrail the Dashboard already uses for its ride totals so both
// screens count the same set — it is a read limit, not a schema change.
export const RIDES_PAGE_SIZE = 15;
export const RIDE_QUERY_LIMIT = 1000;

export const DEFAULT_RIDE_FILTERS: RideFilters = {
  statuses: [],
  fromDay: null,
  toDay: null,
  vehicle: { kind: 'any' },
  minKm: null,
  maxKm: null,
  sort: 'newest',
};

// Presentation labels for the persisted status values. The values themselves are never renamed:
// 'recording' | 'finished' | 'recovered' is what the database stores.
export const RIDE_STATUS_LABELS: Record<RideStatusValue, string> = {
  recording: 'Recording',
  finished: 'Finished',
  recovered: 'Recovered',
};

export const RIDE_SORT_LABELS: Record<RideSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  longest_distance: 'Longest distance',
  longest_duration: 'Longest duration',
};

export const QUICK_STATUS_LABELS: Record<QuickStatus, string> = {
  all: 'All',
  finished: 'Finished',
  recovered: 'Recovered',
};

// ---------------------------------------------------------------- active filters

export function isDefaultFilters(filters: RideFilters): boolean {
  return (
    filters.statuses.length === 0 &&
    filters.fromDay === null &&
    filters.toDay === null &&
    filters.vehicle.kind === 'any' &&
    filters.minKm === null &&
    filters.maxKm === null &&
    filters.sort === DEFAULT_RIDE_FILTERS.sort
  );
}

// ---------------------------------------------------------------- form validation (draft-safe)

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DayParse = { ok: true; value: string | null } | { ok: false; error: string };

export function parseDayInput(raw: string): DayParse {
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  const match = DAY_PATTERN.exec(text);
  if (!match) return { ok: false, error: 'Use the format YYYY-MM-DD.' };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(year, month - 1, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    return { ok: false, error: 'That date does not exist.' };
  }
  return { ok: true, value: text };
}

// Local-day bounds. `d + 1` runs through the Date constructor, so month and DST boundaries
// resolve to the real next local midnight instead of a fixed 24h offset.
function dayBounds(day: string): { start: number; endExclusive: number } | null {
  const match = DAY_PATTERN.exec(day);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const dayOfMonth = Number(match[3]);
  return {
    start: new Date(year, month - 1, dayOfMonth).getTime(),
    endExclusive: new Date(year, month - 1, dayOfMonth + 1).getTime(),
  };
}

export function dateRangeError(fromText: string, toText: string): string | null {
  const from = parseDayInput(fromText);
  if (!from.ok) return from.error;
  const to = parseDayInput(toText);
  if (!to.ok) return to.error;
  if (from.value && to.value) {
    const fromBounds = dayBounds(from.value);
    const toBounds = dayBounds(to.value);
    if (fromBounds && toBounds && fromBounds.start > toBounds.start) {
      return 'The start date must be on or before the end date.';
    }
  }
  return null;
}

export type DistanceParse = { ok: true; value: number | null } | { ok: false; error: string };

export function parseDistanceInput(raw: string): DistanceParse {
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, error: 'Enter a number of kilometres, 0 or more.' };
  }
  return { ok: true, value };
}

export function distanceRangeError(minText: string, maxText: string): string | null {
  const min = parseDistanceInput(minText);
  if (!min.ok) return min.error;
  const max = parseDistanceInput(maxText);
  if (!max.ok) return max.error;
  if (min.value != null && max.value != null && min.value > max.value) {
    return 'The minimum distance cannot be larger than the maximum.';
  }
  return null;
}

// ---------------------------------------------------------------- search

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

// Everything a ride row can actually be searched by: the vehicle name snapshot taken at start,
// the status label, and the start date/time in the same formats the list displays plus the
// machine 'YYYY-MM-DD' and 'HH:MM' forms. The schema has no ride title or note column, so no
// title or note is searched or promised.
export function rideSearchText(ride: RideRow): string {
  const started = new Date(ride.started_at);
  return [
    ride.vehicle_name ?? '',
    RIDE_STATUS_LABELS[ride.status],
    started.toLocaleDateString(),
    started.toLocaleTimeString(),
    `${started.getFullYear()}-${pad2(started.getMonth() + 1)}-${pad2(started.getDate())}`,
    `${pad2(started.getHours())}:${pad2(started.getMinutes())}`,
  ].join(' ').toLowerCase();
}

// Whitespace-separated terms must ALL match (AND), so "honda 2026" narrows instead of guessing.
export function rideMatchesQuery(ride: RideRow, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  const haystack = rideSearchText(ride);
  return query.split(/\s+/).every((token) => haystack.includes(token));
}

// ---------------------------------------------------------------- filtering + sorting

export function rideMatchesFilters(ride: RideRow, filters: RideFilters): boolean {
  if (filters.statuses.length > 0 && !filters.statuses.includes(ride.status)) return false;
  if (filters.fromDay) {
    const bounds = dayBounds(filters.fromDay);
    if (bounds && ride.started_at < bounds.start) return false;
  }
  if (filters.toDay) {
    const bounds = dayBounds(filters.toDay);
    if (bounds && ride.started_at >= bounds.endExclusive) return false;
  }
  if (filters.vehicle.kind === 'none' && ride.user_vehicle_id != null) return false;
  if (filters.vehicle.kind === 'vehicle' && ride.user_vehicle_id !== filters.vehicle.id) return false;
  if (filters.minKm != null && ride.distance_m < filters.minKm * 1000) return false;
  if (filters.maxKm != null && ride.distance_m > filters.maxKm * 1000) return false;
  return true;
}

// Recording rides have no final duration; `tracked_s` is what the existing card already falls
// back to, and a ride with neither sorts last rather than first.
function durationForSort(ride: RideRow): number {
  return ride.duration_s ?? ride.tracked_s ?? 0;
}

// Deterministic ordering. Every sort falls back to the ride id (descending) so equal keys keep a
// stable position across pages — pagination can never skip or repeat a row.
export function sortRides(rides: readonly RideRow[], sort: RideSort): RideRow[] {
  const out = [...rides];
  switch (sort) {
    case 'oldest':
      out.sort((a, b) => a.started_at - b.started_at || byIdDesc(a, b));
      break;
    case 'longest_distance':
      out.sort((a, b) => b.distance_m - a.distance_m || byIdDesc(a, b));
      break;
    case 'longest_duration':
      out.sort((a, b) => durationForSort(b) - durationForSort(a) || byIdDesc(a, b));
      break;
    default:
      out.sort((a, b) => b.started_at - a.started_at || byIdDesc(a, b));
  }
  return out;
}

function byIdDesc(a: RideRow, b: RideRow): number {
  if (a.id < b.id) return 1;
  if (a.id > b.id) return -1;
  return 0;
}

export function selectRides(
  rides: readonly RideRow[],
  filters: RideFilters,
  query: string,
): RideRow[] {
  return sortRides(
    rides.filter((ride) => rideMatchesFilters(ride, filters) && rideMatchesQuery(ride, query)),
    filters.sort,
  );
}

// ---------------------------------------------------------------- summary

export type RideTotals = { savedCount: number; totalDistanceM: number };

// Saved-ride totals, counted exactly like the Dashboard's "Ride totals": only finalized rides
// count, a ride still recording is excluded until it is saved. Takes no search/filter/sort input
// so the summary can never be narrowed by what the list is currently showing.
export function rideTotals(rides: readonly RideRow[]): RideTotals {
  let savedCount = 0;
  let totalDistanceM = 0;
  for (const ride of rides) {
    if (ride.status === 'recording') continue;
    savedCount += 1;
    totalDistanceM += ride.distance_m;
  }
  return { savedCount, totalDistanceM };
}

// ---------------------------------------------------------------- quick status chips

export function statusesForQuickFilter(quick: QuickStatus): RideStatusValue[] {
  return quick === 'all' ? [] : [quick];
}

// 'all' includes recovered rides. Returns null when the advanced filters hold a combination the
// three quick chips cannot represent (for example 'recording' plus 'finished').
export function quickFilterForStatuses(statuses: readonly RideStatusValue[]): QuickStatus | null {
  if (statuses.length === 0) return 'all';
  if (statuses.length === 1 && statuses[0] === 'finished') return 'finished';
  if (statuses.length === 1 && statuses[0] === 'recovered') return 'recovered';
  return null;
}

// ---------------------------------------------------------------- vehicle options

export type VehicleOption = { selection: VehicleSelection; label: string; count: number };

// Vehicles come from the rows themselves: rides store both the vehicle id and the name snapshot
// taken when the ride started. The label shown is the most recent snapshot for that id, so a
// renamed vehicle reads under its current name while older rides still filter correctly.
export function vehicleOptions(rides: readonly RideRow[]): VehicleOption[] {
  const groups = new Map<string, { label: string; latest: number; count: number }>();
  let withoutVehicle = 0;
  for (const ride of rides) {
    const id = ride.user_vehicle_id;
    if (id == null) {
      withoutVehicle += 1;
      continue;
    }
    const group = groups.get(id);
    if (!group) {
      groups.set(id, { label: ride.vehicle_name ?? 'Vehicle', latest: ride.started_at, count: 1 });
      continue;
    }
    group.count += 1;
    if (ride.started_at >= group.latest && ride.vehicle_name) {
      group.label = ride.vehicle_name;
      group.latest = ride.started_at;
    }
  }
  const options: VehicleOption[] = [...groups.entries()]
    .map(([id, group]) => ({ selection: { kind: 'vehicle', id } as VehicleSelection, label: group.label, count: group.count }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (withoutVehicle > 0) {
    options.push({ selection: { kind: 'none' }, label: 'No vehicle', count: withoutVehicle });
  }
  return options;
}

// The vehicle section is only shown when at least one ride actually carries a vehicle.
export function hasVehicleFilterData(rides: readonly RideRow[]): boolean {
  return rides.some((ride) => ride.user_vehicle_id != null);
}

// ---------------------------------------------------------------- empty states

export type RidesEmptyState = 'none' | 'no_matches' | null;

export function ridesEmptyState(storedRideCount: number, resultCount: number): RidesEmptyState {
  if (storedRideCount === 0) return 'none';
  if (resultCount === 0) return 'no_matches';
  return null;
}

// ---------------------------------------------------------------- pagination

// The visible prefix grows one batch at a time; `slice` clamps at the end of the list, so a
// stale count can never read past the data.
export function pageSlice<T>(items: readonly T[], visibleCount: number): T[] {
  return items.slice(0, Math.max(0, visibleCount));
}

export function nextVisibleCount(current: number, total: number): number {
  return Math.min(current + RIDES_PAGE_SIZE, total);
}

export function hasMoreRides(current: number, total: number): boolean {
  return current < total;
}

// ---------------------------------------------------------------- route geometry for previews

// Reads the persisted ride's route: `route_segments` holds the JSON Route built at finalize
// time (one encoded polyline per segment, split at GPS gaps) — the same shape the Ride Detail
// screen reads. Absent or unreadable segments mean "no route" for that row; nothing is invented.
export function rideRouteSegments(ride: Pick<RideRow, 'route_segments'>): LatLon[][] {
  if (!ride.route_segments) return [];
  try {
    const route = JSON.parse(ride.route_segments) as Route;
    if (!route || !Array.isArray(route.segments)) return [];
    return route.segments
      .map((segment) => decodePolyline(segment.polyline))
      .filter((points) => points.length > 1);
  } catch {
    return [];
  }
}
