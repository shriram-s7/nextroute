// End-of-run (or mid-run) report: KPI comparison, time-of-day charts, what Samam did, how the
// sensors and forecast performed, and the 20-seed batch context. Exportable as JSON, CSV or print/PDF.
import { useEffect, useRef, useState } from 'react';
import batchRaw from '../data/batch-results.json';
import { SCENARIOS } from '../engine/index';
import type { ReportMsg, SeriesView } from '../worker/protocol';
import { KPI_DEFS, deltaText } from './App';
import { actions, fmtClock, fmtInt, net, useStore } from './store';

interface BatchMetric { baseline: number; baselineSd: number; hold: number; holdSd: number; samam: number; samamSd: number; diff: number; ci: number; pct: number; better: number }
interface Batch {
  nSeeds: number; seeds: [number, number];
  metrics: { key: string; label: string; unit: string; digits: number; lowerBetter: boolean }[];
  summary: Record<string, { name: string; metrics: Record<string, BatchMetric> }>;
}
export const batch = batchRaw as unknown as Batch;
export const fmtN = (x: number, d: number) => x.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

interface ChartDef { title: string; sub: string; unit: string; digits: number; get: (s: SeriesView, i: number) => number | null }
const CHARTS: ChartDef[] = [
  { title: 'Average wait by time of day', sub: 'Minutes, riders boarding in each 15 minutes', unit: 'min', digits: 1, get: (s, i) => (s.board[i] > 0 ? s.wait[i] / s.board[i] / 60 : null) },
  { title: 'Riders left behind', sub: 'Refused boardings per 15 minutes', unit: '', digits: 0, get: (s, i) => s.left[i] },
  { title: 'Crush-loaded departures', sub: 'Share of stop departures above 85% of capacity', unit: '%', digits: 1, get: (s, i) => (s.dep[i] > 0 ? (100 * s.crush[i]) / s.dep[i] : null) },
  { title: 'Bunching events', sub: 'New bunched pairs per 15 minutes', unit: '', digits: 0, get: (s, i) => s.bunch[i] },
];

function LineChart({ def, r }: { def: ChartDef; r: ReportMsg }) {
  const W = 520, H = 190, L = 34, R = 10, T = 10, B = 22;
  const ref = useRef<SVGSVGElement>(null);
  const [hi, setHi] = useState<number | null>(null);
  const sb = r.series.base, ss = r.series.samam;
  const n = sb.board.length;
  const last = Math.max(1, Math.min(n, Math.ceil((r.t - sb.start) / sb.bin)));
  const a: (number | null)[] = [], b: (number | null)[] = [];
  let max = 0;
  for (let i = 0; i < last; i++) { const va = def.get(sb, i), vb = def.get(ss, i); a.push(va); b.push(vb); max = Math.max(max, va ?? 0, vb ?? 0); }
  const step = max <= 0 ? 1 : Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 2 : max / Math.pow(10, Math.floor(Math.log10(max))) > 2 ? 1 : 0.5);
  const yMax = Math.max(step, Math.ceil(max / step) * step);
  const x = (i: number) => L + ((i + 0.5) / n) * (W - L - R);
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const path = (vals: (number | null)[]) => { let d = '', pen = false; vals.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; }); return d; };
  const ticks: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(v);
  const f = (v: number | null) => (v === null ? 'none' : fmtN(v, def.digits) + (def.unit ? ` ${def.unit}` : ''));
  return (
    <div className="card">
      <div className="chart-title">{def.title}</div>
      <div className="chart-sub">{def.sub}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', minHeight: 18 }}>
        <span><span className="lg"><i style={{ background: 'var(--base)' }} />Fixed schedule</span><span className="lg"><i style={{ background: 'var(--accent)' }} />Samam</span></span>
        {hi !== null && <span className="num muted" style={{ fontSize: 11.5 }}>{fmtClock(sb.start + hi * sb.bin)} · fixed {f(a[hi])} · Samam {f(b[hi])}</span>}
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${def.title}: fixed schedule versus Samam`}
        onMouseMove={(e) => { const q = ref.current!.getBoundingClientRect(); const px = ((e.clientX - q.left) / q.width) * W; setHi(Math.max(0, Math.min(last - 1, Math.floor(((px - L) / (W - L - R)) * n)))); }}
        onMouseLeave={() => setHi(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
            <text x={L - 5} y={y(v) + 3} textAnchor="end" fontSize="9.5" fill="var(--text-3)" fontFamily="IBM Plex Mono">{fmtN(v, step < 1 ? 1 : 0)}</text>
          </g>
        ))}
        {[6, 9, 12, 15, 18, 21].map((h) => <text key={h} x={L + ((h * 3600 - sb.start) / (n * sb.bin)) * (W - L - R)} y={H - 6} textAnchor="middle" fontSize="9.5" fill="var(--text-3)" fontFamily="IBM Plex Mono">{String(h).padStart(2, '0')}:00</text>)}
        <path d={path(a)} fill="none" stroke="var(--base)" strokeWidth="2" strokeLinejoin="round" />
        <path d={path(b)} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
        {hi !== null && (
          <g>
            <line x1={x(hi)} x2={x(hi)} y1={T} y2={H - B} stroke="var(--text-3)" strokeWidth="1" />
            {a[hi] !== null && <circle cx={x(hi)} cy={y(a[hi]!)} r="4" fill="var(--base)" stroke="var(--surface-1)" strokeWidth="2" />}
            {b[hi] !== null && <circle cx={x(hi)} cy={y(b[hi]!)} r="4" fill="var(--accent)" stroke="var(--surface-1)" strokeWidth="2" />}
          </g>
        )}
      </svg>
    </div>
  );
}

function csvOf(r: ReportMsg): string {
  const q = (c: string | number) => `"${String(c).replace(/"/g, '""')}"`;
  const rows: (string | number)[][] = [
    ['Samam run report (in simulation)', SCENARIOS[r.opts.scenario].name, `seed ${r.opts.seed}`, `04:00 to ${fmtClock(r.t)}`],
    [], ['Metric', 'Unit', 'Fixed schedule', 'Samam', 'Difference', 'Difference %'],
    ...KPI_DEFS.map((d) => { const b = d.get(r.kpi.base), s = d.get(r.kpi.samam); return [d.label, d.unit, b.toFixed(3), s.toFixed(3), (s - b).toFixed(3), b !== 0 ? (((s - b) / b) * 100).toFixed(2) : '0']; }),
    [], ['Time', ...CHARTS.flatMap((c) => [`${c.title} (fixed)`, `${c.title} (Samam)`])],
  ];
  const sb = r.series.base, ss = r.series.samam;
  for (let i = 0; i < sb.board.length && sb.start + i * sb.bin < r.t; i++) rows.push([fmtClock(sb.start + i * sb.bin), ...CHARTS.flatMap((c) => [c.get(sb, i)?.toFixed(2) ?? '', c.get(ss, i)?.toFixed(2) ?? ''])]);
  return rows.map((row) => row.map(q).join(',')).join('\n');
}

export function ReportView() {
  const r = useStore((s) => s.report);
  const done = useStore((s) => s.done);
  useEffect(() => {
    actions.refreshReport();
    const id = setInterval(() => actions.refreshReport(), 2500);
    return () => clearInterval(id);
  }, []);
  if (!r) return <div className="page"><div className="page-in"><div className="empty">Preparing the report…</div></div></div>;

  const rows = KPI_DEFS.map((d) => ({ d, b: d.get(r.kpi.base), s: d.get(r.kpi.samam) }));
  const service = rows.filter((x) => !x.d.neutral);
  const worse = service.filter((x) => x.s > x.b + 1e-9), better = service.filter((x) => x.s < x.b - 1e-9);
  const km = rows.find((x) => x.d.neutral)!;
  const kmPct = km.b > 0 ? ((km.s - km.b) / km.b) * 100 : 0;
  const c = (k: string) => r.recCounts[k] || 0;
  const name = `samam-report-${r.opts.scenario}-seed${r.opts.seed}-${fmtClock(r.t).replace(':', '')}`;
  const bs = batch.summary[r.opts.scenario];
  const stdOpts = r.opts.reserveShare === 0.08 && r.opts.demandScale === 1;

  return (
    <div className="page" aria-label="Run report">
      <div className="page-in">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h1>Run report</h1>
            <p style={{ margin: 0 }}>
              <b>{SCENARIOS[r.opts.scenario].name}</b> · seed <span className="num">{r.opts.seed}</span> · flex reserve <span className="num">{Math.round(r.opts.reserveShare * 100)}%</span> · 04:00 to <span className="num">{fmtClock(r.t)}</span> IST{done ? ' (full day)' : ' (run still in progress)'}
            </p>
          </div>
          <div className="noprint" style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={() => download(`${name}.csv`, csvOf(r), 'text/csv')}>Export CSV</button>
            <button className="btn" onClick={() => download(`${name}.json`, JSON.stringify({ ...r, note: 'Simulation results. Real network, simulated passengers.' }, (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v), 1), 'application/json')}>Export JSON</button>
            <button className="btn primary" onClick={() => window.print()}>Print / PDF</button>
          </div>
        </div>

        <div className="callout">
          <b>In simulation.</b> Real MTC network and timetable, simulated passengers, traffic and sensors. Both runs faced the same riders and the same traffic.
          {' '}Samam did better than the fixed schedule on <b>{better.length} of {service.length}</b> service measures{worse.length > 0 ? <> and <b>worse on {worse.length}</b> ({worse.map((x) => x.d.label.toLowerCase()).join(', ')})</> : ''}, using <b>{kmPct >= 0 ? '+' : ''}{kmPct.toFixed(1)}%</b> bus-km. This is one simulated day, not a prediction for real operations.
        </div>

        <h2>KPI comparison</h2>
        <table className="t">
          <thead><tr><th>Measure</th><th>Fixed schedule</th><th>Samam</th><th>Difference</th><th>Result</th></tr></thead>
          <tbody>
            {rows.map(({ d, b, s }) => {
              const dl = deltaText(b, s, d.neutral);
              const same = Math.abs(s - b) < 1e-9;
              return (
                <tr key={d.label}>
                  <td><b style={{ fontWeight: 600 }}>{d.label}</b><div className="dim" style={{ fontSize: 11 }}>{d.hint}</div></td>
                  <td>{d.fmt(b)} {d.unit}</td>
                  <td>{d.fmt(s)} {d.unit}</td>
                  <td>{dl.text}</td>
                  <td><span className={`verdict ${d.neutral || same ? 'same' : s < b ? 'good' : 'bad'}`}>{same ? 'No difference' : d.neutral ? (s > b ? 'Cost: more km' : 'Fewer km') : s < b ? 'Better' : 'Worse'}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h2>Through the day</h2>
        <div className="cols">{CHARTS.map((d) => <LineChart key={d.title} def={d} r={r} />)}</div>

        <h2>What Samam did</h2>
        <div className="cols3">
          <div className="card">
            <div className="chart-title">Actions</div>
            <div className="row"><span>Holds applied</span><span className="num">{fmtInt(r.kpi.samam.holds)} · {fmtInt(r.kpi.samam.holdSec / 60)} bus-min</span></div>
            <div className="row"><span>Holds released early or lapsed</span><span className="num">{fmtInt(c('hold:expired'))}</span></div>
            <div className="row"><span>Short-turn trips</span><span className="num">{r.kpi.samam.shortTrips}</span></div>
            <div className="row"><span>Flex pool trips</span><span className="num">{r.kpi.samam.flexTrips}</span></div>
            <div className="row"><span>Breakdown covers</span><span className="num">{r.kpi.samam.covers}</span></div>
            <div className="row"><span>Rejected by dispatcher</span><span className="num">{fmtInt(c('hold:rejected') + c('short:rejected') + c('flex:rejected') + c('cover:rejected'))}</span></div>
          </div>
          <div className="card">
            <div className="chart-title">Sensor health</div>
            <div className="row"><span>Counter faults in service</span><span className="num">{r.sensors.faults}</span></div>
            <div className="row"><span>Detected, switched to tickets</span><span className="num">{r.sensors.detected}</span></div>
            <div className="row"><span>Median time to detect</span><span className="num">{r.sensors.detected ? `${r.sensors.medianDelayMin.toFixed(1)} min` : 'n/a'}</span></div>
            <div className="row"><span>Buses flagged with no fault</span><span className="num">{r.sensors.falseAlarms}</span></div>
          </div>
          <div className="card">
            <div className="chart-title">Forecast accuracy, this run</div>
            {r.forecast.n > 0 ? (
              <>
                <div className="row"><span>30 min ahead, average error</span><span className="num">{r.forecast.model30.toFixed(1)} riders/bus</span></div>
                <div className="row"><span>60 min ahead, average error</span><span className="num">{r.forecast.model60.toFixed(1)} riders/bus</span></div>
                <div className="row"><span>Time-of-day profile alone</span><span className="num">{r.forecast.profile.toFixed(1)} riders/bus</span></div>
              </>
            ) : <div className="dim" style={{ fontSize: 11.5 }}>Available after the first hour of the run.</div>}
          </div>
        </div>

        {r.topLeft.length > 0 && (
          <>
            <h2>Stops where riders were left behind most</h2>
            <table className="t">
              <thead><tr><th>Stop</th><th>Fixed schedule</th><th>Samam</th><th>Difference</th></tr></thead>
              <tbody>{r.topLeft.map((x) => <tr key={x.stop}><td>{net.stops[x.stop].name}</td><td>{fmtInt(x.base)}</td><td>{fmtInt(x.samam)}</td><td>{x.samam - x.base > 0 ? '+' : ''}{fmtInt(x.samam - x.base)}</td></tr>)}</tbody>
            </table>
          </>
        )}

        {r.interventions.length > 0 && (
          <>
            <h2>Your interventions in this run</h2>
            <ul>{r.interventions.map((x, i) => <li key={i}><span className="num">{fmtClock(x.t)}</span> · {x.text}</li>)}</ul>
          </>
        )}

        {bs && (
          <>
            <h2>How typical is this? {batch.nSeeds} seeds of “{bs.name}”</h2>
            <p>From the headless batch run (seeds {batch.seeds[0]}–{batch.seeds[1]}, full days, 8% reserve). Mean ± standard deviation. “Holding only” uses no extra buses, so it shows what spacing alone achieves.{!stdOpts ? ' Your run uses different settings from the batch.' : ''}</p>
            <table className="t">
              <thead><tr><th>Measure</th><th>Fixed schedule</th><th>Samam, holding only</th><th>Samam, all levers</th><th>Change (95% CI)</th><th>Better in</th></tr></thead>
              <tbody>
                {batch.metrics.map((m) => {
                  const v = bs.metrics[m.key];
                  return (
                    <tr key={m.key}>
                      <td>{m.label}{m.unit ? ` (${m.unit})` : ''}</td>
                      <td>{fmtN(v.baseline, m.digits)} ± {fmtN(v.baselineSd, m.digits)}</td>
                      <td>{fmtN(v.hold, m.digits)} ± {fmtN(v.holdSd, m.digits)}</td>
                      <td>{fmtN(v.samam, m.digits)} ± {fmtN(v.samamSd, m.digits)}</td>
                      <td>{v.pct >= 0 ? '+' : ''}{v.pct.toFixed(1)}% ({v.diff >= 0 ? '+' : ''}{fmtN(v.diff, m.digits)} ± {fmtN(v.ci, m.digits)})</td>
                      <td>{v.better}/{batch.nSeeds}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
        <p className="dim" style={{ marginTop: 22, fontSize: 11.5 }}>Samam · independent prototype, not affiliated with MTC · real network, simulated passengers · see the Methods page for every assumption.</p>
      </div>
    </div>
  );
}
