import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ascentTo,
  descentTo,
  elevationAt,
  hoursBetween,
  naismithHours,
  nextWaypoint,
  previousWaypoint,
  sectionAt,
} from '../../apps/edale-kinder/js/route.js';
import { build, serialise } from '../../tools/build-route.mjs';
import { loadRoute } from './helpers.mjs';

const route = loadRoute();

test('committed route.json matches tools/route-source.mjs', () => {
  const committed = readFileSync(new URL('../../apps/edale-kinder/data/route.json', import.meta.url), 'utf8');
  assert.equal(committed, serialise(build()), 'run `npm run build:route`');
});

test('route statistics are plausible for the Kinder circuit', () => {
  const { distance, ascent, descent, maxEle, minEle } = route.stats;
  assert.ok(distance > 12500 && distance < 14500, `distance ${distance}`);
  assert.ok(Math.abs(ascent - descent) < 1e-9, 'a circuit climbs as much as it descends');
  assert.ok(ascent > 400 && ascent < 700, `ascent ${ascent}`);
  assert.equal(maxEle, 636);
  assert.equal(minEle, 245);
  assert.equal(route.summit.id, 'summit');
  assert.ok(route.summit.along > 6000 && route.summit.along < 7000);
});

test('the route starts and finishes at Edale station', () => {
  const first = route.waypoints[0];
  const last = route.waypoints.at(-1);
  assert.equal(first.id, 'start');
  assert.equal(first.along, 0);
  assert.equal(last.id, 'finish');
  assert.equal(last.along, route.stats.distance);
  assert.deepEqual([first.lat, first.lon], [last.lat, last.lon]);
});

test('waypoints are in walking order and carry grid references', () => {
  for (let i = 1; i < route.waypoints.length; i++) assert.ok(route.waypoints[i].along > route.waypoints[i - 1].along);
  for (const w of route.waypoints) assert.match(w.gridRef, /^SK \d{4} \d{4}$/);
  const kinderLow = route.waypoints.find((w) => w.id === 'kinder-low');
  assert.equal(kinderLow.gridRef, 'SK 0789 8706');
});

test('climb, height and time along the route', () => {
  assert.equal(ascentTo(route, 0), 0);
  assert.ok(Math.abs(ascentTo(route, route.stats.distance) - route.stats.ascent) < 1e-9);
  assert.ok(Math.abs(descentTo(route, route.stats.distance) - route.stats.descent) < 1e-9);
  let prev = 0;
  for (let d = 0; d <= route.stats.distance; d += 100) {
    const a = ascentTo(route, d);
    assert.ok(a >= prev - 1e-9, 'ascent never decreases');
    prev = a;
  }
  assert.equal(elevationAt(route, route.summit.along), 636);
  assert.ok(Math.abs(hoursBetween(route, 0, route.stats.distance) - route.stats.naismithHours) < 1e-9);
  assert.equal(hoursBetween(route, 5000, 4000), 0);
  assert.equal(naismithHours(5000, 600), 2);
});

test('next and previous waypoint lookups', () => {
  assert.equal(nextWaypoint(route, 0).id, 'nags-head');
  assert.equal(previousWaypoint(route, 0).id, 'start');
  const top = route.waypoints.find((w) => w.id === 'grindsbrook-top');
  assert.equal(nextWaypoint(route, top.along - 100).id, 'grindsbrook-top');
  assert.equal(nextWaypoint(route, route.stats.distance), null);
});

test('the summit detour is flagged as a faint path', () => {
  assert.equal(sectionAt(route, route.summit.along)?.style, 'faint');
  assert.equal(sectionAt(route, 1000), null);
});
