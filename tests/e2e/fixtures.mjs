import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { buildRoute, positionAt } from '../../apps/edale-kinder/js/route.js';

export const route = buildRoute(JSON.parse(readFileSync(new URL('../../apps/edale-kinder/data/route.json', import.meta.url), 'utf8')));

/** { latitude, longitude } at a distance along the route, optionally pushed `north` metres off it. */
export function along(d, north = 0) {
  const [lat, lon] = positionAt(route, d);
  return { latitude: lat + north / 111195, longitude: lon, accuracy: 8 };
}

const TILE_HOST = /tile\.(opentopomap|openstreetmap)\.org/;
// A 1×1 PNG stands in for map tiles so tests never depend on the tile servers.
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4+/cvAAXaAu1W7ONMAAAAAElFTkSuQmCC', 'base64');

export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      // Map tiles failing to load offline (through the service worker) is expected, not an app error.
      if (msg.type() === 'error' && !TILE_HOST.test(msg.location().url)) errors.push(msg.text());
    });
    await page.route(TILE_HOST, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
    page.on('dialog', (dialog) => dialog.accept());
    await use(page);
    expect(errors, 'no errors in the page').toEqual([]);
  },
});

export { expect };
