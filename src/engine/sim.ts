// One simulation arm (baseline or Samam). Fixed 1-second time step, fully deterministic for a seed.
// Ground truth lives here; the controller only ever reads GPS positions, sensor-derived estimates,
// ticket records and the timetable.
import {
  N_BINS, CTRL, DEMAND, DWELL, EV, SCENARIOS, SENSOR, TRAFFIC, bandOf, binOf, congestion, rainAt,
  type RunOptions, type Scenario,
} from './config';
import { Controller } from './controller';
import type { Passengers } from './demand';
import { Forecaster, type ForecastModel } from './forecast';
import { DAY_END, DAY_START, pointAt, schedHeadway, type Network, type Pattern } from './network';
import { Rng, hashNormal, hashUnit } from './rng';
import type { Fleet } from './schedule';

export const ST = { OUT: 0, LAYOVER: 1, DWELL: 2, HOLD: 3, RUN: 4, CHARGE: 5, BROKEN: 6 } as const;
export const ST_NAMES = ['Out of service', 'Layover', 'At stop', 'Holding', 'Running', 'Charging', 'Broken down'];
export const RUN_KIND = { SCHED: 0, SHORT: 1, FLEX: 2, COVER: 3 } as const;

export interface Run { pattern: number; from: number; to: number; dep: number; kind: number; chargeBefore: boolean; recId: number }

export interface HoldPlan { idx: number; sec: number; recId: number; approved: boolean; hf: number; hb: number }

export interface Bus {
  id: number; code: string; line: number; electric: boolean; seats: number; cap: number; pool: boolean;
  state: number; pattern: number; idx: number; s: number; v: number; timer: number;
  run: Run | null; runs: Run[]; runPos: number;
  load: number; pax: number[]; ticketOn: number;
  km: number; tripNo: number; soc: number; runStartT: number;
  // sensor (truth side)
  door: boolean; fault: number; faultAt: number; faultKind: number; faultDone: boolean; manualBlock: boolean;
  doorEst: number; cctvBias: number; stuck: number; stopB: number; stopA: number; stopTickets: number;
  // estimator (what the control room believes)
  est: number; estSrc: number; conf: number; health: number; nullStreak: number; suspicion: number; agree: number; sawLoad: boolean;
  detectedAt: number; lastCount: number | null; lastTicketEst: number;
  // control
  hold: HoldPlan | null; holdingSec: number; bunchedUntil: number; bunchPair: number; breakPending: boolean; poolAt: number;
  // trace of the current trip (for the detail panel)
  trIdx: number[]; trLoad: number[]; trEst: number[];
}

export type RecKind = 'hold' | 'short' | 'flex' | 'cover' | 'alert';
export type RecStatus = 'pending' | 'applied' | 'rejected' | 'expired' | 'info';
export interface Rec {
  id: number; t: number; kind: RecKind; status: RecStatus; auto: boolean;
  bus: number; line: string; pattern: number; stop: number;
  title: string; reason: string; effect: string; expires: number; lon: number; lat: number;
  data?: unknown;
}

export interface SimConfig {
  samam: boolean;
  mode: 'auto' | 'manual';
  levers: { hold: boolean; short: boolean; flex: boolean };
  model: ForecastModel | null;
  /** keep the forecaster updating even without the controller (used by the training script) */
  collect?: boolean;
}

export interface Kpis {
  t: number;
  generated: number; waiting: number; onboard: number; arrived: number;
  avgWait: number; p90Wait: number; avgJourney: number; avgRide: number;
  leftBehind: number; leftUnique: number;
  peakLoad: number; maxLoad: number; peakLoadFactor: number; crushShare: number;
  bunching: number; busKm: number;
  boardings: number; departures: number;
  holds: number; holdSec: number; shortTrips: number; flexTrips: number; covers: number;
  busesOut: number; poolFree: number;
}

const SERIES_BIN = 900;
const N_SERIES = (DAY_END - DAY_START) / SERIES_BIN;
const WAIT_BIN = 10;
const WAIT_BINS = 721;

export class Sim {
  t = DAY_START;
  readonly sc: Scenario;
  readonly buses: Bus[];
  readonly waiting: number[][];
  readonly pState: Uint8Array; // 0 not yet arrived, 1 waiting, 2 on board, 3 arrived
  readonly pWaitStart: Float32Array;
  readonly pDenied: Uint8Array;
  readonly pXfer: Uint8Array;
  readonly pBoardT: Float32Array;
  nextPax = 0;
  nWaiting = 0; nOnboard = 0; nArrived = 0;
  readonly rng: Rng;
  readonly fc: Forecaster;
  readonly ctrl: Controller | null;
  readonly recs: Rec[] = [];
  recVersion = 0;
  // AVL-derived: last departure time of each pattern at each stop
  readonly lastDepT: Float64Array;
  readonly lastDepTrip: Int32Array;
  readonly lastDepBus: Int32Array;
  // ground-truth statistics
  readonly actSum: Float32Array[];
  readonly actCnt: Uint16Array[];
  readonly boardSum: Float32Array[];
  readonly leftByStop: Uint32Array;
  readonly waitHist = new Uint32Array(WAIT_BINS);
  readonly loadFactorHist = new Uint32Array(131); // % of capacity at stop departures
  readonly series = {
    board: new Float32Array(N_SERIES), wait: new Float32Array(N_SERIES), left: new Float32Array(N_SERIES),
    dep: new Float32Array(N_SERIES), crush: new Float32Array(N_SERIES), bunch: new Float32Array(N_SERIES),
  };
  k = { boarded: 0, sumWait: 0, leftBehind: 0, leftUnique: 0, dep: 0, crushDep: 0, maxLoad: 0, maxLoadFactor: 0, bunch: 0, km: 0, holds: 0, holdSec: 0, shortTrips: 0, flexTrips: 0, covers: 0, sumJourney: 0, sumRide: 0, runActual: 0, runSched: 0, lateStarts: 0, starts: 0 };
  private breakdownTimes: number[];
  private pendingCovers: { at: number; runs: Run[]; code: string }[] = [];
  private stride: number;
  mode: 'auto' | 'manual';
  private tmp = new Float64Array(3);

  constructor(readonly net: Network, readonly pax: Passengers, readonly fleet: Fleet, readonly opts: RunOptions, readonly cfg: SimConfig) {
    this.sc = SCENARIOS[opts.scenario];
    this.mode = cfg.mode;
    this.rng = new Rng(opts.seed * 31 + 7);
    this.stride = net.maxStops;
    this.waiting = net.stops.map(() => []);
    this.pState = new Uint8Array(pax.n);
    this.pWaitStart = new Float32Array(pax.n);
    this.pDenied = new Uint8Array(pax.n);
    this.pXfer = new Uint8Array(pax.n);
    this.pBoardT = new Float32Array(pax.n);
    this.leftByStop = new Uint32Array(net.stops.length);
    this.lastDepT = new Float64Array(net.patterns.length * this.stride).fill(-1);
    this.lastDepTrip = new Int32Array(net.patterns.length * this.stride).fill(-1);
    this.lastDepBus = new Int32Array(net.patterns.length * this.stride).fill(-1);
    this.actSum = net.patterns.map((p) => new Float32Array(p.n * N_BINS));
    this.actCnt = net.patterns.map((p) => new Uint16Array(p.n * N_BINS));
    this.boardSum = net.patterns.map((p) => new Float32Array(p.n * N_BINS));
    this.fc = new Forecaster(net, cfg.model);
    this.breakdownTimes = [...(this.sc.breakdowns ?? [])];
    const failShare = this.sc.sensorFailShare ?? SENSOR.baseFailShare;
    this.buses = fleet.buses.map((b) => {
      const runs: Run[] = b.block.map((tr) => ({
        pattern: tr.pattern, from: 0, to: net.patterns[tr.pattern].n - 1, dep: tr.dep, kind: RUN_KIND.SCHED, chargeBefore: tr.chargeBefore, recId: -1,
      }));
      const fails = hashUnit(opts.seed, 31, b.id) < failShare;
      return {
        id: b.id, code: b.code, line: b.line, electric: b.electric, seats: b.seats, cap: b.cap, pool: b.pool,
        state: ST.OUT, pattern: runs[0]?.pattern ?? 0, idx: 0, s: 0, v: 0, timer: 0,
        run: null, runs, runPos: 0, load: 0, pax: [], ticketOn: 0, km: 0, tripNo: 0, soc: EV.batteryKwh, runStartT: 0,
        door: b.electric, fault: 0, faultAt: fails ? DAY_START + 2 * 3600 + hashUnit(opts.seed, 32, b.id) * 15 * 3600 : Infinity,
        faultKind: hashUnit(opts.seed, 33, b.id) < 0.5 ? 1 : 2, faultDone: false, manualBlock: false,
        doorEst: 0, cctvBias: hashNormal(opts.seed, 34, b.id) * SENSOR.cctvBiasSd, stuck: Math.floor(hashUnit(opts.seed, 35, b.id) * 3),
        stopB: 0, stopA: 0, stopTickets: 0,
        est: 0, estSrc: b.electric ? 0 : 1, conf: b.electric ? 0.92 : 0.82, health: 0, nullStreak: 0, suspicion: 0, agree: 0, sawLoad: false,
        detectedAt: -1, lastCount: 0, lastTicketEst: 0,
        hold: null, holdingSec: 0, bunchedUntil: -1, bunchPair: -1, breakPending: false, poolAt: b.pool ? DAY_START : Infinity,
        trIdx: [], trLoad: [], trEst: [],
      };
    });
    this.ctrl = cfg.samam ? new Controller(this) : null;
  }

  // ------------------------------------------------------------------ main loop
  step(): void {
    const t = ++this.t;
    const pax = this.pax;
    while (this.nextPax < pax.n && pax.t[this.nextPax] <= t) {
      const pid = this.nextPax++;
      this.pState[pid] = 1;
      this.pWaitStart[pid] = pax.t[pid];
      this.waiting[pax.origin[pid]].push(pid);
      this.nWaiting++;
    }
    if (this.breakdownTimes.length && t >= this.breakdownTimes[0]) {
      this.breakdownTimes.shift();
      const id = this.pickScheduledBus(t);
      if (id >= 0) this.breakdown(id);
    }
    if (this.pendingCovers.length && t >= this.pendingCovers[0].at) {
      const c = this.pendingCovers.shift()!;
      this.applyCover(c.runs, t + 240, -1);
    }
    const buses = this.buses;
    for (let i = 0; i < buses.length; i++) {
      const bus = buses[i];
      switch (bus.state) {
        case ST.RUN: this.stepRun(bus); break;
        case ST.DWELL: if (t >= bus.timer) this.dwellEnd(bus); break;
        case ST.HOLD: bus.holdingSec = Math.max(0, bus.timer - t); if (t >= bus.timer) this.depart(bus); break;
        case ST.LAYOVER: if (t >= bus.timer) this.startRun(bus); break;
        case ST.CHARGE: this.stepCharge(bus); break;
        case ST.OUT:
          if (bus.runPos < bus.runs.length) {
            if (t >= bus.runs[bus.runPos].dep - 300) this.toLayover(bus, 0);
          } else if (bus.electric && bus.pool && bus.soc < EV.batteryKwh) {
            bus.soc = Math.min(EV.batteryKwh, bus.soc + EV.chargeKw / 3600);
          }
          break;
      }
    }
    if ((t - DAY_START) % CTRL.cycle === 0) {
      if (this.ctrl) this.ctrl.cycle();
      else if (this.cfg.collect) this.fc.update(t);
    }
  }

  runTo(tEnd: number): void { while (this.t < tEnd) this.step(); }

  // ------------------------------------------------------------------ movement
  /** Actual travel time (s) on link k of pattern p for a bus entering it now. */
  linkTime(p: Pattern, k: number, bus: Bus): number {
    const t = this.t, seed = this.opts.seed;
    const base = TRAFFIC.cruiseShare * p.schedRun * (p.linkLen[k] / p.lengthM);
    const b = Math.floor(t / TRAFFIC.fieldBucket), f = t / TRAFFIC.fieldBucket - b;
    const field = hashNormal(seed, p.roadKey[k], b, 11) * (1 - f) + hashNormal(seed, p.roadKey[k], b + 1, 11) * f;
    const rain = this.sc.rain ? rainAt(this.sc, t) : 0;
    const sigma = TRAFFIC.fieldSigma + (this.sc.rain ? this.sc.rain.extraSigma * rain : 0);
    const drv = hashNormal(seed, bus.id, bus.tripNo * 64 + k, 13);
    const rainMult = this.sc.rain ? 1 + (this.sc.rain.timeMult - 1) * rain : 1;
    return Math.max(4, base * congestion(t) * rainMult * Math.exp(sigma * field + TRAFFIC.driverSigma * drv));
  }

  /** The controller's travel-time expectation (no access to the random traffic field). */
  linkTimeEst(p: Pattern, k: number, t: number): number {
    const rainMult = this.sc.rain ? 1 + (this.sc.rain.timeMult - 1) * rainAt(this.sc, t) : 1;
    return TRAFFIC.cruiseShare * p.schedRun * (p.linkLen[k] / p.lengthM) * congestion(t) * rainMult;
  }

  private stepRun(bus: Bus): void {
    const p = this.net.patterns[bus.pattern];
    bus.s += bus.v;
    const km = bus.v / 1000;
    bus.km += km;
    this.k.km += km;
    if (bus.electric) {
      const rain = this.sc.rain ? 1 + (this.sc.rain.energyMult - 1) * rainAt(this.sc, this.t) : 1;
      bus.soc = Math.max(0, bus.soc - EV.kwhPerKm * (1 + EV.loadGain * (bus.load / bus.cap)) * km * rain - EV.auxKw / 3600);
    }
    if (bus.s >= p.stopDist[bus.idx + 1]) {
      bus.idx++;
      bus.s = p.stopDist[bus.idx];
      this.processStop(bus, false);
    }
  }

  private stepCharge(bus: Bus): void {
    bus.soc = Math.min(EV.batteryKwh, bus.soc + EV.chargeKw / 3600);
    const next = bus.runs[bus.runPos];
    if (!next) { bus.state = ST.OUT; return; }
    if (bus.soc >= EV.fullSoc * EV.batteryKwh || (this.t >= next.dep - 60 && bus.soc >= EV.resumeSoc * EV.batteryKwh)) {
      bus.state = ST.LAYOVER;
      bus.timer = Math.max(this.t + 30, next.dep - DWELL.preBoard);
    }
  }

  /** Put the bus at the start of its next run, waiting to open doors. */
  private toLayover(bus: Bus, minWait: number): void {
    const next = bus.runs[bus.runPos];
    const p = this.net.patterns[next.pattern];
    bus.pattern = next.pattern;
    bus.idx = next.from;
    bus.s = p.stopDist[next.from];
    bus.v = 0;
    if (bus.electric && (next.chargeBefore || bus.soc < EV.forceSoc * EV.batteryKwh)) {
      bus.state = ST.CHARGE;
      return;
    }
    bus.state = ST.LAYOVER;
    bus.timer = Math.max(this.t + minWait, next.dep - DWELL.preBoard);
  }

  private startRun(bus: Bus): void {
    const run = bus.runs[bus.runPos++];
    bus.run = run;
    bus.pattern = run.pattern;
    bus.idx = run.from;
    bus.s = this.net.patterns[run.pattern].stopDist[run.from];
    bus.trIdx = []; bus.trLoad = []; bus.trEst = [];
    bus.hold = null;
    bus.runStartT = Math.max(this.t, run.dep);
    if (run.kind === RUN_KIND.SCHED) { this.k.starts++; if (this.t > run.dep + 180) this.k.lateStarts++; }
    if (this.ctrl) this.ctrl.planHold(bus, run.from, true);
    this.processStop(bus, true);
  }

  // ------------------------------------------------------------------ stops
  private processStop(bus: Bus, isStart: boolean): void {
    const t = this.t;
    const p = this.net.patterns[bus.pattern];
    const run = bus.run!;
    const stop = p.stops[bus.idx];
    const atEnd = bus.idx === run.to;
    let a = 0;
    if (bus.load > 0) {
      const dest = this.pax.dest, keep: number[] = [];
      for (let i = 0; i < bus.pax.length; i++) {
        const pid = bus.pax[i];
        if (dest[pid] === stop || atEnd) {
          this.pState[pid] = 3; this.nOnboard--; this.nArrived++; a++;
          this.k.sumJourney += t - this.pax.t[pid];
          this.k.sumRide += t - this.pBoardT[pid];
          if (this.pax.ticket[pid]) bus.ticketOn--;
        } else keep.push(pid);
      }
      bus.pax = keep;
      bus.load = keep.length;
    }
    bus.stopA = a; bus.stopB = 0; bus.stopTickets = 0;
    if (atEnd) { this.endRun(bus); return; }
    if (bus.breakPending) { this.breakNow(bus); return; }
    const b = this.board(bus, p, stop, true);
    let dwell = 0;
    if (a + b > 0) {
      const crowd = 1 + DWELL.crowdGain * Math.max(0, bus.load / bus.cap - 0.6) / 0.4;
      dwell = DWELL.base + DWELL.perBoard * b * crowd + DWELL.perAlight * a;
      if (this.sc.rain) dwell *= 1 + (this.sc.rain.dwellMult - 1) * rainAt(this.sc, t);
    }
    bus.state = ST.DWELL;
    bus.timer = isStart ? Math.max(t + dwell, run.dep) : t + dwell;
    if (bus.timer <= t) this.dwellEnd(bus);
  }

  /** Board waiting passengers whose destination this run serves. Returns the number boarded. */
  private board(bus: Bus, p: Pattern, stop: number, countDenied: boolean): number {
    const q = this.waiting[stop];
    if (q.length === 0) return 0;
    const t = this.t, run = bus.run!, posOf = p.posOf, dest = this.pax.dest;
    let w = 0, b = 0;
    for (let i = 0; i < q.length; i++) {
      const pid = q[i];
      const pos = posOf[dest[pid]];
      if (pos > bus.idx && pos <= run.to) {
        if (bus.load < bus.cap) {
          const wait = Math.max(0, t - this.pWaitStart[pid]);
          this.k.sumWait += wait;
          this.waitHist[Math.min(WAIT_BINS - 1, Math.floor(wait / WAIT_BIN))]++;
          const sb = Math.min(N_SERIES - 1, Math.floor((t - DAY_START) / SERIES_BIN));
          this.series.wait[sb] += wait;
          this.series.board[sb]++;
          if (!this.pXfer[pid]) this.k.boarded++;
          this.pState[pid] = 2; this.nWaiting--; this.nOnboard++;
          this.pBoardT[pid] = t;
          bus.pax.push(pid); bus.load++; b++;
          if (this.pax.ticket[pid]) { bus.ticketOn++; bus.stopTickets++; }
          continue;
        }
        if (countDenied) {
          this.k.leftBehind++;
          this.leftByStop[stop]++;
          this.series.left[Math.min(N_SERIES - 1, Math.floor((t - DAY_START) / SERIES_BIN))]++;
          if (this.pDenied[pid] === 0) this.k.leftUnique++;
          if (this.pDenied[pid] < 255) this.pDenied[pid]++;
        }
      }
      q[w++] = pid;
    }
    q.length = w;
    bus.stopB += b;
    return b;
  }

  private dwellEnd(bus: Bus): void {
    const h = bus.hold;
    if (h && h.idx === bus.idx) {
      bus.hold = null;
      if (h.approved && this.ctrl) {
        const sec = this.ctrl.resolveHold(bus, h);
        if (sec >= CTRL.holdMin) {
          bus.state = ST.HOLD;
          bus.timer = this.t + sec;
          bus.holdingSec = sec;
          this.k.holds++; this.k.holdSec += sec;
          return;
        }
      } else if (this.ctrl) this.ctrl.holdLapsed(h);
    }
    this.depart(bus);
  }

  private depart(bus: Bus): void {
    const t = this.t;
    const p = this.net.patterns[bus.pattern];
    const stop = p.stops[bus.idx];
    bus.holdingSec = 0;
    if (bus.load < bus.cap) this.board(bus, p, stop, false); // riders who arrived during the dwell / hold
    this.readSensor(bus, p);
    // ground-truth statistics
    const bin = binOf(t);
    const cell = bus.idx * N_BINS + bin;
    this.actSum[p.idx][cell] += bus.load;
    this.actCnt[p.idx][cell]++;
    this.boardSum[p.idx][cell] += bus.stopB;
    const lf = bus.load / bus.cap;
    this.k.dep++;
    this.loadFactorHist[Math.min(130, Math.round(lf * 100))]++;
    const sb = Math.min(N_SERIES - 1, Math.floor((t - DAY_START) / SERIES_BIN));
    this.series.dep[sb]++;
    if (lf > 0.85) { this.k.crushDep++; this.series.crush[sb]++; }
    if (bus.load > this.k.maxLoad) this.k.maxLoad = bus.load;
    if (lf > this.k.maxLoadFactor) this.k.maxLoadFactor = lf;
    // bunching (AVL-derived, same definition in both arms)
    const key = p.idx * this.stride + bus.idx;
    const prev = this.lastDepT[key];
    if (prev >= 0) {
      const gap = t - prev;
      if (gap < Math.max(60, 0.25 * schedHeadway(p, bus.idx, t))) {
        bus.bunchedUntil = t + 240;
        const lead = this.lastDepBus[key];
        if (lead >= 0) this.buses[lead].bunchedUntil = t + 240;
        if (bus.bunchPair !== this.lastDepTrip[key]) {
          bus.bunchPair = this.lastDepTrip[key];
          this.k.bunch++;
          this.series.bunch[sb]++;
        }
      }
    }
    this.lastDepT[key] = t;
    this.lastDepTrip[key] = bus.id * 256 + (bus.tripNo & 255);
    this.lastDepBus[key] = bus.id;
    bus.trIdx.push(bus.idx); bus.trLoad.push(bus.load); bus.trEst.push(bus.est);
    this.fc.observe(p.idx, bus.idx, t, bus.est);
    if (this.ctrl) this.ctrl.planHold(bus, bus.idx + 1, false);
    bus.v = p.linkLen[bus.idx] / this.linkTime(p, bus.idx, bus);
    bus.state = ST.RUN;
  }

  private endRun(bus: Bus): void {
    const run = bus.run!;
    const endedAtDepot = this.net.patterns[run.pattern].depotIdx === run.to;
    if (run.kind === RUN_KIND.SCHED) { this.k.runActual += this.t - bus.runStartT; this.k.runSched += this.net.patterns[run.pattern].schedRun; }
    bus.tripNo++;
    bus.run = null;
    bus.hold = null;
    bus.doorEst = 0; bus.est = 0; bus.ticketOn = 0;
    bus.v = 0;
    if (bus.breakPending) { this.breakNow(bus); return; }
    if (bus.runPos < bus.runs.length) { this.toLayover(bus, DWELL.minTurn); return; }
    bus.state = ST.OUT;
    if (bus.pool) bus.poolAt = endedAtDepot ? this.t + CTRL.poolTurn : Infinity;
  }

  // ------------------------------------------------------------------ sensors + estimator
  private readSensor(bus: Bus, p: Pattern): void {
    const t = this.t, rng = this.rng;
    const lf = bus.load / bus.cap;
    if (!bus.faultDone && t >= bus.faultAt) { bus.fault = bus.faultKind; bus.faultDone = true; bus.faultAt = t; }
    const fault = bus.manualBlock ? 2 : bus.fault;
    let count: number | null;
    // the door counter keeps integrating even when its output is blocked, so it resumes consistently
    if (bus.door) {
      const crush = lf > 0.85;
      const err = SENSOR.doorErr + (crush ? SENSOR.doorCrushErr : 0);
      const ob = bus.stopB * (1 - (crush ? SENSOR.doorCrushMiss : 0)) + rng.normal() * err * bus.stopB;
      const oa = bus.stopA + rng.normal() * err * bus.stopA;
      bus.doorEst = Math.max(0, Math.min(bus.cap * 1.3, bus.doorEst + ob - oa));
    }
    if (fault === 1) count = null;
    else if (fault === 2) count = bus.stuck;
    else if (bus.door) count = Math.round(bus.doorEst);
    else {
      const over = Math.max(0, Math.min(1, (lf - 0.75) / 0.25));
      const mean = bus.load * (1 + bus.cctvBias) * (1 - SENSOR.cctvCrushUnder * over);
      const sd = SENSOR.cctvSd0 + SENSOR.cctvSdLoad * bus.load + (lf > 0.85 ? SENSOR.cctvCrushSd * bus.load : 0);
      count = Math.max(0, Math.round(mean + rng.normal() * sd));
    }
    const ticketLoad = Math.max(0, Math.round(bus.ticketOn * (1 + rng.normal() * SENSOR.ticketNoise)));
    this.estimate(bus, p, count, ticketLoad);
  }

  /** Sensor-health logic. Inputs: the counter reading and ETM ticket records. Never ground truth. */
  private estimate(bus: Bus, p: Pattern, count: number | null, ticketLoad: number): void {
    const t = this.t;
    const tk = ticketLoad / DEMAND.ticketShare;
    const hist = this.fc.profile.ok ? this.fc.profile.loadAt(p.idx, bus.idx, t) : tk;
    const wasFault = bus.health === 2;
    bus.lastCount = count;
    bus.lastTicketEst = tk;
    if (count === null) {
      bus.nullStreak++;
      if (bus.nullStreak >= 2 && bus.health !== 2) { bus.health = 2; bus.detectedAt = t; bus.agree = 0; bus.sawLoad = false; }
      else if (bus.health === 0) bus.health = 1;
    } else {
      bus.nullStreak = 0;
      const diff = Math.abs(count - tk);
      const bad = (count <= 2 && tk >= 10) || diff > Math.max(12, 0.6 * tk);
      if (bus.health === 2) {
        // recover only on evidence that the counter is really counting people again:
        // four consecutive readings with riders on board that agree with ticket sales
        if (tk >= 8 && count >= 5 && diff <= Math.max(6, 0.3 * tk)) {
          bus.agree++;
          if (bus.agree >= 4) { bus.health = 0; bus.suspicion = 0; }
        } else if (tk >= 8) bus.agree = 0;
      } else if (bad) {
        bus.suspicion++;
        if (bus.suspicion >= 3) { bus.health = 2; bus.detectedAt = t; bus.agree = 0; bus.sawLoad = false; }
        else bus.health = 1;
      } else {
        bus.suspicion = Math.max(0, bus.suspicion - 1);
        if (bus.suspicion === 0) bus.health = 0;
      }
    }
    const kind = bus.door ? 0 : 1;
    if (bus.health === 2 || count === null) {
      bus.est = 0.7 * tk + 0.3 * hist; bus.estSrc = 2; bus.conf = 0.5;
    } else if (bus.health === 1) {
      bus.est = 0.5 * count + 0.5 * tk; bus.estSrc = kind; bus.conf = 0.62;
    } else {
      bus.est = count; bus.estSrc = kind;
      bus.conf = (bus.door ? 0.92 : 0.82) - (count / bus.cap > 0.85 ? 0.2 : 0);
    }
    bus.est = Math.max(0, Math.min(bus.cap * 1.2, bus.est));
    if (this.ctrl) {
      if (!wasFault && bus.health === 2) this.ctrl.sensorAlert(bus, true, count === null);
      else if (wasFault && bus.health === 0) this.ctrl.sensorAlert(bus, false, false);
    }
  }

  // ------------------------------------------------------------------ disruptions
  /** A bus scheduled to be mid-trip on the busiest line at time t (same choice in both arms). */
  private pickScheduledBus(t: number): number {
    const line = [...this.net.lines].sort((a, b) =>
      (this.net.patterns[b.patterns[0]].departures.length) - (this.net.patterns[a.patterns[0]].departures.length))[0];
    const cands: number[] = [];
    for (const b of this.fleet.buses) {
      if (b.line !== line.idx) continue;
      for (const tr of b.block) {
        const run = this.net.patterns[tr.pattern].schedRun;
        if (tr.dep + 0.2 * run <= t && t <= tr.dep + 0.7 * run) { cands.push(b.id); break; }
      }
    }
    if (!cands.length) return -1;
    return cands[Math.floor(hashUnit(this.opts.seed, 41, Math.floor(t)) * cands.length)];
  }

  setSensorBlocked(id: number, blocked: boolean): void {
    const bus = this.buses[id];
    if (bus) bus.manualBlock = blocked;
  }

  breakdown(id: number): void {
    const bus = this.buses[id];
    if (!bus || bus.state === ST.BROKEN) return;
    if (bus.state === ST.RUN) { bus.breakPending = true; return; }
    this.breakNow(bus);
  }

  private breakNow(bus: Bus): void {
    const t = this.t;
    bus.breakPending = false;
    const p = this.net.patterns[bus.pattern];
    const stop = p.stops[bus.idx];
    for (const pid of bus.pax) {
      // riders get off and wait at this stop for the next bus that serves their destination
      this.pState[pid] = 1; this.nOnboard--; this.nWaiting++;
      this.pWaitStart[pid] = t;
      this.pXfer[pid] = 1;
      this.waiting[stop].push(pid);
    }
    bus.pax = []; bus.load = 0; bus.ticketOn = 0; bus.est = 0;
    const remaining = bus.runs.slice(bus.runPos);
    bus.runs = []; bus.runPos = 0; bus.run = null; bus.hold = null; bus.v = 0;
    bus.state = ST.BROKEN;
    if (this.ctrl) this.ctrl.onBreakdown(bus, remaining);
    else if (remaining.length) {
      // fixed-schedule operation: a spare is sent after a manual response delay
      this.pendingCovers.push({ at: t + CTRL.baselineCoverDelay, runs: remaining, code: bus.code });
      this.pendingCovers.sort((a, b) => a.at - b.at);
    }
  }

  poolAvailable(): Bus[] {
    return this.buses.filter((b) => b.pool && b.state === ST.OUT && b.runPos >= b.runs.length && b.poolAt <= this.t);
  }

  /** Give a pool bus the rest of a broken-down bus's block, from its next departure out of the depot. */
  applyCover(runs: Run[], minDep: number, recId: number): Bus | null {
    const i = runs.findIndex((r) => this.net.patterns[r.pattern].depotIdx === 0 && r.from === 0 && r.dep >= minDep);
    if (i < 0) return null;
    const bus = this.poolAvailable()[0];
    if (!bus) return null;
    bus.runs = runs.slice(i).map((r) => ({ ...r, kind: RUN_KIND.COVER, chargeBefore: false, recId }));
    bus.runPos = 0;
    this.toLayover(bus, 0);
    this.k.covers++;
    return bus;
  }

  /** Send a pool bus out on extra runs (short-turn or flex). */
  dispatchPool(bus: Bus, runs: Run[]): void {
    bus.runs = runs;
    bus.runPos = 0;
    this.toLayover(bus, 0);
    if (runs[0].kind === RUN_KIND.SHORT) this.k.shortTrips++; else this.k.flexTrips++;
  }

  // ------------------------------------------------------------------ recommendations
  addRec(r: Omit<Rec, 'id' | 't'>): Rec {
    const rec: Rec = { ...r, id: this.recs.length, t: this.t };
    this.recs.push(rec);
    this.recVersion++;
    return rec;
  }

  // ------------------------------------------------------------------ outputs
  kpis(): Kpis {
    const t = this.t;
    let waitSum = this.k.sumWait, n = this.k.boarded;
    const hist = new Uint32Array(this.waitHist);
    for (const q of this.waiting) for (const pid of q) {
      const w = Math.max(0, t - this.pWaitStart[pid]);
      waitSum += w;
      if (!this.pXfer[pid]) n++;
      hist[Math.min(WAIT_BINS - 1, Math.floor(w / WAIT_BIN))]++;
    }
    let total = 0;
    for (let i = 0; i < WAIT_BINS; i++) total += hist[i];
    let p90 = 0;
    if (total > 0) {
      let acc = 0;
      for (let i = 0; i < WAIT_BINS; i++) { acc += hist[i]; if (acc >= 0.9 * total) { p90 = (i + 0.5) * WAIT_BIN; break; } }
    }
    let peak = 0;
    if (this.k.dep > 0) {
      let acc = 0;
      for (let i = 130; i >= 0; i--) { acc += this.loadFactorHist[i]; if (acc >= 0.01 * this.k.dep) { peak = i / 100; break; } }
    }
    let out = 0, poolFree = 0;
    for (const b of this.buses) {
      if (b.state !== ST.OUT && b.state !== ST.BROKEN) out++;
      if (b.pool && b.state === ST.OUT && b.runPos >= b.runs.length && b.poolAt <= t) poolFree++;
    }
    return {
      t, generated: this.nextPax, waiting: this.nWaiting, onboard: this.nOnboard, arrived: this.nArrived,
      avgWait: n > 0 ? waitSum / n : 0, p90Wait: p90,
      avgJourney: this.nArrived > 0 ? this.k.sumJourney / this.nArrived : 0, avgRide: this.nArrived > 0 ? this.k.sumRide / this.nArrived : 0,
      leftBehind: this.k.leftBehind, leftUnique: this.k.leftUnique,
      peakLoad: Math.round(peak * 80), maxLoad: this.k.maxLoad, peakLoadFactor: peak,
      crushShare: this.k.dep > 0 ? this.k.crushDep / this.k.dep : 0,
      bunching: this.k.bunch, busKm: this.k.km, boardings: this.k.boarded, departures: this.k.dep,
      holds: this.k.holds, holdSec: this.k.holdSec, shortTrips: this.k.shortTrips, flexTrips: this.k.flexTrips, covers: this.k.covers,
      busesOut: out, poolFree,
    };
  }

  /** Per-bus render state: [lon, lat, bearing, trueLoad, estLoad, state, flags, band] x N. */
  snapshot(out: Float32Array): void {
    const t = this.t, tmp = this.tmp;
    for (let i = 0; i < this.buses.length; i++) {
      const b = this.buses[i];
      const o = i * 8;
      if (b.state === ST.OUT) { out[o] = 0; out[o + 1] = 0; out[o + 5] = ST.OUT; out[o + 6] = 0; continue; }
      pointAt(this.net.patterns[b.pattern], b.s, tmp);
      out[o] = tmp[0]; out[o + 1] = tmp[1]; out[o + 2] = tmp[2];
      out[o + 3] = b.load; out[o + 4] = b.est; out[o + 5] = b.state;
      out[o + 6] = (t < b.bunchedUntil ? 1 : 0) | (b.state === ST.HOLD ? 2 : 0) | (b.health === 2 ? 4 : 0) | (b.health === 1 ? 8 : 0)
        | (b.run && b.run.kind !== RUN_KIND.SCHED ? 16 : 0) | (b.hold && b.hold.approved ? 32 : 0);
      out[o + 7] = bandOf(b.est, b.seats, b.cap);
    }
  }

  waitingCounts(out: Uint16Array): void {
    for (let i = 0; i < this.waiting.length; i++) out[i] = Math.min(65535, this.waiting[i].length);
  }

  /** Conservation check: everyone generated is waiting, on board or arrived. */
  conservation(): { generated: number; waiting: number; onboard: number; arrived: number; ok: boolean } {
    let w = 0, o = 0;
    for (const q of this.waiting) w += q.length;
    for (const b of this.buses) o += b.pax.length;
    let s1 = 0, s2 = 0, s3 = 0;
    for (let i = 0; i < this.nextPax; i++) { const s = this.pState[i]; if (s === 1) s1++; else if (s === 2) s2++; else if (s === 3) s3++; }
    const ok = w === s1 && o === s2 && s1 + s2 + s3 === this.nextPax && w === this.nWaiting && o === this.nOnboard && s3 === this.nArrived;
    return { generated: this.nextPax, waiting: w, onboard: o, arrived: s3, ok };
  }
}

export { N_SERIES, SERIES_BIN };
