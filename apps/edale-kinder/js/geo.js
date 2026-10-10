/**
 * Geodesy helpers shared by the browser app and tools/build-route.mjs.
 * Points are [lat, lon] arrays in decimal degrees (WGS84) unless stated otherwise.
 */

export const EARTH_RADIUS = 6371008.8; // mean radius in metres

const RAD = Math.PI / 180;
export const toRad = (deg) => deg * RAD;
export const toDeg = (rad) => rad / RAD;

/** Great-circle (haversine) distance in metres. */
export function distance(a, b) {
  const φ1 = a[0] * RAD;
  const φ2 = b[0] * RAD;
  const dφ = φ2 - φ1;
  const dλ = (b[1] - a[1]) * RAD;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b in degrees clockwise from north (0–360). */
export function bearing(a, b) {
  const φ1 = a[0] * RAD;
  const φ2 = b[0] * RAD;
  const dλ = (b[1] - a[1]) * RAD;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const COMPASS_WORDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const octant = (deg) => Math.round((((deg % 360) + 360) % 360) / 45) % 8;
/** Eight-point compass abbreviation for a bearing in degrees: 'NE'. */
export const compassPoint = (deg) => COMPASS[octant(deg)];
/** Eight-point compass direction in words: 'north-east'. */
export const compassWord = (deg) => COMPASS_WORDS[octant(deg)];

/** Linear interpolation between two points (fine over a few hundred metres). */
export function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** cum[i] = metres along the polyline from coords[0] to coords[i]. */
export function cumulativeDistances(coords) {
  const cum = new Array(coords.length);
  cum[0] = 0;
  for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + distance(coords[i - 1], coords[i]);
  return cum;
}

/** Index i of the segment [i, i+1] that contains distance-along d (clamped to the line). */
export function segmentIndexAt(cum, d) {
  let lo = 0;
  let hi = cum.length - 1;
  if (d <= 0) return 0;
  if (d >= cum[hi]) return Math.max(0, hi - 1);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Position at distance-along d. */
export function pointAt(coords, cum, d) {
  const i = segmentIndexAt(cum, d);
  const len = cum[i + 1] - cum[i];
  const t = len > 0 ? Math.min(1, Math.max(0, (d - cum[i]) / len)) : 0;
  return lerp(coords[i], coords[i + 1] ?? coords[i], t);
}

/** Value of a per-vertex series (e.g. elevation) at distance-along d. */
export function valueAt(values, cum, d) {
  const i = segmentIndexAt(cum, d);
  const len = cum[i + 1] - cum[i];
  const t = len > 0 ? Math.min(1, Math.max(0, (d - cum[i]) / len)) : 0;
  return values[i] + ((values[i + 1] ?? values[i]) - values[i]) * t;
}

/**
 * Closest point to p on the polyline segments between vertex indices [from, to].
 * `score(offset, along)` ranks candidates (lowest wins); by default the nearest one wins.
 * Uses a local equirectangular projection centred on p, accurate to well under 1 %
 * over the few kilometres that matter here.
 */
export function closestOnPolyline(p, coords, cum, { from = 0, to = coords.length - 1, score } = {}) {
  const kx = Math.cos(p[0] * RAD) * EARTH_RADIUS * RAD; // metres per degree of longitude
  const ky = EARTH_RADIUS * RAD; // metres per degree of latitude
  const last = Math.min(to, coords.length - 1);
  let best = null;
  for (let i = Math.max(0, from); i < last; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const ax = (a[1] - p[1]) * kx;
    const ay = (a[0] - p[0]) * ky;
    const dx = (b[1] - a[1]) * kx;
    const dy = (b[0] - a[0]) * ky;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const offset = Math.hypot(ax + t * dx, ay + t * dy);
    const along = cum[i] + t * (cum[i + 1] - cum[i]);
    const s = score ? score(offset, along) : offset;
    if (!best || s < best.score) best = { index: i, t, offset, along, score: s, point: lerp(a, b, t) };
  }
  return best;
}

// --- Ordnance Survey National Grid -------------------------------------------------------
// Transverse Mercator projection plus a 7-parameter Helmert transform between OSGB36 and
// WGS84, as published in the OS guide "A guide to coordinate systems in Great Britain".
// The Helmert step is good to about ±5 m, plenty for 8-figure (10 m) walking grid references.

const AIRY1830 = { a: 6377563.396, b: 6356256.909 };
const WGS84 = { a: 6378137, b: 6356752.314245 };
const NATIONAL_GRID = { F0: 0.9996012717, φ0: 49 * RAD, λ0: -2 * RAD, E0: 400000, N0: -100000 };
// WGS84 → OSGB36 (metres, ppm, arc-seconds). The reverse transform negates every term.
const HELMERT = { tx: -446.448, ty: 125.157, tz: -542.06, s: 20.4894, rx: -0.1502, ry: -0.247, rz: -0.8421 };

function meridionalArc(φ, b, n) {
  const { F0, φ0 } = NATIONAL_GRID;
  const n2 = n * n;
  const n3 = n2 * n;
  const dφ = φ - φ0;
  const sφ = φ + φ0;
  return (
    b *
    F0 *
    ((1 + n + 1.25 * n2 + 1.25 * n3) * dφ -
      (3 * n + 3 * n2 + (21 / 8) * n3) * Math.sin(dφ) * Math.cos(sφ) +
      ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * dφ) * Math.cos(2 * sφ) -
      (35 / 24) * n3 * Math.sin(3 * dφ) * Math.cos(3 * sφ))
  );
}

/** OSGB36 latitude/longitude (degrees) → National Grid easting/northing (metres). */
export function osgb36ToGrid(lat, lon) {
  const { a, b } = AIRY1830;
  const { F0, λ0, E0, N0 } = NATIONAL_GRID;
  const φ = lat * RAD;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  const sinφ = Math.sin(φ);
  const cosφ = Math.cos(φ);
  const tan2 = Math.tan(φ) ** 2;
  const tan4 = tan2 * tan2;
  const ν = (a * F0) / Math.sqrt(1 - e2 * sinφ * sinφ);
  const ρ = (a * F0 * (1 - e2)) / (1 - e2 * sinφ * sinφ) ** 1.5;
  const η2 = ν / ρ - 1;
  const I = meridionalArc(φ, b, n) + N0;
  const II = (ν / 2) * sinφ * cosφ;
  const III = (ν / 24) * sinφ * cosφ ** 3 * (5 - tan2 + 9 * η2);
  const IIIA = (ν / 720) * sinφ * cosφ ** 5 * (61 - 58 * tan2 + tan4);
  const IV = ν * cosφ;
  const V = (ν / 6) * cosφ ** 3 * (ν / ρ - tan2);
  const VI = (ν / 120) * cosφ ** 5 * (5 - 18 * tan2 + tan4 + 14 * η2 - 58 * tan2 * η2);
  const dλ = lon * RAD - λ0;
  return {
    easting: E0 + IV * dλ + V * dλ ** 3 + VI * dλ ** 5,
    northing: I + II * dλ ** 2 + III * dλ ** 4 + IIIA * dλ ** 6,
  };
}

/** National Grid easting/northing (metres) → OSGB36 latitude/longitude (degrees). */
export function gridToOsgb36(easting, northing) {
  const { a, b } = AIRY1830;
  const { F0, φ0, λ0, E0, N0 } = NATIONAL_GRID;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  let φ = φ0;
  let M = 0;
  do {
    φ += (northing - N0 - M) / (a * F0);
    M = meridionalArc(φ, b, n);
  } while (Math.abs(northing - N0 - M) >= 0.00001);
  const sinφ = Math.sin(φ);
  const secφ = 1 / Math.cos(φ);
  const tanφ = Math.tan(φ);
  const tan2 = tanφ * tanφ;
  const tan4 = tan2 * tan2;
  const tan6 = tan4 * tan2;
  const ν = (a * F0) / Math.sqrt(1 - e2 * sinφ * sinφ);
  const ρ = (a * F0 * (1 - e2)) / (1 - e2 * sinφ * sinφ) ** 1.5;
  const η2 = ν / ρ - 1;
  const VII = tanφ / (2 * ρ * ν);
  const VIII = (tanφ / (24 * ρ * ν ** 3)) * (5 + 3 * tan2 + η2 - 9 * tan2 * η2);
  const IX = (tanφ / (720 * ρ * ν ** 5)) * (61 + 90 * tan2 + 45 * tan4);
  const X = secφ / ν;
  const XI = (secφ / (6 * ν ** 3)) * (ν / ρ + 2 * tan2);
  const XII = (secφ / (120 * ν ** 5)) * (5 + 28 * tan2 + 24 * tan4);
  const XIIA = (secφ / (5040 * ν ** 7)) * (61 + 662 * tan2 + 1320 * tan4 + 720 * tan6);
  const dE = easting - E0;
  return {
    lat: toDeg(φ - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6),
    lon: toDeg(λ0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7),
  };
}

function toCartesian(lat, lon, { a, b }) {
  const φ = lat * RAD;
  const λ = lon * RAD;
  const e2 = 1 - (b * b) / (a * a);
  const ν = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
  return [ν * Math.cos(φ) * Math.cos(λ), ν * Math.cos(φ) * Math.sin(λ), (1 - e2) * ν * Math.sin(φ)];
}

function fromCartesian([x, y, z], { a, b }) {
  const e2 = 1 - (b * b) / (a * a);
  const ep2 = e2 / (1 - e2);
  const p = Math.hypot(x, y);
  const θ = Math.atan2(z * a, p * b); // Bowring's method: sub-millimetre at the Earth's surface
  const φ = Math.atan2(z + ep2 * b * Math.sin(θ) ** 3, p - e2 * a * Math.cos(θ) ** 3);
  return { lat: toDeg(φ), lon: toDeg(Math.atan2(y, x)) };
}

/** direction +1: WGS84 → OSGB36; -1: OSGB36 → WGS84. */
function helmert([x, y, z], direction) {
  const k = direction;
  const s1 = 1 + (k * HELMERT.s) / 1e6;
  const rx = toRad((k * HELMERT.rx) / 3600);
  const ry = toRad((k * HELMERT.ry) / 3600);
  const rz = toRad((k * HELMERT.rz) / 3600);
  return [k * HELMERT.tx + x * s1 - y * rz + z * ry, k * HELMERT.ty + x * rz + y * s1 - z * rx, k * HELMERT.tz - x * ry + y * rx + z * s1];
}

/** WGS84 (GPS) latitude/longitude → National Grid easting/northing. */
export function wgs84ToGrid(lat, lon) {
  const osgb = fromCartesian(helmert(toCartesian(lat, lon, WGS84), 1), AIRY1830);
  return osgb36ToGrid(osgb.lat, osgb.lon);
}

/** National Grid easting/northing → WGS84 (GPS) latitude/longitude. */
export function gridToWgs84(easting, northing) {
  const osgb = gridToOsgb36(easting, northing);
  return fromCartesian(helmert(toCartesian(osgb.lat, osgb.lon, AIRY1830), -1), WGS84);
}

/** Easting/northing → grid reference such as "SK 08485 87563" (digits: 6, 8 or 10). */
export function formatGridRef(easting, northing, digits = 10) {
  const e100k = Math.floor(easting / 100000);
  const n100k = Math.floor(northing / 100000);
  if (e100k < 0 || e100k > 6 || n100k < 0 || n100k > 12) return null; // outside the GB grid
  let l1 = 19 - n100k - ((19 - n100k) % 5) + Math.floor((e100k + 10) / 5);
  let l2 = (((19 - n100k) * 5) % 25) + (e100k % 5);
  if (l1 > 7) l1++; // the grid skips the letter I
  if (l2 > 7) l2++;
  const half = digits / 2;
  const scale = 10 ** (5 - half);
  const e = String(Math.floor((easting % 100000) / scale)).padStart(half, '0');
  const n = String(Math.floor((northing % 100000) / scale)).padStart(half, '0');
  return `${String.fromCharCode(65 + l1, 65 + l2)} ${e} ${n}`;
}

/**
 * Grid reference ("SK 085 875", "SK0848587563") → { easting, northing }.
 * By default returns the south-west corner of the referenced square, as the OS does;
 * pass { centre: true } for the middle of the square (best estimate for a 6-figure ref).
 */
export function parseGridRef(ref, { centre = false } = {}) {
  const m = /^\s*([A-HJ-Z])([A-HJ-Z])\s*(\d+)\s*(\d*)\s*$/i.exec(ref);
  if (!m) throw new Error(`Invalid grid reference: ${ref}`);
  const [, a, b] = m;
  let [, , , e, n] = m;
  if (!n) {
    if (e.length % 2) throw new Error(`Invalid grid reference: ${ref}`);
    n = e.slice(e.length / 2);
    e = e.slice(0, e.length / 2);
  }
  if (e.length !== n.length || e.length < 1 || e.length > 5) throw new Error(`Invalid grid reference: ${ref}`);
  let l1 = a.toUpperCase().charCodeAt(0) - 65;
  let l2 = b.toUpperCase().charCodeAt(0) - 65;
  if (l1 > 7) l1--;
  if (l2 > 7) l2--;
  const e100k = ((l1 - 2) % 5) * 5 + (l2 % 5);
  const n100k = 19 - Math.floor(l1 / 5) * 5 - Math.floor(l2 / 5);
  const pad = centre ? 10 ** (5 - e.length) / 2 : 0;
  return {
    easting: e100k * 100000 + Number(e.padEnd(5, '0')) + pad,
    northing: n100k * 100000 + Number(n.padEnd(5, '0')) + pad,
  };
}
