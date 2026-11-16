// UI state + the bridge to the simulation worker.
// High-frequency data (bus positions) lives in the mutable `live` object, outside React, and is read
// by the map's animation loop. Everything else goes through the zustand store at ~4 Hz.
import { create } from 'zustand';
import corridorRaw from '../data/corridor.json';
import { DAY_START, DEFAULT_OPTIONS, SCENARIOS, buildNetwork, type Kpis, type Network, type RawCorridor, type RunOptions, type ScenarioId } from '../engine/index';
import type { Arm, BusDetail, BusMeta, ForecastView, Frame, FromWorker, ReadyMsg, RecView, ReportMsg, ToWorker } from '../worker/protocol';

export const net: Network = buildNetwork(corridorRaw as unknown as RawCorridor);

export type View = 'live' | 'forecast' | 'report' | 'methods';

export interface LiveData {
  prev: { base: Float32Array; samam: Float32Array } | null;
  curr: { base: Float32Array; samam: Float32Array } | null;
  tRecv: number; // performance.now() when curr arrived
  interval: number; // ms between the last two frames
  wait: { base: Uint16Array; samam: Uint16Array } | null;
  waitVersion: number;
  simT: number;
}
export const live: LiveData = { prev: null, curr: null, tRecv: 0, interval: 100, wait: null, waitVersion: 0, simT: DAY_START };

interface State {
  ready: ReadyMsg | null;
  buses: BusMeta[];
  t: number; playing: boolean; speed: number; busy: boolean; progress: number; done: boolean;
  mode: 'auto' | 'manual';
  kpi: { base: Kpis; samam: Kpis } | null;
  recs: RecView[]; recTotal: number; recPending: number; recCounts: Record<string, number>;
  detail: BusDetail | null;
  forecast: ForecastView | null;
  report: ReportMsg | null;
  // ui
  view: View; arm: Arm; selectedBus: number; selectedStop: number; follow: boolean; panelTab: 'bus' | 'driver';
  fcPattern: number;
  options: RunOptions;
  mapNotice: string | null; mapKind: string;
  set: (p: Partial<State>) => void;
}

export const useStore = create<State>((set) => ({
  ready: null, buses: [], t: DAY_START, playing: false, speed: 30, busy: true, progress: 0, done: false, mode: 'auto',
  kpi: null, recs: [], recTotal: 0, recPending: 0, recCounts: {}, detail: null, forecast: null, report: null,
  view: 'live', arm: 'samam', selectedBus: -1, selectedStop: -1, follow: false, panelTab: 'bus', fcPattern: 1,
  options: { ...DEFAULT_OPTIONS },
  mapNotice: null, mapKind: '',
  set: (p) => set(p),
}));

// ------------------------------------------------------------------ worker (created once, survives hot reload)
type Hot = { worker?: Worker };
const hot: Hot = ((window as unknown as { __samam?: Hot }).__samam ??= {});

function onMessage(e: MessageEvent<FromWorker>): void {
  const m = e.data;
  if (m.type === 'ready') {
    useStore.setState({ ready: m, buses: m.buses, options: m.opts, report: null, recs: [], recTotal: 0, recPending: 0, recCounts: {}, detail: null, kpi: null });
    live.prev = live.curr = null;
    return;
  }
  if (m.type === 'report') { useStore.setState({ report: m }); return; }
  const f = m as Frame;
  const now = performance.now();
  live.prev = f.busy ? null : live.curr;
  live.curr = f.bus;
  live.interval = Math.max(16, Math.min(1100, now - live.tRecv));
  live.tRecv = now;
  live.simT = f.t;
  if (f.wait) { live.wait = f.wait; live.waitVersion++; }
  const s = useStore.getState();
  const patch: Partial<State> = {};
  if (f.kpi || f.busy !== s.busy || f.playing !== s.playing) {
    patch.t = f.t; patch.playing = f.playing; patch.speed = f.speed; patch.busy = f.busy; patch.progress = f.progress; patch.mode = f.mode; patch.done = f.done;
  } else if (Math.floor(f.t) !== Math.floor(s.t) && (f.speed <= 10 || Math.floor(f.t / 5) !== Math.floor(s.t / 5))) patch.t = f.t;
  if (f.kpi) patch.kpi = f.kpi;
  if (f.recs) { patch.recs = f.recs.items; patch.recTotal = f.recs.total; patch.recPending = f.recs.pending; patch.recCounts = f.recs.counts; }
  if (f.detail !== undefined) patch.detail = f.detail;
  if (f.forecast !== undefined) patch.forecast = f.forecast;
  if (Object.keys(patch).length) useStore.setState(patch);
}

function worker(): Worker {
  if (!hot.worker) hot.worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
  hot.worker.onmessage = onMessage;
  return hot.worker;
}
const send = (m: ToWorker) => worker().postMessage(m);

export const SCENARIO_START: Record<ScenarioId, number> = {
  normal: 7.5 * 3600, rain: 16.25 * 3600, surge: 17.75 * 3600, sensors: 7.5 * 3600, breakdown: 8.5 * 3600,
};

export const actions = {
  start(opts: RunOptions, startAt?: number) {
    const s = useStore.getState();
    useStore.setState({ busy: true, progress: 0, selectedBus: -1, detail: null, options: opts, report: null });
    send({ type: 'init', opts, startAt: startAt ?? SCENARIO_START[opts.scenario], speed: s.speed, playing: true, mode: s.mode });
    if (s.view === 'forecast') send({ type: 'forecast', pattern: s.fcPattern });
  },
  play(playing: boolean) { send({ type: 'play', playing }); },
  speed(speed: number) { useStore.setState({ speed }); send({ type: 'speed', speed }); },
  jump(t: number) { useStore.setState({ busy: true, progress: 0 }); send({ type: 'jump', t }); },
  mode(mode: 'auto' | 'manual') { useStore.setState({ mode }); send({ type: 'mode', mode }); },
  decide(id: number, approve: boolean) { send({ type: 'decide', id, approve }); },
  blockSensor(bus: number, blocked: boolean) { send({ type: 'blockSensor', bus, blocked }); },
  breakdown(bus: number) { send({ type: 'breakdown', bus }); },
  select(bus: number) {
    const s = useStore.getState();
    useStore.setState({ selectedBus: bus, selectedStop: -1, detail: bus < 0 ? null : s.detail, follow: bus < 0 ? false : s.follow });
    send({ type: 'select', bus, arm: s.arm });
  },
  selectStop(stop: number) { useStore.setState({ selectedStop: stop, selectedBus: -1, detail: null }); send({ type: 'select', bus: -1, arm: useStore.getState().arm }); },
  arm(arm: Arm) {
    const s = useStore.getState();
    useStore.setState({ arm });
    send({ type: 'select', bus: s.selectedBus, arm });
  },
  view(view: View) {
    const s = useStore.getState();
    useStore.setState({ view });
    send({ type: 'forecast', pattern: view === 'forecast' ? s.fcPattern : -1 });
    if (view === 'report') send({ type: 'report' });
  },
  forecastPattern(p: number) { useStore.setState({ fcPattern: p }); send({ type: 'forecast', pattern: p }); },
  refreshReport() { send({ type: 'report' }); },
};

export function boot(): void {
  worker();
  if (!useStore.getState().ready) actions.start(useStore.getState().options);
}

if (typeof window !== 'undefined') {
  (window as unknown as { __actions: typeof actions; __useStore: typeof useStore }).__actions = actions;
  (window as unknown as { __actions: typeof actions; __useStore: typeof useStore }).__useStore = useStore;
}

// ------------------------------------------------------------------ formatting helpers
export const fmtClock = (t: number, withSec = false): string => {
  const s = Math.floor(t);
  const hh = String(Math.floor(s / 3600) % 24).padStart(2, '0'), mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
  return withSec ? `${hh}:${mm}:${String(s % 60).padStart(2, '0')}` : `${hh}:${mm}`;
};
export const fmtInt = (x: number): string => Math.round(x).toLocaleString('en-IN');
export const fmtMin = (sec: number, d = 1): string => (sec / 60).toFixed(d);
export const scenarioName = (id: ScenarioId): string => SCENARIOS[id].name;
