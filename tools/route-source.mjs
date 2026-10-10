/**
 * Source data for apps/edale-kinder/data/route.json (regenerate with `npm run build:route`).
 *
 * The route is described in Ordnance Survey National Grid coordinates because that is how
 * the published landmark positions are given. Named landmarks carry the grid reference and
 * source they come from; the plain [easting, northing, height] points between them are
 * hand-placed along the line of the paths and are approximate (expect ±50–100 m), as are the
 * heights of unnamed points. Treat the line as a guide, not a substitute for OS Explorer OL1.
 *
 * Waypoint `tier` controls when its marker shows on the map: 1 always, 2 from zoom 13, 3 from zoom 14.5,
 * so the overview isn't cluttered on a phone.
 *
 * A path point is either [easting, northing, heightMetres] or
 * { ref, centre?, ele, wp?, revisit? } where `ref` is a grid reference, `centre` means the
 * reference is a coarse (6-figure) square and its centre should be used, `wp` names the
 * waypoint at that point and `revisit` marks a waypoint passed for the second time.
 */

export const meta = {
  id: 'edale-kinder-scout',
  name: 'Edale to Kinder Scout',
  summary:
    'Classic Dark Peak circuit: up Grindsbrook Clough, west along the gritstone edges to Kinder Low ' +
    'and the 636 m summit, then down Jacob’s Ladder and back to Edale on the Pennine Way.',
  region: 'Peak District National Park, Derbyshire',
  grade: 'Strenuous',
  gradeNote:
    'Steep, rocky scramble in upper Grindsbrook Clough; exposed moorland plateau where navigation ' +
    'is hard in mist; peat bog around the summit.',
  map: 'OS Explorer OL1 – The Peak District: Dark Peak area',
  start: 'Edale railway station (Hope Valley line); village car park next to the station',
};

export const waypoints = {
  start: {
    tier: 1,
    name: 'Edale station',
    kind: 'start',
    description: 'Start at Edale station on the Hope Valley line (Manchester–Sheffield). The village car park is beside it.',
    directions: 'Walk north up the lane through the village, under the railway and past the church, to the Old Nag’s Head.',
    source: 'Pennine Way start grid ref next to the station, peakdistrictwalks.net',
  },
  'nags-head': {
    tier: 2,
    name: 'The Old Nag’s Head',
    kind: 'landmark',
    description: 'Historic inn at Grindsbrook Booth and the official southern start of the Pennine Way.',
    directions: 'Just past the inn, follow the path signed for Grindsbrook down to the footbridge over Grinds Brook.',
    source: 'Historic England listing 1096618 (E 412283, N 385995)',
  },
  'grindsbrook-bridge': {
    tier: 3,
    name: 'Grinds Brook footbridge',
    kind: 'junction',
    description: 'Footbridge over Grinds Brook at the bottom of the valley.',
    directions:
      'Climb the stone steps and follow the path north-west through meadows and woodland into Grindsbrook Clough, ' +
      'crossing the brook where needed. The upper clough is a steep, rocky scramble up the stream bed — slippery ' +
      'when wet and best avoided when the brook is in spate.',
    source: 'Route guide grid ref SK 122 861',
  },
  'grindsbrook-top': {
    tier: 1,
    name: 'Top of Grindsbrook Clough',
    kind: 'landmark',
    description: 'You reach the edge of the Kinder plateau at about 590 m.',
    directions: 'Turn left (west) on the path along the southern edge of the plateau towards the head of Crowden Clough.',
    source: 'Route guide grid ref SK 105 872',
  },
  'crowden-brook': {
    tier: 3,
    name: 'Crowden Brook crossing',
    kind: 'junction',
    description: 'Ford Crowden Brook where it drops off the plateau into Crowden Clough.',
    directions: 'Cross the brook and climb the short distance to the gritstone tor of Crowden Tower.',
    approx: true,
  },
  'crowden-tower': {
    tier: 2,
    name: 'Crowden Tower',
    kind: 'landmark',
    description: 'A fortress-like pile of gritstone guarding the head of Crowden Clough, with views down the Vale of Edale.',
    directions: 'Continue west along the edge path into the field of weathered boulders known as the Woolpacks.',
    approx: true,
  },
  woolpacks: {
    tier: 3,
    name: 'The Woolpacks',
    kind: 'landmark',
    description: 'Wind-sculpted gritstone boulders, some with names such as the Pagoda and the Moat Stone.',
    directions: 'Weave through the boulders and keep to the edge path, emerging at Pym Chair.',
    approx: true,
  },
  'pym-chair': {
    tier: 2,
    name: 'Pym Chair',
    kind: 'landmark',
    description: 'Prominent gritstone outcrop on the edge path, at the western end of the Woolpacks.',
    directions: 'Stay on the edge path heading west towards the anvil-shaped Noe Stool.',
    source: 'Moors for the Future audio trail, SK 08797 87065',
  },
  'noe-stool': {
    tier: 2,
    name: 'Noe Stool',
    kind: 'landmark',
    description: 'Anvil-shaped rock above Edale Head, where the River Noe begins.',
    directions: 'Bear north-west up the edge to the trig pillar on Kinder Low.',
    approx: true,
  },
  'kinder-low': {
    tier: 1,
    name: 'Kinder Low trig point',
    kind: 'landmark',
    description: 'Trig pillar on a boulder at 633 m — once thought to be the top of Kinder.',
    directions:
      'For the true summit, head north-east (grid bearing about 050°) for about 750 m across peat groughs on faint ' +
      'paths. Only go in good visibility, and come back the same way.',
    source: 'Trig pillar SK 07899 87062, britishwalks.org; height 633 m',
  },
  summit: {
    tier: 1,
    name: 'Kinder Scout summit',
    kind: 'summit',
    description:
      'The highest point in the Peak District (636 m on OS maps; a 2009 survey suggests nearer 634 m). An unmarked, ' +
      'peaty knoll — easy to miss in mist.',
    directions: 'Retrace your steps south-west to the Kinder Low trig pillar.',
    source: 'Nuttalls 2009 summit survey, SK 08485 87563',
  },
  'kinder-low-return': {
    tier: 1,
    name: 'Kinder Low (return)',
    kind: 'junction',
    hidden: true,
    description: 'Back at the trig pillar.',
    directions: 'Follow the Pennine Way south past the rocks of Swine’s Back to the cairn at the top of Jacob’s Ladder.',
  },
  'jacobs-ladder': {
    tier: 1,
    name: 'Top of Jacob’s Ladder',
    kind: 'junction',
    description: 'Cairn at the top of the old packhorse route. Edale Cross, a medieval wayside cross, is 350 m to the south-west.',
    directions: 'Descend Jacob’s Ladder — the steep stepped path or the gentler zig-zag bridleway — to the packhorse bridge.',
    source: 'Route guide grid ref SK 07948 86360',
  },
  'packhorse-bridge': {
    tier: 2,
    name: 'Jacob’s Ladder packhorse bridge',
    kind: 'landmark',
    description: 'Stone packhorse bridge over the infant River Noe.',
    directions: 'Follow the track east down the valley past Lee Farm.',
    source: 'Derbyshire HER, SK 0883 8615',
  },
  'lee-farm': {
    tier: 2,
    name: 'Lee Farm',
    kind: 'landmark',
    description: 'Hill farm in the upper Vale of Edale.',
    directions: 'Continue along the lane to the hamlet of Upper Booth.',
    approx: true,
  },
  'upper-booth': {
    tier: 1,
    name: 'Upper Booth',
    kind: 'junction',
    description: 'Farming hamlet where Crowden Brook joins the River Noe.',
    directions: 'Follow the Pennine Way signs north-east across the fields below Broadlee-Bank Tor back to Grindsbrook Booth.',
    approx: true,
  },
  'nags-head-return': {
    tier: 2,
    name: 'The Old Nag’s Head (return)',
    kind: 'junction',
    hidden: true,
    description: 'Back in Edale village.',
    directions: 'Walk back down the lane to the station.',
  },
  finish: {
    tier: 1,
    name: 'Edale station (finish)',
    kind: 'finish',
    hidden: true,
    description: 'Back where you started.',
  },
};

/** Points of interest near (but not on) the route. */
export const pois = [
  {
    id: 'edale-cross',
    name: 'Edale Cross',
    ref: 'SK 07717 86099',
    ele: 544,
    description: 'Medieval wayside cross on the old packhorse route, 350 m south-west of the top of Jacob’s Ladder.',
    source: 'Historic England list entry 1008615',
  },
  {
    id: 'grindslow-knoll',
    name: 'Grindslow Knoll',
    ref: 'SK 109 868',
    centre: true,
    ele: 601,
    description: 'Rounded top above Grindsbrook Clough — a short detour from the plateau edge with fine views over Edale.',
    source: 'OS grid SK 109 868, 601 m',
  },
];

/** Ordered path. Parts of the line flagged in `sections` get a different style on the map. */
export const path = [
  { ref: 'SK 12374 85328', ele: 245, wp: 'start' },
  [412372, 385420, 247],
  [412385, 385530, 249],
  [412398, 385640, 252],
  [412380, 385760, 256],
  [412335, 385880, 260],
  { ref: 'SK 12283 85995', ele: 264, wp: 'nags-head' },
  [412262, 386075, 260],
  { ref: 'SK 122 861', centre: true, ele: 256, wp: 'grindsbrook-bridge' },
  [412140, 386270, 270],
  [411990, 386400, 284],
  [411840, 386520, 298],
  [411690, 386640, 312],
  [411530, 386760, 330],
  [411380, 386870, 352],
  [411230, 386970, 378],
  [411090, 387060, 405],
  [410960, 387130, 432],
  [410830, 387185, 468],
  [410700, 387220, 520],
  { ref: 'SK 105 872', centre: true, ele: 590, wp: 'grindsbrook-top' },
  [410330, 387230, 592],
  [410100, 387200, 590],
  [409860, 387180, 585],
  { ref: 'SK 09660 87170', ele: 578, wp: 'crowden-brook' },
  { ref: 'SK 09460 87110', ele: 605, wp: 'crowden-tower' },
  [409260, 387080, 603],
  { ref: 'SK 09080 87060', ele: 602, wp: 'woolpacks' },
  [408930, 387060, 605],
  { ref: 'SK 08797 87065', ele: 608, wp: 'pym-chair' },
  [408630, 387010, 610],
  [408480, 386950, 612],
  { ref: 'SK 08340 86930', ele: 615, wp: 'noe-stool' },
  [408180, 386960, 620],
  [408040, 387010, 627],
  { ref: 'SK 07899 87062', ele: 633, wp: 'kinder-low' },
  [408090, 387220, 630],
  [408290, 387395, 630],
  { ref: 'SK 08485 87563', ele: 636, wp: 'summit' },
  [408290, 387395, 630],
  [408090, 387220, 630],
  { ref: 'SK 07899 87062', ele: 633, wp: 'kinder-low-return' },
  [407905, 386860, 615],
  [407925, 386640, 590],
  { ref: 'SK 07948 86360', ele: 535, wp: 'jacobs-ladder' },
  [408150, 386330, 515],
  [408350, 386280, 490],
  [408520, 386230, 455],
  [408650, 386195, 410],
  [408750, 386170, 370],
  { ref: 'SK 0883 8615', centre: true, ele: 340, wp: 'packhorse-bridge' },
  [408960, 386040, 335],
  [409110, 385900, 328],
  [409300, 385760, 320],
  [409480, 385630, 314],
  { ref: 'SK 09650 85560', ele: 308, wp: 'lee-farm' },
  [409900, 385500, 300],
  [410100, 385450, 294],
  { ref: 'SK 10300 85420', ele: 290, wp: 'upper-booth' },
  [410550, 385560, 298],
  [410850, 385680, 308],
  [411200, 385800, 316],
  [411550, 385880, 315],
  [411850, 385930, 300],
  [412100, 385980, 278],
  { ref: 'SK 12283 85995', ele: 264, wp: 'nags-head-return' },
  [412335, 385880, 260],
  [412380, 385760, 256],
  [412398, 385640, 252],
  [412385, 385530, 249],
  [412372, 385420, 247],
  { ref: 'SK 12374 85328', ele: 245, wp: 'finish' },
];

/** Stretches of the line drawn differently, between two waypoint ids (inclusive). */
export const sections = [
  {
    from: 'kinder-low',
    to: 'kinder-low-return',
    style: 'faint',
    note: 'Summit detour: faint paths across peat groughs. Skip it in poor visibility — Kinder Low (633 m) makes a fine top.',
  },
];
