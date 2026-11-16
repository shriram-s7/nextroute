// Messages between the UI thread and the simulation worker.
import type { Kpis, RecKind, RecStatus, RunOptions } from '../engine/index';

export type Arm = 'base' | 'samam';

export type ToWorker =
  | { type: 'init'; opts: RunOptions; startAt: number; speed: number; playing: boolean; mode: 'auto' | 'manual' }
  | { type: 'play'; playing: boolean }
  | { type: 'speed'; speed: number }
  | { type: 'jump'; t: number }
  | { type: 'mode'; mode: 'auto' | 'manual' }
  | { type: 'decide'; id: number; approve: boolean }
  | { type: 'blockSensor'; bus: number; blocked: boolean }
  | { type: 'breakdown'; bus: number }
  | { type: 'select'; bus: number; arm: Arm }
  | { type: 'forecast'; pattern: number }
  | { type: 'report' };

export interface BusMeta { id: number; code: string; line: number; electric: boolean; seats: number; cap: number; pool: boolean }

export interface RecView {
  id: number; t: number; kind: RecKind; status: RecStatus; auto: boolean; bus: number; busCode: string;
  line: string; pattern: number; stop: number; title: string; reason: string; effect: string; expires: number; lon: number; lat: number;
}

export interface Instruction { kind: 'hold' | 'holdAhead' | 'short' | 'flex' | 'cover' | 'layover' | 'charge' | 'broken' | 'proceed' | 'out'; text: string; sub: string; sec?: number }

export interface BusDetail {
  id: number; code: string; arm: Arm; lineId: string; electric: boolean; pool: boolean; seats: number; cap: number;
  state: number; pattern: number; patternId: string; from: string; to: string; runKind: number;
  stopIdx: number; runFrom: number; runTo: number; nextStop: string; atStop: string;
  load: number; est: number; band: number; src: number; conf: number; health: number;
  trueFault: number; manualBlock: boolean; lastCount: number | null; ticketEst: number; detectedAt: number;
  soc: number; rangeKm: number; km: number; trips: number;
  instruction: Instruction;
  trace: { idx: number[]; load: number[]; est: number[] };
  stopNames: string[];
  next: { dep: number; to: string }[];
  lon: number; lat: number;
}

export interface ForecastView {
  pattern: number; patternId: string; from: string; to: string; stopNames: string[]; nLinks: number; nBins: number; horizons: number;
  t: number; nowBin: number; cap: number;
  actual: Float32Array; // nLinks x nBins, -1 where no bus ran (simulation ground truth, Samam arm)
  pred30: Float32Array; // forecast made ~30 min before each bin, -1 if none
  pred60: Float32Array;
  profile: Float32Array;
  live: Float32Array; // nLinks x horizons: the forecast for the next 60 min
  mae: { n: number; model30: number; model60: number; profile: number };
}

export interface SeriesView { bin: number; start: number; board: Float32Array; wait: Float32Array; left: Float32Array; dep: Float32Array; crush: Float32Array; bunch: Float32Array }

export interface Frame {
  type: 'frame';
  t: number; playing: boolean; speed: number; busy: boolean; progress: number; mode: 'auto' | 'manual'; done: boolean;
  bus: { base: Float32Array; samam: Float32Array };
  wait?: { base: Uint16Array; samam: Uint16Array };
  kpi?: { base: Kpis; samam: Kpis };
  recs?: { version: number; items: RecView[]; total: number; pending: number; counts: Record<string, number> };
  detail?: BusDetail | null;
  forecast?: ForecastView | null;
}

export interface ReadyMsg {
  type: 'ready';
  opts: RunOptions; buses: BusMeta[]; nPax: number; surgeCount: number; surgeStop: number;
  fleet: { scheduled: number; pool: number; electric: number };
  model: { profileDays: number; fitDays: number; testDays: number; maeProfile: number[]; maeModel: number[]; seeds: string };
}

export interface ReportMsg {
  type: 'report';
  t: number; opts: RunOptions; kpi: { base: Kpis; samam: Kpis };
  series: { base: SeriesView; samam: SeriesView };
  recCounts: Record<string, number>;
  sensors: { faults: number; detected: number; falseAlarms: number; medianDelayMin: number };
  forecast: { n: number; model30: number; model60: number; profile: number };
  topLeft: { stop: number; base: number; samam: number }[];
  interventions: { t: number; text: string }[];
}

export type FromWorker = Frame | ReadyMsg | ReportMsg;
