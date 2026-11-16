// Runtime network built from the preprocessed GTFS corridor bundle (src/data/corridor.json).
import { hash4 } from './rng';

export interface RawCorridor {
  meta: {
    generatedAt: string;
    source: { feed: string; url: string; feedVersion: string; service: string; geometry: string };
    selection: { rule: string; busiestSegment: { from: string; to: string; tripsPerDay: number }; skippedLopsided: string[] };
    totals: { mtcWeekdayTripsInFeed: number; corridorTrips: number; corridorTripShare: number };
  };
  stops: { id: string; name: string; lat: number; lon: number; feedTrips: number }[];
  lines: { id: string; name: string; patterns: number[] }[];
  patterns: {
    id: string; line: string; dir: number; from: string; to: string;
    gtfsShortNames: string[]; gtfsRouteIds: string[];
    stops: number[]; stopDist: number[]; schedOffsets: number[]; departures: number[];
    path: [number, number][]; lengthM: number;
    snapInfo: { droppedWaypoints: number; straightLegs: number };
  }[];
}

export interface Stop { idx: number; id: string; name: string; lat: number; lon: number; feedTrips: number }

export interface Pattern {
  idx: number;
  id: string;
  line: number;
  lineId: string;
  dir: number;
  from: string;
  to: string;
  stops: number[]; // global stop indices
  n: number;
  stopDist: number[]; // metres along path at each stop
  linkLen: number[]; // metres, link k = stop k -> k+1
  lengthM: number;
  schedOffsets: number[];
  schedRun: number; // scheduled end-to-end seconds
  departures: number[]; // scheduled start times within the simulated day (s since midnight)
  pathLon: Float64Array;
  pathLat: Float64Array;
  pathCum: Float64Array; // metres, rescaled so the last value == lengthM
  posOf: Int16Array; // global stop idx -> first index in this pattern, or -1
  reverse: number; // pattern idx of the opposite direction
  opp: Int16Array; // for each stop index: nearest stop index in the reverse pattern (-1 if none within 600 m)
  roadKey: Int32Array; // per link: key shared by all patterns using the same stop pair
  inbound: boolean; // heads towards the city centre
  depotIdx: number; // index of the depot stop on this pattern, or -1
  headwayBins: Float32Array; // scheduled headway (s) per 30-min bin of the day at stop 0
}

export interface Line { idx: number; id: string; patterns: [number, number] }

export interface Network {
  meta: RawCorridor['meta'];
  stops: Stop[];
  lines: Line[];
  patterns: Pattern[];
  depot: { name: string; lat: number; lon: number };
  maxStops: number;
  bbox: [number, number, number, number];
}

export const DAY_START = 4 * 3600;
export const DAY_END = 24 * 3600;
const CBD = { lat: 13.0827, lon: 80.2707 }; // Chennai Central

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371008.8, k = Math.PI / 180;
  const dLat = (lat2 - lat1) * k, dLon = (lon2 - lon1) * k;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * k) * Math.cos(lat2 * k) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function buildNetwork(raw: RawCorridor): Network {
  const stops: Stop[] = raw.stops.map((s, idx) => ({ idx, ...s }));
  const lineIdx = new Map(raw.lines.map((l, i) => [l.id, i]));
  const patterns: Pattern[] = raw.patterns.map((rp, idx) => {
    const n = rp.stops.length;
    const pathLon = new Float64Array(rp.path.length), pathLat = new Float64Array(rp.path.length), pathCum = new Float64Array(rp.path.length);
    for (let i = 0; i < rp.path.length; i++) {
      pathLon[i] = rp.path[i][0];
      pathLat[i] = rp.path[i][1];
      if (i > 0) pathCum[i] = pathCum[i - 1] + haversine(pathLat[i - 1], pathLon[i - 1], pathLat[i], pathLon[i]);
    }
    const scale = rp.lengthM / (pathCum[pathCum.length - 1] || 1);
    for (let i = 0; i < pathCum.length; i++) pathCum[i] *= scale;
    const posOf = new Int16Array(stops.length).fill(-1);
    rp.stops.forEach((s, i) => { if (posOf[s] < 0) posOf[s] = i; });
    const stopDist = rp.stopDist.slice();
    for (let i = 1; i < n; i++) if (stopDist[i] <= stopDist[i - 1]) stopDist[i] = stopDist[i - 1] + 1;
    const linkLen: number[] = [];
    for (let i = 0; i < n - 1; i++) linkLen.push(stopDist[i + 1] - stopDist[i]);
    const roadKey = new Int32Array(n - 1);
    for (let i = 0; i < n - 1; i++) roadKey[i] = hash4(rp.stops[i], rp.stops[i + 1], 77, 0) | 0;
    const departures = rp.departures.filter((d) => d >= DAY_START && d < DAY_END - 600).sort((a, b) => a - b);
    const headwayBins = new Float32Array(48).fill(1800);
    for (let b = 0; b < 48; b++) {
      const c = departures.filter((d) => d >= b * 1800 - 900 && d < b * 1800 + 2700).length; // 1-hour window centred on the bin
      headwayBins[b] = c > 0 ? 3600 / c : 3600;
    }
    const a = stops[rp.stops[0]], z = stops[rp.stops[n - 1]];
    return {
      idx, id: rp.id, line: lineIdx.get(rp.line)!, lineId: rp.line, dir: rp.dir, from: rp.from, to: rp.to,
      stops: rp.stops, n, stopDist, linkLen, lengthM: stopDist[n - 1], schedOffsets: rp.schedOffsets,
      schedRun: rp.schedOffsets[n - 1], departures, pathLon, pathLat, pathCum, posOf,
      reverse: -1, opp: new Int16Array(n).fill(-1), roadKey,
      inbound: haversine(z.lat, z.lon, CBD.lat, CBD.lon) < haversine(a.lat, a.lon, CBD.lat, CBD.lon),
      depotIdx: -1, headwayBins,
    };
  });
  const lines: Line[] = raw.lines.map((l, idx) => ({ idx, id: l.id, patterns: [l.patterns[0], l.patterns[1]] }));
  for (const l of lines) {
    patterns[l.patterns[0]].reverse = l.patterns[1];
    patterns[l.patterns[1]].reverse = l.patterns[0];
  }
  for (const p of patterns) {
    const r = patterns[p.reverse];
    for (let i = 0; i < p.n; i++) {
      const s = stops[p.stops[i]];
      let best = 600, bi = -1;
      for (let j = 0; j < r.n; j++) {
        const q = stops[r.stops[j]];
        const d = haversine(s.lat, s.lon, q.lat, q.lon);
        if (d < best) { best = d; bi = j; }
      }
      p.opp[i] = bi;
    }
  }
  // Depot = the terminus that starts the most patterns (flex pool is parked there).
  const startCount = new Map<string, { n: number; lat: number; lon: number }>();
  for (const p of patterns) {
    const s = stops[p.stops[0]];
    const e = startCount.get(s.name) || { n: 0, lat: 0, lon: 0 };
    e.n++; e.lat += s.lat; e.lon += s.lon;
    startCount.set(s.name, e);
  }
  const [depName, dep] = [...startCount.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  const depot = { name: depName, lat: dep.lat / dep.n, lon: dep.lon / dep.n };
  for (const p of patterns) {
    for (let i = 0; i < p.n; i++) {
      const s = stops[p.stops[i]];
      if (haversine(s.lat, s.lon, depot.lat, depot.lon) < 450) { p.depotIdx = i; if (i === 0) break; }
    }
  }
  let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
  for (const s of stops) { minLon = Math.min(minLon, s.lon); maxLon = Math.max(maxLon, s.lon); minLat = Math.min(minLat, s.lat); maxLat = Math.max(maxLat, s.lat); }
  return { meta: raw.meta, stops, lines, patterns, depot, maxStops: Math.max(...patterns.map((p) => p.n)), bbox: [minLon, minLat, maxLon, maxLat] };
}

/** Position and bearing at distance s (metres) along a pattern. Writes [lon, lat, bearingDeg] into out. */
export function pointAt(p: Pattern, s: number, out: Float64Array | number[]): void {
  const cum = p.pathCum;
  const last = cum.length - 1;
  if (s <= 0) s = 0;
  if (s >= cum[last]) s = cum[last];
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const span = cum[hi] - cum[lo];
  const f = span > 0 ? (s - cum[lo]) / span : 0;
  const lon0 = p.pathLon[lo], lat0 = p.pathLat[lo], lon1 = p.pathLon[hi], lat1 = p.pathLat[hi];
  out[0] = lon0 + (lon1 - lon0) * f;
  out[1] = lat0 + (lat1 - lat0) * f;
  const dx = (lon1 - lon0) * Math.cos((lat0 * Math.PI) / 180), dy = lat1 - lat0;
  out[2] = (Math.atan2(dx, dy) * 180) / Math.PI;
}

/** Scheduled headway (s) of a pattern at stop index j around time t. */
export function schedHeadway(p: Pattern, j: number, t: number): number {
  const b = Math.max(0, Math.min(47, Math.floor((t - p.schedOffsets[j]) / 1800)));
  return p.headwayBins[b];
}

export function hhmm(t: number): string {
  const m = Math.floor(t / 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
