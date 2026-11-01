import { encodePolyline, simplify, type LatLon } from './polyline';

export type RoutePoint = { ts: number; lat: number; lon: number; accuracy: number | null };
export type RouteSegment = { polyline: string; points: number; startTs: number; endTs: number };
export type Route = {
  v: 1;
  segments: RouteSegment[]; // each segment is continuous; segments are NOT joined across gaps
  droppedSegments: number; // segments with too few usable points to draw
  usablePoints: number;
};
export type RouteOptions = {
  maxAccuracyM: number;
  breakGapS: number; // a gap between usable fixes longer than this starts a new segment
  toleranceM: number;
  precision: number;
  minSegmentPoints: number;
};

// Builds the route from stored points. Uses ONLY usable (accurate) fixes, and splits at the same gaps that
// processFixes treats as untracked, so the drawn route, the distance and the tracked time agree.
export function buildRoute(points: RoutePoint[], o: RouteOptions): Route {
  const usable = points
    .filter((p) => p.accuracy !== null && p.accuracy <= o.maxAccuracyM)
    .sort((a, b) => a.ts - b.ts);
  const groups: RoutePoint[][] = [];
  let current: RoutePoint[] = [];
  for (const p of usable) {
    const prev = current[current.length - 1];
    if (prev && (p.ts - prev.ts) / 1000 > o.breakGapS) {
      groups.push(current);
      current = [];
    }
    current.push(p);
  }
  if (current.length > 0) groups.push(current);

  const segments: RouteSegment[] = [];
  let dropped = 0;
  for (const g of groups) {
    if (g.length < o.minSegmentPoints) {
      dropped += 1;
      continue;
    }
    const line: LatLon[] = simplify(g.map((p) => ({ lat: p.lat, lon: p.lon })), o.toleranceM);
    segments.push({
      polyline: encodePolyline(line, o.precision),
      points: g.length,
      startTs: g[0].ts,
      endTs: g[g.length - 1].ts,
    });
  }
  return { v: 1, segments, droppedSegments: dropped, usablePoints: usable.length };
}

// The single `polyline` column (what the cloud currently stores) can only represent a COMPLETE one-piece route.
// Anything else returns null; those rides must sync `route_segments` (needs a cloud column: see STEP4_PLAN).
export function singlePolyline(route: Route): string | null {
  return route.segments.length === 1 && route.droppedSegments === 0 ? route.segments[0].polyline : null;
}
