import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bearing,
  closestOnPolyline,
  compassPoint,
  cumulativeDistances,
  distance,
  formatGridRef,
  gridToOsgb36,
  gridToWgs84,
  osgb36ToGrid,
  parseGridRef,
  pointAt,
  wgs84ToGrid,
} from '../../apps/edale-kinder/js/geo.js';

const near = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ''} expected ${expected} ± ${tolerance}, got ${actual}`);

test('transverse Mercator matches the Ordnance Survey worked example', () => {
  // OS "A guide to coordinate systems in Great Britain", annex C.
  const lat = 52 + 39 / 60 + 27.2531 / 3600;
  const lon = 1 + 43 / 60 + 4.5177 / 3600;
  const { easting, northing } = osgb36ToGrid(lat, lon);
  near(easting, 651409.903, 0.001, 'easting');
  near(northing, 313177.27, 0.001, 'northing');
  const back = gridToOsgb36(651409.903, 313177.27);
  near(back.lat, lat, 1e-8, 'lat');
  near(back.lon, lon, 1e-8, 'lon');
});

test('grid → WGS84 agrees with a published conversion of the Kinder Scout summit', () => {
  // hilltopviews.org.uk lists SK 08484 87560 as 53.384808, -1.87391.
  const { lat, lon } = gridToWgs84(408484, 387560);
  assert.ok(distance([lat, lon], [53.384808, -1.87391]) < 5);
});

test('WGS84 ⇄ grid round trip is millimetre-accurate', () => {
  for (const [e, n] of [
    [412283, 385995],
    [407899, 387062],
    [408485, 387563],
  ]) {
    const { lat, lon } = gridToWgs84(e, n);
    const g = wgs84ToGrid(lat, lon);
    near(g.easting, e, 0.01);
    near(g.northing, n, 0.01);
  }
});

test('grid references format and parse', () => {
  assert.equal(formatGridRef(408485, 387563, 10), 'SK 08485 87563');
  assert.equal(formatGridRef(408485, 387563, 8), 'SK 0848 8756');
  assert.equal(formatGridRef(408485, 387563, 6), 'SK 084 875');
  assert.equal(formatGridRef(651409, 313177, 6), 'TG 514 131');
  assert.equal(formatGridRef(-5, 100, 6), null);
  assert.deepEqual(parseGridRef('SK 08485 87563'), { easting: 408485, northing: 387563 });
  assert.deepEqual(parseGridRef('sk0848587563'), { easting: 408485, northing: 387563 });
  assert.deepEqual(parseGridRef('SK 109 868'), { easting: 410900, northing: 386800 });
  assert.deepEqual(parseGridRef('SK 109 868', { centre: true }), { easting: 410950, northing: 386850 });
  assert.deepEqual(parseGridRef('TG 51409 13177'), { easting: 651409, northing: 313177 });
  assert.throws(() => parseGridRef('SK 123'), /Invalid grid reference/);
  assert.throws(() => parseGridRef('hello'), /Invalid grid reference/);
});

test('distance and bearing', () => {
  near(distance([53, -1.8], [54, -1.8]), 111195, 50, 'one degree of latitude');
  near(bearing([53, -1.8], [54, -1.8]), 0, 1e-9);
  near(bearing([53, -1.8], [53, -1.7]), 90, 0.1);
  assert.equal(compassPoint(44), 'NE');
  assert.equal(compassPoint(359), 'N');
  assert.equal(compassPoint(-90), 'W');
});

test('closest point on a polyline and position along it', () => {
  const line = [
    [53.37, -1.82],
    [53.37, -1.81],
    [53.38, -1.81],
  ];
  const cum = cumulativeDistances(line);
  const hit = closestOnPolyline([53.3705, -1.815], line, cum);
  assert.equal(hit.index, 0);
  near(hit.t, 0.5, 0.01);
  near(hit.offset, 55.6, 1);
  near(hit.along, cum[1] / 2, 1);
  const mid = pointAt(line, cum, cum[1] + (cum[2] - cum[1]) / 2);
  near(mid[0], 53.375, 1e-9);
  near(mid[1], -1.81, 1e-9);
});
