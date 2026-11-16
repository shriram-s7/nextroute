// Validates the Chennai GTFS feed before anything is built on it.
// Usage: node scripts/gtfs-validate.mjs <gtfs-dir> [report.json]
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readCsv, gtfsTime, haversine } from './lib/csv.mjs';

const dir = process.argv[2];
const reportPath = process.argv[3];
if (!dir) { console.error('usage: gtfs-validate.mjs <gtfs-dir> [report.json]'); process.exit(2); }

// Generous Chennai Metropolitan Area box (MTC runs to Mahabalipuram, Chengalpattu, Tiruvallur…)
const BBOX = { latMin: 12.3, latMax: 13.7, lonMin: 79.5, lonMax: 80.5 };
const inBox = (lat, lon) => lat >= BBOX.latMin && lat <= BBOX.latMax && lon >= BBOX.lonMin && lon <= BBOX.lonMax;

const report = { bbox: BBOX, checks: [], ok: true };
const check = (name, pass, detail) => {
  report.checks.push({ name, pass, detail });
  if (!pass) report.ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
};

const stops = readCsv(join(dir, 'stops.txt'));
const routes = readCsv(join(dir, 'routes.txt'));
const trips = readCsv(join(dir, 'trips.txt'));
const stopTimes = readCsv(join(dir, 'stop_times.txt'));
const shapes = existsSync(join(dir, 'shapes.txt')) ? readCsv(join(dir, 'shapes.txt')) : [];
const agencies = readCsv(join(dir, 'agency.txt'));

console.log(`rows: stops=${stops.length} routes=${routes.length} trips=${trips.length} stop_times=${stopTimes.length} shapes=${shapes.length}`);
console.log('agencies:', agencies.map((a) => `${a.agency_id}:${a.agency_name}`).join(' | '));

// ---- stops ----
const stopById = new Map();
let badCoord = 0, outside = 0;
const outsideSamples = [];
for (const s of stops) {
  const lat = parseFloat(s.stop_lat), lon = parseFloat(s.stop_lon);
  s.lat = lat; s.lon = lon;
  stopById.set(s.stop_id, s);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) { badCoord++; continue; }
  if (!inBox(lat, lon)) { outside++; if (outsideSamples.length < 8) outsideSamples.push(`${s.stop_id} ${s.stop_name} (${lat},${lon})`); }
}
const mtcStops = stops.filter((s) => s.stop_id.startsWith('MTC-'));
const mtcOutside = mtcStops.filter((s) => !inBox(s.lat, s.lon));
check('stop coordinates parse', badCoord === 0, `${badCoord} unparseable of ${stops.length}`);
check('all stops inside Chennai region', outside / stops.length < 0.005,
  `${outside} of ${stops.length} outside bbox; samples: ${outsideSamples.join('; ') || 'none'}`);
check('MTC stops inside Chennai region', mtcOutside.length / Math.max(1, mtcStops.length) < 0.005,
  `${mtcOutside.length} of ${mtcStops.length} MTC stops outside bbox`);
// The old broken feed had New York stops (lat ~40.7, lon ~-74). Explicit check.
const nyc = stops.filter((s) => s.lat > 40 && s.lat < 41.5 && s.lon < -73 && s.lon > -75);
check('no New York coordinates', nyc.length === 0, `${nyc.length} stops near NYC`);
const lats = mtcStops.map((s) => s.lat).sort((a, b) => a - b), lons = mtcStops.map((s) => s.lon).sort((a, b) => a - b);
const med = (a) => a[Math.floor(a.length / 2)];
check('MTC stop centroid is Chennai', Math.abs(med(lats) - 13.05) < 0.25 && Math.abs(med(lons) - 80.2) < 0.25,
  `median lat/lon = ${med(lats)}, ${med(lons)}`);

// ---- routes / trips ----
const routeById = new Map(routes.map((r) => [r.route_id, r]));
const mtcRoutes = routes.filter((r) => r.agency_id === '69' || r.route_id.startsWith('MTC-'));
check('MTC bus routes present', mtcRoutes.length > 100, `${mtcRoutes.length} MTC routes (route_type set: ${[...new Set(mtcRoutes.map((r) => r.route_type))].join(',')})`);
const tripById = new Map(trips.map((t) => [t.trip_id, t]));
const orphanTrips = trips.filter((t) => !routeById.has(t.route_id)).length;
check('trips reference valid routes', orphanTrips === 0, `${orphanTrips} orphan trips of ${trips.length}`);

// ---- stop_times ----
const byTrip = new Map();
let orphanSt = 0, badStop = 0, badTime = 0;
for (const st of stopTimes) {
  if (!tripById.has(st.trip_id)) { orphanSt++; continue; }
  if (!stopById.has(st.stop_id)) badStop++;
  const t = gtfsTime(st.departure_time || st.arrival_time);
  if (!Number.isFinite(t)) badTime++;
  let arr = byTrip.get(st.trip_id);
  if (!arr) byTrip.set(st.trip_id, (arr = []));
  arr.push({ seq: +st.stop_sequence, stop: st.stop_id, t });
}
check('stop_times reference valid trips', orphanSt === 0, `${orphanSt} orphan rows`);
check('stop_times reference valid stops', badStop === 0, `${badStop} rows with unknown stop`);
check('stop_times have parseable times', badTime / stopTimes.length < 0.01, `${badTime} of ${stopTimes.length} rows without a time`);

let mtcTrips = 0, tripsNoSt = 0, nonMono = 0, timeBackwards = 0, jumpy = 0, short = 0;
const speedSamples = [];
for (const t of trips) {
  if (!t.trip_id.startsWith('MTC-')) continue;
  mtcTrips++;
  const arr = byTrip.get(t.trip_id);
  if (!arr || arr.length < 2) { tripsNoSt++; continue; }
  arr.sort((a, b) => a.seq - b.seq);
  if (arr.length < 5) short++;
  let mono = true, back = false, jump = false, dist = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i].seq === arr[i - 1].seq) mono = false;
    if (arr[i].t < arr[i - 1].t) back = true;
    const a = stopById.get(arr[i - 1].stop), b = stopById.get(arr[i].stop);
    if (a && b) {
      const d = haversine(a.lat, a.lon, b.lat, b.lon);
      dist += d;
      if (d > 8000) jump = true;
    }
  }
  if (!mono) nonMono++;
  if (back) timeBackwards++;
  if (jump) jumpy++;
  const dur = arr[arr.length - 1].t - arr[0].t;
  if (dur > 0 && speedSamples.length < 20000) speedSamples.push((dist / dur) * 3.6);
}
check('MTC trips have stop sequences', tripsNoSt / mtcTrips < 0.01, `${tripsNoSt} of ${mtcTrips} MTC trips lack ≥2 stop_times`);
check('stop sequences strictly increasing', nonMono / mtcTrips < 0.01, `${nonMono} trips with duplicate sequence numbers`);
check('times non-decreasing along trips', timeBackwards / mtcTrips < 0.01, `${timeBackwards} trips go backwards in time`);
check('consecutive stops are plausibly close', jumpy / mtcTrips < 0.05, `${jumpy} of ${mtcTrips} trips have a >8 km hop between consecutive stops`);
speedSamples.sort((a, b) => a - b);
const q = (p) => speedSamples[Math.floor(p * (speedSamples.length - 1))];
check('scheduled speeds plausible for city buses', q(0.5) > 8 && q(0.5) < 45,
  `straight-line schedule speed km/h p10=${q(0.1).toFixed(1)} p50=${q(0.5).toFixed(1)} p90=${q(0.9).toFixed(1)}`);

// ---- shapes ----
const shapeIds = new Set(shapes.map((s) => s.shape_id));
const mtcTripsWithShape = trips.filter((t) => t.trip_id.startsWith('MTC-') && t.shape_id && shapeIds.has(t.shape_id)).length;
report.mtcShapes = { shapeIdsInFeed: shapeIds.size, mtcTripsWithShape };
console.log(`INFO  shapes — ${shapeIds.size} shape ids in feed (${[...shapeIds].slice(0, 6).join(', ')}…); MTC trips with a shape: ${mtcTripsWithShape} of ${mtcTrips}`);
report.shapesUsableForMtc = mtcTripsWithShape > 0;

// ---- service ids ----
const svc = {};
for (const t of trips) if (t.trip_id.startsWith('MTC-')) svc[t.service_id] = (svc[t.service_id] || 0) + 1;
console.log('INFO  MTC trips by service_id:', JSON.stringify(svc));
report.mtcTripsByService = svc;
report.counts = { stops: stops.length, mtcStops: mtcStops.length, routes: routes.length, mtcRoutes: mtcRoutes.length, trips: trips.length, mtcTrips, stopTimes: stopTimes.length };

console.log(`\nRESULT: ${report.ok ? 'FEED USABLE' : 'FEED FAILED VALIDATION'}${report.shapesUsableForMtc ? '' : ' (no MTC shapes: road geometry must come from map-matching at preprocess time)'}`);
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
