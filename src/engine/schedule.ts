// Fleet and vehicle blocks derived from the GTFS timetable.
// Each line's scheduled departures are chained into blocks (one bus runs out, lays over, runs back…)
// with a first-in-first-out rule. The fleet size is whatever the timetable needs; nothing is invented.
import { BUS_TYPES, CAL, EV } from './config';
import type { Network } from './network';
import { hashUnit } from './rng';

export interface TripRef { pattern: number; dep: number; chargeBefore: boolean }

export interface BusSpec {
  id: number;
  code: string;
  line: number; // -1 for flex pool buses
  electric: boolean;
  seats: number;
  cap: number;
  pool: boolean;
  block: TripRef[];
}

export interface Fleet { buses: BusSpec[]; scheduled: number; pool: number; electric: number }

const ELECTRIC_SHARE = CAL.electricFleet / CAL.fleet;

export function buildFleet(net: Network, reserveShare: number): Fleet {
  const buses: BusSpec[] = [];
  for (const line of net.lines) {
    const trips: { pattern: number; dep: number }[] = [];
    for (const pi of line.patterns) for (const dep of net.patterns[pi].departures) trips.push({ pattern: pi, dep });
    trips.sort((a, b) => a.dep - b.dep || a.pattern - b.pattern);
    const active: { spec: BusSpec; availAt: number; next: number; kmSince: number; pendingCharge: boolean }[] = [];
    let k = 0;
    for (const tr of trips) {
      const p = net.patterns[tr.pattern];
      let best = -1;
      for (let i = 0; i < active.length; i++) {
        const a = active[i];
        if (a.next === tr.pattern && a.availAt <= tr.dep && (best < 0 || a.availAt < active[best].availAt)) best = i;
      }
      if (best < 0) {
        const electric = hashUnit(CAL.fleet, line.idx, k, CAL.electricFleet) < ELECTRIC_SHARE;
        const type = electric ? BUS_TYPES.electric : BUS_TYPES.diesel;
        const spec: BusSpec = {
          id: buses.length, code: `${line.id}-${String(k + 1).padStart(2, '0')}`, line: line.idx,
          electric, seats: type.seats, cap: type.cap, pool: false, block: [],
        };
        buses.push(spec);
        active.push({ spec, availAt: 0, next: tr.pattern, kmSince: 0, pendingCharge: false });
        best = active.length - 1;
        k++;
      }
      const a = active[best];
      a.spec.block.push({ pattern: tr.pattern, dep: tr.dep, chargeBefore: a.pendingCharge });
      a.pendingCharge = false;
      const layover = Math.max(300, 0.1 * p.schedRun);
      a.availAt = tr.dep + p.schedRun + layover;
      a.next = p.reverse;
      a.kmSince += p.lengthM / 1000;
      if (a.spec.electric && a.kmSince + net.patterns[p.reverse].lengthM / 1000 > EV.planKm) {
        a.availAt += EV.planBreak;
        a.pendingCharge = true;
        a.kmSince = 0;
      }
    }
  }
  const scheduled = buses.length;
  const pool = Math.round(reserveShare * scheduled);
  for (let i = 0; i < pool; i++) {
    const electric = hashUnit(CAL.fleet, 999, i, CAL.electricFleet) < ELECTRIC_SHARE;
    const type = electric ? BUS_TYPES.electric : BUS_TYPES.diesel;
    buses.push({ id: buses.length, code: `FX-${String(i + 1).padStart(2, '0')}`, line: -1, electric, seats: type.seats, cap: type.cap, pool: true, block: [] });
  }
  return { buses, scheduled, pool, electric: buses.filter((b) => b.electric).length };
}
