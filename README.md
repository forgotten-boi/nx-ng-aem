# Edale → Kinder Scout trail tracker

A static web app for the classic Peak District walk from **Edale to Kinder Scout**, the highest point in the
Peak District (636 m). It has three parts:

- **Map**: OpenTopoMap and OpenStreetMap base maps, the route line with direction arrows, numbered waypoints and nearby
  points of interest.
- **Route**: distance, ascent and Naismith time, an interactive elevation profile, and turn-by-turn waypoint directions with
  OS grid references.
- **Live tracking**: uses your phone's GPS. It shows progress along the route, distance and time to the summit and to the
  finish, and estimated arrival times that adapt to your pace. It also shows height, height climbed, speed, your current
  OS grid reference, the next waypoint with directions, an off-route warning with the direction back to the path, and
  daylight left before sunset.

The app is plain HTML, CSS and JavaScript, with [Leaflet](https://leafletjs.com) vendored in. There is no build step and no
server code, and nothing leaves the device. It works as an installable PWA and keeps working offline once it has loaded.

> **Safety:** the route line and heights are compiled from published landmark positions and are approximate. Carry
> OS Explorer OL1 and a compass, check the mountain forecast, and don't rely on a phone alone on Kinder.

## The route

A 13.2 km (8.2 mi) circuit with about 450 m of ascent. It goes up Grindsbrook Clough, west along the southern edges to
Kinder Low, then out to the true summit and back. It returns by Jacob's Ladder and the Pennine Way.

| km   | Height | Grid ref     | Waypoint                                         |
| ---- | ------ | ------------ | ------------------------------------------------ |
| 0.0  | 245 m  | SK 1237 8532 | Edale station (start)                            |
| 0.7  | 264 m  | SK 1228 8599 | The Old Nag's Head (start of the Pennine Way)    |
| 2.9  | 590 m  | SK 1055 8725 | Top of Grindsbrook Clough                        |
| 4.0  | 605 m  | SK 0946 8711 | Crowden Tower                                    |
| 4.7  | 608 m  | SK 0879 8706 | Pym Chair, after the Woolpacks                   |
| 5.6  | 633 m  | SK 0789 8706 | Kinder Low trig point                            |
| 6.4  | 636 m  | SK 0848 8756 | **Kinder Scout summit** (faint path, out & back) |
| 7.8  | 535 m  | SK 0794 8636 | Top of Jacob's Ladder                            |
| 8.8  | 340 m  | SK 0883 8615 | Packhorse bridge                                 |
| 10.4 | 290 m  | SK 1030 8542 | Upper Booth                                      |
| 13.2 | 245 m  | SK 1237 8532 | Edale station (finish)                           |

The full list, with directions, is in the app's **Route** tab and in [`tools/route-source.mjs`](tools/route-source.mjs).

## Run it

Any static file server works. Use `localhost` or HTTPS, because browsers only allow GPS and service workers there.

```sh
npm start            # → http://localhost:4173/ (no dependencies needed)
# or: npx serve apps/edale-kinder   |   python3 -m http.server -d apps/edale-kinder
```

You don't need to be in Edale to try the tracking screen. **Try a demo walk** replays the route with a simulated GPS at
60–300× speed.

### On the hill

- Open the app at home or on the way, and pan along the route at the zoom you'll use. Map tiles you've viewed are cached
  for offline use, and the app itself is cached by its service worker.
- Add it to your home screen ("Install app" / "Add to Home Screen").
- Browsers pause GPS when the screen locks. Tick **Keep the screen on while tracking** for a continuous track. If you
  don't, the gaps are joined up the next time you look.
- Your track is saved on the device as you go, so it survives a reload, and you can download it as GPX.

## Deploy

The site is the `apps/edale-kinder/` folder. There's nothing to build.

- **GitHub Pages:** Settings → Pages → _Deploy from a branch_ → pick the branch and `/ (root)`. The root `index.html`
  redirects to the app at `https://<user>.github.io/nx-ng-aem/apps/edale-kinder/`. `.nojekyll` skips Jekyll.
- **Netlify / Cloudflare Pages / Azure Static Web Apps:** set the publish directory (`app_location`) to
  `apps/edale-kinder` and leave the build command empty.

When you change any app file, bump `VERSION` in [`apps/edale-kinder/sw.js`](apps/edale-kinder/sw.js) so installed copies
refresh their cache.

## Project layout

```
apps/edale-kinder/          the static site
  index.html, css/app.css   page and styles (light + dark)
  js/geo.js                 distances, route matching, OS grid ⇄ WGS84 (Helmert + Transverse Mercator)
  js/route.js               route model: distance, climb, Naismith timings, waypoints
  js/tracker.js             GPS fixes → progress, off-route, pace-adjusted ETAs (pure logic, unit tested)
  js/map.js, js/profile.js  Leaflet map and SVG elevation profile
  js/main.js                UI wiring, geolocation, persistence, wake lock
  js/simulator.js           demo walk (Tobler's hiking function)
  js/gpx.js, js/sun.js      GPX export, sunrise/sunset
  data/route.json           generated route data — do not edit by hand
  sw.js, manifest.webmanifest
  vendor/leaflet/           Leaflet 1.9.4 (BSD-2-Clause)
tools/
  route-source.mjs          route definition in OS grid references, with sources
  build-route.mjs           → data/route.json (npm run build:route)
  serve.mjs                 zero-dependency dev server
  render-icons.mjs          icon.svg → PNG icons
tests/unit/                 node:test — geodesy, route, tracker, GPX, sunset
tests/e2e/                  Playwright — map, profile, mocked-GPS tracking, reload, demo, offline
```

## Route data

The route is defined in OS National Grid coordinates in `tools/route-source.mjs`. Running `npm run build:route` converts
it to WGS84 `data/route.json`. Named landmarks use published grid references, and each one cites its source:

- Kinder Low trig pillar: SK 07899 87062
- Kinder Scout summit: SK 08485 87563, from a 2009 survey
- Pym Chair: Moors for the Future audio trail
- Edale Cross: Historic England list entry 1008615
- Jacob's Ladder bridge: Derbyshire HER
- Old Nag's Head: Historic England listing 1096618
- Others are from published route guides

Points between landmarks are hand-placed along the paths, so expect ±50–100 m. Heights away from named summits are
estimates. The route uses straight lines between points, so real distances on the ground run a little longer. To refine
the line, edit the source, rebuild, and run the tests. A unit test fails if `route.json` is out of date.

The grid conversion is checked against the Ordnance Survey's worked example and against a published conversion of the
summit.

## Tests

```sh
npm install
npm test                          # unit tests (node:test)
npx playwright install chromium   # once
npm run test:e2e                  # browser tests, phone + desktop viewports
npm run test:all                  # all of the above + route data check
```

CI runs the same checks on every push (`.github/workflows/ci.yml`).

## Credits & licences

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). Map style ©
  [OpenTopoMap](https://opentopomap.org) (CC-BY-SA). Please respect the
  [tile usage policies](https://operations.osmfoundation.org/policies/tiles/); the app only caches tiles you've viewed.
- [Leaflet](https://leafletjs.com) © Volodymyr Agafonkin, BSD-2-Clause (`apps/edale-kinder/vendor/leaflet/LICENSE`).
- Coordinate conversion follows the Ordnance Survey's _A guide to coordinate systems in Great Britain_.
