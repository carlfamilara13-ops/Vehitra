import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { projectRoute, type SketchedPoint } from './sketch';

// Small straight-line track around Metro Manila-ish coordinates.
const SEG = [
  { lat: 14.5995, lon: 120.9842 },
  { lat: 14.6005, lon: 120.9852 },
  { lat: 14.6015, lon: 120.9862 },
];

const box = (pts: SketchedPoint[]) => ({
  minX: Math.min(...pts.map((p) => p.x)),
  maxX: Math.max(...pts.map((p) => p.x)),
  minY: Math.min(...pts.map((p) => p.y)),
  maxY: Math.max(...pts.map((p) => p.y)),
});

describe('offline route sketch projection', () => {
  it('projects one segment into the padded canvas', () => {
    const sk = projectRoute([SEG], { width: 100, height: 100, padding: 10 });
    assert.equal(sk.isEmpty, false);
    assert.equal(sk.usablePoints, 3);
    assert.equal(sk.segments.length, 1);
    assert.equal(sk.segments[0].length, 3);

    const b = box(sk.segments[0]);
    assert.ok(b.minX >= 10 && b.maxX <= 90, 'x inside padded box');
    assert.ok(b.minY >= 10 && b.maxY <= 90, 'y inside padded box');
    // north is up (y grows downward), east is right (x grows rightward)
    assert.ok(sk.segments[0][2].y < sk.segments[0][0].y);
    assert.ok(sk.segments[0][2].x > sk.segments[0][0].x);
  });

  it('keeps both axes at the same ground scale (x is cos-corrected)', () => {
    const sk = projectRoute([SEG], { width: 200, height: 200, padding: 0 });
    const [a, , c] = sk.segments[0];
    const dx = c.x - a.x;
    const dy = a.y - c.y;
    // The input spans equal degrees of latitude and longitude, so with one shared ground scale
    // the screen ratio dx/dy must equal cos(mid latitude)   the projection's lon correction.
    const midLat = ((14.5995 + 14.6015) / 2) * (Math.PI / 180);
    const expectedRatio = Math.cos(midLat);
    assert.ok(
      Math.abs(dx / dy - expectedRatio) < 0.005,
      `dx/dy=${(dx / dy).toFixed(5)} expected≈${expectedRatio.toFixed(5)}`,
    );
    assert.ok(dy > 0 && dx > 0);
  });

  it('fits multiple segments together in one coordinate frame', () => {
    const other = [
      { lat: 14.5, lon: 120.9 },
      { lat: 14.55, lon: 120.92 },
    ];
    const sk = projectRoute([SEG, other], { width: 120, height: 80, padding: 4 });
    assert.equal(sk.segments.length, 2);
    assert.equal(sk.usablePoints, 5);
    const all = [...sk.segments[0], ...sk.segments[1]];
    const b = box(all);
    assert.ok(b.minX >= 4 && b.maxX <= 116);
    assert.ok(b.minY >= 4 && b.maxY <= 76);
    // the far-away southern segment must not be clipped into the northern one
    assert.ok(b.maxY - b.minY > 20);
  });

  it('reports isEmpty for empty input instead of drawing a dot', () => {
    const sk = projectRoute([], { width: 100, height: 100 });
    assert.equal(sk.isEmpty, true);
    assert.equal(sk.usablePoints, 0);
    assert.deepEqual(sk.segments, []);
  });

  it('reports isEmpty for a route whose points are all identical', () => {
    const same = [SEG[0], SEG[0], SEG[0]];
    const sk = projectRoute([same], { width: 100, height: 100 });
    assert.equal(sk.isEmpty, true);
    assert.equal(sk.usablePoints, 3);
  });

  it('skips non-finite coordinates and empty segments', () => {
    const bad = [
      { lat: 14.6, lon: 120.98 },
      { lat: Number.NaN, lon: 120.98 },
      { lat: 95, lon: 120.98 }, // out of range
      { lat: 14.61, lon: 120.99 },
    ];
    const sk = projectRoute([[], bad], { width: 100, height: 100 });
    assert.equal(sk.isEmpty, false);
    assert.equal(sk.usablePoints, 2);
    assert.equal(sk.segments.length, 1); // empty segment dropped
    assert.equal(sk.segments[0].length, 2);
  });

  it('defaults padding and clamps degenerate sizes', () => {
    const sk = projectRoute([SEG], { width: 0, height: 0 });
    assert.equal(sk.isEmpty, false);
    for (const seg of sk.segments) {
      for (const p of seg) {
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      }
    }
    const noPad = projectRoute([SEG], { width: 50, height: 50, padding: 0 });
    assert.ok(noPad.segments[0].length === 3);
  });
});
