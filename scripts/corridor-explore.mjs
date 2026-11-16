// Exploration: find busy trunk sections shared by several frequent routes.
// Usage: node scripts/corridor-explore.mjs <gtfs-dir>
import { join } from 'node:path';
import { readCsv, gtfsTime } from './lib/csv.mjs';

const dir = process.argv[2];
const stops = new Map(readCsv(join(dir, 'stops.txt')).map((s) => [s.stop_id, s]));
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

// trips per short name
const byName = new Map();
for (const t of trips) {
  const name = routes.get(t.route_id).route_short_name;
  let e = byName.get(name);
  if (!e) byName.set(name, (e = { name, trips: 0, routeIds: new Set(), patterns: new Map() }));
  e.trips++;
  e.routeIds.add(t.route_id);
  const a = byTrip.get(t.trip_id);
  const key = a.map((x) => x.stop).join('>');
  const p = e.patterns.get(key) || { n: 0, stops: a.map((x) => x.stop), dir: t.direction_id, dur: a[a.length - 1].t - a[0].t };
  p.n++;
  e.patterns.set(key, p);
}
const names = [...byName.values()].sort((a, b) => b.trips - a.trips);
console.log('route short names:', names.length, ' total trips', trips.length);
console.log('TOP 40 by scheduled trips/day:');
for (const e of names.slice(0, 40)) {
  const pats = [...e.patterns.values()].sort((a, b) => b.n - a.n);
  const p = pats[0];
  console.log(`${e.name.padEnd(8)} trips=${String(e.trips).padStart(4)} routeIds=${e.routeIds.size} patterns=${pats.length} top: n=${p.n} stops=${p.stops.length} dur=${Math.round(p.dur / 60)}m ${stops.get(p.stops[0]).stop_name} -> ${stops.get(p.stops[p.stops.length - 1]).stop_name}`);
}

// segment volumes
const seg = new Map();
for (const t of trips) {
  const a = byTrip.get(t.trip_id);
  const name = routes.get(t.route_id).route_short_name;
  for (let i = 1; i < a.length; i++) {
    const k = a[i - 1].stop + '>' + a[i].stop;
    let e = seg.get(k);
    if (!e) seg.set(k, (e = { k, n: 0, names: new Map() }));
    e.n++;
    e.names.set(name, (e.names.get(name) || 0) + 1);
  }
}
const segs = [...seg.values()].sort((a, b) => b.n - a.n);
console.log('\nTOP 40 directed stop-to-stop segments by trips/day:');
for (const s of segs.slice(0, 40)) {
  const [a, b] = s.k.split('>');
  const top = [...s.names.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([n, c]) => `${n}:${c}`).join(' ');
  console.log(`${String(s.n).padStart(5)}  ${stops.get(a).stop_name} -> ${stops.get(b).stop_name}  [${s.names.size} routes] ${top}`);
}

// time-of-day distribution of trip starts
const hist = new Array(24).fill(0);
for (const t of trips) { const a = byTrip.get(t.trip_id); hist[Math.floor(a[0].t / 3600) % 24]++; }
console.log('\ntrip starts by hour:', hist.join(' '));
