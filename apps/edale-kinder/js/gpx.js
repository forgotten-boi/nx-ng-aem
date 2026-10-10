/**
 * GPX 1.1 export for the planned route and the walker's recorded track.
 */

const CREATOR = 'Edale to Kinder Scout trail tracker';

const escapeXml = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

const header = (name) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<gpx version="1.1" creator="${escapeXml(CREATOR)}" xmlns="http://www.topografix.com/GPX/1/1">\n` +
  `  <metadata><name>${escapeXml(name)}</name></metadata>\n`;

/** The planned route as a track, with the named waypoints. */
export function routeToGpx(route) {
  const wpts = route.waypoints
    .filter((w) => !w.hidden)
    .map((w) => `  <wpt lat="${w.lat}" lon="${w.lon}"><ele>${w.ele}</ele><name>${escapeXml(w.name)}</name></wpt>\n`)
    .join('');
  const pts = route.coordinates.map(([lat, lon, ele]) => `      <trkpt lat="${lat}" lon="${lon}"><ele>${ele}</ele></trkpt>\n`).join('');
  return `${header(route.name)}${wpts}  <trk><name>${escapeXml(route.name)}</name>\n    <trkseg>\n${pts}    </trkseg>\n  </trk>\n</gpx>\n`;
}

/**
 * A recorded track. `points` are [lat, lon, altitude|null, timestamp, startsNewSegment] as stored by the tracker;
 * pauses start a new <trkseg>.
 */
export function trackToGpx(points, name) {
  let body = '';
  points.forEach(([lat, lon, alt, t, brk], i) => {
    if (i === 0 || brk) body += `${i === 0 ? '' : '    </trkseg>\n'}    <trkseg>\n`;
    const ele = alt == null ? '' : `<ele>${alt}</ele>`;
    body += `      <trkpt lat="${lat}" lon="${lon}">${ele}<time>${new Date(t).toISOString()}</time></trkpt>\n`;
  });
  if (points.length) body += '    </trkseg>\n';
  return `${header(name)}  <trk><name>${escapeXml(name)}</name>\n${body}  </trk>\n</gpx>\n`;
}

/** Hand a text file to the browser as a download. */
export function downloadText(filename, text, type = 'application/gpx+xml') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
