import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ACCURACY_M, OFF_ROUTE_M, Tracker } from '../../apps/edale-kinder/js/tracker.js';
import { hoursBetween, positionAt } from '../../apps/edale-kinder/js/route.js';
import { loadRoute, offset, walk } from './helpers.mjs';

const route = loadRoute();
const T0 = Date.UTC(2026, 5, 6, 8, 0);
const wp = (id) => route.waypoints.find((w) => w.id === id);

function startedTracker() {
  const tracker = new Tracker(route, { now: () => T0 });
  tracker.start(T0);
  return tracker;
}

test('follows a complete walk round the circuit, including the out-and-back summit detour', () => {
  const tracker = startedTracker();
  const fixes = walk(route, { start: T0 });
  let previous = null;
  let maxGap = 0;
  for (const fix of fixes) {
    tracker.addFix(fix);
    const { along } = tracker.state;
    maxGap = Math.max(maxGap, Math.abs(along - fix.along));
    if (previous != null) assert.ok(along >= previous - 15, `progress jumped back from ${previous} to ${along}`);
    previous = along;
  }
  assert.ok(maxGap < 25, `matched progress strayed ${maxGap.toFixed(1)} m from the true position`);
  const snap = tracker.snapshot(fixes.at(-1).timestamp);
  assert.ok(snap.toFinish < 25, `toFinish ${snap.toFinish}`);
  assert.ok(snap.progress > 0.99);
  assert.equal(snap.summitReached, true);
  assert.ok(snap.onRoute);
  const ratio = snap.walked / route.stats.distance;
  assert.ok(ratio > 0.97 && ratio < 1.08, `walked/route = ${ratio.toFixed(3)}`);
  assert.ok(Math.abs(snap.ascentDone - route.stats.ascent) < 5);
});

test('the first fix at the station maps to the start, not the finish', () => {
  const tracker = startedTracker();
  const [lat, lon] = positionAt(route, 30);
  tracker.addFix({ lat, lon, accuracy: 8, timestamp: T0 });
  assert.ok(tracker.state.along < 60, `along ${tracker.state.along}`);
  const snap = tracker.snapshot(T0);
  assert.ok(snap.toSummit > route.summit.along - 100);
});

test('the walk back down the village lane is matched to the return leg', () => {
  const tracker = startedTracker();
  for (const fix of walk(route, { from: route.stats.distance - 1500, to: route.stats.distance - 300, start: T0 })) tracker.addFix(fix);
  assert.ok(tracker.state.along > route.stats.distance - 400, `along ${tracker.state.along}`);
});

test('standing still does not add distance', () => {
  const tracker = startedTracker();
  const here = positionAt(route, 2000);
  for (let i = 0; i < 120; i++) {
    const [lat, lon] = offset(here, Math.sin(i) * 4, Math.cos(i * 1.7) * 4);
    tracker.addFix({ lat, lon, accuracy: 10, timestamp: T0 + i * 1000 });
  }
  const snap = tracker.snapshot(T0 + 120000);
  assert.ok(snap.walked < 10, `walked ${snap.walked}`);
  assert.equal(snap.movingMs, 0);
});

test('fixes that are too inaccurate are not recorded', () => {
  const tracker = startedTracker();
  const [lat, lon] = positionAt(route, 100);
  assert.equal(tracker.addFix({ lat, lon, accuracy: MAX_ACCURACY_M + 50, timestamp: T0 }), false);
  assert.equal(tracker.state.points.length, 0);
  assert.equal(tracker.state.lastFix.accuracy, MAX_ACCURACY_M + 50, 'still shown as the latest position');
});

test('flags leaving the route and says which way it is', () => {
  const tracker = startedTracker();
  const fixes = walk(route, { from: 0, to: 3000, start: T0, scatter: 0 });
  for (const fix of fixes) tracker.addFix(fix);
  // Step 150 m due south of the edge path near Crowden Tower.
  const crowden = wp('crowden-tower');
  const along = crowden.along - 150;
  const [lat, lon] = offset(positionAt(route, along), -150, 0);
  tracker.addFix({ lat, lon, accuracy: 8, timestamp: fixes.at(-1).timestamp + 600000 });
  let snap = tracker.snapshot();
  assert.equal(snap.offRoute, true);
  assert.ok(snap.offset > OFF_ROUTE_M);
  assert.ok(snap.rejoinBearing > 315 || snap.rejoinBearing < 45, `rejoin bearing ${snap.rejoinBearing}`);
  const [lat2, lon2] = positionAt(route, along + 20);
  tracker.addFix({ lat: lat2, lon: lon2, accuracy: 8, timestamp: fixes.at(-1).timestamp + 660000 });
  snap = tracker.snapshot();
  assert.equal(snap.offRoute, false);
  assert.equal(snap.onRoute, true);
});

test('skipping the summit detour picks the route up again beyond it', () => {
  const tracker = startedTracker();
  const kinderLow = wp('kinder-low');
  const back = wp('kinder-low-return');
  let fixes = walk(route, { from: kinderLow.along - 1500, to: kinderLow.along, start: T0 });
  for (const fix of fixes) tracker.addFix(fix);
  fixes = walk(route, { from: back.along + 20, to: back.along + 400, start: fixes.at(-1).timestamp + 20000 });
  for (const fix of fixes) tracker.addFix(fix);
  assert.ok(tracker.state.along > back.along + 300, `along ${tracker.state.along}`);
  const snap = tracker.snapshot();
  assert.equal(snap.summitReached, false);
  assert.ok(snap.toSummit < 0, 'summit is now behind');
  assert.equal(snap.next.id, 'jacobs-ladder');
});

test('pausing stops the clock and does not count the gap as walking', () => {
  const tracker = startedTracker();
  const [a, b] = walk(route, { from: 1000, to: 1020, start: T0 + 60000 });
  tracker.addFix(a);
  tracker.pause(T0 + 120000);
  assert.equal(tracker.addFix(b), false, 'ignored while paused');
  tracker.resume(T0 + 720000);
  const [lat, lon] = positionAt(route, 1500);
  tracker.addFix({ lat, lon, accuracy: 8, timestamp: T0 + 730000 });
  const snap = tracker.snapshot(T0 + 780000);
  assert.equal(snap.elapsedMs, 180000);
  assert.equal(snap.walked, 0, 'the jump across the pause is not counted');
  assert.equal(tracker.state.points.at(-1)[4], 1, 'a new track segment starts after the pause');
});

test('estimates use Naismith until there is enough of the walk to judge pace', () => {
  const tracker = startedTracker();
  const [lat, lon] = positionAt(route, 500);
  tracker.addFix({ lat, lon, accuracy: 8, timestamp: T0 });
  const snap = tracker.snapshot(T0);
  assert.equal(snap.paceFactor, 1);
  const expected = hoursBetween(route, tracker.state.along, route.stats.distance) * 3600000;
  assert.ok(Math.abs(snap.msToFinish - expected) < 1);
  assert.equal(snap.etaFinish, T0 + snap.msToFinish);
});

test('a slower walker gets later estimates', () => {
  const tracker = startedTracker();
  // Half Naismith pace on the walk in.
  for (const fix of walk(route, { from: 0, to: 2500, speed: 0.55, start: T0 })) tracker.addFix(fix);
  const snap = tracker.snapshot();
  assert.ok(snap.paceFactor > 1.3, `pace factor ${snap.paceFactor}`);
});

test('state survives a JSON round trip (page reload)', () => {
  const tracker = startedTracker();
  for (const fix of walk(route, { from: 0, to: 2000, start: T0 })) tracker.addFix(fix);
  const restored = new Tracker(route, { state: JSON.parse(JSON.stringify(tracker.toJSON())) });
  const at = T0 + 3600000;
  assert.deepEqual(restored.snapshot(at), tracker.snapshot(at));
});

test('finishing freezes the clock', () => {
  const tracker = startedTracker();
  for (const fix of walk(route, { from: 0, to: 400, start: T0 })) tracker.addFix(fix);
  tracker.finish(T0 + 600000);
  const snap = tracker.snapshot(T0 + 9999999);
  assert.equal(snap.status, 'finished');
  assert.equal(snap.elapsedMs, 600000);
  assert.equal(snap.etaFinish, null);
});
