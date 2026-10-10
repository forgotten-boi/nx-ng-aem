import { readFileSync } from 'node:fs';
import { buildRoute, positionAt } from '../../apps/edale-kinder/js/route.js';
import { seededRandom } from '../../apps/edale-kinder/js/simulator.js';
import { EARTH_RADIUS } from '../../apps/edale-kinder/js/geo.js';

export const routeData = JSON.parse(readFileSync(new URL('../../apps/edale-kinder/data/route.json', import.meta.url), 'utf8'));
export const loadRoute = () => buildRoute(structuredClone(routeData));

/** Move a point by metres north/east. */
export function offset([lat, lon], north, east) {
  return [
    lat + (north / EARTH_RADIUS) * (180 / Math.PI),
    lon + (east / (EARTH_RADIUS * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI),
  ];
}

/** Fixes every `step` metres along the route between two distances, walking at `speed` m/s with a little GPS scatter. */
export function walk(
  route,
  { from = 0, to = route.stats.distance, step = 20, speed = 1.2, start = Date.UTC(2026, 5, 6, 8, 0), seed = 1, scatter = 4 } = {},
) {
  const random = seededRandom(seed);
  const fixes = [];
  for (let d = from, t = start; d <= to + 1e-6; d += step, t += (step / speed) * 1000) {
    const [lat, lon] = offset(positionAt(route, Math.min(d, to)), (random() - 0.5) * 2 * scatter, (random() - 0.5) * 2 * scatter);
    fixes.push({ lat, lon, accuracy: 8, altitude: null, speed, timestamp: t, along: Math.min(d, to) });
  }
  return fixes;
}
