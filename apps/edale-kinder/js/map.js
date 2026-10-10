/**
 * Leaflet map: base layers, the route and its waypoints, and the walker's position and track.
 * Line colours come from CSS classes so light/dark themes apply to them too.
 */
import { bearing, pointAt } from './geo.js';
import { formatDistance, formatHeight } from './format.js';

const BASE_LAYERS = [
  {
    name: 'Topographic',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: {
      subdomains: 'abc',
      maxNativeZoom: 17,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM · ' +
        'style © <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
    },
  },
  {
    name: 'Streets',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxNativeZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
];

const ICONS = {
  fit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  locate:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function waypointPopup(w) {
  const box = el('div', 'popup');
  box.append(el('strong', 'popup-title', w.name));
  box.append(
    el('div', 'popup-meta', `${formatDistance(w.along)} from start · ${formatHeight(w.ele)} · ${w.gridRef}${w.approx ? ' (approx.)' : ''}`),
  );
  box.append(el('p', 'popup-text', w.description));
  if (w.directions) {
    const p = el('p', 'popup-text popup-next');
    p.append(el('span', 'popup-label', 'Next: '), document.createTextNode(w.directions));
    box.append(p);
  }
  return box;
}

function poiPopup(p) {
  const box = el('div', 'popup');
  box.append(el('strong', 'popup-title', p.name));
  box.append(el('div', 'popup-meta', `${formatHeight(p.ele)} · ${p.gridRef} · off route`));
  box.append(el('p', 'popup-text', p.description));
  return box;
}

/**
 * @param {HTMLElement} container
 * @param {object} route built route
 * @param {{ onLocate: () => void, onFollowChange: (following: boolean) => void }} handlers
 */
export function createMap(container, route, { onLocate, onFollowChange } = {}) {
  const L = window.L;
  const map = L.map(container, { zoomControl: true, maxZoom: 18, minZoom: 9, zoomSnap: 0.5 });

  const layers = {};
  for (const b of BASE_LAYERS) layers[b.name] = L.tileLayer(b.url, { ...b.options, maxZoom: 18 });
  layers.Topographic.addTo(map);
  L.control.layers(layers, null, { position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

  // Give the map its view first: Leaflet only creates marker elements once the map has one.
  const { coords, cum } = route;
  const bounds = L.latLngBounds(coords);
  const fitRoute = () => map.fitBounds(bounds, { padding: [24, 24] });
  fitRoute();

  // --- Route line: white casing, solid path, dotted where the path is faint ---
  const faint = route.sections.filter((s) => s.style === 'faint');
  L.polyline(coords, { className: 'route-casing', weight: 9, interactive: false }).addTo(map);
  let start = 0;
  for (const s of faint) {
    L.polyline(coords.slice(start, s.from + 1), { className: 'route-line', weight: 4, interactive: false }).addTo(map);
    L.polyline(coords.slice(s.from, s.to + 1), {
      className: 'route-line route-line--faint',
      weight: 4,
      dashArray: '1 9',
      interactive: false,
    }).addTo(map);
    start = s.to;
  }
  L.polyline(coords.slice(start), { className: 'route-line', weight: 4, interactive: false }).addTo(map);

  // Direction chevrons every kilometre (not on the out-and-back detour, where they would point both ways).
  const inFaint = (d) => faint.some((s) => d >= cum[s.from] - 150 && d <= cum[s.to] + 150);
  for (let d = 500; d < route.stats.distance - 300; d += 1000) {
    if (inFaint(d)) continue;
    const a = pointAt(coords, cum, d - 20);
    const b = pointAt(coords, cum, d + 20);
    const icon = L.divIcon({
      className: 'route-arrow',
      html: `<svg viewBox="0 0 16 16" style="transform:rotate(${bearing(a, b).toFixed(0)}deg)" aria-hidden="true"><path d="M4 11 8 4l4 7" /></svg>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    L.marker(pointAt(coords, cum, d), { icon, interactive: false, keyboard: false }).addTo(map);
  }

  // --- Waypoints ---
  const markers = new Map();
  let n = 0;
  for (const w of route.waypoints) {
    if (w.hidden) continue;
    const label = w.kind === 'start' ? 'S' : w.kind === 'summit' ? '▲' : String(++n);
    const icon = L.divIcon({
      className: `wp-icon wp-icon--tier-${w.tier ?? 1}`,
      html: `<span class="wp wp--${w.kind}">${label}</span>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -12],
    });
    const name = w.kind === 'start' ? `${w.name} — start & finish` : w.name;
    const marker = L.marker([w.lat, w.lon], {
      icon,
      title: name,
      alt: name,
      riseOnHover: true,
      zIndexOffset: w.kind === 'summit' ? 500 : 0,
    })
      .bindTooltip(el('span', null, name), { direction: 'top', offset: [0, -12] })
      .bindPopup(() => waypointPopup(w), { maxWidth: 280 })
      .addTo(map);
    marker.getElement()?.setAttribute('aria-label', name); // not the badge text ("3", "▲")
    w.label = label;
    markers.set(w.id, marker);
  }
  for (const p of route.pois) {
    const icon = L.divIcon({
      className: 'wp-icon wp-icon--tier-2',
      html: '<span class="poi"></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    L.marker([p.lat, p.lon], { icon, title: p.name, alt: p.name })
      .bindTooltip(el('span', null, p.name), { direction: 'top', offset: [0, -8] })
      .bindPopup(() => poiPopup(p), { maxWidth: 260 })
      .addTo(map)
      .getElement()
      ?.setAttribute('aria-label', p.name);
  }

  // --- Walker: own panes so the position dot sits above the waypoint markers ---
  map.createPane('hover').style.zIndex = 610;
  map.createPane('you').style.zIndex = 620;
  const youRenderer = L.svg({ pane: 'you' });
  const track = L.polyline([], { className: 'track-line', weight: 4, interactive: false }).addTo(map);
  const accuracy = L.circle([0, 0], { radius: 1, className: 'accuracy-circle', weight: 1, interactive: false, renderer: youRenderer });
  const dot = L.circleMarker([0, 0], { radius: 7, className: 'you-dot', weight: 3, interactive: false, renderer: youRenderer });
  const hover = L.circleMarker([0, 0], {
    radius: 6,
    className: 'profile-dot',
    weight: 2,
    interactive: false,
    renderer: L.svg({ pane: 'hover' }),
  });

  // Show minor waypoints only once zoomed in far enough for them not to overlap.
  const updateDetail = () => {
    const z = map.getZoom();
    container.dataset.detail = z >= 14.5 ? '3' : z >= 13 ? '2' : '1';
  };
  map.on('zoomend', updateDetail);
  // The summary pill sits over the top of the map; get it out of the way of popups.
  const pane = container.closest('.map-pane') ?? container;
  map.on('popupopen', () => pane.classList.add('popup-open'));
  map.on('popupclose', () => pane.classList.remove('popup-open'));

  updateDetail();

  // --- Controls: show whole route, find me / follow me ---
  let following = false;
  let zoomOnNextFix = false;
  const locateBtn = el('button', 'map-button');
  const setFollow = (on) => {
    zoomOnNextFix = on && !following;
    following = on;
    locateBtn.setAttribute('aria-pressed', String(on));
    onFollowChange?.(on);
  };
  const Buttons = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar map-buttons');
      L.DomEvent.disableClickPropagation(bar);
      return bar;
    },
  });
  const bar = new Buttons().addTo(map).getContainer();
  const fitBtn = el('button', 'map-button');
  fitBtn.type = 'button';
  fitBtn.innerHTML = ICONS.fit;
  fitBtn.title = 'Show the whole route';
  fitBtn.setAttribute('aria-label', 'Show the whole route');
  fitBtn.addEventListener('click', () => {
    setFollow(false);
    fitRoute();
  });
  locateBtn.type = 'button';
  locateBtn.innerHTML = ICONS.locate;
  locateBtn.title = 'Show and follow my location';
  locateBtn.setAttribute('aria-label', 'Show and follow my location');
  locateBtn.setAttribute('aria-pressed', 'false');
  locateBtn.addEventListener('click', () => {
    setFollow(!following);
    if (following) onLocate?.();
  });
  bar.append(fitBtn, locateBtn);

  map.on('dragstart', () => following && setFollow(false));

  return {
    map,
    fitRoute,
    setFollow,
    get following() {
      return following;
    },
    focus(lat, lon, zoom = 15) {
      setFollow(false);
      map.flyTo([lat, lon], Math.max(map.getZoom(), zoom), { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.6 });
    },
    openWaypoint(id) {
      const m = markers.get(id);
      if (!m) return;
      map.once('moveend', () => m.openPopup());
      const { lat, lng } = m.getLatLng();
      this.focus(lat, lng, 15);
    },
    setPosition(fix) {
      const ll = [fix.lat, fix.lon];
      accuracy.setLatLng(ll).setRadius(Math.max(3, fix.accuracy ?? 10));
      dot.setLatLng(ll);
      if (!map.hasLayer(accuracy)) accuracy.addTo(map);
      if (!map.hasLayer(dot)) dot.addTo(map);
      if (following && zoomOnNextFix) map.setView(ll, Math.max(map.getZoom(), 15), { animate: false });
      else if (following) map.panTo(ll, { animate: false });
      zoomOnNextFix = false;
    },
    clearPosition() {
      accuracy.remove();
      dot.remove();
    },
    setTrack(points) {
      track.setLatLngs(points.map((p) => [p[0], p[1]]));
    },
    addTrackPoint(p) {
      track.addLatLng([p[0], p[1]]);
    },
    showHover(latlon) {
      if (!latlon) return hover.remove();
      hover.setLatLng(latlon);
      if (!map.hasLayer(hover)) hover.addTo(map);
    },
  };
}
