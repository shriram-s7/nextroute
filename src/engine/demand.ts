// Simulated passengers: individual agents with an origin stop, a destination stop and an arrival time.
// Generated once per run from the seed; the baseline and Samam arms share the exact same list.
import { CAL, DEMAND, SCENARIOS, demandWeight, rainAt, type RunOptions } from './config';
import { DAY_END, DAY_START, haversine, type Network } from './network';
import { Rng, hashUnit } from './rng';

export interface Passengers {
  n: number;
  origin: Uint16Array; // global stop index
  dest: Uint16Array; // global stop index
  t: Float32Array; // arrival time at the origin stop (s since midnight), ascending
  ticket: Uint8Array; // 1 if this boarding produces an ETM ticket record
  surgeCount: number;
}

const STEP = 300;

function sampleCdf(cdf: Float64Array, u: number): number {
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < u) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function toCdf(w: number[]): Float64Array | null {
  const cdf = new Float64Array(w.length);
  let s = 0;
  for (let i = 0; i < w.length; i++) { s += w[i]; cdf[i] = s; }
  if (s <= 0) return null;
  for (let i = 0; i < w.length; i++) cdf[i] /= s;
  cdf[w.length - 1] = 1;
  return cdf;
}

export function defaultSurgeStop(net: Network): number {
  const name = net.meta.selection.busiestSegment.from;
  const s = net.stops.find((x) => x.name === name);
  return s ? s.idx : net.patterns[0].stops[Math.floor(net.patterns[0].n / 2)];
}

export function generatePassengers(net: Network, opts: RunOptions): Passengers {
  const sc = SCENARIOS[opts.scenario];
  const rng = new Rng(opts.seed * 7919 + 101);
  const perTrip = CAL.dailyPassengers / net.meta.totals.mtcWeekdayTripsInFeed;
  const O: number[] = [], D: number[] = [], T: number[] = [];
  const nSteps = (DAY_END - DAY_START) / STEP;

  // per-pattern samplers (also reused by the surge)
  const samplers = net.patterns.map((p) => {
    const sw = p.stops.map((s) => Math.pow(Math.max(1, net.stops[s].feedTrips), DEMAND.stopWeightExp));
    const destCdf: (Float64Array | null)[] = [];
    const ow: number[] = [];
    for (let i = 0; i < p.n; i++) {
      const w: number[] = new Array(p.n).fill(0);
      let any = 0;
      for (let j = i + 1; j < p.n; j++) {
        if (p.stops[j] === p.stops[i]) continue;
        const d = p.stopDist[j] - p.stopDist[i];
        w[j] = sw[j] * Math.exp(-d / DEMAND.decayM) * (d < DEMAND.shortTripM ? DEMAND.shortTripFactor : 1);
        any += w[j];
      }
      destCdf.push(any > 0 ? toCdf(w) : null);
      ow.push(any > 0 ? sw[i] : 0);
    }
    const tw: number[] = [];
    let base = 0, withRain = 0;
    for (let k = 0; k < nSteps; k++) {
      const t = DAY_START + (k + 0.5) * STEP;
      const w = demandWeight(t, p.inbound);
      const r = sc.rain ? 1 + (sc.rain.demandMult - 1) * rainAt(sc, t) : 1;
      base += w; withRain += w * r;
      tw.push(w * r);
    }
    return { originCdf: toCdf(ow)!, destCdf, timeCdf: toCdf(tw)!, boost: withRain / base };
  });

  for (const p of net.patterns) {
    if (p.departures.length === 0) continue;
    const sm = samplers[p.idx];
    const N = Math.round(p.departures.length * perTrip * opts.demandScale * sm.boost);
    const first = p.departures[0], last = p.departures[p.departures.length - 1];
    for (let k = 0; k < N; k++) {
      const i = sampleCdf(sm.originCdf, rng.next());
      const j = sampleCdf(sm.destCdf[i]!, rng.next());
      // people only turn up while the pattern is running at their stop
      const lo = first + p.schedOffsets[i] - 300, hi = last + p.schedOffsets[i] - 120;
      let t = 0, ok = false;
      for (let tries = 0; tries < 8 && !ok; tries++) {
        t = DAY_START + (sampleCdf(sm.timeCdf, rng.next()) + rng.next()) * STEP;
        ok = t >= lo && t <= hi;
      }
      if (!ok) t = lo + rng.next() * (hi - lo);
      O.push(p.stops[i]); D.push(p.stops[j]); T.push(t);
    }
  }

  // event surge: extra riders at the chosen stop (and its twin across the road)
  let surgeCount = 0;
  if (sc.surge) {
    const stopIdx = opts.surgeStop ?? defaultSurgeStop(net);
    const t0 = opts.surgeTime ?? sc.surge.t;
    const S = net.stops[stopIdx];
    const cand: { p: number; i: number; w: number }[] = [];
    for (const p of net.patterns) {
      for (let i = 0; i < p.n - 1; i++) {
        const q = net.stops[p.stops[i]];
        if (p.stops[i] === stopIdx || haversine(q.lat, q.lon, S.lat, S.lon) < 350) {
          if (samplers[p.idx].destCdf[i]) cand.push({ p: p.idx, i, w: p.departures.length });
          break;
        }
      }
    }
    const cdf = cand.length ? toCdf(cand.map((c) => c.w)) : null;
    if (cdf) {
      const N = Math.round(sc.surge.pax * opts.demandScale);
      for (let k = 0; k < N; k++) {
        const c = cand[sampleCdf(cdf, rng.next())];
        const p = net.patterns[c.p];
        const j = sampleCdf(samplers[c.p].destCdf[c.i]!, rng.next());
        const t = t0 + ((rng.next() + rng.next()) / 2) * sc.surge.dur;
        O.push(p.stops[c.i]); D.push(p.stops[j]); T.push(t);
        surgeCount++;
      }
    }
  }

  const n = T.length;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => T[a] - T[b] || a - b);
  const pax: Passengers = { n, origin: new Uint16Array(n), dest: new Uint16Array(n), t: new Float32Array(n), ticket: new Uint8Array(n), surgeCount };
  for (let i = 0; i < n; i++) {
    const k = order[i];
    pax.origin[i] = O[k]; pax.dest[i] = D[k]; pax.t[i] = T[k];
    pax.ticket[i] = hashUnit(opts.seed, 555, i) < DEMAND.ticketShare ? 1 : 0;
  }
  return pax;
}
