import { useEffect, useRef, useState } from 'react';
import { DAY_END, DAY_START, SCENARIOS, type Kpis } from '../engine/index';
import { flyTo, getMapHost, mountMap, resetView } from '../map/mapHost';
import { BAND_HEX, BAND_LETTER, startRenderLoop } from '../map/render';
import { Console } from './Console';
import { ForecastView } from './ForecastView';
import { LeftPanel } from './LeftPanel';
import { MethodsView } from './MethodsView';
import { ReportView } from './ReportView';
import { actions, fmtClock, fmtInt, useStore, type View } from './store';

const SPEEDS = [1, 5, 10, 30, 60, 120];
const VIEWS: { id: View; label: string }[] = [
  { id: 'live', label: 'Live map' }, { id: 'forecast', label: 'Forecast' }, { id: 'report', label: 'Run report' }, { id: 'methods', label: 'Methods' },
];

function TopBar() {
  const view = useStore((s) => s.view);
  return (
    <header className="topbar">
      <div className="brand"><b>NEXTROUTE</b><span>Adaptive dispatch · Chennai buses</span></div>
      <div className="badge" title="Routes, stops and timetables are sourced from official Chennai GTFS. Passenger flows, traffic delays and IoT sensors are simulated."><i />Live Simulation Demo · Simulated Riders</div>
      <nav className="tabs" role="tablist" aria-label="Views">
        {VIEWS.map((v) => (
          <button key={v.id} role="tab" aria-selected={view === v.id} onClick={() => actions.view(v.id)}>{v.label}</button>
        ))}
      </nav>
      <div className="disclaimer">
        <span className="demo-pill">DEMO ONLY</span>
        <span>Independent prototype · Testing with simulated data & real GTFS network</span>
      </div>
    </header>
  );
}

function Timeline() {
  const t = useStore((s) => s.t);
  const scenario = useStore((s) => s.options.scenario);
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const span = DAY_END - DAY_START;
  const at = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    return DAY_START + Math.round((f * span) / 300) * 300;
  };
  const sc = SCENARIOS[scenario];
  const marks: [number, number][] = [];
  if (sc.rain) marks.push([sc.rain.from, sc.rain.to]);
  if (sc.surge) marks.push([sc.surge.t, sc.surge.t + sc.surge.dur]);
  for (const b of sc.breakdowns ?? []) marks.push([b - 300, b + 300]);
  const pct = (x: number) => `${((x - DAY_START) / span) * 100}%`;
  return (
    <div
      className="timeline" ref={ref} role="slider" aria-label="Time of day" aria-valuemin={4} aria-valuemax={24} aria-valuenow={+(t / 3600).toFixed(2)} tabIndex={0}
      onMouseMove={(e) => setHover(at(e))} onMouseLeave={() => setHover(null)} onClick={(e) => actions.jump(at(e))}
      onKeyDown={(e) => { if (e.key === 'ArrowRight') actions.jump(Math.min(DAY_END, t + 900)); if (e.key === 'ArrowLeft') actions.jump(Math.max(DAY_START + 60, t - 900)); }}
    >
      <div className="track" />
      {marks.map((m, i) => <div key={i} className="mark" style={{ left: pct(m[0]), width: `${((m[1] - m[0]) / span) * 100}%` }} title="Scenario event" />)}
      <div className="fill" style={{ width: pct(t) }} />
      <div className="knob" style={{ left: pct(t) }} />
      {Array.from({ length: 11 }, (_, i) => 4 + i * 2).map((h) => <div key={h} className="tick" style={{ left: pct(h * 3600) }}>{String(h).padStart(2, '0')}</div>)}
      {hover !== null && <div className="hover" style={{ left: pct(hover) }}>{fmtClock(hover)}</div>}
    </div>
  );
}

function TimeBar() {
  const t = useStore((s) => s.t);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const done = useStore((s) => s.done);
  const opts = useStore((s) => s.options);
  const ready = useStore((s) => s.ready);
  return (
    <div className="timebar">
      <button className="playbtn" onClick={() => actions.play(!playing)} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (Space)' : 'Play (Space)'} disabled={done}>
        {playing
          ? <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="1.5" width="3" height="9" fill="currentColor" /><rect x="7" y="1.5" width="3" height="9" fill="currentColor" /></svg>
          : <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>}
      </button>
      <div className="seg" role="group" aria-label="Simulation speed">
        {SPEEDS.map((x) => <button key={x} aria-pressed={speed === x} onClick={() => actions.speed(x)}>{x}x</button>)}
      </div>
      <div className="clock" aria-live="off">{fmtClock(t, true)}<small>IST</small></div>
      <Timeline />
      <div className="runinfo">
        <b>{SCENARIOS[opts.scenario].name}</b> · seed <span className="num">{opts.seed}</span>
        {ready && <> · <span className="num">{fmtInt(ready.nPax)}</span> simulated riders · <span className="num">{ready.fleet.scheduled}</span> buses + <span className="num">{ready.fleet.pool}</span> flex</>}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="overlay legend" aria-label="Map legend">
      <div className="cap" style={{ marginBottom: 5 }}>Bus crowding (as sensed)</div>
      {['Empty', 'Seated', 'Standing', 'Crush'].map((name, i) => (
        <div className="li" key={name}>
          <span className="dot" style={{ background: BAND_HEX[i], width: 13 + i * 2.2, height: 13 + i * 2.2 }}>{BAND_LETTER[i]}</span>{name}
        </div>
      ))}
      <div className="cap" style={{ margin: '8px 0 5px' }}>Markers</div>
      <div className="li"><span className="ring" style={{ borderColor: 'var(--bunch)' }} />Bunched buses</div>
      <div className="li"><span className="ring" style={{ borderColor: '#e9ecef' }} />Holding at stop</div>
      <div className="li"><span style={{ color: 'var(--warn)', font: '700 13px var(--mono)', width: 15, textAlign: 'center' }}>!</span>Sensor fault or breakdown</div>
      <div className="li"><span style={{ width: 15, display: 'grid', placeItems: 'center' }}><span style={{ width: 11, height: 11, borderRadius: '50%', background: 'rgba(148,170,198,.4)', border: '1px solid rgba(170,190,214,.8)' }} /></span>Stop, sized by waiting crowd</div>
    </div>
  );
}

function MapView({ full }: { full?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const arm = useStore((s) => s.arm);
  const busy = useStore((s) => s.busy);
  const progress = useStore((s) => s.progress);
  const notice = useStore((s) => s.mapNotice);
  const view = useStore((s) => s.view);
  useEffect(() => {
    if (ref.current) {
      mountMap(ref.current);
      const ro = new ResizeObserver(() => {
        getMapHost().map?.resize();
      });
      ro.observe(ref.current);
      return () => ro.disconnect();
    }
  }, []);
  useEffect(() => {
    startRenderLoop();
  }, [view, full]);
  return (
    <div className={`main ${full ? 'full-bg' : ''}`}>
      <div className="map-host" ref={ref} />
      {view === 'live' && (
        <>
          <div className="overlay armtoggle">
            <div className="seg sans" role="group" aria-label="Which run to show on the map">
              <button aria-pressed={arm === 'base'} onClick={() => actions.arm('base')} title="Show the fixed-schedule run (B)">Fixed schedule</button>
              <button aria-pressed={arm === 'samam'} onClick={() => actions.arm('samam')} title="Show the NextRoute run (S)">NextRoute</button>
            </div>
            <div className="armnote">Same seed, same riders, same traffic. Showing: <b style={{ color: 'var(--text)' }}>{arm === 'base' ? 'fixed schedule' : 'NextRoute'}</b></div>
          </div>
          <Legend />
          <div className="overlay mapbtns"><button className="btn small" onClick={resetView}>Reset view</button></div>
          {notice && <div className="overlay notice" role="status">{notice}</div>}
        </>
      )}
      {view === 'forecast' && <ForecastView />}
      {busy && (
        <div className="overlay busy" role="status">
          <div>
            <div style={{ fontWeight: 600 }}>Running the simulation forward…</div>
            <div className="muted" style={{ fontSize: 11.5 }}>Both runs are computed from 04:00 so every number is real.</div>
            <div className="bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          </div>
        </div>
      )}
    </div>
  );
}

interface KpiDef { label: string; get: (k: Kpis) => number; fmt: (x: number) => string; unit: string; neutral?: boolean; hint: string }
export const KPI_DEFS: KpiDef[] = [
  { label: 'Average wait', get: (k) => k.avgWait / 60, fmt: (x) => x.toFixed(1), unit: 'min', hint: 'Mean time from arriving at the stop to boarding, including riders still waiting.' },
  { label: '90th pct wait', get: (k) => k.p90Wait / 60, fmt: (x) => x.toFixed(1), unit: 'min', hint: 'Nine riders in ten wait less than this.' },
  { label: 'Left behind', get: (k) => k.leftBehind, fmt: fmtInt, unit: '', hint: 'Times a rider could not board because the bus was full.' },
  { label: 'Peak load', get: (k) => k.peakLoadFactor * 100, fmt: (x) => x.toFixed(0), unit: '% cap', hint: '99th percentile of bus load when leaving a stop, as a share of capacity.' },
  { label: 'Bunching events', get: (k) => k.bunching, fmt: fmtInt, unit: '', hint: 'Pairs of buses on the same pattern that came within a quarter of the scheduled headway (min 60 s).' },
  { label: 'Bus-km used', get: (k) => k.busKm, fmt: fmtInt, unit: 'km', neutral: true, hint: 'Kilometres run by all buses. NextRoute uses extra km for short-turn and flex trips.' },
  { label: 'Average journey', get: (k) => k.avgJourney / 60, fmt: (x) => x.toFixed(1), unit: 'min', hint: 'Wait plus ride for riders who have arrived. Holding adds ride time, so this shows the net effect.' },
];

export function deltaText(b: number, s: number, neutral?: boolean): { text: string; cls: string } {
  if (b === 0 && s === 0) return { text: 'no difference', cls: '' };
  const d = s - b;
  const pct = b !== 0 ? (d / b) * 100 : 0;
  if (Math.abs(pct) < 0.05 && Math.abs(d) < 1e-9) return { text: 'no difference', cls: '' };
  const arrow = d < 0 ? '▼' : '▲';
  const word = neutral ? (d < 0 ? 'less' : 'more') : d < 0 ? 'better' : 'worse';
  return { text: `${arrow} ${Math.abs(pct).toFixed(1)}% ${word}`, cls: neutral ? '' : d < 0 ? 'good' : 'bad' };
}

function KpiStrip() {
  const kpi = useStore((s) => s.kpi);
  return (
    <footer className="kpis" aria-label="Live KPIs, fixed schedule versus NextRoute">
      <div className="kpi-head">
        <span className="cap">Live KPIs</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>In simulation, since 04:00, from ground truth</span>
      </div>
      {KPI_DEFS.map((d) => {
        const b = kpi ? d.get(kpi.base) : 0, s = kpi ? d.get(kpi.samam) : 0;
        const dl = deltaText(b, s, d.neutral);
        return (
          <div className="kpi" key={d.label} title={d.hint}>
            <span className="cap">{d.label}</span>
            <div className="vals">
              <div><div className="who"><i style={{ background: 'var(--base)' }} />Fixed</div><div className="v">{kpi ? d.fmt(b) : '–'}<small>{d.unit}</small></div></div>
              <div><div className="who"><i style={{ background: 'var(--accent)' }} />NextRoute</div><div className="v">{kpi ? d.fmt(s) : '–'}<small>{d.unit}</small></div></div>
            </div>
            <div className={`delta ${dl.cls}`}>{kpi ? dl.text : ''}</div>
          </div>
        );
      })}
    </footer>
  );
}

export function App() {
  const view = useStore((s) => s.view);
  const playing = useStore((s) => s.playing);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); actions.play(!useStore.getState().playing); }
      if (e.key === 'b' || e.key === 'B') actions.arm('base');
      if (e.key === 's' || e.key === 'S') actions.arm('samam');
      if (e.key === 'Escape') actions.select(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing]);
  const full = view === 'report' || view === 'methods';
  return (
    <div className="app">
      <TopBar />
      <TimeBar />
      {/* The map stays permanently mounted behind all views so WebGL is never lost. */}
      {!full && <LeftPanel />}
      <MapView full={full} />
      {!full && <Console onFocus={(lon, lat, bus) => { if (useStore.getState().view !== 'live') actions.view('live'); if (bus >= 0) actions.select(bus); flyTo(lon, lat); }} />}
      {!full && <KpiStrip />}
      {view === 'report' && <ReportView />}
      {view === 'methods' && <MethodsView />}
    </div>
  );
}
