/// <reference lib="webworker" />
// Simulation worker: runs the baseline and Samam arms in lockstep on the same seed and passengers,
// and streams render state to the UI. Dispatcher actions are logged with their simulation time so
// that jumping back in time replays them and the run stays reproducible.
import corridorRaw from '../data/corridor.json';
import modelRaw from '../data/forecast-model.json';
import {
  BASELINE, SAMAM, BIN, DAY_END, DAY_START, EV, HORIZONS, N_BINS, N_SERIES, RUN_KIND, SERIES_BIN, ST, bandOf, binOf, buildNetwork, createSim, createWorld,
  defaultSurgeStop, hhmm, pointAt,
  type Bus, type ForecastModel, type Network, type RawCorridor, type RunOptions, type Sim, type World,
} from '../engine/index';
import type { Arm, BusDetail, ForecastView, Frame, Instruction, ReadyMsg, RecView, ReportMsg, SeriesView, ToWorker } from './protocol';

const net: Network = buildNetwork(corridorRaw as unknown as RawCorridor);
const model = modelRaw as unknown as ForecastModel;
const ctx = self as unknown as DedicatedWorkerGlobalScope;

let world: World;
let base: Sim;
let samam: Sim;
let opts: RunOptions;
let playing = false;
let speed = 30;
let mode: 'auto' | 'manual' = 'auto';
let target = -1; // jump target while fast-forwarding
let jumpFrom = 0;
let owed = 0;
let lastTick = 0;
let selected = -1;
let selectedArm: Arm = 'samam';
let fcPattern = -1;
let lastSlow = 0;
let lastRecVersion = -1;
let forceSlow = true;
let initialised = false;

type Cmd =
  | { kind: 'mode'; mode: 'auto' | 'manual' }
  | { kind: 'decide'; id: number; approve: boolean }
  | { kind: 'blockSensor'; bus: number; blocked: boolean }
  | { kind: 'breakdown'; bus: number };
let log: { t: number; cmd: Cmd; text: string }[] = [];
let logPos = 0;

function build(): void {
  world = createWorld(net, opts);
  base = createSim(world, BASELINE, model);
  samam = createSim(world, { ...SAMAM, mode: 'auto' }, model);
  logPos = 0;
  lastRecVersion = -1;
  forceSlow = true;
}

function apply(cmd: Cmd): void {
  switch (cmd.kind) {
    case 'mode': samam.mode = cmd.mode; break;
    case 'decide': samam.ctrl?.decide(cmd.id, cmd.approve); break;
    case 'blockSensor': base.setSensorBlocked(cmd.bus, cmd.blocked); samam.setSensorBlocked(cmd.bus, cmd.blocked); break;
    case 'breakdown': base.breakdown(cmd.bus); samam.breakdown(cmd.bus); break;
  }
  forceSlow = true;
}

function record(cmd: Cmd, text: string): void {
  // a new action after a rewind discards the old future
  log = log.slice(0, logPos);
  log.push({ t: samam.t, cmd, text });
  logPos = log.length;
  apply(cmd);
}

function stepBoth(): void {
  base.step();
  samam.step();
  while (logPos < log.length && log[logPos].t <= samam.t) apply(log[logPos++].cmd);
}

// ------------------------------------------------------------------ views
function recView(sim: Sim): Frame['recs'] {
  const all = sim.recs;
  const counts: Record<string, number> = {};
  let pending = 0;
  for (const r of all) {
    counts[r.kind + ':' + r.status] = (counts[r.kind + ':' + r.status] || 0) + 1;
    if (r.status === 'pending') pending++;
  }
  // newest 160, but never drop a pending one
  const items: RecView[] = [];
  for (let i = all.length - 1; i >= 0 && (items.length < 160 || all[i].status === 'pending'); i--) {
    const r = all[i];
    if (items.length >= 160 && r.status !== 'pending') continue;
    items.push({
      id: r.id, t: r.t, kind: r.kind, status: r.status, auto: r.auto, bus: r.bus, busCode: r.bus >= 0 ? sim.buses[r.bus].code : '',
      line: r.line, pattern: r.pattern, stop: r.stop, title: r.title, reason: r.reason, effect: r.effect, expires: r.expires, lon: r.lon, lat: r.lat,
    });
    if (items.length > 400) break;
  }
  return { version: sim.recVersion, items, total: all.length, pending, counts };
}

function instruction(sim: Sim, b: Bus): Instruction {
  const p = net.patterns[b.pattern];
  const stopName = (i: number) => net.stops[p.stops[Math.max(0, Math.min(p.n - 1, i))]].name;
  if (b.state === ST.BROKEN) return { kind: 'broken', text: 'Out of service', sub: `Breakdown reported at ${stopName(b.idx)}. Control room informed.` };
  if (b.state === ST.OUT) return { kind: 'out', text: b.pool ? 'Standby at depot' : 'Not in service', sub: b.pool ? `Flex pool, ${net.depot.name}` : 'No trip assigned' };
  if (b.state === ST.CHARGE) return { kind: 'charge', text: 'Charging', sub: `Battery ${Math.round((b.soc / EV.batteryKwh) * 100)}%. Next departure ${b.runs[b.runPos] ? hhmm(b.runs[b.runPos].dep) : 'not set'}.` };
  if (b.state === ST.LAYOVER) {
    const r = b.runs[b.runPos];
    const q = net.patterns[r.pattern];
    const kind = r.kind === RUN_KIND.SHORT ? 'Short-turn trip' : r.kind === RUN_KIND.FLEX ? 'Extra trip' : r.kind === RUN_KIND.COVER ? 'Cover trip' : 'Trip';
    return { kind: 'layover', text: `Depart ${hhmm(Math.max(r.dep, b.timer))}`, sub: `${kind} on ${q.lineId} to ${net.stops[q.stops[r.to]].name}` };
  }
  const run = b.run!;
  if (b.state === ST.HOLD) return { kind: 'hold', text: `Hold ${Math.ceil(b.holdingSec)} s`, sub: `at ${stopName(b.idx)}. Doors open. Leave when the timer ends.`, sec: Math.ceil(b.holdingSec) };
  if (b.hold && b.hold.approved) return { kind: 'holdAhead', text: `Hold ${b.hold.sec} s at ${stopName(b.hold.idx)}`, sub: `${b.hold.idx - b.idx} stop${b.hold.idx - b.idx === 1 ? '' : 's'} ahead. Evens the gap to the bus in front.`, sec: b.hold.sec };
  if (run.kind === RUN_KIND.SHORT) {
    const outbound = b.runPos < b.runs.length;
    return outbound
      ? { kind: 'short', text: `Short-turn at ${stopName(run.to)}`, sub: `All riders alight there. Turn back to ${net.depot.name}.` }
      : { kind: 'short', text: `Return to ${stopName(run.to)}`, sub: 'Short-turn trip, in service.' };
  }
  if (run.kind === RUN_KIND.FLEX) return { kind: 'flex', text: `Extra trip to ${stopName(run.to)}`, sub: `Flex bus on line ${p.lineId}. Normal stops.` };
  if (run.kind === RUN_KIND.COVER) return { kind: 'cover', text: `Cover trip to ${stopName(run.to)}`, sub: `Replacing a broken-down bus on line ${p.lineId}.` };
  return { kind: 'proceed', text: `Next: ${stopName(b.idx + (b.state === ST.RUN ? 1 : 0))}`, sub: `Line ${p.lineId} to ${p.to}. No instruction.` };
}

const tmp = new Float64Array(3);
function detail(sim: Sim, arm: Arm, id: number): BusDetail | null {
  const b = sim.buses[id];
  if (!b) return null;
  const p = net.patterns[b.pattern];
  const run = b.run;
  pointAt(p, b.s, tmp);
  const runFrom = run ? run.from : 0, runTo = run ? run.to : p.n - 1;
  const perKm = EV.kwhPerKm * (1 + EV.loadGain * 0.4) + EV.auxKw / 22;
  return {
    id, code: b.code, arm, lineId: p.lineId, electric: b.electric, pool: b.pool, seats: b.seats, cap: b.cap,
    state: b.state, pattern: b.pattern, patternId: p.id, from: p.from, to: p.to, runKind: run ? run.kind : -1,
    stopIdx: b.idx, runFrom, runTo,
    nextStop: net.stops[p.stops[Math.min(p.n - 1, b.idx + 1)]].name, atStop: net.stops[p.stops[b.idx]].name,
    load: b.load, est: b.est, band: bandOf(b.est, b.seats, b.cap), src: b.estSrc, conf: b.conf, health: b.health,
    trueFault: b.manualBlock ? 2 : b.fault, manualBlock: b.manualBlock, lastCount: b.lastCount, ticketEst: b.lastTicketEst, detectedAt: b.detectedAt,
    soc: b.soc / EV.batteryKwh, rangeKm: Math.max(0, (b.soc - EV.forceSoc * EV.batteryKwh) / perKm), km: b.km, trips: b.tripNo,
    instruction: instruction(sim, b),
    trace: { idx: b.trIdx.slice(), load: b.trLoad.slice(), est: b.trEst.slice() },
    stopNames: p.stops.map((s) => net.stops[s].name),
    next: b.runs.slice(b.runPos, b.runPos + 3).map((r) => ({ dep: r.dep, to: net.stops[net.patterns[r.pattern].stops[r.to]].name })),
    lon: tmp[0], lat: tmp[1],
  };
}

function forecastMae(sim: Sim, pFilter: number): { n: number; model30: number; model60: number; profile: number } {
  let n = 0, e30 = 0, e60 = 0, ep = 0;
  const nowBin = binOf(sim.t);
  for (const p of net.patterns) {
    if (pFilter >= 0 && p.idx !== pFilter) continue;
    const cnt = sim.actCnt[p.idx], sum = sim.actSum[p.idx], p30 = sim.fc.pred30[p.idx], p60 = sim.fc.pred60[p.idx];
    for (let k = 0; k < p.n - 1; k++) for (let b = 0; b < nowBin; b++) {
      const i = k * N_BINS + b;
      if (cnt[i] === 0 || p30[i] < 0 || p60[i] < 0) continue;
      const a = sum[i] / cnt[i];
      n++; e30 += Math.abs(p30[i] - a); e60 += Math.abs(p60[i] - a); ep += Math.abs(sim.fc.profile.loadBin(p.idx, k, b) - a);
    }
  }
  return n ? { n, model30: e30 / n, model60: e60 / n, profile: ep / n } : { n: 0, model30: 0, model60: 0, profile: 0 };
}

function forecastView(sim: Sim, pi: number): ForecastView | null {
  const p = net.patterns[pi];
  if (!p) return null;
  const nLinks = p.n - 1;
  const actual = new Float32Array(nLinks * N_BINS), profile = new Float32Array(nLinks * N_BINS);
  for (let k = 0; k < nLinks; k++) for (let b = 0; b < N_BINS; b++) {
    const i = k * N_BINS + b;
    actual[i] = sim.actCnt[pi][i] > 0 ? sim.actSum[pi][i] / sim.actCnt[pi][i] : -1;
    profile[i] = sim.fc.profile.loadBin(pi, k, b);
  }
  return {
    pattern: pi, patternId: p.id, from: p.from, to: p.to, stopNames: p.stops.map((s) => net.stops[s].name), nLinks, nBins: N_BINS, horizons: HORIZONS,
    t: sim.t, nowBin: binOf(sim.t), cap: 78, actual, profile,
    pred30: sim.fc.pred30[pi].slice(0, nLinks * N_BINS), pred60: sim.fc.pred60[pi].slice(0, nLinks * N_BINS),
    live: sim.fc.F[pi].slice(0, nLinks * HORIZONS),
    mae: forecastMae(sim, pi),
  };
}

function seriesView(sim: Sim): SeriesView {
  const s = sim.series;
  return { bin: SERIES_BIN, start: DAY_START, board: s.board.slice(), wait: s.wait.slice(), left: s.left.slice(), dep: s.dep.slice(), crush: s.crush.slice(), bunch: s.bunch.slice() };
}

function report(): ReportMsg {
  const counts: Record<string, number> = {};
  for (const r of samam.recs) counts[r.kind + ':' + r.status] = (counts[r.kind + ':' + r.status] || 0) + 1;
  let faults = 0, detected = 0, falseAlarms = 0;
  const delays: number[] = [];
  for (const b of samam.buses) {
    if (b.faultDone || b.manualBlock) {
      faults++;
      if (b.detectedAt >= 0 && (b.manualBlock || b.detectedAt >= b.faultAt)) { detected++; if (b.faultDone) delays.push((b.detectedAt - b.faultAt) / 60); }
    } else if (b.detectedAt >= 0) falseAlarms++;
  }
  delays.sort((a, b) => a - b);
  const top = net.stops.map((s) => ({ stop: s.idx, base: base.leftByStop[s.idx], samam: samam.leftByStop[s.idx] }))
    .filter((x) => x.base + x.samam > 0).sort((a, b) => b.base - a.base).slice(0, 8);
  return {
    type: 'report', t: samam.t, opts, kpi: { base: base.kpis(), samam: samam.kpis() },
    series: { base: seriesView(base), samam: seriesView(samam) }, recCounts: counts,
    sensors: { faults, detected, falseAlarms, medianDelayMin: delays.length ? delays[Math.floor(delays.length / 2)] : 0 },
    forecast: forecastMae(samam, -1), topLeft: top,
    interventions: log.slice(0, logPos).filter((l) => l.cmd.kind !== 'decide').map((l) => ({ t: l.t, text: l.text })),
  };
}

function post(slow: boolean): void {
  const n = base.buses.length;
  const a = new Float32Array(n * 8), b = new Float32Array(n * 8);
  base.snapshot(a);
  samam.snapshot(b);
  const busy = target >= 0;
  const f: Frame = {
    type: 'frame', t: samam.t, playing, speed, busy, mode: samam.mode, done: samam.t >= DAY_END,
    progress: busy ? (samam.t - jumpFrom) / Math.max(1, target - jumpFrom) : 1,
    bus: { base: a, samam: b },
  };
  const transfer: Transferable[] = [a.buffer, b.buffer];
  if (slow) {
    const wa = new Uint16Array(net.stops.length), wb = new Uint16Array(net.stops.length);
    base.waitingCounts(wa); samam.waitingCounts(wb);
    f.wait = { base: wa, samam: wb };
    f.kpi = { base: base.kpis(), samam: samam.kpis() };
    if (samam.recVersion !== lastRecVersion) { f.recs = recView(samam); lastRecVersion = samam.recVersion; }
    if (selected >= 0) f.detail = detail(selectedArm === 'base' ? base : samam, selectedArm, selected);
    if (fcPattern >= 0) f.forecast = forecastView(samam, fcPattern);
    transfer.push(wa.buffer, wb.buffer);
  }
  ctx.postMessage(f, transfer);
}

function tick(): void {
  if (!initialised) return;
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastTick) / 1000);
  lastTick = now;
  let stepped = false;
  if (target >= 0) {
    const until = performance.now() + 28;
    while (samam.t < target && performance.now() < until) for (let i = 0; i < 200 && samam.t < target; i++) stepBoth();
    if (samam.t >= target) { target = -1; forceSlow = true; }
    stepped = true;
  } else if (playing && samam.t < DAY_END) {
    owed += speed * dt;
    let n = Math.floor(owed);
    owed -= n;
    if (n > 400) n = 400;
    for (let i = 0; i < n && samam.t < DAY_END; i++) stepBoth();
    stepped = n > 0;
    if (samam.t >= DAY_END) { playing = false; forceSlow = true; }
  }
  const slow = forceSlow || now - lastSlow > 240;
  if (stepped || forceSlow) {
    if (slow) { lastSlow = now; forceSlow = false; }
    post(slow);
  }
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'init': {
      opts = { ...m.opts };
      if (opts.scenario === 'surge' && opts.surgeStop === undefined) opts.surgeStop = defaultSurgeStop(net);
      speed = m.speed; playing = m.playing; mode = m.mode;
      log = mode === 'manual' ? [{ t: DAY_START, cmd: { kind: 'mode', mode }, text: 'Manual mode' }] : [];
      build();
      const ready: ReadyMsg = {
        type: 'ready', opts,
        buses: world.fleet.buses.map((b) => ({ id: b.id, code: b.code, line: b.line, electric: b.electric, seats: b.seats, cap: b.cap, pool: b.pool })),
        nPax: world.pax.n, surgeCount: world.pax.surgeCount, surgeStop: opts.surgeStop ?? -1,
        fleet: { scheduled: world.fleet.scheduled, pool: world.fleet.pool, electric: world.fleet.electric },
        model: { profileDays: model.training.profileDays, fitDays: model.training.fitDays, testDays: model.training.testDays, maeProfile: model.training.maeProfile, maeModel: model.training.maeModel, seeds: model.training.seeds },
      };
      ctx.postMessage(ready);
      selected = -1;
      jumpFrom = DAY_START;
      target = Math.max(DAY_START + 1, Math.min(DAY_END, m.startAt));
      initialised = true;
      lastTick = performance.now();
      break;
    }
    case 'play': playing = m.playing; owed = 0; forceSlow = true; break;
    case 'speed': speed = m.speed; forceSlow = true; break;
    case 'jump': {
      const t = Math.max(DAY_START + 1, Math.min(DAY_END, Math.round(m.t)));
      if (t < samam.t) build(); // rewind = replay from the start of the day, with logged actions up to t
      jumpFrom = samam.t;
      target = t;
      break;
    }
    case 'mode': mode = m.mode; record({ kind: 'mode', mode: m.mode }, m.mode === 'manual' ? 'Switched to manual mode' : 'Switched to auto mode'); break;
    case 'decide': record({ kind: 'decide', id: m.id, approve: m.approve }, ''); break;
    case 'blockSensor': record({ kind: 'blockSensor', bus: m.bus, blocked: m.blocked }, `${m.blocked ? 'Blocked' : 'Unblocked'} the passenger counter on ${samam.buses[m.bus]?.code}`); break;
    case 'breakdown': record({ kind: 'breakdown', bus: m.bus }, `Triggered a breakdown of ${samam.buses[m.bus]?.code}`); break;
    case 'select': selected = m.bus; selectedArm = m.arm; forceSlow = true; break;
    case 'forecast': fcPattern = m.pattern; forceSlow = true; break;
    case 'report': ctx.postMessage(report()); break;
  }
  if (initialised && target < 0 && !playing) tick();
};

setInterval(tick, 33);
