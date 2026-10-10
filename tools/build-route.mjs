#!/usr/bin/env node
/**
 * Builds apps/edale-kinder/data/route.json from tools/route-source.mjs:
 * converts OS grid references to WGS84, resolves waypoints and styled sections to
 * vertex indices and prints a sanity summary.
 *
 *   node tools/build-route.mjs           write the JSON
 *   node tools/build-route.mjs --check   fail if the committed JSON is out of date
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { formatGridRef, gridToWgs84, parseGridRef } from '../apps/edale-kinder/js/geo.js';
import { buildRoute } from '../apps/edale-kinder/js/route.js';
import { meta, path, pois, sections, waypoints } from './route-source.mjs';

const OUT = fileURLToPath(new URL('../apps/edale-kinder/data/route.json', import.meta.url));

const round = (x, dp) => Number(x.toFixed(dp));

function resolvePoint(p) {
  const { easting, northing } = Array.isArray(p) ? { easting: p[0], northing: p[1] } : parseGridRef(p.ref, { centre: p.centre });
  const { lat, lon } = gridToWgs84(easting, northing);
  return { easting, northing, lat: round(lat, 6), lon: round(lon, 6), ele: Array.isArray(p) ? p[2] : p.ele };
}

export function build() {
  const coordinates = [];
  const wps = [];
  path.forEach((p, index) => {
    const r = resolvePoint(p);
    coordinates.push([r.lat, r.lon, r.ele]);
    if (!Array.isArray(p) && p.wp) {
      const w = waypoints[p.wp];
      if (!w) throw new Error(`Unknown waypoint id "${p.wp}"`);
      wps.push({
        id: p.wp,
        name: w.name,
        kind: w.kind,
        tier: w.tier ?? 1,
        index,
        lat: r.lat,
        lon: r.lon,
        ele: r.ele,
        gridRef: formatGridRef(r.easting, r.northing, 8),
        description: w.description,
        ...(w.directions && { directions: w.directions }),
        ...(w.approx && { approx: true }),
        ...(w.hidden && { hidden: true }),
        ...(w.source && { source: w.source }),
      });
    }
  });

  const unused = Object.keys(waypoints).filter((id) => !wps.some((w) => w.id === id));
  if (unused.length) throw new Error(`Waypoints not on the path: ${unused.join(', ')}`);

  const indexOf = (id) => {
    const w = wps.find((x) => x.id === id);
    if (!w) throw new Error(`Unknown waypoint id "${id}" in sections`);
    return w.index;
  };

  return {
    ...meta,
    attribution:
      'Route compiled from published OS grid references of landmarks; intermediate points and most heights are ' +
      'approximate. Always carry OS Explorer OL1 and a compass.',
    coordinates,
    waypoints: wps,
    pois: pois.map((p) => {
      const r = resolvePoint(p);
      return {
        id: p.id,
        name: p.name,
        lat: r.lat,
        lon: r.lon,
        ele: p.ele,
        gridRef: formatGridRef(r.easting, r.northing, 8),
        description: p.description,
        source: p.source,
      };
    }),
    sections: sections.map((s) => ({ from: indexOf(s.from), to: indexOf(s.to), style: s.style, note: s.note })),
  };
}

/** JSON with each coordinate triple on one line, so diffs stay readable. */
export function serialise(data) {
  return `${JSON.stringify(data, null, 2).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2, $3]')}\n`;
}

async function main() {
  const data = build();
  const json = serialise(data);
  if (process.argv.includes('--check')) {
    const current = await readFile(OUT, 'utf8').catch(() => '');
    if (current !== json) {
      console.error('route.json is out of date — run `npm run build:route`.');
      process.exit(1);
    }
    console.log('route.json is up to date.');
    return;
  }
  await writeFile(OUT, json);

  const route = buildRoute(data);
  const summit = route.waypoints.find((w) => w.kind === 'summit');
  const km = (m) => `${(m / 1000).toFixed(2)} km`;
  console.log(`Wrote ${OUT}`);
  console.log(`  ${data.coordinates.length} points, ${data.waypoints.length} waypoints`);
  console.log(
    `  distance ${km(route.stats.distance)}, ascent ${Math.round(route.stats.ascent)} m, descent ${Math.round(route.stats.descent)} m`,
  );
  console.log(`  highest ${route.stats.maxEle} m, start → summit ${km(summit.along)}`);
  console.log(`  Naismith time ${route.stats.naismithHours.toFixed(1)} h`);
  for (const w of route.waypoints) console.log(`    ${km(w.along).padStart(9)}  ${String(w.ele).padStart(4)} m  ${w.gridRef}  ${w.name}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
