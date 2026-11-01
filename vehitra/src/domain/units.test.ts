import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceUnit,
  formatDistanceKm,
  formatDistanceM,
  formatSpeedMs,
  odometerInputLabel,
  speedUnit,
} from './units';

describe('unit display formatting', () => {
  it('labels the right unit per system', () => {
    assert.equal(distanceUnit('metric'), 'km');
    assert.equal(distanceUnit('imperial'), 'mi');
    assert.equal(speedUnit('metric'), 'km/h');
    assert.equal(speedUnit('imperial'), 'mph');
  });

  it('formats distances from metres with at most one decimal', () => {
    assert.equal(formatDistanceM(0, 'metric'), '0 km');
    assert.equal(formatDistanceM(999, 'metric'), '1 km'); // rounds through oneDecimal
    assert.equal(formatDistanceM(1234, 'metric'), '1.2 km');
    assert.equal(formatDistanceM(1000, 'metric', { decimals: 0 }), '1 km');
    assert.equal(formatDistanceM(1234, 'metric', { decimals: 0 }), '1 km');
    assert.equal(formatDistanceM(1234, 'metric', { decimals: 2 }), '1.23 km');
    assert.equal(formatDistanceM(10049, 'metric', { decimals: 2 }), '10.05 km');
  });

  it('never leaves a trailing .0', () => {
    assert.equal(formatDistanceM(10000, 'metric'), '10 km');
    assert.equal(formatDistanceM(15000, 'metric'), '15 km');
    assert.equal(formatDistanceM(10500, 'metric'), '10.5 km');
  });

  it('converts to miles for imperial display', () => {
    // 1609.344 m = exactly 1 mile
    assert.equal(formatDistanceM(1609.344, 'imperial'), '1 mi');
    assert.equal(formatDistanceM(804.672, 'imperial'), '0.5 mi');
    assert.equal(formatDistanceM(1000, 'imperial'), '0.6 mi');
  });

  it('handles non-finite input', () => {
    assert.equal(formatDistanceM(Number.NaN, 'metric'), '—');
    assert.equal(formatDistanceM(Number.POSITIVE_INFINITY, 'metric'), '—');
    assert.equal(formatDistanceKm(Number.NaN, 'metric'), '—');
    assert.equal(formatSpeedMs(null, 'metric'), '—');
    assert.equal(formatSpeedMs(undefined, 'imperial'), '—');
    assert.equal(formatSpeedMs(Number.NaN, 'metric'), '—');
  });

  it('formats kilometre inputs (odometers/intervals) through the same path', () => {
    assert.equal(formatDistanceKm(1500, 'metric'), '1500 km');
    assert.equal(formatDistanceKm(1.5, 'metric'), '1.5 km');
    assert.equal(formatDistanceKm(0, 'metric'), '0 km');
    // 1 mile exactly
    assert.equal(formatDistanceKm(1.609344, 'imperial'), '1 mi');
  });

  it('converts speeds correctly in both systems', () => {
    assert.equal(formatSpeedMs(10, 'metric'), '36 km/h');
    assert.equal(formatSpeedMs(0, 'metric'), '0 km/h');
    assert.equal(formatSpeedMs(10, 'imperial'), '22.4 mph');
    assert.equal(formatSpeedMs(0, 'imperial'), '0 mph');
    // the two systems must describe the same speed
    assert.match(formatSpeedMs(10, 'imperial'), /^22\.4 mph$/);
  });

  it('keeps odometer input in kilometres for both systems', () => {
    assert.equal(odometerInputLabel('metric'), 'Odometer (km)');
    assert.match(odometerInputLabel('imperial'), /stored as km/);
  });
});
