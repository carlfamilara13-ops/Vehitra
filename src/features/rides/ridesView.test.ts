import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodePolyline } from '../../domain/ride/polyline';
import type { RideRow } from '../../data/local/ridesStore';
import {
  DEFAULT_RIDE_FILTERS,
  RIDES_PAGE_SIZE,
  dateRangeError,
  distanceRangeError,
  hasMoreRides,
  hasVehicleFilterData,
  isDefaultFilters,
  nextVisibleCount,
  pageSlice,
  parseDayInput,
  parseDistanceInput,
  quickFilterForStatuses,
  rideMatchesQuery,
  rideRouteSegments,
  ridesEmptyState,
  rideTotals,
  selectRides,
  sortRides,
  statusesForQuickFilter,
  vehicleOptions,
  type RideFilters,
  type RideSort,
} from './ridesView';

// Minimal RideRow fixture: every column the store defines, then only the fields a test cares
// about are overridden. Nothing here represents real stored data.
function ride(id: string, over: Partial<RideRow> = {}): RideRow {
  return {
    id,
    user_vehicle_id: null,
    vehicle_name: null,
    started_at: 0,
    ended_at: null,
    status: 'finished',
    point_count: 0,
    distance_m: 0,
    raw_distance_m: 0,
    max_gap_s: 0,
    max_delay_ms: 0,
    late_batches: 0,
    untracked_gap_s: 0,
    untracked_gap_m: 0,
    max_speed_ms: 0,
    last_ts: null,
    last_lat: null,
    last_lon: null,
    last_raw_lat: null,
    last_raw_lon: null,
    duration_s: null,
    avg_speed_ms: null,
    polyline: null,
    polyline_tolerance_m: null,
    needs_review: 0,
    raw_purged_at: null,
    sync_status: 'pending',
    first_usable_ts: null,
    last_usable_ts: null,
    last_usable_lat: null,
    last_usable_lon: null,
    tracked_s: null,
    route_segments: null,
    interrupted: 0,
    interruption_count: 0,
    interruption_s: 0,
    recovery_state: 'none',
    integrity_issue: null,
    ...over,
  };
}

function filters(over: Partial<RideFilters> = {}): RideFilters {
  return { ...DEFAULT_RIDE_FILTERS, ...over };
}

const D = (y: number, m: number, d: number, h = 12, mi = 0): number =>
  new Date(y, m - 1, d, h, mi).getTime();
const DAY = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

describe('ridesView: summary independence', () => {
  const rides = [
    ride('a', { status: 'finished', distance_m: 1000 }),
    ride('b', { status: 'recovered', distance_m: 2500 }),
    ride('c', { status: 'recording', distance_m: 99_000 }),
  ];

  it('counts only finalized rides and sums their stored distance', () => {
    assert.deepEqual(rideTotals(rides), { savedCount: 2, totalDistanceM: 3500 });
  });

  it('is unaffected by search, filters, sorting or display mode', () => {
    // rideTotals deliberately takes no query/filter/sort input: filtering to recovered rides or
    // searching for text cannot change what the summary reports.
    const narrowed = selectRides(rides, filters({ statuses: ['recovered'] }), 'no-match-text');
    assert.equal(narrowed.length, 0);
    assert.deepEqual(rideTotals(rides), { savedCount: 2, totalDistanceM: 3500 });
  });

  it('reports zero for an empty list', () => {
    assert.deepEqual(rideTotals([]), { savedCount: 0, totalDistanceM: 0 });
  });
});

describe('ridesView: search', () => {
  const rides = [
    ride('a', { vehicle_name: 'Honda Click', started_at: D(2026, 10, 10, 9, 30), status: 'finished' }),
    ride('b', { vehicle_name: 'Yamaha NMAX', started_at: D(2026, 11, 2, 18, 5), status: 'recovered' }),
    ride('c', { vehicle_name: null, started_at: D(2026, 12, 25, 7, 15), status: 'recording' }),
  ];

  it('matches the stored vehicle name, case-insensitively', () => {
    const hits = rides.filter((r) => rideMatchesQuery(r, 'honda'));
    assert.deepEqual(hits.map((r) => r.id), ['a']);
  });

  it('matches the machine date form and the time', () => {
    assert.deepEqual(rides.filter((r) => rideMatchesQuery(r, '2026-11-02')).map((r) => r.id), ['b']);
    assert.deepEqual(rides.filter((r) => rideMatchesQuery(r, '07:15')).map((r) => r.id), ['c']);
  });

  it('matches the displayed locale date', () => {
    const expected = new Date(D(2026, 10, 10, 9, 30)).toLocaleDateString();
    assert.deepEqual(rides.filter((r) => rideMatchesQuery(r, expected)).map((r) => r.id), ['a']);
  });

  it('matches the status label without renaming stored values', () => {
    assert.deepEqual(rides.filter((r) => rideMatchesQuery(r, 'recovered')).map((r) => r.id), ['b']);
    assert.deepEqual(rides.filter((r) => rideMatchesQuery(r, 'recording')).map((r) => r.id), ['c']);
  });

  it('requires every whitespace-separated term to match', () => {
    assert.deepEqual(rides.filter((r) => rideMatchesQuery(r, 'yamaha 2026-11')).map((r) => r.id), ['b']);
    assert.equal(rides.filter((r) => rideMatchesQuery(r, 'yamaha honda')).length, 0);
  });

  it('an empty or blank query matches everything', () => {
    assert.equal(rides.filter((r) => rideMatchesQuery(r, '')).length, 3);
    assert.equal(rides.filter((r) => rideMatchesQuery(r, '   ')).length, 3);
  });
});

describe('ridesView: advanced filters', () => {
  const rides = [
    ride('a', {
      status: 'finished',
      started_at: D(2026, 10, 10),
      distance_m: 5000,
      user_vehicle_id: 'v1',
      vehicle_name: 'Honda Click',
    }),
    ride('b', {
      status: 'recovered',
      started_at: D(2026, 10, 20),
      distance_m: 15_000,
      user_vehicle_id: 'v2',
      vehicle_name: 'Yamaha NMAX',
    }),
    ride('c', {
      status: 'recording',
      started_at: D(2026, 10, 25),
      distance_m: 1000,
      user_vehicle_id: null,
      vehicle_name: null,
    }),
  ];
  const ids = (f: RideFilters, q = '') => selectRides(rides, f, q).map((r) => r.id);

  it('quick status filters map to stored status values', () => {
    assert.deepEqual(statusesForQuickFilter('all'), []);
    assert.deepEqual(statusesForQuickFilter('finished'), ['finished']);
    assert.deepEqual(statusesForQuickFilter('recovered'), ['recovered']);
    assert.deepEqual(ids(filters({ statuses: ['finished'] })), ['a']);
    // 'All' includes recovered rides (and every other stored status).
    assert.deepEqual(ids(filters()), ['c', 'b', 'a']);
    assert.deepEqual(ids(filters({ statuses: ['recovered'] })), ['b']);
  });

  it('date range is inclusive of both local days and rejects the following day', () => {
    const f = filters({ fromDay: DAY(2026, 10, 10), toDay: DAY(2026, 10, 20) });
    assert.deepEqual(ids(f), ['b', 'a']);
    const oneDayEarlier = selectRides(rides, filters({ fromDay: DAY(2026, 10, 9), toDay: DAY(2026, 10, 9) }), '');
    assert.deepEqual(oneDayEarlier.map((r) => r.id), []);
  });

  it('date range keeps boundary-day rides inside the range', () => {
    const f = filters({ fromDay: DAY(2026, 10, 25), toDay: DAY(2026, 10, 25) });
    assert.deepEqual(ids(f), ['c']);
  });

  it('minimum and maximum distance filter stored metres', () => {
    assert.deepEqual(ids(filters({ minKm: 5 })), ['b', 'a']); // 5 km ride is included
    assert.deepEqual(ids(filters({ minKm: 5.001 })), ['b']);
    assert.deepEqual(ids(filters({ maxKm: 5 })), ['c', 'a']);
    assert.deepEqual(ids(filters({ minKm: 5, maxKm: 15 })), ['b', 'a']);
  });

  it('vehicle filter uses the stored vehicle id, including "no vehicle"', () => {
    assert.deepEqual(ids(filters({ vehicle: { kind: 'vehicle', id: 'v1' } })), ['a']);
    assert.deepEqual(ids(filters({ vehicle: { kind: 'vehicle', id: 'v2' } })), ['b']);
    assert.deepEqual(ids(filters({ vehicle: { kind: 'none' } })), ['c']);
    assert.equal(ids(filters({ vehicle: { kind: 'any' } })).length, 3);
  });

  it('combines criteria with AND', () => {
    const f = filters({
      statuses: ['recovered'],
      fromDay: DAY(2026, 10, 1),
      toDay: DAY(2026, 10, 31),
      minKm: 10,
      vehicle: { kind: 'vehicle', id: 'v2' },
    });
    assert.deepEqual(ids(f), ['b']);
    assert.deepEqual(ids({ ...f, vehicle: { kind: 'vehicle', id: 'v1' } }), []);
  });

  it('marks non-default filters for the active-filter indication', () => {
    assert.equal(isDefaultFilters(DEFAULT_RIDE_FILTERS), true);
    assert.equal(isDefaultFilters(filters({ statuses: ['finished'] })), false);
    assert.equal(isDefaultFilters(filters({ sort: 'oldest' })), false);
    assert.equal(isDefaultFilters(filters({ minKm: 1 })), false);
  });
});

describe('ridesView: sorting', () => {
  const t1 = D(2026, 10, 10);
  const t2 = D(2026, 10, 11);
  const rides = [
    ride('a', { started_at: t2, distance_m: 3000, duration_s: 600 }),
    ride('b', { started_at: t1, distance_m: 9000, duration_s: 100 }),
    ride('c', { started_at: t1, distance_m: 1000, duration_s: 900 }),
  ];
  const ids = (sort: RideSort) => sortRides(rides, sort).map((r) => r.id);

  it('newest first is the default order, ties broken by id descending', () => {
    assert.deepEqual(ids('newest'), ['a', 'c', 'b']);
    assert.equal(DEFAULT_RIDE_FILTERS.sort, 'newest');
  });

  it('oldest first reverses the date order and keeps the tie-break', () => {
    assert.deepEqual(ids('oldest'), ['c', 'b', 'a']);
  });

  it('longest distance and longest duration rank by their stored values', () => {
    assert.deepEqual(ids('longest_distance'), ['b', 'a', 'c']);
    assert.deepEqual(ids('longest_duration'), ['c', 'a', 'b']);
  });

  it('breaks ties by ride id descending so the order is deterministic', () => {
    const tied = [
      ride('x', { started_at: t1, distance_m: 100, duration_s: 10 }),
      ride('w', { started_at: t1, distance_m: 100, duration_s: 10 }),
      ride('y', { started_at: t1, distance_m: 100, duration_s: 10 }),
    ];
    for (const sort of ['newest', 'oldest', 'longest_distance', 'longest_duration'] as RideSort[]) {
      const once = sortRides(tied, sort).map((r) => r.id);
      const twice = sortRides([...tied].reverse(), sort).map((r) => r.id);
      assert.deepEqual(once, twice, sort);
      assert.deepEqual(once, ['y', 'x', 'w'], sort);
    }
  });

  it('a recording ride without a duration sorts last by duration', () => {
    const list = [
      ride('r', { status: 'recording', duration_s: null, tracked_s: null }),
      ride('f', { duration_s: 60 }),
    ];
    assert.deepEqual(sortRides(list, 'longest_duration').map((x) => x.id), ['f', 'r']);
  });
});

describe('ridesView: pagination', () => {
  const rides = Array.from({ length: 40 }, (_, i) =>
    ride(`r${String(i).padStart(2, '0')}`, { started_at: D(2026, 1, 1) + i * 1000 }),
  );

  it('first batch, next batch, and clamping at the end', () => {
    assert.equal(pageSlice(rides, RIDES_PAGE_SIZE).length, RIDES_PAGE_SIZE);
    assert.equal(nextVisibleCount(RIDES_PAGE_SIZE, rides.length), RIDES_PAGE_SIZE * 2);
    assert.equal(nextVisibleCount(35, rides.length), 40);
    assert.equal(nextVisibleCount(40, rides.length), 40);
    assert.equal(hasMoreRides(40, 40), false);
    assert.equal(hasMoreRides(39, 40), true);
  });

  it('consecutive batches never overlap or skip a record', () => {
    const sorted = sortRides(rides, 'newest');
    const seen: string[] = [];
    let visible = 0;
    while (hasMoreRides(visible, sorted.length)) {
      const batch = pageSlice(sorted, nextVisibleCount(visible, sorted.length)).slice(visible);
      seen.push(...batch.map((r) => r.id));
      visible = nextVisibleCount(visible, sorted.length);
    }
    assert.equal(seen.length, sorted.length);
    assert.equal(new Set(seen).size, sorted.length);
    assert.deepEqual(seen, sorted.map((r) => r.id));
  });

  it('a stale visible count clamps instead of reading past the list', () => {
    assert.equal(pageSlice(rides, 999).length, rides.length);
    assert.equal(pageSlice(rides, -5).length, 0);
  });
});

describe('ridesView: empty states', () => {
  it('distinguishes "no rides yet" from "nothing matches"', () => {
    assert.equal(ridesEmptyState(0, 0), 'none');
    assert.equal(ridesEmptyState(3, 0), 'no_matches');
    assert.equal(ridesEmptyState(3, 2), null);
  });
});

describe('ridesView: filter form validation', () => {
  it('accepts empty, valid and rejects malformed days', () => {
    assert.deepEqual(parseDayInput(''), { ok: true, value: null });
    assert.deepEqual(parseDayInput('  2026-10-10  '), { ok: true, value: '2026-10-10' });
    assert.equal(parseDayInput('10/10/2026').ok, false);
    assert.equal(parseDayInput('2026-13-01').ok, false);
    assert.equal(parseDayInput('2026-02-30').ok, false);
  });

  it('rejects a reversed date range and passes an ordered one', () => {
    assert.equal(dateRangeError('', ''), null);
    assert.equal(dateRangeError('2026-10-01', '2026-10-31'), null);
    assert.equal(dateRangeError('2026-10-31', '2026-10-01'), 'The start date must be on or before the end date.');
    assert.equal(dateRangeError('2026-10-01', 'nope'), 'Use the format YYYY-MM-DD.');
  });

  it('accepts empty, decimal and rejects negative distances', () => {
    assert.deepEqual(parseDistanceInput(''), { ok: true, value: null });
    assert.deepEqual(parseDistanceInput('12.5'), { ok: true, value: 12.5 });
    assert.equal(parseDistanceInput('-1').ok, false);
    assert.equal(parseDistanceInput('abc').ok, false);
    assert.equal(distanceRangeError('10', '5'), 'The minimum distance cannot be larger than the maximum.');
    assert.equal(distanceRangeError('0', '100'), null);
    assert.equal(distanceRangeError('', ''), null);
  });
});

describe('ridesView: vehicle options', () => {
  const rides = [
    ride('a', { user_vehicle_id: 'v1', vehicle_name: 'Old name', started_at: D(2026, 1, 1) }),
    ride('b', { user_vehicle_id: 'v1', vehicle_name: 'New name', started_at: D(2026, 6, 1) }),
    ride('c', { user_vehicle_id: 'v2', vehicle_name: 'Second bike', started_at: D(2026, 3, 1) }),
    ride('d', { user_vehicle_id: null, vehicle_name: null, started_at: D(2026, 4, 1) }),
  ];

  it('groups by stored vehicle id and labels with the latest name snapshot', () => {
    const options = vehicleOptions(rides);
    const v1 = options.find((o) => o.selection.kind === 'vehicle' && o.selection.id === 'v1');
    assert.ok(v1);
    assert.equal(v1.label, 'New name');
    assert.equal(v1.count, 2);
    assert.equal(options.filter((o) => o.selection.kind === 'vehicle').length, 2);
    const none = options.find((o) => o.selection.kind === 'none');
    assert.equal(none?.count, 1);
  });

  it('only reports vehicle filter data when a ride carries a vehicle', () => {
    assert.equal(hasVehicleFilterData(rides), true);
    assert.equal(hasVehicleFilterData([ride('solo', { user_vehicle_id: null })]), false);
    assert.deepEqual(vehicleOptions([ride('solo', { user_vehicle_id: null })]).map((o) => o.selection.kind), ['none']);
  });
});

describe('ridesView: quick status round trip', () => {
  it('maps the quick chips and back', () => {
    assert.equal(quickFilterForStatuses(statusesForQuickFilter('all')), 'all');
    assert.equal(quickFilterForStatuses(statusesForQuickFilter('finished')), 'finished');
    assert.equal(quickFilterForStatuses(statusesForQuickFilter('recovered')), 'recovered');
    assert.equal(quickFilterForStatuses(['finished', 'recovered']), null);
    assert.equal(quickFilterForStatuses(['recording']), null);
  });
});

describe('ridesView: route segments for previews', () => {
  it('decodes each stored segment and drops unusable ones', () => {
    const polyline = encodePolyline([
      { lat: 14.6, lon: 121.0 },
      { lat: 14.601, lon: 121.001 },
      { lat: 14.602, lon: 121.002 },
    ]);
    const route = {
      v: 1 as const,
      segments: [
        { polyline, points: 3, startTs: 1, endTs: 3 },
        { polyline: encodePolyline([{ lat: 14.6, lon: 121.0 }]), points: 1, startTs: 4, endTs: 4 },
      ],
      droppedSegments: 1,
      usablePoints: 4,
    };
    const segments = rideRouteSegments({ route_segments: JSON.stringify(route) });
    assert.equal(segments.length, 1);
    assert.equal(segments[0].length, 3);
  });

  it('returns nothing for absent, empty or unreadable route data', () => {
    assert.deepEqual(rideRouteSegments({ route_segments: null }), []);
    assert.deepEqual(rideRouteSegments({ route_segments: '' }), []);
    assert.deepEqual(rideRouteSegments({ route_segments: '{not json' }), []);
    assert.deepEqual(rideRouteSegments({ route_segments: '{"v":1}' }), []);
  });
});
