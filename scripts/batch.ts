// Headless batch experiment: every scenario x 20 seeds x three arms.
//   baseline     fixed GTFS schedule, no control (flex pool stays in the depot)
//   samam-hold   Samam with holding only (no extra buses) — shows what spacing alone achieves
//   samam        Samam with all three levers (holding, short-turn trips, flex pool)
// Writes results/results.json and results/RESULTS.md. The README quotes these numbers.
// Usage: npx tsx scripts/batch.ts [nSeeds=20]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  BASELINE, SAMAM, DAY_END, DEFAULT_OPTIONS, SCENARIOS, buildNetwork, createSim, createWorld,
  type ForecastModel, type Kpis, type RawCorridor, type ScenarioId, type SimConfig,
} from '../src/engine/index';

const raw = JSON.parse(readFileSync('src/data/corridor.json', 'utf8')) as RawCorridor;
const model = JSON.parse(readFileSync('src/data/forecast-model.json', 'utf8')) as ForecastModel;
const net = buildNetwork(raw);
const N = +(process.argv[2] || 20);
const seeds = Array.from({ length: N }, (_, i) => 101 + i);

const ARMS: { id: string; label: string; cfg: Omit<SimConfig, 'model'> }[] = [
  { id: 'baseline', label: 'Fixed schedule', cfg: BASELINE },
  { id: 'samam-hold', label: 'Samam, holding only', cfg: { ...SAMAM, levers: { hold: true, short: false, flex: false } } },
  { id: 'samam', label: 'Samam, all levers', cfg: SAMAM },
];

const METRICS: { key: string; label: string; unit: string; get: (k: Kpis) => number; digits: number; lowerBetter: boolean }[] = [
  { key: 'avgWait', label: 'Average wait', unit: 'min', get: (k) => k.avgWait / 60, digits: 2, lowerBetter: true },
  { key: 'p90Wait', label: '90th pct wait', unit: 'min', get: (k) => k.p90Wait / 60, digits: 2, lowerBetter: true },
  { key: 'leftBehind', label: 'Left behind', unit: 'events', get: (k) => k.leftBehind, digits: 0, lowerBetter: true },
  { key: 'peakLoad', label: 'Peak load (p99)', unit: '% cap', get: (k) => k.peakLoadFactor * 100, digits: 1, lowerBetter: true },
  { key: 'crush', label: 'Crush departures', unit: '%', get: (k) => k.crushShare * 100, digits: 2, lowerBetter: true },
  { key: 'bunching', label: 'Bunching events', unit: '', get: (k) => k.bunching, digits: 0, lowerBetter: true },
  { key: 'busKm', label: 'Bus-km', unit: 'km', get: (k) => k.busKm, digits: 0, lowerBetter: true },
  { key: 'journey', label: 'Average journey', unit: 'min', get: (k) => k.avgJourney / 60, digits: 2, lowerBetter: true },
];

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const T975: Record<number, number> = { 5: 2.776, 10: 2.262, 20: 2.093, 30: 2.045 };
const tcrit = T975[N] ?? 2.1;

interface Cell { values: number[]; mean: number; sd: number }
const results: Record<string, Record<string, Record<string, Cell>>> = {};
const extras: Record<string, { holds: number[]; shortTrips: number[]; flexTrips: number[]; covers: number[]; faults: number; detected: number; falseAlarms: number; delays: number[] }> = {};
const t0 = Date.now();
for (const sc of Object.keys(SCENARIOS) as ScenarioId[]) {
  results[sc] = {};
  extras[sc] = { holds: [], shortTrips: [], flexTrips: [], covers: [], faults: 0, detected: 0, falseAlarms: 0, delays: [] };
  for (const arm of ARMS) results[sc][arm.id] = Object.fromEntries(METRICS.map((m) => [m.key, { values: [], mean: 0, sd: 0 }]));
  for (const seed of seeds) {
    const world = createWorld(net, { ...DEFAULT_OPTIONS, seed, scenario: sc });
    for (const arm of ARMS) {
      const sim = createSim(world, arm.cfg, model);
      sim.runTo(DAY_END);
      const c = sim.conservation();
      if (!c.ok) throw new Error(`conservation failed: ${sc} seed ${seed} ${arm.id}`);
      const k = sim.kpis();
      for (const m of METRICS) results[sc][arm.id][m.key].values.push(m.get(k));
      if (arm.id === 'samam') {
        const e = extras[sc];
        e.holds.push(k.holds); e.shortTrips.push(k.shortTrips); e.flexTrips.push(k.flexTrips); e.covers.push(k.covers);
        for (const b of sim.buses) {
          if (b.faultDone) {
            e.faults++;
            if (b.detectedAt >= b.faultAt) { e.detected++; e.delays.push((b.detectedAt - b.faultAt) / 60); }
          } else if (b.detectedAt >= 0) e.falseAlarms++;
        }
      }
    }
  }
  for (const arm of ARMS) for (const m of METRICS) { const c = results[sc][arm.id][m.key]; c.mean = mean(c.values); c.sd = sd(c.values); }
  console.log(`${sc}: done (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

// ---------------- report ----------------
const fmt = (x: number, d: number) => x.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
let md = `# Samam batch results (simulation)\n\n`;
md += `Generated ${new Date().toISOString().slice(0, 10)} by \`npm run batch\`. ${N} seeds (${seeds[0]}–${seeds[N - 1]}) per scenario, the same passengers and traffic in every arm of a seed. `;
md += `All figures are **in simulation**: real MTC network and timetable, simulated passengers. They are not predictions of real-world results.\n\n`;
md += `Corridor: ${net.lines.map((l) => l.id).join(', ')} · ${net.stops.length} stops · ${net.meta.totals.corridorTrips} scheduled trips/day.\n\n`;
md += `Values are mean ± standard deviation across seeds. "Δ vs fixed" is the mean paired difference with a 95% confidence interval; "better in" counts seeds where the arm beat the fixed schedule.\n\n`;
const summary: Record<string, unknown> = {};
for (const sc of Object.keys(SCENARIOS) as ScenarioId[]) {
  md += `## ${SCENARIOS[sc].name}\n\n${SCENARIOS[sc].blurb}\n\n`;
  md += `| Metric | Fixed schedule | Samam, holding only | Samam, all levers | Δ vs fixed (all levers) | Better in |\n|---|---:|---:|---:|---:|---:|\n`;
  const scSum: Record<string, unknown> = {};
  for (const m of METRICS) {
    const b = results[sc]['baseline'][m.key], h = results[sc]['samam-hold'][m.key], s = results[sc]['samam'][m.key];
    const diffs = s.values.map((v, i) => v - b.values[i]);
    const dm = mean(diffs), ci = (tcrit * sd(diffs)) / Math.sqrt(N);
    const better = diffs.filter((d) => (m.lowerBetter ? d < 0 : d > 0)).length;
    const pct = b.mean !== 0 ? (dm / b.mean) * 100 : 0;
    md += `| ${m.label}${m.unit ? ` (${m.unit})` : ''} | ${fmt(b.mean, m.digits)} ± ${fmt(b.sd, m.digits)} | ${fmt(h.mean, m.digits)} ± ${fmt(h.sd, m.digits)} | ${fmt(s.mean, m.digits)} ± ${fmt(s.sd, m.digits)} | ${dm >= 0 ? '+' : ''}${fmt(dm, m.digits)} ± ${fmt(ci, m.digits)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%) | ${better}/${N} |\n`;
    scSum[m.key] = { baseline: b.mean, baselineSd: b.sd, hold: h.mean, holdSd: h.sd, samam: s.mean, samamSd: s.sd, diff: dm, ci, pct, better };
  }
  const e = extras[sc];
  md += `\nSamam actions per day (mean): ${fmt(mean(e.holds), 0)} holds, ${fmt(mean(e.shortTrips), 1)} short-turn trips, ${fmt(mean(e.flexTrips), 1)} flex trips, ${fmt(mean(e.covers), 1)} breakdown covers. `;
  const med = e.delays.length ? [...e.delays].sort((a, b) => a - b)[Math.floor(e.delays.length / 2)] : 0;
  md += `Sensor faults that occurred in service: ${e.faults} over ${N} days, ${e.detected} detected (${e.faults ? ((100 * e.detected) / e.faults).toFixed(0) : 0}%), median detection delay ${med.toFixed(1)} min, ${e.falseAlarms} buses flagged with no fault.\n\n`;
  summary[sc] = { name: SCENARIOS[sc].name, metrics: scSum, actions: { holds: mean(e.holds), shortTrips: mean(e.shortTrips), flexTrips: mean(e.flexTrips), covers: mean(e.covers) }, sensors: { faults: e.faults, detected: e.detected, medianDelayMin: med, falseAlarms: e.falseAlarms } };
}
md += `## Forecast accuracy (held-out simulated days)\n\nMean absolute error in riders per bus, by look-ahead:\n\n| Look-ahead | 10 min | 20 min | 30 min | 40 min | 50 min | 60 min |\n|---|---:|---:|---:|---:|---:|---:|\n`;
md += `| Time-of-day profile only | ${model.training.maeProfile.join(' | ')} |\n| Profile + live correction | ${model.training.maeModel.join(' | ')} |\n\n`;
md += `Training: ${model.training.profileDays} profile days, ${model.training.fitDays} fit days, ${model.training.testDays} test days x 2 arms (${model.training.seeds}).\n`;
mkdirSync('results', { recursive: true });
writeFileSync('results/RESULTS.md', md);
writeFileSync('results/results.json', JSON.stringify({ generatedAt: new Date().toISOString(), seeds, metrics: METRICS.map(({ key, label, unit, digits, lowerBetter }) => ({ key, label, unit, digits, lowerBetter })), summary, forecast: model.training }, null, 1));
writeFileSync('src/data/batch-results.json', JSON.stringify({ generatedAt: new Date().toISOString(), nSeeds: N, seeds: [seeds[0], seeds[N - 1]], metrics: METRICS.map(({ key, label, unit, digits, lowerBetter }) => ({ key, label, unit, digits, lowerBetter })), summary }));
console.log(`wrote results/RESULTS.md, results/results.json, src/data/batch-results.json (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
