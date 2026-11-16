import { readFileSync } from 'node:fs';
import { createWorld, createSim, SAMAM, DAY_END, DEFAULT_OPTIONS, hhmm, type RawCorridor, type ForecastModel } from '../src/engine/index';
const raw = JSON.parse(readFileSync('src/data/corridor.json', 'utf8')) as RawCorridor;
const model = JSON.parse(readFileSync('src/data/forecast-model.json', 'utf8')) as ForecastModel;
const world = createWorld(raw, { ...DEFAULT_OPTIONS, seed: +(process.argv[3] || 1), scenario: (process.argv[2] as any) || 'normal' });
const sim = createSim(world, SAMAM, model);
let lastFree = -1;
const freeLog: string[] = [];
while (sim.t < DAY_END) { sim.step(); if (sim.t % 1800 === 0) freeLog.push(`${hhmm(sim.t)}:${sim.poolAvailable().length}`); }
console.log('pool free by time:', freeLog.join(' '));
const byStatus: Record<string, number> = {};
for (const r of sim.recs) { const k = r.kind + '/' + r.status; byStatus[k] = (byStatus[k] || 0) + 1; }
console.log(byStatus);
for (const r of sim.recs.filter((r) => r.kind !== "hold" && r.t >= +(process.argv[5] || 0) * 3600).slice(0, +(process.argv[4] || 30))) console.log(`${hhmm(r.t)} [${r.kind}/${r.status}] ${r.title}\n      ${r.reason}\n      ${r.effect}`);
const h = sim.recs.filter((r) => r.kind === 'hold').slice(100, 103);
for (const r of h) console.log(`${hhmm(r.t)} [${r.kind}/${r.status}] ${r.title}\n      ${r.reason}\n      ${r.effect}`);
console.log('depot:', world.net.depot, 'depotIdx:', world.net.patterns.map((p) => `${p.id}:${p.depotIdx}/${p.n}`).join(' '));
