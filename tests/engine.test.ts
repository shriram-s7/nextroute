import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BASELINE, SAMAM, DAY_END, DAY_START, DEFAULT_OPTIONS, ST, buildNetwork, createSim, createWorld,
  type ForecastModel, type RawCorridor, type ScenarioId, type Sim,
} from '../src/engine/index';

const raw = JSON.parse(readFileSync('src/data/corridor.json', 'utf8')) as RawCorridor;
const model = JSON.parse(readFileSync('src/data/forecast-model.json', 'utf8')) as ForecastModel;
const net = buildNetwork(raw);

function run(seed: number, scenario: ScenarioId, samam: boolean, check?: (s: Sim) => void): Sim {
  const sim = createSim(createWorld(net, { ...DEFAULT_OPTIONS, seed, scenario }), samam ? SAMAM : BASELINE, model);
  while (sim.t < DAY_END) {
    sim.step();
    if (check && sim.t % 600 === 0) check(sim);
  }
  return sim;
}

describe('network (real GTFS data)', () => {
  it('has 6-8 lines, all stops inside the Chennai region, and usable geometry', () => {
    expect(net.lines.length).toBeGreaterThanOrEqual(6);
    expect(net.lines.length).toBeLessThanOrEqual(8);
    for (const s of net.stops) {
      expect(s.lat).toBeGreaterThan(12.3); expect(s.lat).toBeLessThan(13.7);
      expect(s.lon).toBeGreaterThan(79.5); expect(s.lon).toBeLessThan(80.5);
    }
    for (const p of net.patterns) {
      expect(p.departures.length).toBeGreaterThan(50);
      for (let i = 1; i < p.n; i++) expect(p.stopDist[i]).toBeGreaterThan(p.stopDist[i - 1]);
      expect(Math.abs(p.pathCum[p.pathCum.length - 1] - p.lengthM)).toBeLessThan(1);
    }
  });
});

describe.each([['baseline', false], ['samam', true]] as const)('engine invariants (%s)', (_name, samam) => {
  it.each(['normal', 'rain', 'surge', 'sensors', 'breakdown'] as ScenarioId[])('conserves passengers and never exceeds capacity: %s', (scenario) => {
    let checks = 0;
    const sim = run(7, scenario, samam, (s) => {
      const c = s.conservation();
      expect(c.ok).toBe(true);
      expect(c.waiting + c.onboard + c.arrived).toBe(c.generated);
      for (const b of s.buses) {
        expect(b.load).toBeLessThanOrEqual(b.cap);
        expect(b.pax.length).toBe(b.load);
        if (b.state === ST.OUT || b.state === ST.BROKEN) expect(b.load).toBe(0);
      }
      checks++;
    });
    expect(checks).toBeGreaterThan(100);
    const c = sim.conservation();
    expect(c.ok).toBe(true);
    expect(c.generated).toBe(sim.pax.n); // everyone generated has turned up by the end of the day
    expect(sim.k.maxLoadFactor).toBeLessThanOrEqual(1);
    expect(c.arrived / c.generated).toBeGreaterThan(0.98); // and almost everyone has been carried
  });
});

describe('determinism', () => {
  it.each([false, true])('same seed gives identical results (samam=%s)', (samam) => {
    const a = run(11, 'rain', samam), b = run(11, 'rain', samam);
    expect(a.kpis()).toEqual(b.kpis());
    expect(a.recs.length).toBe(b.recs.length);
    expect(a.buses.map((x) => x.km)).toEqual(b.buses.map((x) => x.km));
  });
  it('different seeds give different days', () => {
    expect(run(11, 'normal', false).kpis().avgWait).not.toBe(run(12, 'normal', false).kpis().avgWait);
  });
  it('both arms face the same passengers and the same fleet', () => {
    const w = createWorld(net, { ...DEFAULT_OPTIONS, seed: 5 });
    const a = createSim(w, BASELINE, model), b = createSim(w, SAMAM, model);
    expect(a.pax).toBe(b.pax);
    expect(a.buses.length).toBe(b.buses.length);
    a.runTo(DAY_START + 3 * 3600); b.runTo(DAY_START + 3 * 3600);
    expect(a.nextPax).toBe(b.nextPax);
  });
});

describe('controller behaviour', () => {
  it('holds never exceed 120 s and the baseline arm takes no actions', () => {
    const base = run(3, 'normal', false), sam = run(3, 'normal', true);
    expect(base.recs.length).toBe(0);
    expect(base.k.holds + base.k.shortTrips + base.k.flexTrips).toBe(0);
    expect(sam.k.holds).toBeGreaterThan(0);
    expect(sam.k.holdSec / sam.k.holds).toBeLessThanOrEqual(120);
    for (const r of sam.recs) { expect(r.reason.length).toBeGreaterThan(10); expect(r.effect.length).toBeGreaterThan(10); }
  });
  it('a blocked sensor is detected and the bus falls back to ticket data', () => {
    const sim = createSim(createWorld(net, { ...DEFAULT_OPTIONS, seed: 3 }), SAMAM, model);
    sim.runTo(8 * 3600);
    const bus = sim.buses.find((b) => b.state === ST.RUN && b.load > 15 && b.health === 0 && b.run && b.run.to - b.idx > 12)!;
    expect(bus).toBeTruthy();
    sim.setSensorBlocked(bus.id, true);
    sim.runTo(8 * 3600 + 1500);
    expect(bus.health).toBe(2);
    expect(bus.estSrc).toBe(2);
    expect(sim.recs.some((r) => r.kind === 'alert' && r.bus === bus.id)).toBe(true);
  });
  it('rejecting recommendations in manual mode changes the outcome', () => {
    const w = createWorld(net, { ...DEFAULT_OPTIONS, seed: 3 });
    const auto = createSim(w, SAMAM, model);
    const manual = createSim(w, { ...SAMAM, mode: 'manual' }, model);
    const end = 10 * 3600;
    auto.runTo(end);
    while (manual.t < end) {
      manual.step();
      for (const r of manual.recs) if (r.status === 'pending') manual.ctrl!.decide(r.id, false);
    }
    expect(manual.k.holds + manual.k.shortTrips + manual.k.flexTrips).toBe(0);
    expect(manual.recs.filter((r) => r.status === 'rejected').length).toBeGreaterThan(50);
    expect(manual.kpis().avgWait).not.toBe(auto.kpis().avgWait);
  });
});
