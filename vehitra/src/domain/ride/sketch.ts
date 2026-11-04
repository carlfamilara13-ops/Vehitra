// Pure projection of a recorded route into pixel coordinates for the offline route sketch.
// No map tiles and no network: this only fits the recorded points into a fixed-size canvas
// while preserving shape (same scale on both axes). Multi-segment routes are projected
// together so segments stay aligned, and gaps between segments are not drawn   matching the
// storage rule that distance is never joined across untracked gaps.

import type { LatLon } from './polyline';

export type SketchedPoint = { x: number; y: number };

export type SketchOptions = {
  width: number;
  height: number;
  padding?: number; // px kept clear on every edge
};

export type RouteSketch = {
  segments: SketchedPoint[][];
  usablePoints: number; // total points drawn across all segments
  isEmpty: boolean; // true when nothing could be drawn (no points / all identical)
};

const isFiniteLatLon = (p: LatLon): boolean =>
  Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

// Fits lat/lon segments into the canvas. Points that are not finite coordinates are skipped;
// a route whose points are all identical (or empty) returns isEmpty so the UI can say "no
// route" instead of drawing a meaningless dot.
export function projectRoute(segments: readonly LatLon[][], options: SketchOptions): RouteSketch {
  const padding = Math.max(0, options.padding ?? 12);
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const innerW = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding * 2);

  const cleaned: LatLon[][] = segments
    .map((seg) => seg.filter(isFiniteLatLon))
    .filter((seg) => seg.length > 0);
  const usablePoints = cleaned.reduce((n, seg) => n + seg.length, 0);
  if (usablePoints === 0) return { segments: [], usablePoints: 0, isEmpty: true };

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const seg of cleaned) {
    for (const p of seg) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
  }

  const latSpan = maxLat - minLat;
  const lonSpan = maxLon - minLon;
  if (latSpan === 0 && lonSpan === 0) return { segments: [], usablePoints, isEmpty: true };

  // Longitude shrinks toward the poles; a cosine scale at the mid latitude keeps shapes from
  // stretching horizontally on north/south routes. cos(90°) = 0 is clamped so a pole route
  // still renders.
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const lonScale = Math.max(0.01, Math.cos(midLat));

  const scaledW = lonSpan * lonScale;
  const scaledH = latSpan;
  const scale = scaledW > 0 && scaledH > 0
    ? Math.min(innerW / scaledW, innerH / scaledH)
    : scaledW > 0
      ? innerW / scaledW
      : innerH / scaledH;

  const drawnW = scaledW * scale;
  const drawnH = scaledH * scale;
  const offsetX = padding + (innerW - drawnW) / 2;
  const offsetY = padding + (innerH - drawnH) / 2;

  const projected: SketchedPoint[][] = cleaned.map((seg) =>
    seg.map((p) => ({
      x: offsetX + (p.lon - minLon) * lonScale * scale,
      // Latitude grows north, screen Y grows down: flip.
      y: offsetY + (maxLat - p.lat) * scale,
    })),
  );

  return { segments: projected, usablePoints, isEmpty: false };
}
