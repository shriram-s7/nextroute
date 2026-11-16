// Trains the load forecast on simulated days only, and writes src/data/forecast-model.json.
//   Stage A: time-of-day profile = mean link load per 10-minute bin over fixed-schedule days.
//   Stage B: linear residual correction fitted on further fixed-schedule days.
//   Stage C: refit including days run under Samam (using the stage-B model), so the correction is
//            valid for the arm it is deployed in.
//   Test:    held-out days, mean absolute error of profile-only vs profile + correction.
// Usage: npx tsx scripts/train-forecast.ts
import { readFileSync, writeFileSync } from 'node:fs';
import {
  BASELINE, SAMAM, BIN, DAY_END, DAY_START, DEFAULT_OPTIONS, HORIZONS, N_BINS, Forecaster, buildNetwork, createSim, createWorld, fitCoef,
  type FitRow, type ForecastModel, type RawCorridor, type ScenarioId,
} from '../src/engine/index';
import { hashUnit } from '../src/engine/rng';

const raw = JSON.parse(readFileSync('src/data/corridor.json', 'utf8')) as RawCorridor;
const net = buildNetwork(raw);

const PROFILE_SEEDS = Array.from({ length: 12 }, (_, i) => 9001 + i);
const FIT_SEEDS = Array.from({ length: 8 }, (_, i) => 9101 + i);
const TEST_SEEDS = Array.from({ length: 6 }, (_, i) => 9201 + i);

function dayOptions(seed: number, varied: boolean) {
  // training days vary demand by ±12% (and a few have rain) so the correction has something to learn
  const scale = varied ? 0.88 + 0.24 * hashUnit(seed, 1, 2) : 0.95 + 0.1 * hashUnit(seed, 1, 2);
  const scenario: ScenarioId = varied && hashUnit(seed, 3, 4) < 0.25 ? 'rain' : 'normal';
  return { ...DEFAULT_OPTIONS, seed, scenario, demandScale: scale };
}

// ---------------- Stage A: profile ----------------
const sum = net.patterns.map((p) => new Float64Array(p.n * N_BINS));
const cnt = net.patterns.map((p) => new Float64Array(p.n * N_BINS));
const brd = net.patterns.map((p) => new Float64Array(p.n * N_BINS));
for (const seed of PROFILE_SEEDS) {
  const sim = createSim(createWorld(net, dayOptions(seed, false)), BASELINE, null);
  sim.runTo(DAY_END);
  for (const p of net.patterns) for (let i = 0; i < p.n * N_BINS; i++) {
    sum[p.idx][i] += sim.actSum[p.idx][i]; cnt[p.idx][i] += sim.actCnt[p.idx][i]; brd[p.idx][i] += sim.boardSum[p.idx][i];
  }
}
function smooth(vals: Float64Array, n: Float64Array, nLinks: number): number[] {
  // mean per cell, with a count-weighted 1-2-1 smoothing across neighbouring time bins
  const out: number[] = new Array(nLinks * N_BINS).fill(0);
  for (let k = 0; k < nLinks; k++) for (let b = 0; b < N_BINS; b++) {
    let s = 0, w = 0;
    for (const [db, wt] of [[-1, 1], [0, 2], [1, 1]] as const) {
      const bb = b + db;
      if (bb < 0 || bb >= N_BINS) continue;
      s += wt * vals[k * N_BINS + bb]; w += wt * n[k * N_BINS + bb];
    }
    out[k * N_BINS + b] = w > 0 ? Math.round((s / w) * 10) : 0;
  }
  return out;
}
const model: ForecastModel = {
  bin: BIN, nBins: N_BINS,
  patterns: net.patterns.map((p) => ({ id: p.id, n: p.n, load: smooth(sum[p.idx], cnt[p.idx], p.n), board: smooth(brd[p.idx], cnt[p.idx], p.n) })),
  coef: { a: new Array(HORIZONS).fill(0), c: new Array(HORIZONS).fill(0), g: new Array(HORIZONS).fill(0) },
  training: { profileDays: PROFILE_SEEDS.length, fitDays: 0, testDays: TEST_SEEDS.length, seeds: '', generatedAt: new Date().toISOString(), maeProfile: [], maeModel: [], samples: 0 },
};
console.log(`stage A: profile from ${PROFILE_SEEDS.length} fixed-schedule days`);

// ---------------- feature collection ----------------
interface DayData { feats: Float32Array[]; sim: ReturnType<typeof createSim> }
function runDay(seed: number, samam: boolean, m: ForecastModel): DayData {
  const world = createWorld(net, dayOptions(seed, true));
  const sim = createSim(world, samam ? SAMAM : { ...BASELINE, collect: true }, m);
  // feats[p][((k * N_BINS) + bin) * HORIZONS * 3 + (h-1)*3 + {0,1,2}]
  const feats = net.patterns.map((p) => new Float32Array(p.n * N_BINS * HORIZONS * 3));
  while (sim.t < DAY_END) {
    sim.step();
    if ((sim.t - DAY_START) % BIN === 0 && sim.t < DAY_END) {
      const b = (sim.t - DAY_START) / BIN;
      for (const p of net.patterns) for (let k = 0; k < p.n - 1; k++) for (let h = 1; h <= HORIZONS; h++) {
        const [rl, ru, rg] = sim.fc.features(p.idx, k, h, sim.t);
        const o = (k * N_BINS + b) * HORIZONS * 3 + (h - 1) * 3;
        feats[p.idx][o] = rl; feats[p.idx][o + 1] = ru; feats[p.idx][o + 2] = rg;
      }
    }
  }
  return { feats, sim };
}
function rowsOf(d: DayData, m: ForecastModel) {
  const prof = new Forecaster(net, m).profile;
  const rows: FitRow[][] = Array.from({ length: HORIZONS }, () => []);
  for (const p of net.patterns) for (let k = 0; k < p.n - 1; k++) for (let b = 0; b < N_BINS; b++) for (let h = 1; h <= HORIZONS; h++) {
    const tb = b + h - 1; // features taken at the start of bin b; horizon h targets bin b+h-1
    if (tb >= N_BINS) continue;
    const n = d.sim.actCnt[p.idx][k * N_BINS + tb];
    if (n === 0) continue;
    const actual = d.sim.actSum[p.idx][k * N_BINS + tb] / n;
    const o = (k * N_BINS + b) * HORIZONS * 3 + (h - 1) * 3;
    rows[h - 1].push({ rl: d.feats[p.idx][o], ru: d.feats[p.idx][o + 1], rg: d.feats[p.idx][o + 2], y: actual - prof.loadBin(p.idx, k, tb) });
  }
  return rows;
}
function fit(all: FitRow[][]) {
  const a: number[] = [], c: number[] = [], g: number[] = [];
  for (let h = 0; h < HORIZONS; h++) { const f = fitCoef(all[h], 50); a.push(+f.a.toFixed(4)); c.push(+f.c.toFixed(4)); g.push(+f.g.toFixed(4)); }
  return { a, c, g };
}
const merge = (acc: FitRow[][], r: FitRow[][]) => { for (let h = 0; h < HORIZONS; h++) for (const x of r[h]) acc[h].push(x); };

// ---------------- Stage B ----------------
const rowsAll: FitRow[][] = Array.from({ length: HORIZONS }, () => []);
for (const seed of FIT_SEEDS) merge(rowsAll, rowsOf(runDay(seed, false, model), model));
model.coef = fit(rowsAll);
console.log('stage B coef (fixed-schedule days):', JSON.stringify(model.coef));

// ---------------- Stage C ----------------
for (const seed of FIT_SEEDS) merge(rowsAll, rowsOf(runDay(seed + 50, true, model), model));
model.coef = fit(rowsAll);
console.log('stage C coef (+ Samam days):       ', JSON.stringify(model.coef));

// ---------------- Test ----------------
const errP = new Array(HORIZONS).fill(0), errM = new Array(HORIZONS).fill(0), nn = new Array(HORIZONS).fill(0);
for (const seed of TEST_SEEDS) for (const samam of [false, true]) {
  const rows = rowsOf(runDay(seed, samam, model), model);
  for (let h = 0; h < HORIZONS; h++) for (const r of rows[h]) {
    errP[h] += Math.abs(r.y);
    errM[h] += Math.abs(r.y - (model.coef.a[h] * r.rl + model.coef.c[h] * r.ru + model.coef.g[h] * r.rg));
    nn[h]++;
  }
}
model.training.fitDays = FIT_SEEDS.length * 2;
model.training.seeds = `profile ${PROFILE_SEEDS[0]}-${PROFILE_SEEDS[PROFILE_SEEDS.length - 1]}, fit ${FIT_SEEDS[0]}-${FIT_SEEDS[FIT_SEEDS.length - 1]} (fixed schedule) and ${FIT_SEEDS[0] + 50}-${FIT_SEEDS[FIT_SEEDS.length - 1] + 50} (Samam), test ${TEST_SEEDS[0]}-${TEST_SEEDS[TEST_SEEDS.length - 1]} (both arms)`;
model.training.maeProfile = errP.map((e, h) => +(e / nn[h]).toFixed(2));
model.training.maeModel = errM.map((e, h) => +(e / nn[h]).toFixed(2));
model.training.samples = rowsAll.reduce((a, r) => a + r.length, 0);
console.log('held-out MAE (riders per bus) by horizon 10..60 min:');
console.log('  profile only     :', model.training.maeProfile.join('  '));
console.log('  profile + correct:', model.training.maeModel.join('  '));
writeFileSync('src/data/forecast-model.json', JSON.stringify(model));
console.log(`wrote src/data/forecast-model.json (${(JSON.stringify(model).length / 1024).toFixed(0)} KB, ${model.training.samples} fit samples)`);
