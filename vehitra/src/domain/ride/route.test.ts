import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROCESS } from '../../config/tracking';
import { decodePolyline } from './polyline';
import { newRideState, processFixes } from './processFixes';
import { buildRoute, singlePolyline, type RoutePoint } from './route';
import type { Fix } from './types';

const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);
const LAT = 14.6;
const LON = 121.0;
const K = 111320 * Math.cos((LAT * Math.PI) / 180);
const OPTS = { maxAccuracyM: 25, breakGapS: 30, toleranceM: 5, precision: 5, minSegmentPoints: 2 };

const pt = (tSec: number, xM: number, acc: number | null = 8, dLat = 0): RoutePoint => ({
  ts: T0 + tSec * 1000, lat: LAT + dLat, lon: LON + xM / K, accuracy: acc,
});
const line = (n: number, t0: number, x0: number) => Array.from({ length: n }, (_, i) => pt(t0 + i, x0 + i * 1.4));
const xOf = (lon: number) => (lon - LON) * K;

describe('buildRoute', () => {
  it('splits at a gap and never draws a leg across it', () => {
    const r = buildRoute([...line(40, 0, 0), ...line(40, 200, 500)], OPTS);
    assert.equal(r.segments.length, 2);
    const a = decodePolyline(r.segments[0].polyline);
    const b = decodePolyline(r.segments[1].polyline);
    assert.ok(Math.max(...a.map((p) => xOf(p.lon))) < 60, 'first piece stays before the gap');
    assert.ok(Math.min(...b.map((p) => xOf(p.lon))) > 499, 'second piece starts after the gap');
    assert.equal(r.segments[0].endTs, T0 + 39_000);
    assert.equal(r.segments[1].startTs, T0 + 200_000);
  });

  it('ignores low-accuracy and unknown-accuracy fixes (no spikes in the route)', () => {
    const pts = [...line(20, 0, 0), pt(20.5, 28, 90, 0.003), pt(20.7, 29, null, -0.003), ...line(20, 21, 29)];
    const r = buildRoute(pts, OPTS);
    assert.equal(r.segments.length, 1);
    assert.equal(r.usablePoints, 40);
    decodePolyline(r.segments[0].polyline).forEach((p) => assert.ok(Math.abs(p.lat - LAT) < 1e-4, 'spike leaked into the route'));
  });

  it('a long stretch without usable fixes also splits the route, because no position is trusted there', () => {
    const poor = Array.from({ length: 50 }, (_, i) => pt(20 + i, 30 + i * 1.4, 80));
    const r = buildRoute([...line(20, 0, 0), ...poor, ...line(20, 75, 120)], OPTS);
    assert.equal(r.segments.length, 2);
  });

  it('pieces with fewer than two usable points are dropped and counted', () => {
    const r = buildRoute([...line(30, 0, 0), pt(100, 500)], OPTS);
    assert.equal(r.segments.length, 1);
    assert.equal(r.droppedSegments, 1);
  });

  it('no usable point gives an empty route', () => {
    const r = buildRoute(Array.from({ length: 30 }, (_, i) => pt(i, i, 70)), OPTS);
    assert.deepEqual({ s: r.segments.length, d: r.droppedSegments, u: r.usablePoints }, { s: 0, d: 0, u: 0 });
  });

  it('simplifies each piece independently and keeps its endpoints', () => {
    const r = buildRoute(line(300, 0, 0), OPTS);
    assert.equal(r.segments.length, 1);
    const pts = decodePolyline(r.segments[0].polyline);
    assert.ok(pts.length >= 2 && pts.length < 30, `got ${pts.length}`);
    assert.ok(Math.abs(xOf(pts[pts.length - 1].lon) - 299 * 1.4) < 1);
  });
});

describe('singlePolyline (the one-piece column the cloud has today)', () => {
  it('is set only for a complete one-piece route', () => {
    assert.ok(singlePolyline(buildRoute(line(50, 0, 0), OPTS)));
    assert.equal(singlePolyline(buildRoute([...line(40, 0, 0), ...line(40, 200, 500)], OPTS)), null);
    assert.equal(singlePolyline(buildRoute([...line(30, 0, 0), pt(100, 500)], OPTS)), null);
    assert.equal(singlePolyline(buildRoute([], OPTS)), null);
  });
});

describe('route, distance and tracked time agree', () => {
  it('processFixes reports an untracked gap exactly where buildRoute breaks the route', () => {
    const asFix = (p: RoutePoint): Fix => ({ timestamp: p.ts, lat: p.lat, lon: p.lon, accuracy: p.accuracy, speed: 1.4, altitude: null, heading: null });
    const poor = Array.from({ length: 50 }, (_, i) => pt(20 + i, 30 + i * 1.4, 80));
    const pts = [...line(20, 0, 0), ...poor, ...line(20, 75, 120)];
    const res = processFixes(newRideState(T0), pts.map(asFix), T0 + 200_000, PROCESS);
    const route = buildRoute(pts, OPTS);
    assert.ok(res.state.untrackedGapS > 30);
    assert.equal(route.segments.length, 2);
    // the straight-line stretch across the gap is not in the distance
    assert.ok(res.state.distanceM < 19 * 1.4 + 19 * 1.4 + 10, `distance ${res.state.distanceM}`);
  });
});
