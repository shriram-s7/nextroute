import { useState } from 'react';
import { SCENARIOS, ST_NAMES, bandOf, type ScenarioId } from '../engine/index';
import { BAND_HEX, BAND_LETTER } from '../map/render';
import { actions, fmtClock, fmtInt, live, net, useStore } from './store';

const SENSOR_SRC_NAME = ['Door camera (IR)', 'CCTV counter', 'ETM ticket fallback'];
const HEALTH_LABEL = ['Normal', 'Suspicious', 'Fault (fallback active)'];
const HEALTH_CLS = ['good', 'warn', 'bad'];

function ScenarioSection() {
  const options = useStore((s) => s.options);
  const busy = useStore((s) => s.busy);
  const [seedInput, setSeedInput] = useState(options.seed);

  const selectScenario = (id: ScenarioId) => {
    actions.start({ ...options, scenario: id });
  };

  const handleSeedChange = (val: number) => {
    setSeedInput(val);
    actions.start({ ...options, seed: val });
  };

  return (
    <div className="sect">
      <div className="cap" style={{ marginBottom: 8 }}>Operating Scenario</div>
      {(Object.keys(SCENARIOS) as ScenarioId[]).map((id) => {
        const sc = SCENARIOS[id];
        const active = options.scenario === id;
        return (
          <button
            key={id}
            className="scn"
            aria-pressed={active}
            disabled={busy}
            onClick={() => selectScenario(id)}
          >
            <b>{sc.name}</b>
            <span>{sc.blurb}</span>
          </button>
        );
      })}
      <div className="row" style={{ marginTop: 10 }}>
        <span>Random seed:</span>
        <input
          type="number"
          value={seedInput}
          disabled={busy}
          onChange={(e) => handleSeedChange(Number(e.target.value) || 1)}
          min={1}
          max={99999}
        />
      </div>
    </div>
  );
}

function StopDetailPanel({ stopIdx }: { stopIdx: number }) {
  const stop = net.stops[stopIdx];
  const arm = useStore((s) => s.arm);
  if (!stop) return null;

  const waitBase = live.wait?.base ? live.wait.base[stopIdx] : 0;
  const waitSamam = live.wait?.samam ? live.wait.samam[stopIdx] : 0;

  const callingLines = net.lines.filter((l) =>
    l.patterns.some((pid) => net.patterns[pid].stops.includes(stopIdx))
  );

  return (
    <div className="sect">
      <div className="panel-h" style={{ padding: '0 0 8px 0' }}>
        <div>
          <span className="cap">Stop Details</span>
          <div style={{ font: '600 15px var(--sans)', color: 'var(--text)', marginTop: 2 }}>
            {stop.name}
          </div>
          <div className="muted" style={{ fontSize: 11 }}>ID: {stop.id} · #{stopIdx}</div>
        </div>
        <button className="btn small" onClick={() => actions.selectStop(-1)}>Close</button>
      </div>

      <div className="card" style={{ marginTop: 8 }}>
        <div className="row">
          <span>Waiting riders (Fixed):</span>
          <span className="num" style={{ fontWeight: 600, color: 'var(--base)' }}>{waitBase}</span>
        </div>
        <div className="row">
          <span>Waiting riders (Samam):</span>
          <span className="num" style={{ fontWeight: 600, color: 'var(--accent)' }}>{waitSamam}</span>
        </div>
        <div className="row">
          <span>Active view showing:</span>
          <span style={{ fontWeight: 500, color: arm === 'base' ? 'var(--base)' : 'var(--accent)' }}>
            {arm === 'base' ? 'Fixed schedule' : 'Samam'}
          </span>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="cap" style={{ marginBottom: 4 }}>Calling Lines ({callingLines.length})</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {callingLines.map((l) => (
            <span key={l.id} className="tag" style={{ fontSize: 11, padding: '2px 6px' }}>
              Line {l.id}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function BusDetailInspector() {
  const detail = useStore((s) => s.detail);
  const busId = useStore((s) => s.selectedBus);
  const arm = useStore((s) => s.arm);

  if (!detail || busId < 0) {
    return (
      <div className="sect empty">
        Click any bus on the map or select a recommendation in the console to inspect vehicle state, sensor health, and driver instructions.
      </div>
    );
  }

  const band = bandOf(detail.load, detail.seats, detail.cap);
  const pct = Math.min(100, Math.round((detail.load / detail.cap) * 100));
  const estPct = Math.min(100, Math.round((detail.est / detail.cap) * 100));

  return (
    <div className="sect">
      <div className="panel-h" style={{ padding: '0 0 8px 0' }}>
        <div className="bushead">
          <span className="buscode">{detail.code}</span>
          <span
            className="bandpill"
            style={{ borderColor: BAND_HEX[band], color: BAND_HEX[band] }}
          >
            <span className="dot" style={{ background: BAND_HEX[band], width: 12, height: 12 }}>
              {BAND_LETTER[band]}
            </span>
            {BAND_LETTER[band] === 'E' ? 'Empty' : BAND_LETTER[band] === 'S' ? 'Seated' : BAND_LETTER[band] === 'T' ? 'Standing' : 'Crush'}
          </span>
          {detail.electric && (
            <span className="tag" style={{ borderColor: 'var(--good)', color: 'var(--good)' }}>EV</span>
          )}
          {detail.pool && <span className="tag">FLEX POOL</span>}
        </div>
        <button className="btn small" onClick={() => actions.select(-1)}>Close</button>
      </div>

      {/* Driver current order banner */}
      <div className={`instr ${detail.instruction.kind === 'hold' || detail.instruction.kind === 'short' || detail.instruction.kind === 'flex' ? 'active' : ''}`} style={{ margin: '8px 0' }}>
        <span className="cap">Current Dispatch Order</span>
        <b style={{ marginTop: 2 }}>{detail.instruction.text}</b>
        <span>{detail.instruction.sub}</span>
      </div>

      <div className="row">
        <span>Line / Pattern:</span>
        <b>Line {detail.lineId} ({detail.patternId})</b>
      </div>
      <div className="row">
        <span>Route:</span>
        <span className="dim" style={{ textAlign: 'right', fontSize: 11.5, maxWidth: '65%' }}>
          {detail.from} → {detail.to}
        </span>
      </div>
      <div className="row">
        <span>Status:</span>
        <b>{ST_NAMES[detail.state] || 'Running'}</b>
      </div>
      <div className="row">
        <span>Next stop:</span>
        <b style={{ color: 'var(--text)' }}>{detail.nextStop || '–'}</b>
      </div>

      {/* Crowding & Capacity */}
      <div className="card" style={{ margin: '10px 0 6px' }}>
        <div className="row">
          <span>Ground truth load:</span>
          <b><span className="num">{detail.load}</span> / {detail.cap} <small className="muted">({pct}%)</small></b>
        </div>
        <div className="meter" style={{ margin: '4px 0 8px' }}>
          <i style={{ width: `${pct}%`, background: BAND_HEX[band] }} />
        </div>

        <div className="row">
          <span>Controller estimated load:</span>
          <b><span className="num">{Math.round(detail.est)}</span> / {detail.cap} <small className="muted">({estPct}%)</small></b>
        </div>
        <div className="truth" style={{ marginTop: 2 }}>
          Controller never reads ground truth. Confidence: {Math.round(detail.conf * 100)}%
        </div>
      </div>

      {/* EV battery status if electric */}
      {detail.electric && (
        <div className="card" style={{ marginBottom: 6 }}>
          <div className="row">
            <span>Battery State of Charge:</span>
            <b>{Math.round(detail.soc)} kWh ({Math.round((detail.soc / 250) * 100)}%)</b>
          </div>
          <div className="meter" style={{ margin: '4px 0 6px' }}>
            <i style={{ width: `${Math.min(100, Math.round((detail.soc / 250) * 100))}%`, background: 'var(--good)' }} />
          </div>
          <div className="row">
            <span>Estimated range:</span>
            <span className="num">{detail.rangeKm.toFixed(0)} km</span>
          </div>
        </div>
      )}

      {/* Sensor health & fault simulation */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="cap" style={{ marginBottom: 4 }}>Sensor Health & Telemetry</div>
        <div className="row">
          <span>Primary source:</span>
          <b>{SENSOR_SRC_NAME[detail.src] || 'Sensor'}</b>
        </div>
        <div className="row">
          <span>Sensor status:</span>
          <span className={`verdict ${HEALTH_CLS[detail.health] || 'same'}`}>
            {HEALTH_LABEL[detail.health] || 'Unknown'}
          </span>
        </div>
        {detail.manualBlock && (
          <div className="callout" style={{ margin: '6px 0', padding: '6px 8px', fontSize: 11 }}>
            <b>Sensor manually blocked.</b> Controller is using ETM ticket data fallback.
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button
            className={`btn small ${detail.manualBlock ? 'primary' : ''}`}
            onClick={() => actions.blockSensor(detail.id, !detail.manualBlock)}
          >
            {detail.manualBlock ? 'Unblock sensor' : 'Block sensor'}
          </button>
          <button
            className="btn small danger"
            disabled={detail.state === 6}
            onClick={() => actions.breakdown(detail.id)}
          >
            Trigger breakdown
          </button>
        </div>
      </div>
    </div>
  );
}

function DriverPhoneView() {
  const detail = useStore((s) => s.detail);
  const busId = useStore((s) => s.selectedBus);

  if (!detail || busId < 0) {
    return (
      <div className="sect empty">
        Select a bus on the map to view the in-cab driver mobile terminal.
      </div>
    );
  }

  const instr = detail.instruction;
  const isHold = instr.kind === 'hold';
  const isAlert = instr.kind === 'short' || instr.kind === 'flex' || instr.kind === 'cover' || instr.kind === 'broken';

  return (
    <div className="sect">
      <div className="cap" style={{ textAlign: 'center', marginBottom: 6 }}>
        In-Cab Mobile Terminal (Driver Console)
      </div>
      <div className="phone">
        <div className="screen">
          <div className="ph-top">
            <span>SAMAM DRIVER</span>
            <span>{fmtClock(useStore.getState().t)}</span>
          </div>

          <div className="ph-route">
            <span className="cap">LINE {detail.lineId}</span>
            <div><b>{detail.code}</b></div>
            <div className="dim" style={{ fontSize: 11 }}>{detail.to}</div>
          </div>

          <div className={`ph-main ${isHold ? 'hold' : isAlert ? 'alert' : ''}`}>
            <span className="cap" style={{ color: isHold ? 'var(--accent)' : isAlert ? 'var(--warn)' : 'var(--text-3)' }}>
              {isHold ? 'REGULARITY HOLD' : isAlert ? 'DISPATCH DIRECTIVE' : 'STATUS'}
            </span>
            <div className="big">{instr.text}</div>
            {isHold && instr.sec && (
              <div className="count">{Math.max(0, Math.round(instr.sec))} <span style={{ fontSize: 16 }}>SEC</span></div>
            )}
            <div className="dim" style={{ fontSize: 12 }}>{instr.sub}</div>
          </div>

          <div className="ph-foot">
            <div>
              <span className="cap">Next Stop</span>
              <b>{detail.nextStop || 'Terminus'}</b>
            </div>
            <div>
              <span className="cap">Passengers</span>
              <b>{detail.load} / {detail.cap}</b>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LeftPanel() {
  const selectedBus = useStore((s) => s.selectedBus);
  const selectedStop = useStore((s) => s.selectedStop);
  const tab = useStore((s) => s.panelTab);

  return (
    <aside className="left" aria-label="Control panel">
      {selectedStop >= 0 ? (
        <StopDetailPanel stopIdx={selectedStop} />
      ) : selectedBus >= 0 ? (
        <>
          <div className="subtabs">
            <button
              role="tab"
              aria-selected={tab === 'bus'}
              onClick={() => useStore.setState({ panelTab: 'bus' })}
            >
              Bus Inspector
            </button>
            <button
              role="tab"
              aria-selected={tab === 'driver'}
              onClick={() => useStore.setState({ panelTab: 'driver' })}
            >
              Driver Console
            </button>
          </div>
          {tab === 'bus' ? <BusDetailInspector /> : <DriverPhoneView />}
        </>
      ) : (
        <>
          <ScenarioSection />
          <div className="sect">
            <div className="cap" style={{ marginBottom: 6 }}>GST Road Corridor Fleet</div>
            <div className="row"><span>Total Active Lines:</span><b>7</b></div>
            <div className="row"><span>Total Corridor Stops:</span><b>339</b></div>
            <div className="row"><span>Scheduled Buses:</span><b>231</b></div>
            <div className="row"><span>Flex Pool Reserves:</span><b>18</b></div>
            <div className="row"><span>Electric Fleet (EV):</span><b>41 (18%)</b></div>
            <div className="row"><span>Kilambakkam Depot:</span><b>Active</b></div>
          </div>
        </>
      )}
    </aside>
  );
}
