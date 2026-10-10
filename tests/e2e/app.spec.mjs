import { along, expect, route, test } from './fixtures.mjs';

test.describe('route and map', () => {
  test('shows the route, key waypoints and the walk summary', async ({ page }) => {
    await page.goto('./');
    await expect(page).toHaveTitle('Edale to Kinder Scout · Trail Tracker');
    await expect(page.locator('.route-line').first()).toBeVisible();
    await expect(page.locator('.wp-icon:visible')).not.toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Kinder Scout summit', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edale station — start & finish' })).toBeVisible();
    await expect(page.locator('#hud')).toHaveText('13.2 km circuit · summit 636 m');
    await expect(page.locator('#hero-value')).toHaveText('13.2 km');
    await expect(page.locator('#daylight')).toContainText(/sun ?set/i); // wording depends on the time of day
  });

  test('route tab has the elevation profile and every waypoint', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('tab', { name: 'Route' }).click();
    const profile = page.locator('#profile');
    await expect(profile.locator('svg path.profile-line')).toBeVisible();
    await expect(profile.locator('.profile-label')).toHaveText('Kinder Scout 636 m');
    await expect(page.locator('#wp-list > li')).toHaveCount(route.waypoints.length);

    // Keyboard exploration of the profile shows the readout and a marker on the map.
    await profile.focus();
    await page.keyboard.press('End');
    await expect(page.locator('.profile-tip')).toBeVisible();
    await expect(page.locator('.profile-tip span')).toContainText('13.2 km from start');
    await expect(page.locator('path.profile-dot')).toHaveCount(1);

    await page.getByRole('button', { name: 'Kinder Scout summit — show on map' }).click();
    await expect(page.locator('.leaflet-popup-content')).toContainText('Kinder Scout summit');
    await expect(page.locator('.leaflet-popup-content')).toContainText('SK 0848 8756');
  });

  test('tabs work from the keyboard', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('tab', { name: 'Track' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Route' })).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Route' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#view-route')).toBeVisible();
    await page.keyboard.press('End');
    await expect(page.locator('#view-safety')).toBeVisible();
    await expect(page.locator('#view-safety')).toContainText('Mountain Rescue');
  });

  test('route GPX download', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('tab', { name: 'Route' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download route GPX' }).click()]);
    expect(download.suggestedFilename()).toBe('edale-kinder-scout-route.gpx');
    const text = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'));
    expect(text.match(/<trkpt /g)).toHaveLength(route.coordinates.length);
  });
});

test.describe('sharing', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('Share copies the app link when there is no share sheet', async ({ page }) => {
    await page.goto('./?from=test#route');
    await page.evaluate(() => {
      delete Navigator.prototype.share; // desktop browsers without Web Share
    });
    await page.getByRole('button', { name: 'Share this app' }).click();
    await expect(page.locator('.share-app-label')).toHaveText('Link copied');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(new URL('./', page.url()).href);
  });

  test('link previews have a title and image', async ({ page, request }) => {
    await page.goto('./');
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Edale to Kinder Scout · Trail Tracker');
    const image = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(image).toMatch(/^https:\/\/.+\/icons\/social-card\.png$/);
    const response = await request.get('icons/social-card.png');
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toBe('image/png');
  });
});

test.describe('live tracking', () => {
  test.use({ permissions: ['geolocation'], geolocation: along(0) });

  test('records a walk, warns when off the route and exports GPX', async ({ page, context }) => {
    await page.goto('./');
    await page.getByRole('button', { name: 'Start tracking' }).click();
    await expect(page.locator('#gps-status')).toContainText('Recording');
    await expect(page.locator('#hero-label')).toHaveText('To the summit');

    for (let d = 250; d <= 2500; d += 250) {
      await context.setGeolocation(along(d));
      await expect(page.locator('#t-finish')).toHaveText(`${((route.stats.distance - d) / 1000).toFixed(1)} km`);
    }
    await expect(page.locator('#hero-value')).toHaveText(`${((route.summit.along - 2500) / 1000).toFixed(1)} km`);
    await expect(page.locator('#next-name')).toHaveText('Top of Grindsbrook Clough');
    await expect(page.locator('#gridref')).toHaveText(/^SK \d{4} \d{4}$/);
    await expect(page.locator('#track-info')).toContainText('recorded');

    await context.setGeolocation(along(2500, 200));
    // We stepped 200 m north of the path, so it should be pointed out to the south.
    await expect(page.locator('#alert')).toContainText(/off the route — the path is to the south/);
    await expect(page.locator('#hud')).toContainText('off route');
    await context.setGeolocation(along(2600));
    await expect(page.locator('#alert')).toBeHidden();

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download GPX' }).click()]);
    const gpx = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'));
    expect(gpx.match(/<trkpt /g).length).toBeGreaterThanOrEqual(10);
    expect(gpx).toContain('<time>');
  });

  test('keeps the walk through a reload and can finish it', async ({ page, context }) => {
    await page.goto('./');
    await page.getByRole('button', { name: 'Start tracking' }).click();
    for (let d = 200; d <= 1000; d += 200) {
      await context.setGeolocation(along(d));
      await expect(page.locator('#t-finish')).toHaveText(`${((route.stats.distance - d) / 1000).toFixed(1)} km`);
    }
    const recorded = await page.locator('#track-info').textContent();
    await page.waitForTimeout(1700); // let the debounced save land
    await page.reload();
    await expect(page.locator('#alert')).toContainText('Tracking carried on');
    await expect(page.locator('#track-info')).toHaveText(recorded);
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

    await page.getByRole('button', { name: 'Finish walk' }).click();
    await expect(page.locator('#hero-label')).toHaveText('Walk complete');
    await expect(page.getByRole('button', { name: 'Start a new walk' })).toBeVisible();

    await page.getByRole('button', { name: 'Delete track' }).click();
    await expect(page.locator('#hero-label')).toHaveText('Circuit from Edale');
    await expect(page.getByRole('button', { name: 'Download GPX' })).toBeDisabled();
  });

  test('your position is drawn above waypoints without blocking them', async ({ page, context }) => {
    await page.goto('./');
    await page.getByRole('button', { name: 'Start tracking' }).click();
    const top = route.waypoints.find((w) => w.id === 'grindsbrook-top');
    await context.setGeolocation(along(top.along));
    await expect(page.locator('#next-name')).toHaveText('Crowden Brook crossing');
    // Following zooms in on the walker; the waypoint underneath can still be tapped.
    await page.getByRole('button', { name: 'Top of Grindsbrook Clough' }).click();
    await expect(page.locator('.leaflet-popup-content')).toContainText('Top of Grindsbrook Clough');
    await expect(page.locator('.leaflet-you-pane path.you-dot')).toBeVisible();
  });

  test('pause and resume', async ({ page, context }) => {
    await page.goto('./');
    await page.getByRole('button', { name: 'Start tracking' }).click();
    await context.setGeolocation(along(300));
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.locator('#gps-status')).toContainText('Paused');
    await expect(page.locator('#hud')).toContainText('Paused');
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.locator('#gps-status')).toContainText('Recording');
  });
});

test.describe('without location permission', () => {
  test('explains how to allow location access', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('button', { name: 'Start tracking' }).click();
    await expect(page.locator('#gps-status')).toContainText('Location access is blocked');
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  });
});

test('demo walk runs round the whole route', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Try a demo walk' }).click();
  await expect(page.locator('#demo-bar')).toBeVisible();
  await expect(page.locator('#hero-label')).toHaveText('To the summit');
  await page.evaluate(() => {
    window.edaleApp.demo.walk.speedup = 4000;
  });
  await expect(page.locator('#hud')).toHaveText(/^Demo complete/, { timeout: 30000 });
  await expect(page.locator('#gps-status')).toContainText('Demo finished');
  await expect(page.locator('#hero-label')).toHaveText('Walk complete');
  await expect(page.locator('#hero-meta')).toContainText('summit reached');
  await page.getByRole('button', { name: 'Close demo' }).click();
  await expect(page.locator('#hero-label')).toHaveText('Circuit from Edale');
});

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' });

  test('loads from the service worker cache with no connection', async ({ page, context }) => {
    await page.goto('./');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.route-line').first()).toBeVisible();
    await expect(page.locator('#hero-value')).toHaveText('13.2 km');
    await expect(page.locator('#net-status')).toBeVisible();
    await context.setOffline(false);
  });
});
