// Segment-by-time heatmap of load per bus. Past bins show what happened (simulation ground truth),
// the next 60 minutes show the live forecast, later bins show the learned profile. A second mode
// shows forecast minus actual for bins that have passed.
import { useEffect, useMemo, useRef, useState } from 'react';
import { BIN, DAY_START } from '../engine/index';
import type { ForecastView as FV } from '../worker/protocol';
import { actions, fmtClock, net, useStore } from './store';

const SEQ = ['#141a24', '#0d366b', '#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'];
type RGB = [number, number, number];
const hexRgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const SEQ_RGB = SEQ.map(hexRgb);
const mix = (a: RGB, b: RGB, f: number): string => `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
function seqColor(v: number, cap: number): string {
  const x = Math.max(0, Math.min(1, v / cap)) * (SEQ.length - 1);
  const i = Math.min(SEQ.length - 2, Math.floor(x));
  return mix(SEQ_RGB[i], SEQ_RGB[i + 1], x - i);
}
const MID: RGB = [56, 56, 53], OVER = hexRgb('#3987e5'), UNDER = hexRgb('#e5484d');
const ERR_MAX = 25;
const divColor = (e: number): string => mix(MID, e >= 0 ? OVER : UNDER, Math.min(1, Math.abs(e) / ERR_MAX));

const LABEL_W = 196, HEAD_H = 24, ROW_H = 13;

function valueAt(fc: FV, k: number, b: number): { v: number; kind: 'actual' | 'live' | 'profile' | 'none' } {
  const i = k * fc.nBins + b;
  if (b < fc.nowBin) return fc.actual[i] >= 0 ? { v: fc.actual[i], kind: 'actual' } : { v: 0, kind: 'none' };
  const h = b - fc.nowBin;
  if (h < fc.horizons) return { v: fc.live[k * fc.horizons + h], kind: 'live' };
  return { v: fc.profile[i], kind: 'profile' };
}

export function ForecastView() {
  const fc = useStore((s) => s.forecast);
  const fcPattern = useStore((s) => s.fcPattern);
  const model = useStore((s) => s.ready?.model);
  const [mode, setMode] = useState<'load' | 'error'>('load');
  const [lead, setLead] = useState<30 | 60>(30);
  const [tip, setTip] = useState<{ k: number; b: number; cx: number; cy: number } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);

  useEffect(() => { actions.forecastPattern(fcPattern); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver((e) => setWidth(e[0].contentRect.width));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const ok = !!fc && fc.pattern === fcPattern;
  const cw = ok ? Math.max(4, Math.floor((width - LABEL_W - 4) / fc!.nBins)) : 6;
  const cssW = ok ? LABEL_W + cw * fc!.nBins : width;
  const cssH = ok ? HEAD_H + ROW_H * fc!.nLinks + 4 : 100;

  useEffect(() => {
    const c = canvas.current;
    if (!c || !ok || !fc) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    g.font = '10px "IBM Plex Mono", monospace';
    g.textBaseline = 'middle';
    g.fillStyle = '#6f7884';
    for (let h = 4; h <= 24; h += 2) {
      const x = LABEL_W + ((h * 3600 - DAY_START) / BIN) * cw;
      g.textAlign = h === 24 ? 'right' : 'center';
      g.fillText(String(h % 24).padStart(2, '0') + ':00', x, 9);
      g.fillRect(Math.min(cssW - 1, x), 17, 1, 5);
    }
    g.font = '10.5px "IBM Plex Sans", sans-serif';
    for (let k = 0; k < fc.nLinks; k++) {
      const y = HEAD_H + k * ROW_H;
      g.fillStyle = '#a4abb5';
      g.textAlign = 'right';
      let name = fc.stopNames[k];
      while (g.measureText(name).width > LABEL_W - 12 && name.length > 4) name = name.slice(0, -2);
      g.fillText(name === fc.stopNames[k] ? name : name + '…', LABEL_W - 8, y + ROW_H / 2);
      for (let b = 0; b < fc.nBins; b++) {
        const x = LABEL_W + b * cw;
        const i = k * fc.nBins + b;
        if (mode === 'load') {
          const { v, kind } = valueAt(fc, k, b);
          if (kind === 'none') { g.fillStyle = '#10141a'; g.fillRect(x, y, cw - 1, ROW_H - 1); continue; }
          g.globalAlpha = kind === 'profile' ? 0.42 : 1;
          g.fillStyle = seqColor(v, fc.cap);
          g.fillRect(x, y, cw - 1, ROW_H - 1);
          g.globalAlpha = 1;
          if (v > 0.85 * fc.cap) { g.fillStyle = '#e5484d'; g.fillRect(x, y, cw - 1, 2); }
        } else {
          const pred = (lead === 30 ? fc.pred30 : fc.pred60)[i];
          g.fillStyle = b >= fc.nowBin || fc.actual[i] < 0 || pred < 0 ? '#10141a' : divColor(pred - fc.actual[i]);
          g.fillRect(x, y, cw - 1, ROW_H - 1);
        }
      }
    }
    const nowX = LABEL_W + ((fc.t - DAY_START) / BIN) * cw;
    if (mode === 'load') {
      const x0 = LABEL_W + fc.nowBin * cw, w = Math.min(fc.horizons, fc.nBins - fc.nowBin) * cw;
      g.strokeStyle = '#e9ecef'; g.lineWidth = 1;
      g.strokeRect(x0 - 0.5, HEAD_H - 1.5, w, ROW_H * fc.nLinks + 2);
    }
    g.fillStyle = '#ffffff';
    g.fillRect(nowX - 0.5, HEAD_H - 6, 1.5, ROW_H * fc.nLinks + 8);
  }, [fc, ok, mode, lead, cw, cssW, cssH]);

  const options = useMemo(() => net.patterns.map((p) => ({ idx: p.idx, label: `${p.lineId}  ${p.from.replace(' Bus Terminus', '')} → ${p.to.replace(' Bus Terminus', '')}` })), []);

  const onMove = (e: React.MouseEvent) => {
    if (!ok || !fc) return;
    const r = canvas.current!.getBoundingClientRect();
    const b = Math.floor((e.clientX - r.left - LABEL_W) / cw), k = Math.floor((e.clientY - r.top - HEAD_H) / ROW_H);
    if (b < 0 || b >= fc.nBins || k < 0 || k >= fc.nLinks) { setTip(null); return; }
    setTip({ k, b, cx: e.clientX, cy: e.clientY });
  };

  let tipBody = null;
  if (tip && ok && fc) {
    const i = tip.k * fc.nBins + tip.b;
    const t0 = DAY_START + tip.b * BIN;
    const a = fc.actual[i];
    const cur = valueAt(fc, tip.k, tip.b);
    const f = (v: number) => (v < 0 ? 'none' : v.toFixed(0));
    tipBody = (
      <div className="fc-tip" style={{ left: Math.min(tip.cx + 14, window.innerWidth - 260), top: Math.min(tip.cy + 14, window.innerHeight - 180) }}>
        <div style={{ fontWeight: 600 }}>{fc.stopNames[tip.k]} → {fc.stopNames[tip.k + 1]}</div>
        <div className="dim num" style={{ marginBottom: 4 }}>{fmtClock(t0)}–{fmtClock(t0 + BIN)} · riders per bus</div>
        {tip.b < fc.nowBin
          ? <div className="row"><span>Actual (sim truth)</span><span className="num">{a < 0 ? 'no bus' : a.toFixed(0)}</span></div>
          : <div className="row"><span>{cur.kind === 'live' ? 'Live forecast' : 'Profile (beyond 60 min)'}</span><span className="num">{cur.v.toFixed(0)}</span></div>}
        <div className="row"><span>Forecast made 30 min before</span><span className="num">{f(fc.pred30[i])}</span></div>
        <div className="row"><span>Forecast made 60 min before</span><span className="num">{f(fc.pred60[i])}</span></div>
        <div className="row"><span>Time-of-day profile</span><span className="num">{fc.profile[i].toFixed(0)}</span></div>
        <div className="row"><span>Share of capacity</span><span className="num">{Math.round(((tip.b < fc.nowBin ? Math.max(0, a) : cur.v) / fc.cap) * 100)}%</span></div>
      </div>
    );
  }

  return (
    <div className="fc">
      <div className="fc-h">
        <span className="panel-t">Load forecast</span>
        <select value={fcPattern} onChange={(e) => actions.forecastPattern(+e.target.value)} aria-label="Line and direction">
          {options.map((o) => <option key={o.idx} value={o.idx}>{o.label}</option>)}
        </select>
        <div className="seg sans" role="group" aria-label="What to show">
          <button aria-pressed={mode === 'load'} onClick={() => setMode('load')}>Load</button>
          <button aria-pressed={mode === 'error'} onClick={() => setMode('error')}>Forecast vs actual</button>
        </div>
        {mode === 'error' && (
          <div className="seg sans" role="group" aria-label="Look-ahead">
            <button aria-pressed={lead === 30} onClick={() => setLead(30)}>30 min ahead</button>
            <button aria-pressed={lead === 60} onClick={() => setLead(60)}>60 min ahead</button>
          </div>
        )}
        <span className="muted" style={{ fontSize: 11.5, marginLeft: 'auto' }}>
          {mode === 'load'
            ? <>0 <span className="ramp" style={{ background: `linear-gradient(90deg, ${SEQ.join(',')})` }} /> {ok ? fc!.cap : 78} riders per bus · <span style={{ borderTop: '2px solid var(--crit)', paddingTop: 1 }}>red edge</span> = crush</>
            : <>busier than forecast −{ERR_MAX} <span className="ramp" style={{ background: 'linear-gradient(90deg, #e5484d, #383835, #3987e5)' }} /> +{ERR_MAX} quieter than forecast</>}
        </span>
      </div>
      <div className="fc-body" ref={wrap}>
        <p className="muted" style={{ margin: '0 0 8px', fontSize: 11.5, maxWidth: '120ch' }}>
          {mode === 'load'
            ? 'Rows are stretches between stops, in travel order. Left of the white line is what happened in this run (simulation ground truth, NextRoute run). The outlined hour is the live forecast. Further right, faded, is the time-of-day profile only.'
            : 'For bins that have passed: the forecast made earlier, minus what then happened. Red means the stretch turned out busier than forecast.'}
          {' '}Method: a time-of-day profile learned from {model?.profileDays ?? 12} simulated days, corrected by live sensor readings with a small linear model. It is not deep learning.
        </p>
        {ok
          ? <canvas ref={canvas} style={{ width: cssW, height: cssH, display: 'block' }} onMouseMove={onMove} onMouseLeave={() => setTip(null)} role="img" aria-label={`Heatmap of load per bus on ${fc!.patternId} by stretch and time of day`} />
          : <div className="empty">Loading forecast…</div>}
        {ok && (
          <div className="muted num" style={{ fontSize: 11.5, marginTop: 10 }}>
            {fc!.mae.n > 0
              ? <>This run so far, this direction ({fc!.mae.n} stretch-bins): the forecast 30 min ahead is off by {fc!.mae.model30.toFixed(1)} riders per bus on average, 60 min ahead by {fc!.mae.model60.toFixed(1)}. The profile alone is off by {fc!.mae.profile.toFixed(1)}.</>
              : 'Forecast-vs-actual figures appear once an hour of this run has passed.'}
          </div>
        )}
      </div>
      {tipBody}
    </div>
  );
}
