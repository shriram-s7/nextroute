import { useMemo, useState } from 'react';
import type { RecView } from '../worker/protocol';
import { actions, fmtClock, fmtInt, useStore } from './store';

const KIND_LABEL: Record<string, string> = { hold: 'Hold', short: 'Short-turn', flex: 'Flex pool', cover: 'Cover', alert: 'Alert' };
const FILTERS = [
  { id: 'all', label: 'All' }, { id: 'pending', label: 'Needs decision' }, { id: 'hold', label: 'Holds' },
  { id: 'extra', label: 'Short-turn + flex' }, { id: 'alert', label: 'Alerts' },
];

function statusText(r: RecView): string {
  if (r.status === 'pending') return `open until ${fmtClock(r.expires)}`;
  if (r.status === 'applied') return r.auto ? 'applied (auto)' : 'approved';
  if (r.status === 'rejected') return 'rejected';
  if (r.status === 'expired') return r.kind === 'hold' ? 'not applied' : 'expired';
  return '';
}

function RecCard({ r, onFocus }: { r: RecView; onFocus: (lon: number, lat: number, bus: number) => void }) {
  return (
    <div className={`rec ${r.status === 'pending' ? 'pending' : ''} ${r.kind === 'alert' ? 'alert' : ''}`} onClick={() => onFocus(r.lon, r.lat, r.bus)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onFocus(r.lon, r.lat, r.bus); }}>
      <div className="top">
        <span className="num">{fmtClock(r.t)}</span>
        <span className="tag">{KIND_LABEL[r.kind]}</span>
        <span>Line {r.line}</span>
        <span className={`status ${r.status}`}>{statusText(r)}</span>
      </div>
      <div className="title">{r.title}</div>
      <p><b>Why</b>{r.reason}</p>
      <p><b>{r.kind === 'alert' ? 'Action' : 'Predicted effect'}</b>{r.effect}</p>
      {r.status === 'pending' && (
        <div className="acts" onClick={(e) => e.stopPropagation()}>
          <button className="btn small primary" onClick={() => actions.decide(r.id, true)}>Approve</button>
          <button className="btn small" onClick={() => actions.decide(r.id, false)}>Reject</button>
        </div>
      )}
    </div>
  );
}

export function Console({ onFocus }: { onFocus: (lon: number, lat: number, bus: number) => void }) {
  const recs = useStore((s) => s.recs);
  const total = useStore((s) => s.recTotal);
  const pending = useStore((s) => s.recPending);
  const counts = useStore((s) => s.recCounts);
  const mode = useStore((s) => s.mode);
  const [filter, setFilter] = useState('all');
  const shown = useMemo(() => recs.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'pending') return r.status === 'pending';
    if (filter === 'extra') return r.kind === 'short' || r.kind === 'flex' || r.kind === 'cover';
    return r.kind === filter;
  }), [recs, filter]);
  const c = (k: string) => counts[k] || 0;
  const applied = c('hold:applied') + c('short:applied') + c('flex:applied') + c('cover:applied');
  const rejected = c('hold:rejected') + c('short:rejected') + c('flex:rejected') + c('cover:rejected');
  return (
    <aside className="console" aria-label="Dispatcher console">
      <div className="console-h">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600 }}>Dispatcher console</span>
          <div className="seg sans" role="group" aria-label="Decision mode">
            <button aria-pressed={mode === 'auto'} onClick={() => actions.mode('auto')} title="NextRoute applies its recommendations">Auto</button>
            <button aria-pressed={mode === 'manual'} onClick={() => actions.mode('manual')} title="You approve or reject each recommendation">Manual</button>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 5 }}>
          {mode === 'auto'
            ? 'Auto: recommendations are applied as they are made.'
            : 'Manual: nothing is applied until you approve it. A hold lapses when its bus leaves the stop.'}
        </div>
        <div className="muted num" style={{ fontSize: 11, marginTop: 4 }}>
          {fmtInt(total)} issued · {fmtInt(applied)} applied · {fmtInt(rejected)} rejected{pending > 0 ? ` · ${pending} waiting` : ''}
        </div>
        <div className="chips">
          {FILTERS.map((f) => <button key={f.id} className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}{f.id === 'pending' && pending > 0 ? ` ${pending}` : ''}</button>)}
        </div>
      </div>
      <div className="feed">
        {shown.length === 0 && <div className="empty">{total === 0 ? 'No recommendations yet. NextRoute starts acting once buses are on the road.' : 'Nothing matches this filter.'}</div>}
        {shown.map((r) => <RecCard key={r.id} r={r} onFocus={onFocus} />)}
      </div>
    </aside>
  );
}
