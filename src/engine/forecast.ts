// Load forecast: a time-of-day profile learned from prior simulated days, corrected by live
// observations through a small linear model (ridge regression) fitted on simulated days.
// It is NOT deep learning. Everything here runs identically in the browser worker and in Node.
import { BIN, N_BINS, binOf } from './config';
import { DAY_START, type Network } from './network';

export const HORIZONS = 6; // 6 x 10 min = the next 60 minutes

export interface ForecastModel {
  bin: number;
  nBins: number;
  /** Per pattern: mean load on each link per time bin (x10, integer) and mean boardings per departure (x10). */
  patterns: { id: string; n: number; load: number[]; board: number[] }[];
  /** pred = profile + a[h] * residual(link) + c[h] * residual(upstream link) + g[h] * (pattern demand ratio - 1) * profile, h = 1..6 */
  coef: { a: number[]; c: number[]; g: number[] };
  training: {
    profileDays: number; fitDays: number; testDays: number; seeds: string; generatedAt: string;
    maeProfile: number[]; maeModel: number[]; // per horizon, passengers per bus, on held-out simulated days
    samples: number;
  };
}

export class Profile {
  private load: Float32Array[];
  private board: Float32Array[];
  readonly ok: boolean;
  constructor(net: Network, model: ForecastModel | null) {
    this.ok = !!model && model.patterns.length === net.patterns.length;
    this.load = net.patterns.map((p, i) => {
      const a = new Float32Array(p.n * N_BINS);
      if (this.ok) { const src = model!.patterns[i].load; for (let k = 0; k < a.length; k++) a[k] = (src[k] || 0) / 10; }
      return a;
    });
    this.board = net.patterns.map((p, i) => {
      const a = new Float32Array(p.n * N_BINS);
      if (this.ok) { const src = model!.patterns[i].board; for (let k = 0; k < a.length; k++) a[k] = (src[k] || 0) / 10; }
      return a;
    });
  }
  /** Profile load on link k of pattern p at time t (linear interpolation between bin centres). */
  loadAt(p: number, k: number, t: number): number {
    const x = (t - DAY_START) / BIN - 0.5;
    const b0 = Math.max(0, Math.min(N_BINS - 1, Math.floor(x)));
    const b1 = Math.min(N_BINS - 1, b0 + 1);
    const f = Math.max(0, Math.min(1, x - b0));
    const a = this.load[p];
    return a[k * N_BINS + b0] * (1 - f) + a[k * N_BINS + b1] * f;
  }
  loadBin(p: number, k: number, b: number): number { return this.load[p][k * N_BINS + b]; }
  boardBin(p: number, k: number, b: number): number { return this.board[p][k * N_BINS + b]; }
}

/** Live forecaster. Fed with the controller's load estimates (never ground truth). */
export class Forecaster {
  readonly profile: Profile;
  private a: number[];
  private c: number[];
  private g: number[];
  private so: Float64Array; // per pattern: decayed sum of observed loads
  private sp: Float64Array; // per pattern: decayed sum of the profile at the same links/times
  private tg: Float64Array;
  private v: Float32Array[]; // decayed sum of residuals per link
  private w: Float32Array[]; // decayed weight
  private tl: Float64Array[]; // time of last observation
  private upStep: number[][]; // per pattern, per horizon: links travelled
  /** F[p][k * HORIZONS + (h-1)] = predicted mean load per bus on link k in the bin h steps ahead. */
  readonly F: Float32Array[];
  /** Predictions kept for the forecast-vs-actual view: made ~30 and ~60 minutes before the target bin. */
  readonly pred30: Float32Array[];
  readonly pred60: Float32Array[];
  lastUpdate = -1;

  constructor(private net: Network, model: ForecastModel | null) {
    this.profile = new Profile(net, model);
    this.a = model?.coef.a ?? new Array(HORIZONS).fill(0);
    this.c = model?.coef.c ?? new Array(HORIZONS).fill(0);
    this.g = model?.coef.g ?? new Array(HORIZONS).fill(0);
    this.so = new Float64Array(net.patterns.length);
    this.sp = new Float64Array(net.patterns.length);
    this.tg = new Float64Array(net.patterns.length).fill(-1e9);
    this.v = net.patterns.map((p) => new Float32Array(p.n));
    this.w = net.patterns.map((p) => new Float32Array(p.n));
    this.tl = net.patterns.map((p) => new Float64Array(p.n).fill(-1e9));
    this.F = net.patterns.map((p) => new Float32Array(p.n * HORIZONS));
    this.pred30 = net.patterns.map((p) => new Float32Array(p.n * N_BINS).fill(-1));
    this.pred60 = net.patterns.map((p) => new Float32Array(p.n * N_BINS).fill(-1));
    this.upStep = net.patterns.map((p) => {
      const linkT = p.schedRun / Math.max(1, p.n - 1);
      return Array.from({ length: HORIZONS }, (_, i) => Math.max(1, Math.round(((i + 0.5) * BIN) / linkT)));
    });
  }

  /** A bus of pattern p left stop k at time t with estimated load `est`. */
  observe(p: number, k: number, t: number, est: number): void {
    const prof = this.profile.loadAt(p, k, t);
    const res = est - prof;
    const fg = Math.exp(-(t - this.tg[p]) / 1800);
    this.so[p] = this.so[p] * fg + est;
    this.sp[p] = this.sp[p] * fg + prof;
    this.tg[p] = t;
    const f = Math.exp(-(t - this.tl[p][k]) / 900);
    this.v[p][k] = this.v[p][k] * f + res;
    this.w[p][k] = this.w[p][k] * f + 1;
    this.tl[p][k] = t;
  }

  residual(p: number, k: number, now: number): number {
    const w = this.w[p][k];
    if (w <= 0) return 0;
    return (this.v[p][k] / w) * Math.exp(-(now - this.tl[p][k]) / 1800);
  }

  /** How much busier (>0) or quieter (<0) than the profile the whole pattern has been over the last ~30 min. */
  demandRatio(p: number, now: number): number {
    if (this.sp[p] < 20) return 0;
    const r = Math.max(0.5, Math.min(2, this.so[p] / this.sp[p])) - 1;
    return r * Math.exp(-(now - this.tg[p]) / 3600);
  }

  /** Model inputs for (pattern, link, horizon). Used live and by the training script. */
  features(p: number, k: number, h: number, now: number): [number, number, number] {
    const up = Math.max(0, k - this.upStep[p][h - 1]);
    return [this.residual(p, k, now), this.residual(p, up, now), this.demandRatio(p, now) * this.profile.loadBin(p, k, this.targetBin(now, h))];
  }

  targetBin(now: number, h: number): number { return binOf(now + (h - 0.5) * BIN); }

  update(now: number): void {
    this.lastUpdate = now;
    const atBoundary = Math.round(now - DAY_START) % BIN === 0;
    for (const p of this.net.patterns) {
      const F = this.F[p.idx];
      for (let k = 0; k < p.n - 1; k++) {
        for (let h = 1; h <= HORIZONS; h++) {
          const tb = this.targetBin(now, h);
          const [rl, ru, rg] = this.features(p.idx, k, h, now);
          const pred = Math.max(0, this.profile.loadBin(p.idx, k, tb) + this.a[h - 1] * rl + this.c[h - 1] * ru + this.g[h - 1] * rg);
          F[k * HORIZONS + h - 1] = pred;
          if (atBoundary) {
            if (h === 4) this.pred30[p.idx][k * N_BINS + tb] = pred;
            if (h === 6) this.pred60[p.idx][k * N_BINS + tb] = pred;
          }
        }
      }
    }
  }

  /** Predicted load on link k of pattern p at absolute time t (within the horizon; beyond it, the last step). */
  predAt(p: number, k: number, t: number): number {
    const now = this.lastUpdate;
    const h = Math.max(1, Math.min(HORIZONS, Math.ceil((t - now) / BIN)));
    return this.F[p][k * HORIZONS + h - 1];
  }
}

export interface FitRow { rl: number; ru: number; rg: number; y: number }

/** Fit pred - profile = a*rl + c*ru + g*rg by ridge least squares (3x3 normal equations, Gaussian elimination). */
export function fitCoef(rows: FitRow[], lambda = 1): { a: number; c: number; g: number } {
  const A = [[lambda, 0, 0], [0, lambda, 0], [0, 0, lambda]];
  const b = [0, 0, 0];
  for (const r of rows) {
    const x = [r.rl, r.ru, r.rg];
    for (let i = 0; i < 3; i++) { b[i] += x[i] * r.y; for (let j = 0; j < 3; j++) A[i][j] += x[i] * x[j]; }
  }
  for (let i = 0; i < 3; i++) {
    let piv = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    [A[i], A[piv]] = [A[piv], A[i]]; [b[i], b[piv]] = [b[piv], b[i]];
    if (Math.abs(A[i][i]) < 1e-9) return { a: 0, c: 0, g: 0 };
    for (let r = i + 1; r < 3; r++) {
      const f = A[r][i] / A[i][i];
      for (let j = i; j < 3; j++) A[r][j] -= f * A[i][j];
      b[r] -= f * b[i];
    }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < 3; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return { a: x[0], c: x[1], g: x[2] };
}
