// Exploration: score candidate trunks. A "line" = route short-name family (first token),
// represented by its dominant stop pattern in each direction.
// Usage: node scripts/corridor-candidates.mjs <gtfs-dir>
import { join } from 'node:path';
import { readCsv, gtfsTime, haversine } from './lib/csv.mjs';

const dir = process.argv[2];
const stops = new Map(readCsv(join(dir, 'stops.txt')).map((s) => [s.stop_id, { ...s, lat: +s.stop_lat, lon: +s.stop_lon }]));
const routes = new Map(readCsv(join(dir, 'routes.txt')).map((r) => [r.route_id, r]));
const trips = readCsv(join(dir, 'trips.txt')).filter((t) => t.trip_id.startsWith('MTC-') && t.service_id === 'MTC-Regular');
const tripById = new Map(trips.map((t) => [t.trip_id, t]));
const byTrip = new Map();
for (const st of readCsv(join(dir, 'stop_times.txt'))) {
  if (!tripById.has(st.trip_id)) continue;
  let a = byTrip.get(st.trip_id);
  if (!a) byTrip.set(st.trip_id, (a = []));
  a.push({ seq: +st.stop_sequence, stop: st.stop_id, t: gtfsTime(st.departure_time) });
}
for (const a of byTrip.values()) a.sort((x, y) => x.seq - y.seq);

const fam = new Map();
for (const t of trips) {
  const name = routes.get(t.route_id).route_short_name.trim().split(/\s+/)[0];
  let e = fam.get(name);
  if (!e) fam.set(name, (e = { name, trips: 0, patterns: new Map() }));
  e.trips++;
  const a = byTrip.get(t.trip_id);
  const key = a.map((x) => x.stop).join('>');
  let p = e.patterns.get(key);
  if (!p) e.patterns.set(key, (p = { n: 0, stops: a.map((x) => x.stop), starts: [] }));
  p.n++;
  p.starts.push(a[0].t);
}
const dist = (a, b) => haversine(stops.get(a).lat, stops.get(a).lon, stops.get(b).lat, stops.get(b).lon);
const lines = [];
for (const e of fam.values()) {
  const pats = [...e.patterns.values()].sort((a, b) => b.n - a.n);
  const A = pats[0];
  const B = pats.find((p) => p !== A && dist(p.stops[0], A.stops[A.stops.length - 1]) < 700 && dist(p.stops[p.stops.length - 1], A.stops[0]) < 700);
  if (!B) continue;
  if (A.n < 40 || B.n < 40) continue;
  lines.push({ name: e.name, famTrips: e.trips, A, B, n: A.n + B.n });
}
console.log('lines with a dominant pattern pair (>=40 trips each way):', lines.length);

// shared stop ids between directions?
let shared = 0, tot = 0;
for (const l of lines.slice(0, 50)) { const sb = new Set(l.B.stops); for (const s of l.A.stops) { tot++; if (sb.has(s)) shared++; } }
console.log(`stop ids shared between opposite directions (sample): ${shared}/${tot}`);

// directed segment -> lines
const seg = new Map();
for (const l of lines) for (const p of [l.A, l.B]) for (let i = 1; i < p.stops.length; i++) {
  const k = p.stops[i - 1] + '>' + p.stops[i];
  let e = seg.get(k);
  if (!e) seg.set(k, (e = { k, n: 0, lines: new Map() }));
  e.n += p.n;
  e.lines.set(l.name, p.n);
}
const segs = [...seg.values()].sort((a, b) => b.n - a.n);
const seen = new Set();
const cands = [];
for (const s of segs.slice(0, 400)) {
  const top = [...s.lines.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length < 6) continue;
  const key = top.map((x) => x[0]).sort().join(',');
  if (seen.has(key)) continue;
  seen.add(key);
  const chosen = top.map(([n]) => lines.find((l) => l.name === n));
  // trunk = stops (in seed line's direction pattern) served by >= 5 of the chosen lines in the same direction
  const seedLine = chosen[0];
  const seedPat = [seedLine.A, seedLine.B].find((p) => p.stops.join('>').includes(s.k));
  const idx = seedPat.stops.findIndex((x, i) => i > 0 && seedPat.stops[i - 1] + '>' + x === s.k);
  const servedBy = (i) => {
    if (i < 1 || i >= seedPat.stops.length) return 0;
    const k = seedPat.stops[i - 1] + '>' + seedPat.stops[i];
    const e = seg.get(k);
    return chosen.filter((l) => e.lines.has(l.name)).length;
  };
  let lo = idx, hi = idx;
  while (servedBy(lo - 1) >= 5) lo--;
  while (servedBy(hi + 1) >= 5) hi++;
  let km = 0, tripKm = 0;
  for (let i = lo; i <= hi; i++) {
    const d = dist(seedPat.stops[i - 1], seedPat.stops[i]) / 1000;
    km += d;
    const e = seg.get(seedPat.stops[i - 1] + '>' + seedPat.stops[i]);
    for (const l of chosen) tripKm += (e.lines.get(l.name) || 0) * d;
  }
  const totalTrips = chosen.reduce((a, l) => a + l.n, 0);
  const maxStops = Math.max(...chosen.map((l) => Math.max(l.A.stops.length, l.B.stops.length)));
  cands.push({ key, chosen, trunkFrom: stops.get(seedPat.stops[lo - 1]).stop_name, trunkTo: stops.get(seedPat.stops[hi]).stop_name, trunkStops: hi - lo + 2, km, tripKm, totalTrips, segN: s.n, maxStops });
}
cands.sort((a, b) => b.tripKm - a.tripKm);
for (const c of cands.slice(0, 14)) {
  console.log(`\ntrunk ${c.trunkFrom} -> ${c.trunkTo}  stops=${c.trunkStops} km=${c.km.toFixed(1)} trunkTripKm(one dir)=${Math.round(c.tripKm)} linesTrips/day=${c.totalTrips}`);
  for (const l of c.chosen) console.log(`   ${l.name.padEnd(6)} ${l.A.n}+${l.B.n}  ${l.A.stops.length} stops  ${stops.get(l.A.stops[0]).stop_name} <-> ${stops.get(l.A.stops[l.A.stops.length - 1]).stop_name}`);
}
