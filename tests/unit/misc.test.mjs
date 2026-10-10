import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeToGpx, trackToGpx } from '../../apps/edale-kinder/js/gpx.js';
import { sunTimes } from '../../apps/edale-kinder/js/sun.js';
import { DemoWalk, walkingSpeed } from '../../apps/edale-kinder/js/simulator.js';
import {
  formatClock,
  formatDistance,
  formatDuration,
  formatHeight,
  formatSpeed,
  formatStopwatch,
} from '../../apps/edale-kinder/js/format.js';
import { loadRoute } from './helpers.mjs';

const route = loadRoute();

test('route GPX has every point and the visible waypoints', () => {
  const gpx = routeToGpx(route);
  assert.match(gpx, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<gpx version="1.1"/);
  assert.equal(gpx.match(/<trkpt /g).length, route.coordinates.length);
  assert.equal(gpx.match(/<wpt /g).length, route.waypoints.filter((w) => !w.hidden).length);
  assert.match(gpx, /<name>Kinder Scout summit<\/name>/);
});

test('track GPX escapes names and starts a new segment after a pause', () => {
  const t = Date.UTC(2026, 5, 6, 9, 0);
  const gpx = trackToGpx(
    [
      [53.36, -1.81, 250, t, 0],
      [53.361, -1.811, null, t + 60000, 0],
      [53.362, -1.812, 260, t + 900000, 1],
    ],
    'Walk <1> & "2"',
  );
  assert.match(gpx, /<name>Walk &lt;1&gt; &amp; &quot;2&quot;<\/name>/);
  assert.equal(gpx.match(/<trkseg>/g).length, 2);
  assert.match(gpx, /<trkpt lat="53.36" lon="-1.81"><ele>250<\/ele><time>2026-06-06T09:00:00.000Z<\/time><\/trkpt>/);
  assert.match(gpx, /<trkpt lat="53.361" lon="-1.811"><time>/);
});

test('sunrise and sunset over Kinder are within a few minutes of almanac times', () => {
  const minutes = (ms) => new Date(ms).getUTCHours() * 60 + new Date(ms).getUTCMinutes();
  // Almanac (UTC) for the Manchester area, a few km west: midsummer 03:39 / 20:41, midwinter 08:19 / 15:51.
  const summer = sunTimes(Date.UTC(2026, 5, 21, 12), 53.385, -1.874);
  assert.ok(Math.abs(minutes(summer.sunrise) - (3 * 60 + 39)) <= 5);
  assert.ok(Math.abs(minutes(summer.sunset) - (20 * 60 + 41)) <= 5);
  const winter = sunTimes(Date.UTC(2026, 11, 21, 12), 53.385, -1.874);
  assert.ok(Math.abs(minutes(winter.sunrise) - (8 * 60 + 19)) <= 5);
  assert.ok(Math.abs(minutes(winter.sunset) - (15 * 60 + 51)) <= 5);
  assert.deepEqual(sunTimes(Date.UTC(2026, 5, 21, 12), 80, 0), { sunrise: null, sunset: null }, 'midnight sun');
});

test('demo walk is repeatable and follows Tobler’s speeds', () => {
  const run = () => {
    const fixes = [];
    const demo = new DemoWalk(route, { seed: 3, startTime: 0, onFix: (f) => fixes.push(f) });
    for (let i = 0; i < 50; i++) demo.step(15000);
    return fixes;
  };
  assert.deepEqual(run(), run());
  const flat = walkingSpeed(0) * 3.6;
  assert.ok(flat > 4 && flat < 4.6, `flat ${flat} km/h`);
  assert.ok(walkingSpeed(0.3) < walkingSpeed(0) / 2, 'steep climbs are slow');
  assert.ok(walkingSpeed(-0.05) > walkingSpeed(0), 'gentle descents are quickest');
});

test('demo walk reaches the finish and stops', () => {
  let ended = false;
  const demo = new DemoWalk(route, { startTime: 0, onEnd: () => (ended = true) });
  for (let i = 0; i < 2000 && !ended; i++) demo.step(60000);
  assert.equal(ended, true);
  assert.equal(demo.along, route.stats.distance);
  const hours = demo.time / 3600000;
  assert.ok(hours > 2.5 && hours < 5, `demo took ${hours.toFixed(2)} h`);
});

test('formatting', () => {
  assert.equal(formatDistance(642), '640 m');
  assert.equal(formatDistance(949), '950 m');
  assert.equal(formatDistance(3449), '3.4 km');
  assert.equal(formatDistance(-120), '120 m');
  assert.equal(formatDistance(null), '–');
  assert.equal(formatHeight(635.6), '636 m');
  assert.equal(formatDuration(45 * 60000), '45 min');
  assert.equal(formatDuration(3 * 3600000 + 5 * 60000), '3 h 05 min');
  assert.equal(formatStopwatch(3723000), '1:02:03');
  assert.equal(formatSpeed(1), '3.6 km/h');
  assert.equal(formatClock(Date.UTC(2026, 6, 1, 12, 0)), '13:00', 'British Summer Time');
  assert.equal(formatClock(Date.UTC(2026, 11, 1, 12, 0)), '12:00', 'GMT');
});
