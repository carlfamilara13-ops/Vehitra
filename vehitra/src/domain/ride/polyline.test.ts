import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodePolyline, encodePolyline, simplify, type LatLon } from './polyline';

describe('polyline encoding', () => {
  it('matches the published reference example', () => {
    const pts: LatLon[] = [
      { lat: 38.5, lon: -120.2 },
      { lat: 40.7, lon: -120.95 },
      { lat: 43.252, lon: -126.453 },
    ];
    assert.equal(encodePolyline(pts), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), pts);
  });

  it('round-trips to the encoding precision', () => {
    const pts: LatLon[] = Array.from({ length: 200 }, (_, i) => ({ lat: 14.6 + i * 0.00013, lon: 121 - i * 0.00007 }));
    const back = decodePolyline(encodePolyline(pts));
    assert.equal(back.length, pts.length);
    back.forEach((p, i) => {
      assert.ok(Math.abs(p.lat - pts[i].lat) < 1e-5);
      assert.ok(Math.abs(p.lon - pts[i].lon) < 1e-5);
    });
  });
});

describe('simplify', () => {
  it('collapses a straight line to its endpoints', () => {
    const pts = Array.from({ length: 100 }, (_, i) => ({ lat: 14.6, lon: 121 + i * 0.0001 }));
    const s = simplify(pts, 5);
    assert.equal(s.length, 2);
    assert.deepEqual(s[0], pts[0]);
    assert.deepEqual(s[1], pts[99]);
  });

  it('keeps a real corner and every kept point comes from the input', () => {
    const pts: LatLon[] = [
      ...Array.from({ length: 50 }, (_, i) => ({ lat: 14.6, lon: 121 + i * 0.0001 })),
      ...Array.from({ length: 50 }, (_, i) => ({ lat: 14.6 + i * 0.0001, lon: 121.0049 })),
    ];
    const s = simplify(pts, 5);
    assert.ok(s.length >= 3 && s.length <= 6, `got ${s.length}`);
    assert.ok(s.some((p) => Math.abs(p.lat - 14.6) < 1e-9 && Math.abs(p.lon - 121.0049) < 1e-4));
    s.forEach((p) => assert.ok(pts.includes(p)));
  });

  it('shrinks a wobbly track a lot while staying within the tolerance', () => {
    const pts: LatLon[] = Array.from({ length: 1000 }, (_, i) => ({
      lat: 14.6 + Math.sin(i / 20) * 0.0004,
      lon: 121 + i * 0.00002,
    }));
    const tol = 5;
    const s = simplify(pts, tol);
    assert.ok(s.length < 200, `got ${s.length}`);
    // every original point is within tol (plus a little projection slack) of the simplified line
    const kx = 111320 * Math.cos((14.6 * Math.PI) / 180);
    const xy = (p: LatLon) => ({ x: p.lon * kx, y: p.lat * 111320 });
    for (const p of pts) {
      let best = Infinity;
      for (let i = 0; i < s.length - 1; i++) {
        const a = xy(s[i]), b = xy(s[i + 1]), q = xy(p);
        const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2));
        best = Math.min(best, Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy));
      }
      assert.ok(best <= tol * 1.05, `point off by ${best}`);
    }
  });

  it('handles tiny inputs', () => {
    assert.deepEqual(simplify([], 5), []);
    assert.equal(simplify([{ lat: 1, lon: 1 }], 5).length, 1);
    assert.equal(simplify([{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }], 5).length, 2);
  });
});
