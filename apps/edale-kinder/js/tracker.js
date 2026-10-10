/**
 * Live tracking: turns a stream of position fixes into progress along the route.
 * Pure logic — no DOM, no geolocation — so it can be unit tested and driven by the demo walk.
 *
 * A fix is { lat, lon, accuracy, altitude?, speed?, timestamp } (metres, m/s, epoch ms).
 */
import { bearing, closestOnPolyline, distance, formatGridRef, segmentIndexAt, wgs84ToGrid } from './geo.js';
import { ascentTo, elevationAt, hoursBetween, nextWaypoint, previousWaypoint, sectionAt } from './route.js';

export const OFF_ROUTE_M = 60; // further than this from the line counts as off route
export const MAX_ACCURACY_M = 100; // fixes less accurate than this are shown but not recorded
const LOST_M = 500; // beyond this, progress along the route is not updated at all
const MIN_MOVING_SPEED = 0.3; // m/s — slower intervals count as stopped
const MAX_WALKING_SPEED = 10; // m/s — faster than this is a GPS jump (or a car), not walking
const MAX_GAP_MS = 120000; // a longer gap between fixes counts as stopped
const SUMMIT_RADIUS_M = 40;
const SPEED_WINDOW_MS = 90000;

export function emptyState() {
  return {
    status: 'idle', // idle | tracking | paused | finished
    startedAt: null,
    pausedAt: null,
    pausedMs: 0,
    endedAt: null,
    // Recorded fixes: [lat, lon, altitude|null, timestamp, startsNewSegment(0|1)]
    points: [],
    walked: 0,
    movingMs: 0,
    along: null, // matched distance along the route, metres
    startAlong: null,
    maxAlong: null,
    offset: null, // metres between the latest fix and the route line
    nearest: null, // closest point on the route to the latest fix
    summitAt: null,
    breakNext: false,
    lastFix: null,
  };
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

export class Tracker {
  constructor(route, { now = () => Date.now(), state } = {}) {
    this.route = route;
    this.now = now;
    this.state = { ...emptyState(), ...state };
  }

  start(at = this.now()) {
    const lastFix = this.state.lastFix;
    this.state = { ...emptyState(), status: 'tracking', startedAt: at, lastFix };
  }

  pause(at = this.now()) {
    if (this.state.status !== 'tracking') return;
    this.state.status = 'paused';
    this.state.pausedAt = at;
  }

  resume(at = this.now()) {
    const s = this.state;
    if (s.status !== 'paused') return;
    s.pausedMs += Math.max(0, at - s.pausedAt);
    s.pausedAt = null;
    s.status = 'tracking';
    s.breakNext = true; // don't count the gap as walking
  }

  finish(at = this.now()) {
    const s = this.state;
    if (s.status === 'paused') this.resume(at);
    if (s.status !== 'tracking') return;
    s.status = 'finished';
    s.endedAt = at;
  }

  reset() {
    this.state = { ...emptyState(), lastFix: this.state.lastFix };
  }

  /** Feed one fix. Returns true if it was recorded in the track. */
  addFix(fix) {
    const s = this.state;
    s.lastFix = fix;
    if (s.status !== 'tracking') return false;
    if (!(fix.accuracy <= MAX_ACCURACY_M)) return false;
    const p = [fix.lat, fix.lon];
    this.#match(p, fix.timestamp);

    const last = s.points[s.points.length - 1];
    if (last && !s.breakNext) {
      const d = distance([last[0], last[1]], p);
      // Ignore GPS wander while standing still: only record once we've clearly moved.
      if (d < Math.max(5, Math.min(fix.accuracy, 25))) return false;
      const dt = fix.timestamp - last[3];
      const v = dt > 0 ? d / (dt / 1000) : Infinity;
      if (dt <= MAX_GAP_MS && v >= MIN_MOVING_SPEED && v <= MAX_WALKING_SPEED) s.movingMs += dt;
      s.walked += d;
    }
    s.points.push([
      round6(fix.lat),
      round6(fix.lon),
      fix.altitude == null ? null : Math.round(fix.altitude),
      fix.timestamp,
      s.breakNext && last ? 1 : 0,
    ]);
    s.breakNext = false;
    return true;
  }

  #match(p, timestamp) {
    const s = this.state;
    const { coords, cum, summit } = this.route;
    let m;
    if (s.along == null) {
      // First fix: nearest point. The lane through Edale is walked out and back, so prefer the earlier pass.
      m = closestOnPolyline(p, coords, cum, { score: (offset, along) => offset + along * 0.002 });
    } else {
      // Search a window around the last match. Moving backwards is penalised much more than forwards so
      // out-and-back stretches (the summit detour, the village lane) resolve to the leg being walked.
      const last = s.along;
      const score = (offset, along) => offset + (along < last ? (last - along) * 0.5 : (along - last) * 0.01);
      m = closestOnPolyline(p, coords, cum, {
        from: segmentIndexAt(cum, last - 250),
        to: segmentIndexAt(cum, last + 2500) + 1,
        score,
      });
      if (m.offset > OFF_ROUTE_M) {
        // Rejoined somewhere else — a shortcut, skipped the summit detour, or started part-way round.
        const g = closestOnPolyline(p, coords, cum, { score: (offset, along) => offset + Math.abs(along - last) * 0.002 });
        if (g.offset + 25 < m.offset) m = g;
      }
    }
    s.offset = m.offset;
    s.nearest = m.point;
    if (m.offset > LOST_M) return;
    s.along = m.along;
    if (s.startAlong == null) s.startAlong = m.along;
    s.maxAlong = Math.max(s.maxAlong ?? m.along, m.along);
    if (summit && s.summitAt == null && distance(p, [summit.lat, summit.lon]) <= SUMMIT_RADIUS_M) s.summitAt = timestamp;
  }

  /** Current speed in m/s, or null when unknown or implausible for walking. */
  #speed(at) {
    const v = this.#rawSpeed(at);
    return v != null && v <= MAX_WALKING_SPEED ? v : null;
  }

  /** The receiver's own speed if it gives one, else from recent fixes. */
  #rawSpeed(at) {
    const s = this.state;
    const fix = s.lastFix;
    if (fix && Number.isFinite(fix.speed) && fix.speed >= 0 && at - fix.timestamp < SPEED_WINDOW_MS) return fix.speed;
    const pts = s.points;
    if (pts.length < 2) return null;
    const end = pts[pts.length - 1];
    if (at - end[3] > SPEED_WINDOW_MS) return 0;
    let d = 0;
    let i = pts.length - 1;
    while (i > 0 && end[3] - pts[i - 1][3] <= SPEED_WINDOW_MS && !pts[i][4]) {
      d += distance(pts[i - 1], pts[i]);
      i--;
    }
    const dt = (end[3] - pts[i][3]) / 1000;
    return dt > 0 ? d / dt : null;
  }

  snapshot(at = this.now()) {
    const s = this.state;
    const r = this.route;
    const total = r.stats.distance;
    const summit = r.summit;
    const fix = s.lastFix;
    const grid = fix ? wgs84ToGrid(fix.lat, fix.lon) : null;
    const base = {
      status: s.status,
      lastFix: fix,
      accuracy: fix?.accuracy ?? null,
      gridRef: grid ? formatGridRef(grid.easting, grid.northing, 8) : null,
      gpsAltitude: fix?.altitude ?? null,
      distanceToStart: fix ? distance([fix.lat, fix.lon], r.coords[0]) : null,
      points: s.points.length,
    };
    if (s.status === 'idle') return base;

    const clock = s.endedAt ?? (s.status === 'paused' ? s.pausedAt : at);
    const elapsedMs = Math.max(0, clock - s.startedAt - s.pausedMs);
    const along = s.along;
    const offRoute = s.offset != null && s.offset > OFF_ROUTE_M;

    // How this walker compares with Naismith, once there is enough of the walk to judge.
    let paceFactor = 1;
    if (along != null && s.movingMs >= 10 * 60000 && along - s.startAlong >= 500) {
      const expectedMs = hoursBetween(r, s.startAlong, along) * 3600000;
      if (expectedMs > 0) paceFactor = Math.min(2.5, Math.max(0.5, s.movingMs / expectedMs));
    }
    const msTo = (target) => (along == null || target <= along ? 0 : hoursBetween(r, along, target) * paceFactor * 3600000);
    const finished = s.status === 'finished';

    const out = {
      ...base,
      elapsedMs,
      movingMs: s.movingMs,
      walked: s.walked,
      along,
      progress: along == null ? 0 : Math.min(1, along / total),
      offset: s.offset,
      offRoute,
      onRoute: s.offset != null && !offRoute,
      lost: s.offset != null && s.offset > LOST_M,
      speed: finished ? null : this.#speed(at),
      avgSpeed: s.movingMs > 0 ? s.walked / (s.movingMs / 1000) : null,
      paceFactor,
      summitReached: s.summitAt != null,
      summitAt: s.summitAt,
    };
    if (offRoute && s.nearest && fix) {
      out.rejoinBearing = bearing([fix.lat, fix.lon], s.nearest);
    }
    if (along == null) return out;

    out.toSummit = summit.along - along; // negative once past it
    out.toFinish = Math.max(0, total - along);
    out.elevation = out.onRoute ? elevationAt(r, along) : (fix?.altitude ?? elevationAt(r, along));
    out.ascentDone = Math.max(0, ascentTo(r, along) - ascentTo(r, s.startAlong));
    out.ascentToSummit = Math.max(0, ascentTo(r, summit.along) - ascentTo(r, along));
    out.ascentRemaining = Math.max(0, r.stats.ascent - ascentTo(r, along));
    out.msToSummit = msTo(summit.along);
    out.msToFinish = msTo(total);
    out.etaSummit = finished || out.toSummit <= 0 ? null : at + out.msToSummit;
    out.etaFinish = finished ? null : at + out.msToFinish;
    const next = nextWaypoint(r, along);
    if (next) out.next = { id: next.id, name: next.name, distance: next.along - along, ele: next.ele };
    const prev = previousWaypoint(r, along);
    if (prev?.directions && next) out.directions = { from: prev.name, text: prev.directions };
    out.section = sectionAt(r, along);
    return out;
  }

  toJSON() {
    return this.state;
  }
}
