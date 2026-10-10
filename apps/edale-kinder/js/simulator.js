/**
 * Demo walk: replays the route at an accelerated pace as if a GPS were attached, so the
 * tracking screen can be tried from home. Walking speed follows Tobler's hiking function.
 */
import { EARTH_RADIUS, toRad } from './geo.js';
import { elevationAt, positionAt } from './route.js';

const MAX_STEP_M = 20;

/** Small deterministic PRNG (mulberry32) so demo runs and tests are repeatable. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tobler's hiking function, eased a little for a laden walker. Returns m/s for a slope (rise/run). */
export function walkingSpeed(slope) {
  const kmh = 6 * Math.exp(-3.5 * Math.abs(slope + 0.05)) * 0.85;
  return Math.max(0.35, kmh / 3.6);
}

export class DemoWalk {
  /**
   * @param {object} route  built route
   * @param {object} options speedup (× real time), tickMs, seed, startTime (epoch ms), onFix(fix), onEnd()
   */
  constructor(route, { speedup = 120, tickMs = 200, seed = 7, startTime = Date.now(), onFix, onEnd } = {}) {
    this.route = route;
    this.speedup = speedup;
    this.tickMs = tickMs;
    this.random = seededRandom(seed);
    this.time = startTime;
    this.along = 0;
    this.onFix = onFix;
    this.onEnd = onEnd;
    this.timer = null;
  }

  get running() {
    return this.timer != null;
  }

  start() {
    if (this.timer != null) return;
    this.emit(0);
    this.timer = setInterval(() => this.step(this.tickMs * this.speedup), this.tickMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Advance simulated time by dtMs, emitting a fix at least every MAX_STEP_M like a real receiver would. */
  step(dtMs) {
    const total = this.route.stats.distance;
    let remaining = dtMs / 1000;
    while (remaining > 1e-9 && this.along < total) {
      const ahead = Math.min(total, this.along + 10);
      const slope = (elevationAt(this.route, ahead) - elevationAt(this.route, this.along)) / Math.max(1, ahead - this.along);
      const speed = walkingSpeed(slope);
      const ds = Math.min(MAX_STEP_M, speed * remaining, total - this.along);
      this.along += ds;
      this.time += (ds / speed) * 1000;
      remaining -= ds / speed;
      this.emit(speed);
    }
    if (this.along >= total) {
      this.stop();
      this.onEnd?.();
    }
  }

  emit(speed) {
    const [lat, lon] = positionAt(this.route, this.along);
    // A few metres of GPS scatter, like a real receiver.
    const north = (this.random() - 0.5) * 8;
    const east = (this.random() - 0.5) * 8;
    const fix = {
      lat: lat + (north / EARTH_RADIUS) * (180 / Math.PI),
      lon: lon + (east / (EARTH_RADIUS * Math.cos(toRad(lat)))) * (180 / Math.PI),
      accuracy: 5 + this.random() * 7,
      altitude: elevationAt(this.route, this.along) + (this.random() - 0.5) * 6,
      speed,
      timestamp: this.time,
    };
    this.onFix?.(fix);
    return fix;
  }
}
