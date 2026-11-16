import { useState } from 'react';
import { DAY_START } from '../engine/index';
import { actions, fmtClock, net, useStore } from './store';

// Color map: maps load/bus (0 to ~80) to control-room ramp
function loadColor(val: number, cap: number): string {
  if (val < 0) return '#14181f'; // no bus / unobserved
  const ratio = Math.max(0, Math.min(1.2, val / cap));
  if (ratio < 0.25) return '#1e293b';
  if (ratio < 0.5) return '#1d4ed8';
  if (ratio < 0.75) return '#0d9488';
  if (ratio < 0.9) return '#d97706';
  if (ratio < 1.0) return '#ea580c';
  return '#dc2626'; // crush
}

export function ForecastView() {
  const fc = useStore((s) => s.forecast);
  const fcPattern = useStore((s) => s.fcPattern);
  const [metric, setMetric] = useState<'actual' | 'pred30' | 'pred60' | 'profile'>('actual');
  const [hover, setHover] = useState<{
    link: number;
    bin: number;
    x: number;
    y: number;
    fromStop: string;
    toStop: string;
    time: string;
    act: number;
    p30: number;
    p60: number;
    prof: number;
  } | null>(null);

  const patterns = net.patterns;
  const currentPattern = patterns[fcPattern] || patterns[0];

  return (
    <div className="fc" aria-label="Segment-level Passenger Load Forecast">
      <div className="fc-h">
        <span style={{ fontWeight: 600, fontSize: 14 }}>Segment Load Forecast (60-Min Horizon)</span>

        {/* Pattern Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="cap">Pattern:</span>
          <select
            value={fcPattern}
            onChange={(e) => actions.forecastPattern(Number(e.target.value))}
          >
            {patterns.map((p) => (
              <option key={p.idx} value={p.idx}>
                Line {p.lineId} ({p.id}): {p.from} → {p.to}
              </option>
            ))}
          </select>
        </div>

        {/* View Mode Toggle */}
        <div className="seg sans" role="group" aria-label="Forecast comparison view">
          <button
            aria-pressed={metric === 'actual'}
            onClick={() => setMetric('actual')}
            title="Ground-truth simulated load"
          >
            Actual Simulated
          </button>
          <button
            aria-pressed={metric === 'pred30'}
            onClick={() => setMetric('pred30')}
            title="Forecast 30 minutes ahead"
          >
            30-Min Prediction
          </button>
          <button
            aria-pressed={metric === 'pred60'}
            onClick={() => setMetric('pred60')}
            title="Forecast 60 minutes ahead"
          >
            60-Min Prediction
          </button>
          <button
            aria-pressed={metric === 'profile'}
            onClick={() => setMetric('profile')}
            title="Historical time-of-day profile"
          >
            Historical Profile
          </button>
        </div>

        {/* Accuracy badge if available */}
        {fc && fc.mae.n > 0 && (
          <div className="badge" style={{ background: 'var(--surface-2)' }}>
            <i></i>
            MAE: Profile {fc.mae.profile.toFixed(1)} pax → Model {fc.mae.model30.toFixed(1)} pax ({fc.mae.n} obs)
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="cap">Load per bus:</span>
          <div
            className="ramp"
            style={{
              background: 'linear-gradient(to right, #1e293b, #1d4ed8, #0d9488, #d97706, #dc2626)',
            }}
          />
          <span className="num" style={{ fontSize: 11, color: 'var(--text-3)' }}>0 → 80+</span>
        </div>
      </div>

      <div className="fc-body">
        {!fc || fc.pattern !== fcPattern ? (
          <div className="empty" style={{ paddingTop: 80 }}>
            Loading forecast matrix for {currentPattern.lineId} ({currentPattern.id})…
          </div>
        ) : (
          <div style={{ minWidth: 900 }}>
            {/* Bin times header */}
            <div style={{ display: 'flex', marginLeft: 220, marginBottom: 4 }}>
              {Array.from({ length: Math.min(fc.nBins, 36) }, (_, b) => {
                const t = DAY_START + b * 600 * 3; // every 30 min
                return (
                  <div
                    key={b}
                    style={{
                      width: 48,
                      fontSize: 9.5,
                      fontFamily: 'var(--mono)',
                      color: 'var(--text-3)',
                      textAlign: 'center',
                    }}
                  >
                    {fmtClock(t)}
                  </div>
                );
              })}
            </div>

            {/* Grid rows */}
            {Array.from({ length: fc.nLinks }, (_, link) => {
              const fromName = fc.stopNames[link] || `Stop ${link}`;
              const toName = fc.stopNames[link + 1] || `Stop ${link + 1}`;

              return (
                <div key={link} style={{ display: 'flex', alignItems: 'center', height: 18 }}>
                  <div
                    style={{
                      width: 216,
                      fontSize: 10.5,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      color: 'var(--text-2)',
                      paddingRight: 8,
                      textAlign: 'right',
                    }}
                    title={`${fromName} → ${toName}`}
                  >
                    {fromName}
                  </div>

                  <div style={{ display: 'flex', gap: 1, flex: 1 }}>
                    {Array.from({ length: fc.nBins }, (_, bin) => {
                      const idx = link * fc.nBins + bin;
                      const act = fc.actual[idx];
                      const p30 = fc.pred30[idx];
                      const p60 = fc.pred60[idx];
                      const prof = fc.profile[idx];
                      const val =
                        metric === 'actual' ? act : metric === 'pred30' ? p30 : metric === 'pred60' ? p60 : prof;
                      const bg = loadColor(val, fc.cap);
                      const isNow = bin === fc.nowBin;

                      return (
                        <div
                          key={bin}
                          style={{
                            flex: 1,
                            height: 14,
                            background: bg,
                            borderRadius: 1,
                            outline: isNow ? '1px solid var(--accent)' : 'none',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setHover({
                              link,
                              bin,
                              x: rect.left,
                              y: rect.top - 80,
                              fromStop: fromName,
                              toStop: toName,
                              time: fmtClock(DAY_START + bin * 600),
                              act,
                              p30,
                              p60,
                              prof,
                            });
                          }}
                          onMouseLeave={() => setHover(null)}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Hover detail tooltip */}
        {hover && (
          <div className="fc-tip" style={{ left: hover.x - 40, top: Math.max(80, hover.y) }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>{hover.time} IST</div>
            <div className="dim" style={{ fontSize: 10.5, marginBottom: 4 }}>
              {hover.fromStop} → {hover.toStop}
            </div>
            <div className="row">
              <span>Actual Load:</span>
              <b>{hover.act >= 0 ? `${Math.round(hover.act)} pax` : '– (no bus run)'}</b>
            </div>
            <div className="row">
              <span>30-min Forecast:</span>
              <b>{hover.p30 >= 0 ? `${Math.round(hover.p30)} pax` : '–'}</b>
            </div>
            <div className="row">
              <span>60-min Forecast:</span>
              <b>{hover.p60 >= 0 ? `${Math.round(hover.p60)} pax` : '–'}</b>
            </div>
            <div className="row">
              <span>Historical Profile:</span>
              <b>{hover.prof >= 0 ? `${Math.round(hover.prof)} pax` : '–'}</b>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
