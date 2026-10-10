/**
 * Route model: distances, elevation and timing derived from data/route.json.
 */
import { cumulativeDistances, pointAt, segmentIndexAt, valueAt } from './geo.js';

/** Naismith's rule: 1 hour per 5 km plus 1 hour per 600 m of ascent. Returns hours. */
export function naismithHours(distanceM, ascentM) {
  return distanceM / 5000 + Math.max(0, ascentM) / 600;
}

export function buildRoute(data) {
  const coords = data.coordinates.map(([lat, lon]) => [lat, lon]);
  const ele = data.coordinates.map((c) => c[2]);
  const cum = cumulativeDistances(coords);
  // Running totals of climb and drop so any stretch can be measured without a loop.
  const up = [0];
  const down = [0];
  for (let i = 1; i < ele.length; i++) {
    const d = ele[i] - ele[i - 1];
    up[i] = up[i - 1] + Math.max(d, 0);
    down[i] = down[i - 1] + Math.max(-d, 0);
  }
  const distance = cum[cum.length - 1];
  const waypoints = data.waypoints.map((w) => ({ ...w, along: cum[w.index] }));
  return {
    ...data,
    coords,
    ele,
    cum,
    up,
    down,
    waypoints,
    summit: waypoints.find((w) => w.kind === 'summit'),
    stats: {
      distance,
      ascent: up[up.length - 1],
      descent: down[down.length - 1],
      maxEle: Math.max(...ele),
      minEle: Math.min(...ele),
      naismithHours: naismithHours(distance, up[up.length - 1]),
    },
  };
}

function climbTo(route, series, d) {
  const { cum, ele } = route;
  const i = segmentIndexAt(cum, d);
  const len = cum[i + 1] - cum[i];
  const t = len > 0 ? Math.min(1, Math.max(0, (d - cum[i]) / len)) : 0;
  const step = (ele[i + 1] ?? ele[i]) - ele[i];
  return series[i] + Math.max(series === route.up ? step : -step, 0) * t;
}

/** Metres climbed from the start to distance-along d. */
export const ascentTo = (route, d) => climbTo(route, route.up, d);

/** Metres descended from the start to distance-along d. */
export const descentTo = (route, d) => climbTo(route, route.down, d);

/** Route height (m) at distance-along d. */
export const elevationAt = (route, d) => valueAt(route.ele, route.cum, d);

/** [lat, lon] at distance-along d. */
export const positionAt = (route, d) => pointAt(route.coords, route.cum, d);

/** Naismith hours to walk the route from distance-along a to b. */
export function hoursBetween(route, a, b) {
  if (b <= a) return 0;
  return naismithHours(b - a, ascentTo(route, b) - ascentTo(route, a));
}

/** First visible-or-not waypoint strictly ahead of distance-along d (with a small tolerance). */
export function nextWaypoint(route, d, tolerance = 15) {
  return route.waypoints.find((w) => w.along > d + tolerance) ?? null;
}

/** The last waypoint at or behind distance-along d. */
export function previousWaypoint(route, d, tolerance = 15) {
  let prev = null;
  for (const w of route.waypoints) {
    if (w.along <= d + tolerance) prev = w;
    else break;
  }
  return prev;
}

/** Style of the stretch containing distance-along d ('faint' etc.), or null for the normal path. */
export function sectionAt(route, d) {
  for (const s of route.sections ?? []) {
    if (d >= route.cum[s.from] && d <= route.cum[s.to]) return s;
  }
  return null;
}
