/**
 * App shell: loads the route, builds the map and profile, and connects GPS (or the demo walk)
 * to the tracking screen. Tracking state is kept in localStorage so a reload doesn't lose the walk.
 */
import { compassWord, formatGridRef, wgs84ToGrid } from './geo.js';
import { buildRoute, positionAt } from './route.js';
import { MAX_ACCURACY_M, Tracker } from './tracker.js';
import { DemoWalk } from './simulator.js';
import { createMap } from './map.js';
import { createProfile } from './profile.js';
import { downloadText, routeToGpx, trackToGpx } from './gpx.js';
import { sunTimes } from './sun.js';
import {
  formatClock,
  formatDistance,
  formatDuration,
  formatHeight,
  formatLatLon,
  formatMiles,
  formatSpeed,
  formatStopwatch,
} from './format.js';

const TRACK_KEY = 'edale-kinder:track:v1';
const SETTINGS_KEY = 'edale-kinder:settings:v1';
const AUTO_RESUME_MS = 6 * 3600000; // reopened within this long of the last fix → carry on tracking
const STOPS_ALLOWANCE_MS = 60 * 60000; // added to Naismith when planning against sunset
const STALE_FIX_MS = 30000;

const $ = (id) => document.getElementById(id);

const ICONS = {
  warning:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v5m0 3v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  good: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="m8 12.5 2.8 2.8 5.7-5.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  critical:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v6m0 3v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

const store = {
  read(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Private browsing or storage full: tracking still works, it just won't survive a reload.
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};

const fixFromPosition = (pos) => ({
  lat: pos.coords.latitude,
  lon: pos.coords.longitude,
  accuracy: pos.coords.accuracy,
  altitude: pos.coords.altitude,
  speed: pos.coords.speed,
  // A few older devices report odd timestamps; fall back to the clock rather than skew every timing.
  timestamp: Math.abs((pos.timestamp || 0) - Date.now()) < 86400000 ? pos.timestamp : Date.now(),
});

/** Share through the phone's share sheet where there is one, otherwise copy `copy` to the clipboard. */
async function shareOrCopy({ title, text, url, copy = text ? `${text} ${url}` : url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled'; // share sheet closed
    }
  }
  try {
    await navigator.clipboard.writeText(copy);
    return 'copied';
  } catch {
    prompt('Copy this:', copy);
    return 'shown';
  }
}

/** Swap an element's text for a moment, e.g. "Copied". */
function flash(el, text) {
  el.dataset.label ??= el.textContent;
  el.textContent = text;
  clearTimeout(el.flashTimer);
  el.flashTimer = setTimeout(() => {
    el.textContent = el.dataset.label;
  }, 2000);
}

const gridRef8 = (fix) => {
  const g = wgs84ToGrid(fix.lat, fix.lon);
  return formatGridRef(g.easting, g.northing, 8);
};

class App {
  constructor(route) {
    this.route = route;
    const saved = store.read(TRACK_KEY);
    this.live = new Tracker(route, { state: saved && Array.isArray(saved.points) ? saved : undefined });
    this.tracker = this.live;
    this.demo = null;
    this.watchId = null;
    this.gpsError = null;
    this.wakeLock = null;
    this.alertKey = null;
    this.wasOffRoute = false;
    this.hadSummit = this.live.state.summitAt != null;
    this.saveTimer = null;
    this.renderQueued = false;
    this.settings = { wakeLock: false, ...store.read(SETTINGS_KEY) };
  }

  init() {
    this.renderRouteTab();
    this.mapView = createMap($('map'), this.route, { onLocate: () => this.locateOnce() });
    this.profile = createProfile($('profile'), this.route, {
      onHover: (d) => this.mapView.showHover(d == null ? null : positionAt(this.route, d)),
    });
    this.mapView.setTrack(this.live.state.points);
    if (this.live.state.lastFix && this.live.state.status !== 'idle') this.mapView.setPosition(this.live.state.lastFix);
    this.bindTabs();
    this.bindControls();
    this.bindNetwork();
    this.restoreSession();
    this.render();
    setInterval(() => this.tick(), 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.live.state.status === 'tracking') this.acquireWakeLock();
    });
    // Flush the debounced save if the page is closed or the app is swiped away.
    addEventListener('pagehide', () => this.saveNow());
  }

  // --- Session ---------------------------------------------------------------------------------

  async restoreSession() {
    const s = this.live.state;
    if (s.status !== 'tracking') return;
    const last = s.points.at(-1)?.[3] ?? s.lastFix?.timestamp ?? s.startedAt;
    let granted = false;
    try {
      granted = (await navigator.permissions?.query({ name: 'geolocation' }))?.state === 'granted';
    } catch {
      // Permissions API missing (older Safari): fall back to asking the walker.
    }
    if (granted && Date.now() - last < AUTO_RESUME_MS) {
      this.startGps();
      this.acquireWakeLock();
      this.notice('good', 'Tracking carried on where you left off.');
    } else {
      this.live.pause(last);
      this.save();
      this.notice('warning', 'Your walk was paused when the page closed. Tap Resume to carry on recording.');
    }
    this.render();
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => store.write(TRACK_KEY, this.live.toJSON()), 1500);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    store.write(TRACK_KEY, this.live.toJSON());
  }

  // --- GPS -------------------------------------------------------------------------------------

  startGps() {
    if (!('geolocation' in navigator)) {
      this.gpsError = 'This browser can’t access your location, so it can’t track the walk.';
      return false;
    }
    if (this.watchId != null) return true;
    this.gpsError = null;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.onFix(this.live, fixFromPosition(pos)),
      (err) => this.onGpsError(err),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 },
    );
    return true;
  }

  stopGps() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  onGpsError(err) {
    if (err.code === 1) {
      const wasTracking = this.live.state.status === 'tracking';
      this.gpsError = `Location access is blocked. Allow it for this site in your browser settings, then ${wasTracking ? 'tap Resume' : 'try again'}.`;
      this.stopGps();
      if (wasTracking) this.live.pause();
      this.saveNow();
    } else if (err.code === 3) {
      this.gpsError = 'Still waiting for a GPS fix — it can take a minute, especially in deep valleys.';
    } else {
      this.gpsError = 'Your position isn’t available right now.';
    }
    this.render();
  }

  /** A position from the GPS or the demo walk. */
  onFix(tracker, fix) {
    if (tracker === this.live) this.gpsError = null;
    const recorded = tracker.addFix(fix);
    if (tracker !== this.tracker) return;
    this.mapView.setPosition(fix);
    if (recorded) {
      this.mapView.addTrackPoint(tracker.state.points.at(-1));
      if (tracker === this.live) this.save();
    }
    this.scheduleRender();
  }

  /** Coalesce bursts of fixes (the demo can send several per frame) into one redraw. */
  scheduleRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  locateOnce() {
    if (this.demo || this.watchId != null) return;
    if (!('geolocation' in navigator)) {
      this.gpsError = 'This browser can’t access your location.';
      this.render();
      return;
    }
    $('btn-locate').disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        $('btn-locate').disabled = false;
        const fix = fixFromPosition(pos);
        this.gpsError = null;
        this.live.addFix(fix);
        this.mapView.setPosition(fix);
        if (!this.mapView.following) this.mapView.focus(fix.lat, fix.lon, 14);
        this.render();
      },
      (err) => {
        $('btn-locate').disabled = false;
        this.onGpsError(err);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
  }

  // --- Tracking controls -----------------------------------------------------------------------

  startTracking() {
    if (this.demo) this.stopDemo();
    if (
      this.live.state.points.length > 0 &&
      !confirm('Start a new walk? This replaces the track saved on this device — download it first if you want to keep it.')
    )
      return;
    this.live.start();
    this.hadSummit = false;
    this.wasOffRoute = false;
    this.notice(null);
    this.mapView.setTrack([]);
    this.saveNow();
    this.startGps();
    this.mapView.setFollow(true);
    this.acquireWakeLock();
    this.render();
  }

  pauseTracking() {
    this.live.pause();
    this.stopGps();
    this.releaseWakeLock();
    this.saveNow();
    this.render();
  }

  resumeTracking() {
    this.live.resume();
    this.notice(null);
    this.startGps();
    this.acquireWakeLock();
    this.saveNow();
    this.render();
  }

  finishTracking() {
    if (!confirm('Finish this walk? You can still download the track afterwards.')) return;
    this.live.finish();
    this.stopGps();
    this.releaseWakeLock();
    this.saveNow();
    this.mapView.setFollow(false);
    this.mapView.fitRoute();
    this.render();
  }

  deleteTrack() {
    if (!confirm('Delete the track saved on this device? This can’t be undone.')) return;
    this.stopGps();
    this.releaseWakeLock();
    this.live.reset();
    store.remove(TRACK_KEY);
    this.mapView.setTrack([]);
    this.notice(null);
    this.render();
  }

  // --- Demo walk -------------------------------------------------------------------------------

  startDemo() {
    if (this.live.state.status === 'tracking') {
      if (!confirm('Pause your walk to run the demo?')) return;
      this.pauseTracking();
    }
    let walk = null;
    const tracker = new Tracker(this.route, { now: () => walk?.time ?? Date.now() });
    walk = new DemoWalk(this.route, {
      speedup: Number($('demo-speed').value) || 120,
      onFix: (fix) => this.onFix(tracker, fix),
      onEnd: () => {
        tracker.finish(walk.time);
        this.mapView.setFollow(false);
        this.mapView.fitRoute();
        this.render();
      },
    });
    this.demo = { tracker, walk };
    this.tracker = tracker;
    this.wasOffRoute = false;
    this.hadSummit = false;
    this.notice(null);
    tracker.start(walk.time);
    this.mapView.setTrack([]);
    this.mapView.setFollow(true);
    walk.start();
    this.render();
  }

  stopDemo() {
    if (!this.demo) return;
    this.demo.walk.stop();
    this.demo = null;
    this.tracker = this.live;
    this.notice(null);
    this.hadSummit = this.live.state.summitAt != null;
    this.mapView.setFollow(false);
    this.mapView.setTrack(this.live.state.points);
    if (this.live.state.lastFix) this.mapView.setPosition(this.live.state.lastFix);
    else this.mapView.clearPosition();
    this.mapView.fitRoute();
    this.render();
  }

  // --- Screen wake lock ------------------------------------------------------------------------

  async acquireWakeLock() {
    if (!this.settings.wakeLock || !('wakeLock' in navigator) || this.wakeLock) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
      });
    } catch {
      // Refused (e.g. battery saver) — tracking carries on regardless.
    }
  }

  releaseWakeLock() {
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }

  // --- Events ----------------------------------------------------------------------------------

  bindControls() {
    $('btn-start').addEventListener('click', () => this.startTracking());
    $('btn-pause').addEventListener('click', () => this.pauseTracking());
    $('btn-resume').addEventListener('click', () => this.resumeTracking());
    $('btn-finish').addEventListener('click', () => this.finishTracking());
    $('btn-demo').addEventListener('click', () => this.startDemo());
    $('btn-demo-stop').addEventListener('click', () => this.stopDemo());
    $('demo-speed').addEventListener('change', (e) => {
      if (this.demo) this.demo.walk.speedup = Number(e.target.value) || 120;
    });
    $('btn-locate').addEventListener('click', () => {
      if (this.tracker.state.lastFix && (this.watchId != null || this.demo)) {
        const f = this.tracker.state.lastFix;
        this.mapView.focus(f.lat, f.lon, 15);
      } else this.locateOnce();
    });
    $('btn-share').addEventListener('click', () => this.shareLocation());
    $('btn-share-app').addEventListener('click', () => this.shareApp());
    $('btn-export').addEventListener('click', () => {
      const s = this.live.state;
      const day = new Date(s.startedAt ?? Date.now()).toISOString().slice(0, 10);
      downloadText(`kinder-scout-walk-${day}.gpx`, trackToGpx(s.points, `Edale to Kinder Scout — ${day}`));
    });
    $('btn-clear').addEventListener('click', () => this.deleteTrack());
    $('btn-route-gpx').addEventListener('click', () => downloadText('edale-kinder-scout-route.gpx', routeToGpx(this.route)));
    const wake = $('opt-wakelock');
    wake.checked = !!this.settings.wakeLock;
    wake.addEventListener('change', () => {
      this.settings.wakeLock = wake.checked;
      store.write(SETTINGS_KEY, this.settings);
      if (wake.checked && this.live.state.status === 'tracking') this.acquireWakeLock();
      if (!wake.checked) this.releaseWakeLock();
    });
  }

  bindTabs() {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const select = (tab, focus) => {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        $(t.getAttribute('aria-controls')).hidden = !on;
      }
      if (focus) tab.focus();
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(tab, false));
      tab.addEventListener('keydown', (e) => {
        const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (next == null) return;
        e.preventDefault();
        select(tabs[(next + tabs.length) % tabs.length], true);
      });
    });
  }

  bindNetwork() {
    const update = () => {
      $('net-status').hidden = navigator.onLine;
    };
    addEventListener('online', update);
    addEventListener('offline', update);
    update();
  }

  async shareLocation() {
    const fix = this.tracker.state.lastFix;
    if (!fix) return;
    const lat = fix.lat.toFixed(5);
    const lon = fix.lon.toFixed(5);
    const text = `My location: ${gridRef8(fix)} (${lat}, ${lon}, ±${Math.round(fix.accuracy)} m) — Kinder Scout, Peak District.`;
    const url = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
    if ((await shareOrCopy({ title: 'My location', text, url })) === 'copied') flash($('btn-share'), 'Copied');
  }

  async shareApp() {
    const result = await shareOrCopy({
      title: 'Edale to Kinder Scout',
      text: 'Route, map and live GPS tracking for the Edale to Kinder Scout walk in the Peak District.',
      url: location.origin + location.pathname,
      copy: location.origin + location.pathname,
    });
    if (result === 'copied') flash($('btn-share-app').querySelector('.share-app-label'), 'Link copied');
  }

  tick() {
    const st = this.tracker.state.status;
    if (st === 'tracking' || (st === 'idle' && this.tracker.state.lastFix)) this.render();
  }

  // --- Rendering -------------------------------------------------------------------------------

  /** One-off and sticky messages; kept until replaced so screen readers announce each once. */
  notice(type, text) {
    this.sticky = type ? { type, text } : null;
  }

  render() {
    const snap = this.tracker.snapshot();
    this.renderButtons(snap);
    this.renderStatus(snap);
    this.renderAlert(snap);
    this.renderHero(snap);
    this.renderNext(snap);
    this.renderLocation(snap);
    this.renderDaylight(snap);
    this.renderTrackCard();
    this.renderHud(snap);
    this.profile.setProgress(snap.status === 'idle' ? null : (snap.along ?? null));
    this.markPassed(snap.status === 'idle' ? null : snap.along);
  }

  renderButtons(snap) {
    const demo = !!this.demo;
    const st = snap.status;
    const active = st === 'tracking' || st === 'paused';
    $('btn-start').hidden = demo || active;
    $('btn-start').textContent = st === 'finished' ? 'Start a new walk' : 'Start tracking';
    $('btn-resume').hidden = demo || st !== 'paused';
    $('btn-pause').hidden = demo || st !== 'tracking';
    $('btn-finish').hidden = demo || !active;
    $('btn-demo').hidden = demo || st === 'tracking';
    $('demo-bar').hidden = !demo;
    $('btn-demo-stop').textContent = demo && st === 'finished' ? 'Close demo' : 'Stop demo';
  }

  statusText(snap) {
    const fix = snap.lastFix;
    const acc = fix ? `±${Math.max(5, Math.round(fix.accuracy / 5) * 5)} m` : '';
    if (this.demo)
      return snap.status === 'finished'
        ? 'Demo finished — this is what you’d see back in Edale.'
        : `Demo walk at ${this.demo.walk.speedup}× speed with a simulated GPS.`;
    if (this.gpsError) return this.gpsError;
    switch (snap.status) {
      case 'idle':
        return fix
          ? `Located ${acc} · ${formatDistance(snap.distanceToStart)} from the start at Edale station.`
          : 'GPS is off. Start tracking when you set off from Edale.';
      case 'tracking':
        if (!fix || Date.now() - fix.timestamp > STALE_FIX_MS) return 'Waiting for GPS…';
        return fix.accuracy > MAX_ACCURACY_M ? `GPS signal weak (${acc}) — not recording until it improves.` : `Recording · GPS ${acc}`;
      case 'paused':
        return 'Paused — GPS is off. Resume to carry on recording.';
      default:
        return `Walk finished: ${formatDistance(snap.walked)} in ${formatDuration(snap.elapsedMs)}.`;
    }
  }

  renderStatus(snap) {
    const text = this.statusText(snap);
    const el = $('gps-status');
    if (el.textContent !== text) el.textContent = text;
  }

  renderAlert(snap) {
    let alert = this.sticky;
    const active = snap.status === 'tracking' || snap.status === 'paused';
    if (active && snap.offRoute) {
      alert = snap.lost
        ? { type: 'warning', text: `You’re ${formatDistance(snap.offset)} from the route. Head for Edale station to start it.` }
        : {
            type: 'warning',
            text: `${formatDistance(snap.offset)} off the route — the path is to the ${compassWord(snap.rejoinBearing)}.`,
          };
    } else if (snap.summitReached && snap.toSummit != null && Math.abs(snap.toSummit) < 150) {
      alert = {
        type: 'good',
        text: `You’re on the summit of Kinder Scout — ${formatHeight(this.route.summit.ele)}, the highest point in the Peak District.`,
      };
    } else if (snap.status === 'finished' && snap.toFinish != null && snap.toFinish < 200 && !this.demo) {
      alert = { type: 'good', text: 'Walk complete — welcome back to Edale.' };
    }

    // Gentle buzz when leaving the path or topping out (live walks only).
    if (snap.status === 'tracking' && !this.demo) {
      if (snap.offRoute && !snap.lost && !this.wasOffRoute) navigator.vibrate?.([200, 100, 200]);
      if (snap.summitReached && !this.hadSummit) navigator.vibrate?.([100, 60, 100, 60, 300]);
    }
    this.wasOffRoute = !!snap.offRoute;
    this.hadSummit = !!snap.summitReached;

    const key = alert ? `${alert.type}:${alert.text}` : null;
    if (key === this.alertKey) return;
    this.alertKey = key;
    const el = $('alert');
    el.hidden = !alert;
    if (!alert) return;
    el.className = `alert alert--${alert.type}`;
    el.innerHTML = ICONS[alert.type];
    el.append(document.createElement('span'));
    el.lastChild.textContent = alert.text;
  }

  renderHero(snap) {
    const r = this.route;
    const label = $('hero-label');
    const value = $('hero-value');
    const meta = $('hero-meta');
    const meter = $('progress-meter');
    const tiles = $('tiles');
    if (snap.status === 'idle') {
      label.textContent = 'Circuit from Edale';
      value.textContent = formatDistance(r.stats.distance);
      meta.textContent = `About ${formatDuration(r.stats.naismithHours * 3600000)} walking · ${Math.round(r.stats.ascent / 10) * 10} m of ascent · summit ${formatHeight(r.stats.maxEle)}`;
      meter.hidden = true;
      tiles.hidden = true;
      return;
    }
    meter.hidden = false;
    tiles.hidden = false;
    const pct = Math.round(snap.progress * 100);
    meter.setAttribute('aria-valuenow', String(pct));
    meter.setAttribute('aria-valuetext', `${pct}% of the route`);
    $('progress-fill').style.width = `${pct}%`;

    if (snap.status === 'finished') {
      label.textContent = 'Walk complete';
      value.textContent = formatDistance(snap.walked);
      meta.textContent = `${formatDuration(snap.elapsedMs)} · ${formatHeight(snap.ascentDone ?? 0)} climbed${snap.summitReached ? ' · summit reached' : ''}`;
    } else if (snap.along == null) {
      label.textContent = 'To the summit';
      value.textContent = '–';
      meta.textContent = 'Waiting for your first GPS fix…';
    } else if (snap.toSummit > 0 && !snap.summitReached) {
      label.textContent = 'To the summit';
      value.textContent = formatDistance(snap.toSummit);
      const time = snap.msToSummit < 60000 ? 'Nearly there' : `About ${formatDuration(snap.msToSummit)}`;
      meta.textContent = `${time} · there by ${formatClock(snap.etaSummit)} · ${formatHeight(snap.ascentToSummit)} still to climb`;
    } else {
      label.textContent = 'To the finish';
      value.textContent = formatDistance(snap.toFinish);
      meta.textContent = `About ${formatDuration(snap.msToFinish)} · back in Edale by ${formatClock(snap.etaFinish)}`;
    }

    $('t-walked').textContent = formatDistance(snap.walked);
    $('t-elapsed').textContent = formatStopwatch(snap.elapsedMs);
    $('t-finish').textContent = snap.toFinish == null ? '–' : formatDistance(snap.toFinish);
    $('t-eta').textContent = snap.etaFinish == null ? '–' : formatClock(snap.etaFinish);
    $('t-height').textContent = formatHeight(snap.elevation);
    $('t-climbed').textContent = snap.ascentDone == null ? '–' : formatHeight(snap.ascentDone);
    $('t-speed').textContent = formatSpeed(snap.speed);
    $('t-moving').textContent = formatDuration(snap.movingMs);
  }

  renderNext(snap) {
    const card = $('next-card');
    const show = (snap.status === 'tracking' || snap.status === 'paused') && snap.next;
    card.hidden = !show;
    if (!show) return;
    $('next-name').textContent = snap.next.name;
    $('next-dist').textContent = `· ${formatDistance(snap.next.distance)}`;
    $('next-directions').textContent = snap.directions?.text ?? '';
    const note = $('section-note');
    note.hidden = !snap.section?.note;
    note.textContent = snap.section?.note ?? '';
  }

  renderLocation(snap) {
    const fix = snap.lastFix;
    const grid = fix ? gridRef8(fix) : null;
    $('gridref').textContent = grid ?? 'No GPS fix yet';
    $('sos-gridref').textContent = grid ?? 'no GPS fix yet — open the Track tab and tap Find me';
    $('latlon').textContent = fix
      ? `${formatLatLon(fix.lat, fix.lon)} · ±${Math.round(fix.accuracy)} m · ${formatClock(fix.timestamp)}`
      : '';
    $('btn-share').disabled = !fix;
  }

  renderDaylight(snap) {
    const now = this.demo ? this.demo.walk.time : Date.now();
    const { lat, lon } = this.route.summit;
    const { sunrise, sunset } = sunTimes(now, lat, lon);
    const el = $('daylight');
    if (sunset == null) {
      el.textContent = '';
      return;
    }
    if (now < sunrise) {
      el.textContent = `Sunrise ${formatClock(sunrise)}, sunset ${formatClock(sunset)}.`;
      return;
    }
    if (now >= sunset) {
      el.textContent = `The sun set at ${formatClock(sunset)}. Use a head torch and take extra care on the descent.`;
      return;
    }
    const left = `Sunset ${formatClock(sunset)} — ${formatDuration(sunset - now)} of daylight left.`;
    if (snap.status === 'idle' || snap.status === 'finished') {
      const needed = this.route.stats.naismithHours * 3600000 + STOPS_ALLOWANCE_MS;
      const latest = sunset - needed;
      el.textContent =
        now <= latest
          ? `${left} Allow about ${formatDuration(needed)} with stops: set off by ${formatClock(latest)} to finish in daylight.`
          : `${left} That’s less than the ${formatDuration(needed)} the full circuit needs with stops.`;
      return;
    }
    el.textContent =
      snap.etaFinish != null && snap.etaFinish > sunset
        ? `${left} At this pace you’d finish around ${formatClock(snap.etaFinish)}, after dark — make sure you have a head torch.`
        : left;
  }

  renderTrackCard() {
    const s = this.live.state;
    const n = s.points.length;
    let info;
    if (this.demo) info = 'Demo track — not saved.';
    else if (!n) info = 'Nothing recorded yet. Your track stays on this device.';
    else info = `${formatDistance(s.walked)} recorded since ${formatClock(s.startedAt)} · ${n} points`;
    $('track-info').textContent = info;
    $('btn-export').disabled = !!this.demo || n < 2;
    $('btn-clear').disabled = !!this.demo || (n === 0 && s.status === 'idle');
  }

  renderHud(snap) {
    const hud = $('hud');
    let text = '';
    let tone = '';
    if (snap.status === 'idle') {
      text = `${formatDistance(this.route.stats.distance)} circuit · summit ${formatHeight(this.route.stats.maxEle)}`;
    } else if (snap.status === 'finished') {
      text = `${this.demo ? 'Demo complete' : 'Walk complete'} · ${formatDistance(snap.walked)}`;
      tone = 'good';
    } else if (snap.along == null) {
      text = 'Waiting for GPS…';
    } else if (snap.offRoute) {
      text = `${formatDistance(snap.offset)} off route`;
      tone = 'warning';
    } else if (snap.status === 'paused') {
      text = `Paused · ${formatDistance(snap.toFinish)} to finish`;
    } else if (snap.summitReached && Math.abs(snap.toSummit) < 50) {
      text = '▲ On the summit';
      tone = 'good';
    } else if (snap.toSummit > 0 && !snap.summitReached) {
      text = `▲ ${formatDistance(snap.toSummit)} to summit · ${formatClock(snap.etaSummit)}`;
    } else {
      text = `${formatDistance(snap.toFinish)} to finish · ${formatClock(snap.etaFinish)}`;
    }
    hud.textContent = text;
    hud.className = `hud${tone ? ` hud--${tone}` : ''}`;
  }

  markPassed(along) {
    for (const li of this.wpItems) {
      li.classList.toggle('wp-item--passed', along != null && along > Number(li.dataset.along) + 15);
    }
  }

  renderRouteTab() {
    const r = this.route;
    $('route-summary').textContent = r.summary;
    const facts = [
      ['Distance', `${formatDistance(r.stats.distance)}`, formatMiles(r.stats.distance)],
      ['Ascent', `About ${Math.round(r.stats.ascent / 10) * 10} m`],
      ['Highest point', formatHeight(r.stats.maxEle), 'Kinder Scout summit'],
      ['Walking time', `About ${formatDuration(r.stats.naismithHours * 3600000)}`, 'Naismith’s rule, before stops'],
    ];
    const dl = $('route-facts');
    for (const [term, value, note] of facts) {
      const div = document.createElement('div');
      div.className = 'fact';
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      if (note) {
        const span = document.createElement('span');
        span.className = 'fact-note';
        span.textContent = note;
        dd.append(span);
      }
      div.append(dt, dd);
      dl.append(div);
    }
    const details = $('route-details');
    for (const [term, value, note] of [
      ['Grade', r.grade, r.gradeNote],
      ['Start', r.start],
      ['Map', r.map],
    ]) {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      if (note) {
        const strong = document.createElement('strong');
        strong.textContent = value;
        dd.append(strong, document.createTextNode(note));
      } else dd.textContent = value;
      details.append(dt, dd);
    }

    const list = $('wp-list');
    this.wpItems = [];
    let n = 0;
    for (const w of r.waypoints) {
      const badge = w.kind === 'start' ? 'S' : w.kind === 'summit' ? '▲' : w.hidden ? (w.kind === 'finish' ? 'F' : '↩') : String(++n);
      const li = document.createElement('li');
      li.className = 'wp-item';
      li.dataset.along = String(w.along);
      const icon = document.createElement('span');
      icon.className = `wp wp--${w.kind}`;
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = badge;
      const body = document.createElement('div');
      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'wp-name';
      name.textContent = w.name;
      name.setAttribute('aria-label', `${w.name} — show on map`);
      name.addEventListener('click', () => {
        if (w.hidden) this.mapView.focus(w.lat, w.lon, 15);
        else this.mapView.openWaypoint(w.id);
      });
      const meta = document.createElement('p');
      meta.className = 'wp-meta';
      meta.textContent = `${(w.along / 1000).toFixed(1)} km · ${formatHeight(w.ele)} · ${w.gridRef}${w.approx ? ' (approx.)' : ''}`;
      const desc = document.createElement('p');
      desc.className = 'wp-desc';
      desc.textContent = w.description;
      body.append(name, meta, desc);
      if (w.directions) {
        const dir = document.createElement('p');
        dir.className = 'wp-dir';
        const strong = document.createElement('strong');
        strong.textContent = 'Then: ';
        dir.append(strong, document.createTextNode(w.directions));
        body.append(dir);
      }
      li.append(icon, body);
      list.append(li);
      this.wpItems.push(li);
    }
    $('route-note').textContent = r.attribution;
  }
}

function showFatal(message) {
  const el = $('fatal');
  el.textContent = message;
  el.hidden = false;
}

function registerServiceWorker() {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || local)) return;
  navigator.serviceWorker.register('sw.js').catch(() => {
    // Offline support is a bonus; the app works without it.
  });
}

async function main() {
  if (!window.L) {
    showFatal('The map library failed to load. Check your connection and reload the page.');
    return;
  }
  let route;
  try {
    const res = await fetch('data/route.json');
    if (!res.ok) throw new Error(String(res.status));
    route = buildRoute(await res.json());
  } catch (err) {
    showFatal(`Couldn’t load the route data (${err.message}). Check your connection and reload the page.`);
    return;
  }
  const app = new App(route);
  app.init();
  window.edaleApp = app; // handy for debugging from the console
  registerServiceWorker();
}

main();
