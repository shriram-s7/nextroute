// Preprocess the validated Chennai GTFS feed into the compact corridor bundle used by the app.
// Usage: node scripts/build-corridor.mjs <gtfs-dir> <out.json>
// Needs VITE_MAPBOX_TOKEN (.env) for the one-time road snapping (Mapbox Directions API).
// Responses are cached in data/directions-cache so re-runs make no API calls.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { readCsv, gtfsTime, haversine } from './lib/csv.mjs';

const [gtfsDir, outPath] = process.argv.slice(2);
if (!gtfsDir || !outPath) { console.error('usage: build-corridor.mjs <gtfs-dir> <out.json>'); process.exit(2); }
const CACHE_DIR = 'data/directions-cache';
mkdirSync(CACHE_DIR, { recursive: true });
let TOKEN = process.env.VITE_MAPBOX_TOKEN;
if (!TOKEN && existsSync('.env')) {
  const m = /^VITE_MAPBOX_TOKEN=(.*)$/m.exec(readFileSync('.env', 'utf8'));
  if (m) TOKEN = m[1].trim();
}

const N_LINES = 7;
const MIN_BALANCE = 0.8; // min(nA,nB)/max(nA,nB): excludes lopsided timetables that need unscheduled deadheading

// ---------- load ----------
const stopsRaw = readCsv(join(gtfsDir, 'stops.txt'));
const stops = new Map(stopsRaw.map((s) => [s.stop_id, { id: s.stop_id, name: s.stop_name.trim(), lat: +s.stop_lat, lon: +s.stop_lon }]));
const routes = new Map(readCsv(join(gtfsDir, 'routes.txt')).map((r) => [r.route_id, r]));
const trips = readCsv(join(gtfsDir, 'trips.txt')).filter((t) => t.trip_id.startsWith('MTC-') && t.service_id === 'MTC-Regular');
const tripById = new Map(trips.map((t) => [t.trip_id, t]));
const feedInfo = readCsv(join(gtfsDir, 'feed_info.txt'))[0] || {};
const byTrip = new Map();
for (const st of readCsv(join(gtfsDir, 'stop_times.txt'))) {
  if (!tripById.has(st.trip_id)) continue;
  let a = byTrip.get(st.trip_id);
  if (!a) byTrip.set(st.trip_id, (a = []));
  a.push({ seq: +st.stop_sequence, stop: st.stop_id, t: gtfsTime(st.departure_time || st.arrival_time) });
}
for (const a of byTrip.values()) a.sort((x, y) => x.seq - y.seq);
const totalMtcTrips = trips.length;

// ---------- whole-feed stats ----------
const stopTrips = new Map(); // trips/day calling at each stop (all MTC weekday trips)
const segAll = new Map(); // directed stop pair -> trips/day
for (const t of trips) {
  const a = byTrip.get(t.trip_id);
  for (let i = 0; i < a.length; i++) {
    stopTrips.set(a[i].stop, (stopTrips.get(a[i].stop) || 0) + 1);
    if (i > 0) { const k = a[i - 1].stop + '>' + a[i].stop; segAll.set(k, (segAll.get(k) || 0) + 1); }
  }
}
const [busiestKey, busiestN] = [...segAll.entries()].sort((a, b) => b[1] - a[1])[0];
const [bsA, bsB] = busiestKey.split('>');
console.log(`busiest directed segment in feed: ${stops.get(bsA).name} -> ${stops.get(bsB).name} (${busiestN} trips/day)`);

// ---------- line families and dominant pattern pairs ----------
const fam = new Map();
for (const t of trips) {
  const shortName = routes.get(t.route_id).route_short_name.trim();
  const name = shortName.split(/\s+/)[0];
  let e = fam.get(name);
  if (!e) fam.set(name, (e = { name, trips: 0, patterns: new Map() }));
  e.trips++;
  const a = byTrip.get(t.trip_id);
  const key = a.map((x) => x.stop).join('>');
  let p = e.patterns.get(key);
  if (!p) e.patterns.set(key, (p = { n: 0, stops: a.map((x) => x.stop), starts: [], offsets: [], shortNames: new Set(), routeIds: new Set() }));
  p.n++;
  p.starts.push(a[0].t);
  p.offsets.push(a.map((x) => x.t - a[0].t));
  p.shortNames.add(shortName);
  p.routeIds.add(t.route_id);
}
const sdist = (a, b) => haversine(stops.get(a).lat, stops.get(a).lon, stops.get(b).lat, stops.get(b).lon);
const cands = [];
for (const e of fam.values()) {
  const pats = [...e.patterns.values()].sort((a, b) => b.n - a.n);
  const A = pats[0];
  const B = pats.find((p) => p !== A && sdist(p.stops[0], A.stops[A.stops.length - 1]) < 700 && sdist(p.stops[p.stops.length - 1], A.stops[0]) < 700);
  if (!B) continue;
  const through = [A, B].find((p) => p.stops.some((s, i) => i > 0 && p.stops[i - 1] === bsA && s === bsB));
  if (!through) continue;
  const balance = Math.min(A.n, B.n) / Math.max(A.n, B.n);
  cands.push({ name: e.name, famTrips: e.trips, A, B, through: through.n, balance });
}
cands.sort((a, b) => b.through - a.through);
console.log('lines through the busiest segment (dominant pattern pair):');
for (const c of cands.slice(0, 12)) console.log(`  ${c.name.padEnd(6)} through=${c.through} pair=${c.A.n}+${c.B.n} balance=${c.balance.toFixed(2)} ${c.balance < MIN_BALANCE ? '(skipped: lopsided)' : ''}`);
const chosen = cands.filter((c) => c.balance >= MIN_BALANCE).slice(0, N_LINES);
const skipped = cands.slice(0, 12).filter((c) => c.balance < MIN_BALANCE && c.through >= chosen[chosen.length - 1].through).map((c) => c.name);

// ---------- road snapping (Mapbox Directions, cached) ----------
async function directions(coords) {
  const coordStr = coords.map((c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join(';');
  const key = createHash('sha1').update('v1|' + coordStr).digest('hex');
  const file = join(CACHE_DIR, key + '.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  if (!TOKEN) throw new Error('No VITE_MAPBOX_TOKEN and no cached response for a needed Directions request');
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?geometries=geojson&overview=full&steps=true&continue_straight=true&access_token=${TOKEN}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
    const json = await res.json();
    if (!res.ok || json.code !== 'Ok') throw new Error(`Directions failed: ${res.status} ${json.code || ''} ${json.message || ''}`);
    writeFileSync(file, JSON.stringify(json));
    await new Promise((r) => setTimeout(r, 150));
    return json;
  }
  throw new Error('Directions rate-limited');
}

function lineLen(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]); return d; }

/** Route through waypoints (chunks of <=25); returns per-leg geometries. */
async function routeLegs(pts) {
  const legs = [];
  for (let start = 0; start < pts.length - 1; start += 24) {
    const chunk = pts.slice(start, start + 25);
    const json = await directions(chunk);
    for (const leg of json.routes[0].legs) {
      const g = [];
      for (const step of leg.steps) for (const c of step.geometry.coordinates) {
        if (g.length && g[g.length - 1][0] === c[0] && g[g.length - 1][1] === c[1]) continue;
        g.push(c);
      }
      legs.push(g);
    }
  }
  return legs;
}

/** Snap a stop sequence to roads. Stops whose snapping causes a detour are dropped as waypoints and
 *  projected onto the final line instead. Legs that still detour fall back to a straight line. */
async function snapPattern(stopIds) {
  const pts = stopIds.map((id) => [stops.get(id).lon, stops.get(id).lat]);
  let active = pts.map((_, i) => i);
  let legs = [];
  const isBad = (g, a, b) => {
    const direct = haversine(pts[a][1], pts[a][0], pts[b][1], pts[b][0]);
    const d = lineLen(g);
    return d > direct * 1.9 + 250;
  };
  let droppedTotal = 0;
  for (let iter = 0; iter < 4; iter++) {
    legs = await routeLegs(active.map((i) => pts[i]));
    const bad = legs.map((g, j) => isBad(g, active[j], active[j + 1]));
    if (!bad.some(Boolean)) break;
    const drop = new Set();
    for (let j = 0; j < bad.length; j++) {
      if (!bad[j]) continue;
      // a wrong-side stop makes both its incoming and outgoing leg detour: drop the shared waypoint
      if (j + 1 < bad.length && bad[j + 1]) { drop.add(active[j + 1]); j++; }
      else if (j + 1 < active.length - 1) drop.add(active[j + 1]);
      else if (j > 0) drop.add(active[j]);
    }
    if (drop.size === 0 || iter === 3) break;
    droppedTotal += drop.size;
    active = active.filter((i) => !drop.has(i));
  }
  // final assembly with straight-line fallback for legs that still detour
  let straight = 0;
  const path = [];
  const wpPathIdx = [];
  for (let j = 0; j < legs.length; j++) {
    let g = legs[j];
    if (isBad(g, active[j], active[j + 1])) { g = [pts[active[j]], pts[active[j + 1]]]; straight++; }
    if (j === 0) { path.push(...g); } else { path.push(...g.slice(path[path.length - 1][0] === g[0][0] && path[path.length - 1][1] === g[0][1] ? 1 : 0)); }
    if (j === 0) wpPathIdx.push(0);
    wpPathIdx.push(path.length - 1);
  }
  // cumulative distance along path
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + haversine(path[i - 1][1], path[i - 1][0], path[i][1], path[i][0]));
  // position of each stop along path: active waypoints are exact; dropped stops are projected between neighbours
  const stopCum = new Array(pts.length).fill(NaN);
  active.forEach((si, j) => { stopCum[si] = cum[wpPathIdx[j]]; });
  for (let i = 0; i < pts.length; i++) {
    if (!Number.isNaN(stopCum[i])) continue;
    let lo = i - 1; while (Number.isNaN(stopCum[lo])) lo--;
    let hi = i + 1; while (Number.isNaN(stopCum[hi])) hi++;
    // nearest vertex-segment projection restricted to [stopCum[lo], stopCum[hi]]
    let best = Infinity, bestS = (stopCum[lo] + stopCum[hi]) / 2;
    for (let k = 1; k < path.length; k++) {
      if (cum[k] < stopCum[lo] || cum[k - 1] > stopCum[hi]) continue;
      const ax = path[k - 1][0], ay = path[k - 1][1], bx = path[k][0], by = path[k][1];
      const kx = Math.cos((pts[i][1] * Math.PI) / 180);
      const dx = (bx - ax) * kx, dy = by - ay;
      const px = (pts[i][0] - ax) * kx, py = pts[i][1] - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d < best) { best = d; bestS = cum[k - 1] + t * (cum[k] - cum[k - 1]); }
    }
    stopCum[i] = Math.min(stopCum[hi] - 1, Math.max(stopCum[lo] + 1, bestS));
  }
  return { path, stopCum, dropped: droppedTotal, straight };
}

/** Douglas-Peucker in metres (keeps listed indices). */
function simplify(path, tolM) {
  const keep = new Uint8Array(path.length);
  keep[0] = keep[path.length - 1] = 1;
  const stack = [[0, path.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const kx = Math.cos((path[a][1] * Math.PI) / 180) * 111320, ky = 110540;
    const ax = path[a][0] * kx, ay = path[a][1] * ky, bx = path[b][0] * kx, by = path[b][1] * ky;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let worst = -1, wi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = path[i][0] * kx - ax, py = path[i][1] * ky - ay;
      const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > worst) { worst = d; wi = i; }
    }
    if (worst > tolM) { keep[wi] = 1; stack.push([a, wi], [wi, b]); }
  }
  return path.filter((_, i) => keep[i]);
}

// ---------- assemble ----------
const stopIndex = new Map();
const outStops = [];
const addStop = (id) => {
  if (stopIndex.has(id)) return stopIndex.get(id);
  const s = stops.get(id);
  const idx = outStops.length;
  outStops.push({ id, name: s.name, lat: +s.lat.toFixed(5), lon: +s.lon.toFixed(5), feedTrips: stopTrips.get(id) || 0 });
  stopIndex.set(id, idx);
  return idx;
};
const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

const outLines = [];
const outPatterns = [];
let corridorTrips = 0;
for (const c of chosen) {
  const line = { id: c.name, name: c.name, patterns: [] };
  for (const [dirIdx, p] of [c.A, c.B].entries()) {
    const snap = await snapPattern(p.stops);
    const simplified = simplify(snap.path, 2.5);
    const lenM = snap.stopCum[snap.stopCum.length - 1];
    const nStops = p.stops.length;
    const offs = [];
    for (let i = 0; i < nStops; i++) offs.push(median(p.offsets.map((o) => o[i])));
    const departures = [...p.starts].sort((a, b) => a - b);
    const first = stops.get(p.stops[0]).name, last = stops.get(p.stops[nStops - 1]).name;
    corridorTrips += p.n;
    line.patterns.push(outPatterns.length);
    outPatterns.push({
      id: `${c.name}-${dirIdx === 0 ? 'A' : 'B'}`,
      line: c.name,
      dir: dirIdx,
      from: first,
      to: last,
      gtfsShortNames: [...p.shortNames],
      gtfsRouteIds: [...p.routeIds],
      stops: p.stops.map(addStop),
      stopDist: snap.stopCum.map((d) => Math.round(d)),
      schedOffsets: offs,
      departures,
      path: simplified.map((q) => [+q[0].toFixed(5), +q[1].toFixed(5)]),
      lengthM: Math.round(lenM),
      snapInfo: { droppedWaypoints: snap.dropped, straightLegs: snap.straight },
    });
    const directSum = p.stops.slice(1).reduce((a, s, i) => a + sdist(p.stops[i], s), 0);
    console.log(`  ${c.name}-${dirIdx === 0 ? 'A' : 'B'} ${first} -> ${last}: ${nStops} stops, ${p.n} trips, road ${(lenM / 1000).toFixed(1)} km (stop-to-stop straight ${(directSum / 1000).toFixed(1)} km), sched ${Math.round(offs[nStops - 1] / 60)} min, path pts ${snap.path.length}->${simplified.length}, dropped wp ${snap.dropped}, straight legs ${snap.straight}`);
  }
  outLines.push(line);
}

const bundle = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: {
      feed: 'Chennai unified GTFS (Ithu Ungal Soththu / ungalsoththu/ChennaiGTFS)',
      url: 'https://raw.githubusercontent.com/ungalsoththu/ChennaiGTFS/main/data/chennai-unified-gtfs.zip',
      feedVersion: feedInfo.feed_version || '',
      service: 'MTC-Regular (weekday)',
      geometry: 'Stop sequences from GTFS; road geometry snapped once at preprocessing with the Mapbox Directions API (the feed has no MTC shapes)',
    },
    selection: {
      rule: `Busiest directed stop-to-stop segment in the feed, then the ${N_LINES} lines (route short-name families, dominant stop pattern in each direction) with the most scheduled trips through it; lines whose two directions differ by more than ${Math.round((1 - MIN_BALANCE) * 100)}% in trips are skipped`,
      busiestSegment: { from: stops.get(bsA).name, to: stops.get(bsB).name, tripsPerDay: busiestN },
      skippedLopsided: skipped,
    },
    totals: { mtcWeekdayTripsInFeed: totalMtcTrips, corridorTrips, corridorTripShare: corridorTrips / totalMtcTrips },
  },
  stops: outStops,
  lines: outLines,
  patterns: outPatterns,
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(bundle));
console.log(`\nwrote ${outPath}: ${outStops.length} stops, ${outLines.length} lines, ${outPatterns.length} patterns, ${corridorTrips} trips/day (${((corridorTrips / totalMtcTrips) * 100).toFixed(2)}% of ${totalMtcTrips}), ${(JSON.stringify(bundle).length / 1024).toFixed(0)} KB`);
