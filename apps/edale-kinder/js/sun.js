/**
 * Sunrise and sunset from the standard sunrise equation (accurate to a minute or two),
 * so "daylight left" works offline.
 */
const RAD = Math.PI / 180;
const J1970 = 2440587.5;
const J2000 = 2451545;
const DAY_MS = 86400000;

const toJulian = (ms) => ms / DAY_MS + J1970;
const fromJulian = (j) => (j - J1970) * DAY_MS;

/**
 * Sunrise and sunset (epoch ms) on the UTC calendar day containing `date`, for a position.
 * Returns { sunrise, sunset }, with nulls for polar day/night.
 */
export function sunTimes(date, lat, lon) {
  const d = new Date(date);
  const noon = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12);
  const n = Math.round(toJulian(noon) - J2000 + 0.0008);
  const meanNoon = n - lon / 360; // longitude east-positive
  const M = (357.5291 + 0.98560028 * meanNoon) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const λ = (M + C + 180 + 102.9372) % 360;
  const transit = J2000 + meanNoon + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * λ * RAD);
  const δ = Math.asin(Math.sin(λ * RAD) * Math.sin(23.4397 * RAD));
  const cosω = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(δ)) / (Math.cos(lat * RAD) * Math.cos(δ));
  if (cosω > 1 || cosω < -1) return { sunrise: null, sunset: null };
  const ω = Math.acos(cosω) / RAD;
  return { sunrise: fromJulian(transit - ω / 360), sunset: fromJulian(transit + ω / 360) };
}
