// Quick headless sanity run: one baseline day, prints calibration figures.
import { readFileSync } from 'node:fs';
import { createWorld, createSim, BASELINE, SAMAM, DAY_END, DEFAULT_OPTIONS, type RawCorridor, type ForecastModel } from '../src/engine/index';
import { existsSync } from 'node:fs';

const raw = JSON.parse(readFileSync('src/data/corridor.json', 'utf8')) as RawCorridor;
const model = existsSync('src/data/forecast-model.json') ? (JSON.parse(readFileSync('src/data/forecast-model.json', 'utf8')) as ForecastModel) : null;
const scenario = (process.argv[2] as any) || 'normal';
const seed = +(process.argv[3] || 1);
const t0 = Date.now();
const world = createWorld(raw, { ...DEFAULT_OPTIONS, seed, scenario });
console.log(`world: ${world.pax.n} passengers, fleet ${world.fleet.scheduled} scheduled + ${world.fleet.pool} pool, ${world.fleet.electric} electric (${Date.now() - t0} ms)`);
for (const l of world.net.lines) console.log(`  line ${l.id}: ${world.fleet.buses.filter((b) => b.line === l.idx).length} buses`);
for (const [name, cfg] of [['baseline', BASELINE], ['samam', SAMAM]] as const) {
  if (name === 'samam' && !model) continue;
  const t1 = Date.now();
  const sim = createSim(world, cfg, model);
  sim.runTo(DAY_END);
  const k = sim.kpis();
  const c = sim.conservation();
  console.log(`\n${name} (${Date.now() - t1} ms) conservation ok=${c.ok}`, c);
  console.log(`  journey ${(k.avgJourney / 60).toFixed(2)} min ride ${(k.avgRide / 60).toFixed(2)} min`);
  console.log(`  avgWait ${(k.avgWait / 60).toFixed(2)} min  p90 ${(k.p90Wait / 60).toFixed(1)} min  leftBehind ${k.leftBehind} (unique ${k.leftUnique})  p99 load factor ${k.peakLoadFactor.toFixed(2)}  max load ${k.maxLoad}  crush ${(k.crushShare * 100).toFixed(2)}%  bunching ${k.bunching}  km ${Math.round(k.busKm)}`);
  console.log(`  holds ${k.holds} (${Math.round(k.holdSec / 60)} min)  short ${k.shortTrips}  flex ${k.flexTrips}  covers ${k.covers}  recs ${sim.recs.length}  waiting at end ${k.waiting}`);
  console.log(`  run time actual/scheduled ${(sim.k.runActual / sim.k.runSched).toFixed(3)}  late starts (>3 min) ${sim.k.lateStarts}/${sim.k.starts}`);
  const lf: number[] = [];
  let tot = 0; for (let i = 0; i <= 130; i++) tot += sim.loadFactorHist[i];
  let acc = 0; const qs = [0.5, 0.9, 0.99]; let qi = 0;
  for (let i = 0; i <= 130 && qi < qs.length; i++) { acc += sim.loadFactorHist[i]; while (qi < qs.length && acc >= qs[qi] * tot) { lf.push(i); qi++; } }
  console.log(`  load factor % at departures p50/p90/p99: ${lf.join('/')}`);
  const s = sim.series; const rows: string[] = [];
  for (let h = 5; h < 23; h++) { let b = 0, w = 0, l = 0, cr = 0, d = 0; for (let q = 0; q < 4; q++) { const i = (h - 4) * 4 + q; b += s.board[i]; w += s.wait[i]; l += s.left[i]; cr += s.crush[i]; d += s.dep[i]; } rows.push(`${h}h: board ${b} wait ${(w / Math.max(1, b) / 60).toFixed(1)}m left ${l} crush ${(100 * cr / Math.max(1, d)).toFixed(1)}%`); }
  console.log('  ' + rows.join('\n  '));
}
