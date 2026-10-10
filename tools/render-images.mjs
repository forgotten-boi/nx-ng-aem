#!/usr/bin/env node
/**
 * Renders the generated images in apps/edale-kinder/icons/:
 * - icon-192.png, icon-512.png from icon.svg (web manifest icons)
 * - social-card.png, the 1200×630 preview shown when the link is shared, drawn from data/route.json
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { buildRoute } from '../apps/edale-kinder/js/route.js';

const dir = fileURLToPath(new URL('../apps/edale-kinder/icons/', import.meta.url));
const route = buildRoute(JSON.parse(await readFile(new URL('../apps/edale-kinder/data/route.json', import.meta.url), 'utf8')));

const W = 1200;
const H = 630;
const INK = '#f4f1e8';
const MUTED = '#b9c2b6';
const BG = '#23302a';
const PANEL = '#2c3b33';
const ROUTE = '#eb6834';

/** Fit the route into a box, keeping its shape (equirectangular is fine over a few km). */
function projector(box) {
  const lat0 = (route.coords.reduce((s, c) => s + c[0], 0) / route.coords.length) * (Math.PI / 180);
  const xs = route.coords.map((c) => c[1] * Math.cos(lat0));
  const ys = route.coords.map((c) => -c[0]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min(box.w / (maxX - minX), box.h / (maxY - minY));
  const ox = box.x + (box.w - (maxX - minX) * scale) / 2;
  const oy = box.y + (box.h - (maxY - minY) * scale) / 2;
  return ([lat, lon]) => [ox + (lon * Math.cos(lat0) - minX) * scale, oy + (-lat - minY) * scale];
}

function socialCardSvg() {
  const project = projector({ x: 690, y: 92, w: 420, h: 300 });
  const path = route.coords
    .map((c) =>
      project(c)
        .map((n) => n.toFixed(1))
        .join(','),
    )
    .join(' ');
  const [sx, sy] = project([route.waypoints[0].lat, route.waypoints[0].lon]);
  const [tx, ty] = project([route.summit.lat, route.summit.lon]);

  // Elevation profile under the map, same orange as the route.
  const px = (d) => 690 + (d / route.stats.distance) * 420;
  const py = (e) => 560 - ((e - 200) / 500) * 90;
  const profile = route.cum.map((d, i) => `${px(d).toFixed(1)},${py(route.ele[i]).toFixed(1)}`).join(' ');

  const stat = (x, value, label) =>
    `<text x="${x}" y="520" font-size="44" font-weight="700" fill="${INK}">${value}</text>` +
    `<text x="${x}" y="556" font-size="22" fill="${MUTED}">${label}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect x="650" y="48" width="500" height="534" rx="28" fill="${PANEL}"/>
  <text x="72" y="118" font-size="22" font-weight="600" letter-spacing="4" fill="${MUTED}">PEAK DISTRICT</text>
  <text x="72" y="208" font-size="84" font-weight="800" fill="${INK}">Edale →</text>
  <text x="72" y="300" font-size="84" font-weight="800" fill="${INK}">Kinder Scout</text>
  <text x="72" y="362" font-size="32" fill="${MUTED}">Route, map &amp; live GPS tracking</text>
  ${stat(72, `${(route.stats.distance / 1000).toFixed(1)} km`, 'circuit')}
  ${stat(268, `${route.stats.maxEle} m`, 'summit')}
  ${stat(438, `${Math.round(route.stats.ascent / 10) * 10} m`, 'of ascent')}
  <polygon points="${px(0)},560 ${profile} ${px(route.stats.distance)},560" fill="${ROUTE}" fill-opacity="0.22"/>
  <polyline points="${profile}" fill="none" stroke="${ROUTE}" stroke-width="3" stroke-linejoin="round"/>
  <polyline points="${path}" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="13" stroke-linejoin="round" stroke-linecap="round"/>
  <polyline points="${path}" fill="none" stroke="${ROUTE}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${sx}" cy="${sy}" r="17" fill="#1d1c1a" stroke="#ffffff" stroke-width="4"/>
  <text x="${sx}" y="${sy + 7}" font-size="19" font-weight="700" fill="#ffffff" text-anchor="middle">S</text>
  <circle cx="${tx}" cy="${ty}" r="19" fill="${ROUTE}" stroke="#ffffff" stroke-width="4"/>
  <path d="M${tx - 8} ${ty + 6} L${tx} ${ty - 8} L${tx + 8} ${ty + 6} Z" fill="#ffffff"/>
  <text x="${tx + 30}" y="${ty + 8}" font-size="22" font-weight="600" fill="${INK}">Kinder Scout 636 m</text>
  <text x="${sx - 26}" y="${sy + 8}" font-size="22" font-weight="600" fill="${INK}" text-anchor="end">Edale</text>
</svg>`;
}

const browser = await chromium.launch();
async function render(svg, width, height, file) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${width}px;height:${height}px}</style>${svg}`);
  await page.screenshot({ path: `${dir}${file}` });
  await page.close();
}
const icon = await readFile(`${dir}icon.svg`, 'utf8');
await render(icon, 192, 192, 'icon-192.png');
await render(icon, 512, 512, 'icon-512.png');
await render(socialCardSvg(), W, H, 'social-card.png');
await browser.close();
console.log('Wrote icon-192.png, icon-512.png and social-card.png');
