/**
 * Elevation profile: a single-series SVG area chart with a crosshair tooltip (pointer and
 * keyboard), waypoint markers, a direct label on the summit and the walker's progress.
 */
import { elevationAt } from './route.js';
import { formatDistance, formatHeight } from './format.js';

const NS = 'http://www.w3.org/2000/svg';
const HEIGHT = 180;
const M = { top: 24, right: 14, bottom: 26, left: 46 };
const KEY_STEP = 250; // metres per arrow-key press

function svgEl(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.append(node);
  return node;
}

export function createProfile(container, route, { onHover } = {}) {
  const total = route.stats.distance;
  const minE = Math.floor((route.stats.minEle - 20) / 100) * 100;
  const maxE = Math.ceil((route.stats.maxEle + 20) / 100) * 100;
  const markers = route.waypoints.filter((w) => !w.hidden && w.kind !== 'start');
  const summit = route.summit;

  container.classList.add('profile');
  container.tabIndex = 0;
  container.setAttribute('role', 'group');
  container.setAttribute(
    'aria-label',
    `Elevation profile. ${formatDistance(total)} from ${formatHeight(route.ele[0])} up to ${formatHeight(route.stats.maxEle)} ` +
      `at ${formatDistance(summit.along)}. Use the left and right arrow keys to explore.`,
  );
  const svg = svgEl('svg', { 'aria-hidden': 'true', focusable: 'false' }, container);
  const tip = document.createElement('div');
  tip.className = 'profile-tip';
  tip.hidden = true;
  const tipValue = document.createElement('strong');
  const tipMeta = document.createElement('span');
  tip.append(tipValue, tipMeta);
  container.append(tip);

  let width = 0;
  let progress = null;
  let hoverAlong = null;
  let walkedClip;
  let youGroup;
  let hoverGroup;
  const clipId = `profile-walked-${Math.random().toString(36).slice(2, 8)}`;

  const x = (d) => M.left + (d / total) * (width - M.left - M.right);
  const y = (e) => M.top + (1 - (e - minE) / (maxE - minE)) * (HEIGHT - M.top - M.bottom);
  const alongAtX = (px) => Math.min(total, Math.max(0, ((px - M.left) / (width - M.left - M.right)) * total));

  function render() {
    width = Math.round(container.clientWidth);
    if (width === 0) return; // hidden tab; the resize observer renders it once it is shown
    svg.setAttribute('viewBox', `0 0 ${width} ${HEIGHT}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', HEIGHT);
    svg.replaceChildren();

    const grid = svgEl('g', { class: 'profile-grid' }, svg);
    for (let e = minE; e <= maxE; e += 100) {
      svgEl('line', { x1: M.left, x2: width - M.right, y1: y(e), y2: y(e), class: e === minE ? 'baseline' : 'gridline' }, grid);
      svgEl('text', { x: M.left - 8, y: y(e) + 4, class: 'axis-label', 'text-anchor': 'end' }, grid).textContent = `${e} m`;
    }
    const stepKm = width < 420 ? 4 : 2;
    for (let km = 0; km * 1000 <= total; km += stepKm) {
      svgEl(
        'text',
        { x: x(km * 1000), y: HEIGHT - 6, class: 'axis-label', 'text-anchor': km === 0 ? 'start' : 'middle' },
        grid,
      ).textContent = km === 0 ? '0 km' : `${km}`;
    }

    const pts = route.cum.map((d, i) => `${x(d).toFixed(1)},${y(route.ele[i]).toFixed(1)}`);
    const line = `M${pts.join('L')}`;
    const area = `${line}L${x(total).toFixed(1)},${y(minE)}L${x(0).toFixed(1)},${y(minE)}Z`;
    const defs = svgEl('defs', {}, svg);
    const clip = svgEl('clipPath', { id: clipId }, defs);
    walkedClip = svgEl('rect', { x: M.left, y: 0, width: 0, height: HEIGHT }, clip);
    svgEl('path', { d: area, class: 'profile-area' }, svg);
    svgEl('path', { d: area, class: 'profile-area profile-area--walked', 'clip-path': `url(#${clipId})` }, svg);
    svgEl('path', { d: line, class: 'profile-line' }, svg);

    const dots = svgEl('g', { class: 'profile-markers' }, svg);
    for (const w of markers) {
      svgEl('circle', { cx: x(w.along), cy: y(w.ele), r: w.kind === 'summit' ? 5 : 4, class: 'profile-marker' }, dots);
    }
    // Direct label on the one point the story is about.
    const label = svgEl('text', { x: x(summit.along), y: y(summit.ele) - 10, class: 'profile-label', 'text-anchor': 'middle' }, svg);
    label.textContent = `Kinder Scout ${formatHeight(summit.ele)}`;

    youGroup = svgEl('g', { class: 'profile-you' }, svg);
    hoverGroup = svgEl('g', { class: 'profile-hover' }, svg);
    drawProgress();
    drawHover();
  }

  function drawProgress() {
    if (!youGroup) return;
    youGroup.replaceChildren();
    walkedClip.setAttribute('width', progress == null ? 0 : Math.max(0, x(progress) - M.left));
    if (progress == null) return;
    const px = x(progress);
    const py = y(elevationAt(route, progress));
    svgEl('line', { x1: px, x2: px, y1: M.top - 6, y2: HEIGHT - M.bottom, class: 'you-rule' }, youGroup);
    svgEl('circle', { cx: px, cy: py, r: 6, class: 'you-marker' }, youGroup);
    const anchor = px > width - 60 ? 'end' : px < M.left + 30 ? 'start' : 'middle';
    svgEl('text', { x: px, y: M.top - 10, class: 'you-label', 'text-anchor': anchor }, youGroup).textContent = 'You';
  }

  function nearbyName(d) {
    let best = null;
    for (const w of route.waypoints) {
      const gap = Math.abs(w.along - d);
      if (gap <= 200 && (!best || gap < best.gap)) best = { gap, name: w.name };
    }
    return best?.name;
  }

  function drawHover() {
    if (!hoverGroup) return;
    hoverGroup.replaceChildren();
    if (hoverAlong == null) {
      tip.hidden = true;
      return;
    }
    const e = elevationAt(route, hoverAlong);
    const px = x(hoverAlong);
    const py = y(e);
    svgEl('line', { x1: px, x2: px, y1: M.top - 6, y2: HEIGHT - M.bottom, class: 'crosshair' }, hoverGroup);
    svgEl('circle', { cx: px, cy: py, r: 5, class: 'crosshair-dot' }, hoverGroup);
    tipValue.textContent = formatHeight(e);
    const near = nearbyName(hoverAlong);
    tipMeta.textContent = `${formatDistance(hoverAlong)} from start${near ? ` · ${near}` : ''}`;
    tip.hidden = false;
    const tipWidth = tip.offsetWidth;
    tip.style.left = `${Math.min(width - tipWidth - 4, Math.max(4, px - tipWidth / 2))}px`;
  }

  function setHover(d) {
    hoverAlong = d;
    drawHover();
    onHover?.(d);
  }

  container.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'touch' && !ev.isPrimary) return;
    const rect = svg.getBoundingClientRect();
    setHover(alongAtX(ev.clientX - rect.left));
  });
  container.addEventListener('pointerdown', (ev) => {
    const rect = svg.getBoundingClientRect();
    setHover(alongAtX(ev.clientX - rect.left));
  });
  container.addEventListener('pointerleave', () => setHover(null));
  container.addEventListener('pointercancel', () => setHover(null));
  container.addEventListener('keydown', (ev) => {
    const keys = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP, Home: -Infinity, End: Infinity };
    if (!(ev.key in keys)) return;
    ev.preventDefault();
    const start = hoverAlong ?? progress ?? 0;
    setHover(Math.min(total, Math.max(0, start + keys[ev.key])));
  });
  container.addEventListener('blur', () => setHover(null));

  new ResizeObserver(() => {
    if (Math.round(container.clientWidth) !== width) render();
  }).observe(container);
  render();

  return {
    setProgress(d) {
      progress = d;
      drawProgress();
    },
  };
}
