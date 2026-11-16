import { useMemo, useRef, useState } from 'react';
import { BAND_NAMES, RUN_KIND, SCENARIOS, ST, ST_NAMES, type ScenarioId } from '../engine/index';
import { flyTo } from '../map/mapHost';
import { BAND_HEX, BAND_LETTER } from '../map/render';
import type { BusDetail } from '../worker/protocol';
import { actions, fmtClock, fmtInt, live, net, useStore } from './store';

const SRC_NAMES = ['Door counter cameras', 'CCTV count', 'Ticket data + route history'];
const HEALTH_NAMES = ['Healthy', 'Suspect: checking against tickets', 'Fault detected: fallback active'];
const KIND_NAMES: Record<number, string> = { [-1]: 'Not on a trip', [RUN_KIND.SCHED]: 'Scheduled trip', [RUN_KIND.SHORT]: 'Short-turn trip', [RUN_KIND.FLEX]: 'Flex trip', [RUN_KIND.COVER]: 'Breakdown cover' };

const stopOptions = [...net.stops].sort((a, b) => b.feedTrips - a.feedTrips).slice(0, 60).sort((a, b) => a.name.localeCompare(b.name));

function Setup() {
  const options = useStore((s) => s.options);
  const ready = useStore((s) => s.ready);
  const kpi = useStore((s) => s.kpi);
  const arm = useStore((s) => s.arm);
  const [scenario, setScenario] = useState<ScenarioId>(options.scenario);
  const [seed, setSeed] = useState(options.seed);
  const [reserve, setReserve] = useState(Math.round(options.reserveShare * 100));
  const [surgeStop, setSurgeStop] = useState(options.surgeStop ?? ready?.surgeStop ?? -1);
  const dirty = scenario !== options.scenario || seed !== options.seed || reserve !== Math.round(options.reserveShare * 100)
    || (scenario === 'surge' && surgeStop >= 0 && surgeStop !== (options.surgeStop ?? ready?.surgeStop));
  const k = kpi ? kpi[arm] : null;
  return (
    <>
      <div className="panel-h"><span className="panel-t">Scenario</span><span className="cap">restarts the run</span></div>
      <div className="sect" style={{ borderTop: 0, paddingTop: 0 }}>
        {(Object.keys(SCENARIOS) as ScenarioId[]).map((id) => (
          <button key={id} className="scn" aria-pressed={scenario === id} onClick={() => setScenario(id)}>
            <b>{SCENARIOS[id].name}</b><span>{SCENARIOS[id].blurb}</span>
          </button>
        ))}
        {scenario === 'surge' && (
          <div className="row"><span>Surge at stop</span>
            <select value={surgeStop} onChange={(e) => setSurgeStop(+e.target.value)} style={{ maxWidth: 186 }}>
              {surgeStop < 0 && <option value={-1}>Busiest trunk stop</option>}
              {surgeStop >= 0 && !stopOptions.some((s) => s.idx === surgeStop) && <option value={surgeStop}>{net.stops[surgeStop].name}</option>}
              {stopOptions.map((s) => <option key={s.idx} value={s.idx}>{s.name}</option>)}
            </select>
          </div>
        )}
        <div className="row"><span title="The same seed always gives exactly the same run">Random seed</span><input type="number" value={seed} min={1} max={999999} onChange={(e) => setSeed(Math.max(1, Math.floor(+e.target.value || 1)))} /></div>
        <div className="row"><span title="Spare buses held at the depot, as a share of the scheduled fleet">Flex pool reserve (%)</span><input type="number" value={reserve} min={0} max={20} onChange={(e) => setReserve(Math.max(0, Math.min(20, Math.floor(+e.target.value || 0))))} /></div>
        <button className={`btn ${dirty ? 'primary' : ''}`} style={{ width: '100%', marginTop: 8 }}
          onClick={() => actions.start({ ...options, scenario, seed, reserveShare: reserve / 100, surgeStop: scenario === 'surge' && surgeStop >= 0 ? surgeStop : undefined })}>
          {dirty ? 'Apply and restart run' : 'Restart run'}
        </button>
      </div>
      <div className="sect">
        <div className="cap" style={{ marginBottom: 4 }}>Now · {arm === 'base' ? 'fixed-schedule run' : 'NextRoute run'}</div>
        <div className="row"><span>Buses on the road</span><span className="num">{k ? k.busesOut : '–'}</span></div>
        <div className="row"><span>Flex buses free at depot</span><span className="num">{k ? `${k.poolFree} / ${ready?.fleet.pool ?? 0}` : '–'}</span></div>
        <div className="row"><span>Riders waiting at stops</span><span className="num">{k ? fmtInt(k.waiting) : '–'}</span></div>
        <div className="row"><span>Riders on buses</span><span className="num">{k ? fmtInt(k.onboard) : '–'}</span></div>
        <div className="row"><span>Riders carried so far</span><span className="num">{k ? fmtInt(k.arrived) : '–'}</span></div>
        {arm === 'samam' && k && <div className="row"><span>NextRoute actions</span><span className="num">{fmtInt(k.holds)} holds · {k.shortTrips} short · {k.flexTrips} flex</span></div>}
      </div>
      <div className="sect">
        <div className="cap" style={{ marginBottom: 4 }}>Corridor</div>
        <p className="muted" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.45 }}>
          Lines {net.lines.map((l) => l.id).join(', ')} share the GST Road trunk between {net.depot.name.replace(' Bus Terminus', '')} and Tambaram.
          {' '}{net.stops.length} stops and {fmtInt(net.meta.totals.corridorTrips)} scheduled trips a day, from the public Chennai GTFS feed.
        </p>
        <p className="dim" style={{ margin: '8px 0 0', fontSize: 11.5 }}>Click a bus for its detail and driver screen. Click a stop to see its queue or start a surge there.</p>
      </div>
    </>
  );
}

function LoadChart({ d }: { d: BusDetail }) {
  const W = 306, H = 132, L = 26, R = 8, T = 8, B = 20;
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const n = Math.max(1, d.runTo - d.runFrom);
  const yMax = Math.ceil((d.cap * 1.05) / 10) * 10;
  const x = (i: number) => L + ((i - d.runFrom) / n) * (W - L - R);
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const line = (vals: number[]) => d.trace.idx.map((i, k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(vals[k]).toFixed(1)}`).join('');
  const hi = hover !== null ? d.trace.idx.indexOf(hover) : -1;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="cap">Load over this trip</span>
        <span><span className="lg"><i style={{ background: 'var(--accent)' }} />Sensed</span><span className="lg" style={{ marginRight: 0 }}><i style={{ height: 0, borderTop: '2px dashed var(--base)' }} />Sim truth</span></span>
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Sensed and true load at each stop of the current trip"
        onMouseMove={(e) => { const r = ref.current!.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setHover(Math.max(d.runFrom, Math.min(d.runTo, Math.round(d.runFrom + ((px - L) / (W - L - R)) * n)))); }}
        onMouseLeave={() => setHover(null)}>
        {[0, d.seats, d.cap].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v === d.cap ? '#6b2d30' : '#262b34'} strokeWidth="1" strokeDasharray={v === 0 ? undefined : '3 3'} />
            <text x={L - 4} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#6f7884" fontFamily="IBM Plex Mono">{v}</text>
          </g>
        ))}
        <text x={W - R} y={y(d.cap) - 3} textAnchor="end" fontSize="8.5" fill="#6f7884">capacity</text>
        <text x={W - R} y={y(d.seats) - 3} textAnchor="end" fontSize="8.5" fill="#6f7884">seats</text>
        {d.trace.idx.length > 1 && <path d={line(d.trace.load)} fill="none" stroke="#9aa3ae" strokeWidth="1.5" strokeDasharray="4 3" />}
        {d.trace.idx.length > 1 && <path d={line(d.trace.est)} fill="none" stroke="#3987e5" strokeWidth="2" strokeLinejoin="round" />}
        {d.trace.idx.length > 0 && <circle cx={x(d.trace.idx[d.trace.idx.length - 1])} cy={y(d.trace.est[d.trace.est.length - 1])} r="4" fill="#3987e5" stroke="#12151a" strokeWidth="2" />}
        <text x={L} y={H - 5} fontSize="9" fill="#6f7884">{d.stopNames[d.runFrom]?.slice(0, 22)}</text>
        <text x={W - R} y={H - 5} fontSize="9" fill="#6f7884" textAnchor="end">{d.stopNames[d.runTo]?.slice(0, 22)}</text>
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="#6f7884" strokeWidth="1" />}
      </svg>
      <div className="num" style={{ fontSize: 11, minHeight: 16, color: 'var(--text-2)' }}>
        {hover !== null
          ? `${d.stopNames[hover]?.slice(0, 26)}: ${hi >= 0 ? `sensed ${Math.round(d.trace.est[hi])}, truth ${d.trace.load[hi]}` : 'not reached yet'}`
          : d.trace.idx.length === 0 ? 'No stops served yet on this trip.' : ''}
      </div>
    </div>
  );
}

function BandPill({ band }: { band: number }) {
  return <span className="bandpill"><span className="dot" style={{ background: BAND_HEX[band], width: 18, height: 18 }}>{BAND_LETTER[band]}</span>{BAND_NAMES[band]}</span>;
}

function BusInfo({ d }: { d: BusDetail }) {
  const follow = useStore((s) => s.follow);
  const set = useStore((s) => s.set);
  const k = d.instruction.kind;
  const active = k === 'hold' || k === 'holdAhead' || k === 'short' || k === 'flex' || k === 'cover';
  const broken = d.state === ST.BROKEN;
  const moving = d.state === ST.RUN || d.state === ST.DWELL || d.state === ST.HOLD;
  return (
    <>
      <div className="sect">
        <div className="row"><span>Status</span><span>{ST_NAMES[d.state]}{moving ? ` · ${KIND_NAMES[d.runKind]}` : ''}</span></div>
        <div className="row"><span>{d.state === ST.RUN ? 'Next stop' : 'At'}</span><span style={{ textAlign: 'right' }}>{d.state === ST.RUN ? d.nextStop : d.atStop}</span></div>
        <div className="row"><span>Type</span><span>{d.electric ? 'Electric' : 'Diesel'} · {d.seats} seats, capacity {d.cap}</span></div>
      </div>
      <div className="sect">
        <div className="row" style={{ paddingTop: 0 }}><span className="cap">Crowding (as sensed)</span><BandPill band={d.band} /></div>
        <div className="row"><span>Estimated riders</span><span className="num">about {Math.round(d.est)} of {d.cap}</span></div>
        <div className="meter" aria-hidden="true"><i style={{ width: `${Math.min(100, (d.est / d.cap) * 100)}%`, background: BAND_HEX[d.band] }} /></div>
        <div className="row"><span>Confidence</span><span className="num">{Math.round(d.conf * 100)}%</span></div>
        <div className="truth">Simulation ground truth: <span className="num">{d.load}</span> riders. The controller never sees this.</div>
      </div>
      <div className="sect"><LoadChart d={d} /></div>
      <div className="sect">
        <div className="cap" style={{ marginBottom: 3 }}>Sensor</div>
        <div className="row"><span>Active source</span><span style={{ textAlign: 'right' }}>{SRC_NAMES[d.src]}</span></div>
        <div className="row"><span>Health</span><span style={{ color: d.health === 2 ? 'var(--warn)' : d.health === 1 ? 'var(--serious)' : 'var(--good)', textAlign: 'right' }}>{d.health === 0 ? '● ' : '▲ '}{HEALTH_NAMES[d.health]}</span></div>
        <div className="row"><span>Last counter reading</span><span className="num">{d.lastCount === null ? 'no data' : d.lastCount}</span></div>
        <div className="row"><span>Ticket-based estimate</span><span className="num">{Math.round(d.ticketEst)}</span></div>
        {d.health === 2 && d.detectedAt > 0 && <div className="row"><span>Fault detected at</span><span className="num">{fmtClock(d.detectedAt)}</span></div>}
        <div className="truth">Simulated sensor state: {d.trueFault === 0 ? 'working' : d.trueFault === 1 ? 'dead' : d.manualBlock ? 'blocked by you' : 'blocked'}</div>
        <button className="btn small" style={{ marginTop: 7 }} disabled={broken} onClick={() => actions.blockSensor(d.id, !d.manualBlock)}>{d.manualBlock ? 'Unblock sensor' : 'Block this sensor'}</button>
      </div>
      {d.electric && (
        <div className="sect">
          <div className="row" style={{ paddingTop: 0 }}><span className="cap">Battery</span><span className="num">{Math.round(d.soc * 100)}% · about {Math.round(d.rangeKm)} km left</span></div>
          <div className="meter" aria-hidden="true"><i style={{ width: `${d.soc * 100}%`, background: d.soc < 0.25 ? 'var(--crit)' : d.soc < 0.45 ? 'var(--warn)' : 'var(--good)' }} /></div>
          <div className="truth" style={{ marginTop: 4 }}>Range is what remains before the bus must go and charge.</div>
        </div>
      )}
      <div className="sect">
        <div className="cap" style={{ marginBottom: 5 }}>Current instruction</div>
        <div className={`instr ${active ? 'active' : ''}`}><b>{d.instruction.text}</b><span>{d.instruction.sub}</span></div>
        {d.next.length > 0 && <div className="row" style={{ marginTop: 6 }}><span>Next departures</span><span className="num">{d.next.map((x) => fmtClock(x.dep)).join(' · ')}</span></div>}
        <div className="row"><span>Today</span><span className="num">{d.trips} trips · {d.km.toFixed(0)} km</span></div>
      </div>
      <div className="sect" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn small" onClick={() => flyTo(d.lon, d.lat)}>Find on map</button>
        <button className="btn small" aria-pressed={follow} onClick={() => set({ follow: !follow })} style={follow ? { borderColor: 'var(--accent)' } : undefined}>{follow ? 'Following' : 'Follow'}</button>
        <button className="btn small danger" disabled={broken} onClick={() => actions.breakdown(d.id)}>Trigger breakdown</button>
      </div>
    </>
  );
}

function DriverPhone({ d }: { d: BusDetail }) {
  const t = useStore((s) => s.t);
  const k = d.instruction.kind;
  const cls = k === 'hold' ? 'hold' : k === 'broken' ? 'alert' : '';
  const fromControl = k === 'holdAhead' || k === 'short' || k === 'flex' || k === 'cover';
  return (
    <div>
      <div className="phone" aria-label="Driver console preview">
        <div className="screen">
          <div className="ph-top"><span>{fmtClock(t)} IST</span><span>{d.code}</span></div>
          <div className="ph-route"><b>{d.lineId}</b><div className="muted" style={{ fontSize: 11.5 }}>to {d.to}</div></div>
          <div className={`ph-main ${cls}`}>
            {k === 'hold' ? (
              <>
                <span className="cap" style={{ color: '#9ec5f4' }}>Hold at this stop</span>
                <div className="count">{d.instruction.sec}<span style={{ fontSize: 20 }}> s</span></div>
                <div style={{ fontSize: 13 }}>{d.instruction.sub}</div>
              </>
            ) : (
              <>
                <span className="cap" style={fromControl ? { color: '#9ec5f4' } : undefined}>{fromControl ? 'Instruction from control room' : k === 'broken' ? 'Alert' : 'Status'}</span>
                <div className="big">{d.instruction.text}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>{d.instruction.sub}</div>
              </>
            )}
          </div>
          <div className="ph-foot">
            <div><span className="dim">{d.state === ST.RUN ? 'Next stop' : 'Stop'}</span><b>{(d.state === ST.RUN ? d.nextStop : d.atStop).slice(0, 20)}</b></div>
            <div><span className="dim">On board (sensed)</span><b>{BAND_LETTER[d.band]} · {BAND_NAMES[d.band]}</b></div>
          </div>
        </div>
      </div>
      <p className="dim" style={{ fontSize: 11.5, padding: '0 16px', textAlign: 'center' }}>What the driver of {d.code} would see. Only approved instructions reach this screen.</p>
    </div>
  );
}

function BusPanel() {
  const d = useStore((s) => s.detail);
  const sel = useStore((s) => s.selectedBus);
  const buses = useStore((s) => s.buses);
  const tab = useStore((s) => s.panelTab);
  const arm = useStore((s) => s.arm);
  const set = useStore((s) => s.set);
  const meta = buses[sel];
  return (
    <>
      <div className="panel-h">
        <div className="bushead">
          <span className="buscode">{meta?.code}</span>
          <span className="muted" style={{ fontSize: 11.5 }}>{d ? `Line ${d.lineId} to ${d.to.replace(' Bus Terminus', '')}` : ''}</span>
        </div>
        <button className="iconbtn" onClick={() => actions.select(-1)} aria-label="Close bus panel" title="Close (Esc)">✕</button>
      </div>
      <div className="dim" style={{ padding: '0 14px 6px', fontSize: 11 }}>In the {arm === 'base' ? 'fixed-schedule' : 'NextRoute'} run</div>
      <div className="subtabs" role="tablist">
        <button role="tab" aria-selected={tab === 'bus'} onClick={() => set({ panelTab: 'bus' })}>Bus detail</button>
        <button role="tab" aria-selected={tab === 'driver'} onClick={() => set({ panelTab: 'driver' })}>Driver console</button>
      </div>
      {!d || d.id !== sel ? <div className="empty">Loading…</div> : tab === 'bus' ? <BusInfo d={d} /> : <DriverPhone d={d} />}
    </>
  );
}

function StopPanel() {
  const idx = useStore((s) => s.selectedStop);
  const options = useStore((s) => s.options);
  useStore((s) => s.kpi); // re-render on the 4 Hz data tick
  const stop = net.stops[idx];
  const serving = useMemo(() => net.patterns.filter((p) => p.posOf[idx] >= 0), [idx]);
  return (
    <>
      <div className="panel-h">
        <div><div className="panel-t" style={{ fontSize: 14 }}>{stop.name}</div><div className="dim" style={{ fontSize: 11 }}>Stop {stop.id.replace('MTC-', '')} · {fmtInt(stop.feedTrips)} MTC trips a day call here</div></div>
        <button className="iconbtn" onClick={() => actions.selectStop(-1)} aria-label="Close stop panel">✕</button>
      </div>
      <div className="sect">
        <div className="cap" style={{ marginBottom: 3 }}>Riders waiting now</div>
        <div className="row"><span>Fixed schedule</span><span className="num">{live.wait ? live.wait.base[idx] : 0}</span></div>
        <div className="row"><span>NextRoute</span><span className="num">{live.wait ? live.wait.samam[idx] : 0}</span></div>
        <div className="truth">Simulation ground truth. Stops have no sensors, so the controller does not see queues.</div>
      </div>
      <div className="sect">
        <div className="cap" style={{ marginBottom: 3 }}>Corridor lines calling here</div>
        {serving.map((p) => <div className="row" key={p.id}><span className="num" style={{ color: 'var(--text)' }}>{p.lineId}</span><span style={{ textAlign: 'right' }}>to {p.to}</span></div>)}
      </div>
      <div className="sect">
        <button className="btn" style={{ width: '100%' }} onClick={() => actions.start({ ...options, scenario: 'surge', surgeStop: idx })}>Start an event surge at this stop</button>
        <p className="dim" style={{ fontSize: 11.5, margin: '6px 0 0' }}>Restarts the run with {fmtInt(SCENARIOS.surge.surge!.pax)} extra riders leaving here from {fmtClock(SCENARIOS.surge.surge!.t)}.</p>
        <button className="btn small" style={{ marginTop: 8 }} onClick={() => flyTo(stop.lon, stop.lat, 15)}>Find on map</button>
      </div>
    </>
  );
}

export function LeftPanel() {
  const bus = useStore((s) => s.selectedBus);
  const stop = useStore((s) => s.selectedStop);
  return <aside className="left" aria-label="Details">{bus >= 0 ? <BusPanel /> : stop >= 0 ? <StopPanel /> : <Setup />}</aside>;
}
