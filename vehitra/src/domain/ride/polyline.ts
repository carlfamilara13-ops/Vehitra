// Route simplification and Google-style polyline encoding. Pure functions.

export type LatLon = { lat: number; lon: number };

const M_PER_DEG_LAT = 111320;

// Douglas-Peucker in a local flat projection (metres). Always keeps the first and last point.
export function simplify(points: LatLon[], toleranceM: number): LatLon[] {
  if (points.length <= 2) return points.slice();
  const lat0 = points[0].lat;
  const kx = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  const xy = points.map((p) => ({ x: p.lon * kx, y: p.lat * M_PER_DEG_LAT }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(xy[i], xy[a], xy[b]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > toleranceM && idx !== -1) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

function distToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function encodePolyline(points: LatLon[], precision = 5): string {
  const factor = 10 ** precision;
  let prevLat = 0;
  let prevLon = 0;
  let out = '';
  for (const p of points) {
    const lat = Math.round(p.lat * factor);
    const lon = Math.round(p.lon * factor);
    out += encodeNumber(lat - prevLat) + encodeNumber(lon - prevLon);
    prevLat = lat;
    prevLon = lon;
  }
  return out;
}

function encodeNumber(num: number): string {
  let v = num < 0 ? ~(num << 1) : num << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

export function decodePolyline(encoded: string, precision = 5): LatLon[] {
  const factor = 10 ** precision;
  const points: LatLon[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < encoded.length) {
    for (const axis of ['lat', 'lon'] as const) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 'lat') lat += delta;
      else lon += delta;
    }
    points.push({ lat: lat / factor, lon: lon / factor });
  }
  return points;
}
