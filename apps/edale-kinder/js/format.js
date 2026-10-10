/**
 * Display formatting. Clock times are shown in UK time because that is where the walk is.
 */

const TIME_ZONE = 'Europe/London';
const clockFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });

/** 640 m, 3.4 km */
export function formatDistance(m) {
  if (m == null || !Number.isFinite(m)) return '–';
  const abs = Math.abs(m);
  if (abs < 950) return `${Math.round(abs / 10) * 10} m`;
  return `${(abs / 1000).toFixed(1)} km`;
}

/** 8.2 mi */
export function formatMiles(m) {
  return `${(m / 1609.344).toFixed(1)} mi`;
}

/** 612 m */
export function formatHeight(m) {
  if (m == null || !Number.isFinite(m)) return '–';
  return `${Math.round(m)} m`;
}

/** 45 min, 3 h 05 min */
export function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '–';
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (h === 0) return `${min} min`;
  return `${h} h ${String(min).padStart(2, '0')} min`;
}

/** Stopwatch style: 1:05:32 */
export function formatStopwatch(ms) {
  const total = Math.max(0, Math.floor((ms ?? 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 14:05 (UK time) */
export function formatClock(timestamp) {
  if (timestamp == null || !Number.isFinite(timestamp)) return '–';
  return clockFormat.format(new Date(timestamp));
}

/** 3.8 km/h */
export function formatSpeed(metresPerSecond) {
  if (metresPerSecond == null || !Number.isFinite(metresPerSecond)) return '–';
  return `${(metresPerSecond * 3.6).toFixed(1)} km/h`;
}

/** 53.38485, -1.87390 */
export function formatLatLon(lat, lon) {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
