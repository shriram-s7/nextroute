// Samam controller: three levers only — holding, short-turn trips, flex-pool dispatch.
// It reads GPS positions, the timetable, sensor-derived load estimates and the forecast.
// It never reads ground-truth passenger data. Every decision carries a reason and a predicted effect.
import { BIN, CTRL, DWELL, EV, binOf } from './config';
import { hhmm, schedHeadway, type Pattern } from './network';
import { RUN_KIND, ST, type Bus, type HoldPlan, type Rec, type Run, type Sim } from './sim';

interface ExtraTrip {
  p: Pattern; r: Pattern; d: number; j: number; jr: number; dr: number; dep: number;
  km: number; relief: number; value: number; short: boolean;
  peakL: number; peakT: number; peakPattern: Pattern; peakFrom: number; peakTo: number; peakBuses: number;
}

const fmtGap = (s: number): string => (s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);
const AVG_CAP = 78;

export class Controller {
  private cooldown: Float64Array;
  private open: number[] = [];

  constructor(private sim: Sim) {
    this.cooldown = new Float64Array(sim.net.patterns.length);
  }

  private stopName(p: Pattern, j: number): string { return this.sim.net.stops[p.stops[j]].name; }
  private stopLonLat(p: Pattern, j: number): [number, number] { const s = this.sim.net.stops[p.stops[j]]; return [s.lon, s.lat]; }

  // ------------------------------------------------------------------ lever 1: holding
  /** Expected time the next bus behind `bus` on the same pattern is ready to leave stop j. */
  private followerEta(bus: Bus, p: Pattern, j: number, eta: number): number | null {
    const sim = this.sim, t = sim.t;
    let best: Bus | null = null;
    for (const b of sim.buses) {
      if (b === bus || b.pattern !== p.idx || !b.run) continue;
      if (b.state !== ST.RUN && b.state !== ST.DWELL && b.state !== ST.HOLD) continue;
      if (b.run.to < j || b.run.from > j || b.s >= bus.s) continue;
      if (!best || b.s > best.s) best = b;
    }
    if (best) {
      let tt: number, k: number;
      if (best.state === ST.RUN) { tt = t + (p.stopDist[best.idx + 1] - best.s) / Math.max(1, best.v) + 12; k = best.idx + 1; }
      else { tt = Math.max(t, best.timer); k = best.idx; }
      for (; k < j; k++) tt += sim.linkTimeEst(p, k, tt) + 12;
      return tt;
    }
    let dep = Infinity, from = 0;
    for (const b of sim.buses) {
      if (b === bus || b.runPos >= b.runs.length) continue;
      if (b.state !== ST.LAYOVER && b.state !== ST.CHARGE) continue;
      const r = b.runs[b.runPos];
      if (r.pattern !== p.idx || r.from > j || r.to < j) continue;
      const d = Math.max(r.dep, b.state === ST.LAYOVER ? b.timer + DWELL.preBoard : t + 600);
      if (d < dep) { dep = d; from = r.from; }
    }
    if (dep < Infinity) {
      let tt = dep;
      for (let k = from; k < j; k++) tt += sim.linkTimeEst(p, k, tt) + 12;
      return tt > eta ? tt : null;
    }
    for (const d of p.departures) if (d + p.schedOffsets[j] > eta + 30) return d + p.schedOffsets[j];
    return null;
  }

  /** Called when a bus leaves the stop before a holding point (or is about to start a run). */
  planHold(bus: Bus, j: number, isStart: boolean): void {
    const sim = this.sim;
    if (!sim.cfg.levers.hold) return;
    const run = bus.run;
    if (!run || bus.hold) return;
    if (!isStart) {
      if (j >= run.to - 1) return;
      if ((j - run.from) % CTRL.holdEvery !== 0) return;
    }
    const p = sim.net.patterns[bus.pattern];
    const t = sim.t;
    const eta = isStart ? Math.max(t, run.dep) : t + sim.linkTimeEst(p, j - 1, t) + 12;
    const lead = sim.lastDepT[p.idx * sim.net.maxStops + j];
    if (lead < 0) return;
    const hf = eta - lead;
    if (hf <= 0 || hf > 2400) return;
    const etaF = this.followerEta(bus, p, j, eta);
    if (etaF === null) return;
    const hb = etaF - eta;
    const imb = hb - hf;
    if (imb < CTRL.holdTrigger) return;
    const x = Math.round(Math.min(CTRL.holdMax, CTRL.holdGain * imb) / 10) * 10;
    if (x < CTRL.holdMin) return;
    // predicted effect: waiting saved downstream vs delay to riders on board
    const bin = binOf(eta);
    let boards = 0;
    if (sim.fc.profile.ok) for (let k = j; k < run.to; k++) boards += sim.fc.profile.boardBin(p.idx, k, bin);
    else boards = 20;
    const lam = boards / schedHeadway(p, j, eta);
    const saved = lam * x * (imb - x);
    const cost = CTRL.onboardWeight * bus.est * x;
    if (saved - cost < CTRL.holdMinBenefit) return;
    const auto = sim.mode === 'auto';
    const [lon, lat] = this.stopLonLat(p, j);
    const name = this.stopName(p, j);
    const rec = sim.addRec({
      kind: 'hold', status: auto ? 'applied' : 'pending', auto, bus: bus.id, line: p.lineId, pattern: p.idx, stop: p.stops[j],
      title: `Hold ${bus.code} for ${x} s at ${name}`,
      reason: `${bus.code} will be ${fmtGap(hf)} behind the bus ahead at ${name}, while the next bus is ${fmtGap(hb)} back.`,
      effect: `Gap ahead ${fmtGap(hf)} → ${fmtGap(hf + x)}, gap behind ${fmtGap(hb)} → ${fmtGap(hb - x)}. Est. ${Math.round(saved / 60)} passenger-min of waiting saved downstream`
        + (cost >= 30 ? `, ${Math.round(cost / 60)} passenger-min added on board.` : '.'),
      expires: eta + 90, lon, lat,
    });
    bus.hold = { idx: j, sec: x, recId: rec.id, approved: auto, hf, hb };
    if (!auto) this.open.push(rec.id);
  }

  /** At the holding point: re-check the gaps and release early if they have already recovered. */
  resolveHold(bus: Bus, h: HoldPlan): number {
    const sim = this.sim, t = sim.t;
    const p = sim.net.patterns[bus.pattern];
    const rec = sim.recs[h.recId];
    const lead = sim.lastDepT[p.idx * sim.net.maxStops + h.idx];
    const etaF = this.followerEta(bus, p, h.idx, t);
    let x = h.sec;
    if (lead >= 0 && etaF !== null) {
      const imb = etaF - t - (t - lead);
      x = Math.min(h.sec, Math.round((CTRL.holdGain * imb) / 5) * 5);
    }
    if (x < CTRL.holdMin) {
      if (rec) { rec.status = 'expired'; rec.effect += ' Released without holding: the gap had already recovered.'; sim.recVersion++; }
      return 0;
    }
    if (rec && rec.status !== 'applied') { rec.status = 'applied'; sim.recVersion++; }
    return x;
  }

  holdLapsed(h: HoldPlan): void {
    const rec = this.sim.recs[h.recId];
    if (rec && rec.status === 'pending') { rec.status = 'expired'; this.sim.recVersion++; }
  }

  // ------------------------------------------------------------------ levers 2 + 3: short-turn and flex trips
  private gapDeparture(p: Pattern, d: number, t: number): number {
    const off = p.schedOffsets[d];
    const deps = p.departures;
    for (let i = 0; i < deps.length - 1; i++) {
      if (deps[i] + off >= t + 90) {
        const gap = deps[i + 1] - deps[i];
        return gap < 1500 ? deps[i] + off + gap / 2 : t + 150;
      }
    }
    return t + 150;
  }

  /** Best extra trip out of the depot on pattern p (and back on its reverse), or null. */
  private bestExtraTrip(p: Pattern, t: number): ExtraTrip | null {
    const sim = this.sim, fc = sim.fc, lev = sim.cfg.levers;
    const d = p.depotIdx;
    if (d < 0 || d > p.n - 4) return null;
    const r = sim.net.patterns[p.reverse];
    const dr = r.depotIdx;
    if (dr < 3) return null;
    const dep = this.gapDeparture(p, d, t);
    const comfort = CTRL.comfortShare * AVG_CAP;
    const link = (q: Pattern, k: number, tt: number) => {
      const L = fc.predAt(q.idx, k, tt);
      if (L <= comfort) return { rel: 0, L, nb: 0 };
      const nb = BIN / schedHeadway(q, k, tt);
      const beyond = tt - t > 3600 ? 0.5 : 1;
      return { rel: L * (nb / (nb + 1)) * (q.linkLen[k] / 1000) * beyond, L, nb };
    };
    // outbound walk
    const outT: number[] = [], outRel: number[] = [];
    let tt = dep, acc = 0;
    let oPeak = { L: 0, t: 0, from: -1, to: -1, nb: 0 };
    const oPeaks: (typeof oPeak)[] = [];
    for (let k = d; k < p.n - 1; k++) {
      const x = link(p, k, tt);
      acc += x.rel;
      if (x.rel > 0) {
        if (oPeak.from < 0) oPeak = { ...oPeak, from: k };
        oPeak.to = k + 1;
        if (x.L > oPeak.L) { oPeak.L = x.L; oPeak.t = tt; oPeak.nb = x.nb; }
      }
      tt += sim.linkTimeEst(p, k, tt) + 10;
      outT[k + 1] = tt; outRel[k + 1] = acc; oPeaks[k + 1] = { ...oPeak };
    }
    let best: ExtraTrip | null = null;
    const turns: number[] = [];
    for (let j = d + 4; j < p.n - 1; j += 4) turns.push(j);
    turns.push(p.n - 1);
    for (const j of turns) {
      const short = j < p.n - 1;
      if ((short && !lev.short) || (!short && !lev.flex)) continue;
      const jr = p.opp[j];
      if (jr < 0 || jr >= dr - 1) continue;
      let rt = outT[j] + 180, rel = outRel[j];
      let rPeak = { L: 0, t: 0, from: -1, to: -1, nb: 0 };
      for (let k = jr; k < dr; k++) {
        const x = link(r, k, rt);
        rel += x.rel;
        if (x.rel > 0) {
          if (rPeak.from < 0) rPeak.from = k;
          rPeak.to = k + 1;
          if (x.L > rPeak.L) { rPeak.L = x.L; rPeak.t = rt; rPeak.nb = x.nb; }
        }
        rt += sim.linkTimeEst(r, k, rt) + 10;
      }
      const km = (p.stopDist[j] - p.stopDist[d] + r.stopDist[dr] - r.stopDist[jr]) / 1000;
      const value = rel - CTRL.flexMinScore * km;
      if (value <= 0 || (best && value <= best.value)) continue;
      const o = oPeaks[j];
      const useOut = o.L >= rPeak.L;
      const pk = useOut ? o : rPeak;
      best = {
        p, r, d, j, jr, dr, dep, km, relief: rel, value, short,
        peakL: pk.L, peakT: pk.t, peakPattern: useOut ? p : r, peakFrom: pk.from, peakTo: pk.to, peakBuses: pk.nb,
      };
    }
    return best;
  }

  private proposeExtra(c: ExtraTrip): void {
    const sim = this.sim, t = sim.t;
    const auto = sim.mode === 'auto';
    const depotName = sim.net.depot.name;
    const turn = this.stopName(c.p, c.j);
    const pp = c.peakPattern;
    const pct = Math.round((c.peakL / AVG_CAP) * 100);
    const after = c.peakL * (c.peakBuses / (c.peakBuses + 1));
    const [lon, lat] = this.stopLonLat(c.p, c.short ? c.j : c.d);
    const rec = sim.addRec({
      kind: c.short ? 'short' : 'flex', status: 'pending', auto, bus: -1, line: c.p.lineId, pattern: c.p.idx, stop: c.p.stops[c.j],
      title: c.short
        ? `Short-turn trip on ${c.p.lineId}: ${depotName} ⇄ ${turn}`
        : `Flex bus to ${c.p.lineId}: ${depotName} ⇄ ${turn}`,
      reason: `Forecast for ${hhmm(c.peakT)}: line ${pp.lineId} towards ${pp.to} reaches ${Math.round(c.peakL)} riders per bus (${pct}% of capacity) between ${this.stopName(pp, c.peakFrom)} and ${this.stopName(pp, c.peakTo)}.`,
      effect: `One extra ${c.short ? 'short-turn ' : ''}round trip, ${c.km.toFixed(1)} bus-km, leaving ${hhmm(c.dep)}. Forecast peak ${Math.round(c.peakL)} → about ${Math.round(after)} riders per bus for the buses either side of the extra trip.`,
      expires: t + CTRL.recTtl, lon, lat, data: c,
    });
    this.cooldown[c.p.idx] = t + CTRL.flexCooldown;
    if (auto) this.dispatchExtra(rec, c);
    else this.open.push(rec.id);
  }

  private dispatchExtra(rec: Rec, c: ExtraTrip): boolean {
    const sim = this.sim, t = sim.t;
    const need = c.km * EV.kwhPerKm * 1.3;
    const bus = sim.poolAvailable().find((b) => !b.electric || b.soc - need >= EV.flexReserveSoc * EV.batteryKwh);
    if (!bus) {
      rec.status = 'expired';
      rec.effect += ' Not sent: no flex bus free with enough charge.';
      sim.recVersion++;
      return false;
    }
    const kind = c.short ? RUN_KIND.SHORT : RUN_KIND.FLEX;
    const dep = Math.max(c.dep, t + 60);
    const runs: Run[] = [
      { pattern: c.p.idx, from: c.d, to: c.j, dep, kind, chargeBefore: false, recId: rec.id },
      { pattern: c.r.idx, from: c.jr, to: c.dr, dep: 0, kind, chargeBefore: false, recId: rec.id },
    ];
    sim.dispatchPool(bus, runs);
    rec.bus = bus.id;
    rec.status = 'applied';
    sim.recVersion++;
    return true;
  }

  /** Every CTRL.cycle seconds: refresh the forecast, expire stale recommendations, consider extra trips. */
  cycle(): void {
    const sim = this.sim, t = sim.t;
    sim.fc.update(t);
    if (this.open.length) {
      this.open = this.open.filter((id) => {
        const r = sim.recs[id];
        if (r.status !== 'pending') return false;
        if (t > r.expires) { r.status = 'expired'; sim.recVersion++; return false; }
        return true;
      });
    }
    const lev = sim.cfg.levers;
    if ((!lev.short && !lev.flex) || !sim.fc.profile.ok) return;
    const reserved = this.open.filter((id) => { const k = sim.recs[id].kind; return k === 'short' || k === 'flex' || k === 'cover'; }).length;
    let free = sim.poolAvailable().length - reserved;
    if (free <= 0) return;
    const cands: ExtraTrip[] = [];
    for (const p of sim.net.patterns) {
      if (t < this.cooldown[p.idx]) continue;
      const c = this.bestExtraTrip(p, t);
      if (c) cands.push(c);
    }
    cands.sort((a, b) => b.value - a.value);
    const usedLines = new Set<number>();
    let n = 0;
    for (const c of cands) {
      if (n >= CTRL.flexPerCycle || free <= 0) break;
      if (usedLines.has(c.p.line)) continue;
      usedLines.add(c.p.line);
      this.proposeExtra(c);
      n++; free--;
    }
  }

  // ------------------------------------------------------------------ disruptions
  onBreakdown(bus: Bus, remaining: Run[]): void {
    const sim = this.sim, t = sim.t;
    const p = sim.net.patterns[bus.pattern];
    const [lon, lat] = this.stopLonLat(p, bus.idx);
    const at = this.stopName(p, bus.idx);
    const i = remaining.findIndex((r) => sim.net.patterns[r.pattern].depotIdx === 0 && r.from === 0 && r.dep >= t + 240);
    const auto = sim.mode === 'auto';
    if (i < 0 || sim.poolAvailable().length === 0) {
      sim.addRec({
        kind: 'alert', status: 'info', auto: true, bus: bus.id, line: p.lineId, pattern: p.idx, stop: p.stops[bus.idx],
        title: `Breakdown: ${bus.code} at ${at}`,
        reason: `${bus.code} is out of service. ${remaining.length} scheduled trips remain in its block.`,
        effect: i < 0
          ? 'No later departure from the depot terminus to take over. Forecast-driven extra trips will respond to the gap.'
          : 'No flex bus is free right now. Forecast-driven extra trips will respond to the gap.',
        expires: t, lon, lat,
      });
      return;
    }
    const first = remaining[i];
    const rec = sim.addRec({
      kind: 'cover', status: 'pending', auto, bus: bus.id, line: p.lineId, pattern: p.idx, stop: p.stops[bus.idx],
      title: `Cover ${bus.code}: flex bus takes over its block`,
      reason: `${bus.code} has broken down at ${at}. ${remaining.length} scheduled trips remain in its block.`,
      effect: `A flex bus runs the remaining ${remaining.length - i} trips from the ${hhmm(first.dep)} departure at ${sim.net.depot.name}. Without it those trips are not run.`,
      expires: t + 900, lon, lat, data: remaining,
    });
    if (auto) this.applyCover(rec, remaining);
    else this.open.push(rec.id);
  }

  private applyCover(rec: Rec, remaining: Run[]): void {
    const sim = this.sim;
    const b = sim.applyCover(remaining, sim.t + 240, rec.id);
    rec.status = b ? 'applied' : 'expired';
    if (!b) rec.effect += ' Not sent: no flex bus or no remaining depot departure.';
    sim.recVersion++;
  }

  sensorAlert(bus: Bus, fault: boolean, dead: boolean): void {
    const sim = this.sim;
    const p = sim.net.patterns[bus.pattern];
    const [lon, lat] = this.stopLonLat(p, bus.idx);
    sim.addRec({
      kind: 'alert', status: 'info', auto: true, bus: bus.id, line: p.lineId, pattern: p.idx, stop: p.stops[bus.idx],
      title: fault ? `Sensor fault detected: ${bus.code}` : `Sensor recovered: ${bus.code}`,
      reason: fault
        ? dead
          ? `No data from the ${bus.door ? 'door counter' : 'CCTV count'} on ${bus.code} for two consecutive stops.`
          : `The ${bus.door ? 'door counter' : 'CCTV count'} on ${bus.code} disagrees with ticket sales for three consecutive stops (reads ${bus.lastCount ?? 0}, tickets imply about ${Math.round(bus.lastTicketEst)}).`
        : `Counter readings on ${bus.code} agree with ticket sales again for four consecutive stops.`,
      effect: fault
        ? 'Load for this bus now comes from ticket data plus route history. Confidence 50%.'
        : `Load for this bus comes from the ${bus.door ? 'door counter' : 'CCTV count'} again.`,
      expires: sim.t, lon, lat,
    });
  }

  // ------------------------------------------------------------------ dispatcher decisions (manual mode)
  decide(id: number, approve: boolean): void {
    const sim = this.sim;
    const rec = sim.recs[id];
    if (!rec || rec.status !== 'pending') return;
    this.open = this.open.filter((x) => x !== id);
    if (rec.kind === 'hold') {
      const bus = sim.buses[rec.bus];
      if (bus.hold && bus.hold.recId === id) {
        if (approve) { bus.hold.approved = true; rec.status = 'applied'; }
        else { bus.hold = null; rec.status = 'rejected'; }
      } else rec.status = 'expired';
      sim.recVersion++;
      return;
    }
    if (!approve) {
      rec.status = 'rejected';
      if (rec.kind !== 'cover') this.cooldown[rec.pattern] = sim.t + 2 * CTRL.flexCooldown;
      sim.recVersion++;
      return;
    }
    if (rec.kind === 'cover') this.applyCover(rec, rec.data as Run[]);
    else this.dispatchExtra(rec, rec.data as ExtraTrip);
  }
}
