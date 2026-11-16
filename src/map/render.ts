// deck.gl layers on top of the single map: routes, stops sized by waiting crowd, buses coloured and
// lettered by crowding band. Bus positions are interpolated between worker frames for 60 fps motion.
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { ST } from '../engine/index';
import { actions, live, net, useStore } from '../ui/store';
import { easeTo, flyTo, getMapHost, mapZoom } from './mapHost';

export const BAND_COLORS: [number, number, number][] = [
  [109, 167, 236], // empty   #6da7ec
  [25, 181, 106], // seated   #19b56a
  [250, 178, 25], // standing #fab219
  [229, 72, 77], // crush     #e5484d
];
export const BAND_HEX = ['#6da7ec', '#19b56a', '#fab219', '#e5484d'];
export const BAND_LETTER = ['E', 'S', 'T', 'C'];
const BAND_RADIUS = [6.5, 7.5, 8.5, 10];

interface BusPt { id: number; lon: number; lat: number; band: number; flags: number; state: number; est: number; load: number; code: string }
interface StopPt { idx: number; lon: number; lat: number; wait: number; name: string }

const routeData = net.patterns.map((p) => {
  const path: [number, number][] = [];
  for (let i = 0; i < p.pathLon.length; i++) path.push([p.pathLon[i], p.pathLat[i]]);
  return { idx: p.idx, path, line: p.lineId };
});

let stopCache: { version: number; arm: string; data: StopPt[] } = { version: -1, arm: '', data: [] };
let lastKey = '';
let lastFollow = 0;

function busPoints(): BusPt[] {
  const s = useStore.getState();
  const cur = live.curr?.[s.arm];
  if (!cur) return [];
  const prev = live.prev?.[s.arm];
  const f = prev ? Math.max(0, Math.min(1, (performance.now() - live.tRecv) / live.interval)) : 1;
  const out: BusPt[] = [];
  const n = cur.length / 8;
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    const state = cur[o + 5];
    if (state === ST.OUT) continue;
    let lon = cur[o], lat = cur[o + 1];
    if (prev && prev[o + 5] !== ST.OUT) {
      const plon = prev[o], plat = prev[o + 1];
      // interpolate only real movement; a jump (terminus turn-round) snaps
      if (Math.abs(lon - plon) < 0.004 && Math.abs(lat - plat) < 0.004) { lon = plon + (lon - plon) * f; lat = plat + (lat - plat) * f; }
    }
    out.push({ id: i, lon, lat, band: cur[o + 7], flags: cur[o + 6], state, est: cur[o + 4], load: cur[o + 3], code: s.buses[i]?.code ?? '' });
  }
  return out;
}

function stopPoints(): StopPt[] {
  const arm = useStore.getState().arm;
  if (stopCache.version === live.waitVersion && stopCache.arm === arm) return stopCache.data;
  const w = live.wait?.[arm];
  stopCache = { version: live.waitVersion, arm, data: net.stops.map((st) => ({ idx: st.idx, lon: st.lon, lat: st.lat, wait: w ? w[st.idx] : 0, name: st.name })) };
  return stopCache.data;
}

function buildLayers() {
  const s = useStore.getState();
  const zoom = mapZoom();
  const buses = busPoints();
  const stops = stopPoints();
  const selPattern = s.detail && s.selectedBus >= 0 ? s.detail.pattern : -1;
  const sel = buses.find((b) => b.id === s.selectedBus);
  const flagged = buses.filter((b) => (b.flags & 3) !== 0);
  const faulty = buses.filter((b) => (b.flags & 12) !== 0 || b.state === ST.BROKEN);
  const layers: unknown[] = [
    new PathLayer({
      id: 'routes', data: routeData, getPath: (d: (typeof routeData)[number]) => d.path,
      getColor: [86, 140, 215, 105], getWidth: 3.5, widthUnits: 'pixels', widthMinPixels: 2, capRounded: true, jointRounded: true,
    }),
    new PathLayer({
      id: 'route-selected', data: selPattern >= 0 ? [routeData[selPattern]] : [], getPath: (d: (typeof routeData)[number]) => d.path,
      getColor: [57, 135, 229, 230], getWidth: 4, widthUnits: 'pixels', capRounded: true, jointRounded: true,
    }),
    new ScatterplotLayer<StopPt>({
      id: 'stops', data: stops, getPosition: (d) => [d.lon, d.lat], radiusUnits: 'pixels',
      getRadius: (d) => Math.max(d.idx === s.selectedStop ? 8 : 0, d.wait === 0 ? 2.2 : Math.min(26, 2.6 + 1.7 * Math.sqrt(d.wait))),
      getFillColor: (d) => (d.wait === 0 ? [130, 144, 162, 150] : [148, 170, 198, d.wait > 25 ? 110 : 80]),
      stroked: true, getLineColor: (d) => (d.idx === s.selectedStop ? [57, 135, 229, 255] : [170, 190, 214, d.wait > 0 ? 170 : 0]),
      getLineWidth: (d) => (d.idx === s.selectedStop ? 2.5 : 1), lineWidthUnits: 'pixels', pickable: true,
      updateTriggers: { getRadius: [live.waitVersion, s.selectedStop], getFillColor: live.waitVersion, getLineColor: [live.waitVersion, s.selectedStop], getLineWidth: s.selectedStop },
      onClick: (info) => { if (info.object) { actions.selectStop(info.object.idx); flyTo(info.object.lon, info.object.lat, 13.8); } return true; },
    }),
    // rings: bunched (magenta) / holding (white)
    new ScatterplotLayer<BusPt>({
      id: 'bus-rings', data: flagged, getPosition: (d) => [d.lon, d.lat], radiusUnits: 'pixels', getRadius: (d) => BAND_RADIUS[d.band] + 5,
      filled: false, stroked: true, getLineColor: (d) => ((d.flags & 1) !== 0 ? [233, 97, 160, 255] : [233, 236, 239, 230]), getLineWidth: 2, lineWidthUnits: 'pixels',
    }),
    new ScatterplotLayer<BusPt>({
      id: 'buses', data: buses, getPosition: (d) => [d.lon, d.lat], radiusUnits: 'pixels', getRadius: (d) => BAND_RADIUS[d.band],
      getFillColor: (d) => (d.state === ST.BROKEN ? [120, 126, 136, 255] : d.state === ST.LAYOVER || d.state === ST.CHARGE ? [...BAND_COLORS[d.band], 150] as [number, number, number, number] : BAND_COLORS[d.band]),
      stroked: true, getLineColor: [13, 15, 18, 255], getLineWidth: 1.5, lineWidthUnits: 'pixels', pickable: true,
      onClick: (info) => { if (info.object) { actions.select(info.object.id); flyTo(info.object.lon, info.object.lat, 13.4); } return true; },
    }),
    new TextLayer<BusPt>({
      id: 'bus-letters', data: buses, getPosition: (d) => [d.lon, d.lat], getText: (d) => (d.state === ST.BROKEN ? 'X' : BAND_LETTER[d.band]),
      getSize: 10.5, getColor: [13, 15, 18, 255], fontFamily: '"IBM Plex Mono", monospace', fontWeight: 700, characterSet: 'ESTCX',
      getTextAnchor: 'middle', getAlignmentBaseline: 'center',
    }),
    new TextLayer<BusPt>({
      id: 'bus-fault', data: faulty, getPosition: (d) => [d.lon, d.lat], getText: () => '!', getSize: 13, getColor: [250, 178, 25, 255],
      fontFamily: '"IBM Plex Mono", monospace', fontWeight: 700, characterSet: '!', getPixelOffset: (d) => [BAND_RADIUS[d.band] + 4, -BAND_RADIUS[d.band] - 2],
      outlineWidth: 3, outlineColor: [13, 15, 18, 255], fontSettings: { sdf: true },
    }),
  ];
  if (zoom >= 12.6) {
    layers.push(new TextLayer<BusPt>({
      id: 'bus-codes', data: buses, getPosition: (d) => [d.lon, d.lat], getText: (d) => d.code, getSize: 10.5, getColor: [233, 236, 239, 235],
      fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, getPixelOffset: (d) => [0, -BAND_RADIUS[d.band] - 9],
      background: true, getBackgroundColor: [13, 15, 18, 200], backgroundPadding: [3, 1, 3, 1], getTextAnchor: 'middle', getAlignmentBaseline: 'center',
    }));
  }
  if (sel) {
    layers.push(new ScatterplotLayer<BusPt>({
      id: 'bus-selected', data: [sel], getPosition: (d) => [d.lon, d.lat], radiusUnits: 'pixels', getRadius: (d) => BAND_RADIUS[d.band] + 9,
      filled: false, stroked: true, getLineColor: [57, 135, 229, 255], getLineWidth: 3, lineWidthUnits: 'pixels',
    }));
  }
  // depot + surge markers
  const labels: { lon: number; lat: number; text: string }[] = [{ lon: net.depot.lon, lat: net.depot.lat, text: `FLEX DEPOT ${s.kpi ? s.kpi[s.arm].poolFree : 0}/${s.ready?.fleet.pool ?? 0}` }];
  if (s.ready && s.ready.surgeStop >= 0 && s.options.scenario === 'surge') {
    const st = net.stops[s.ready.surgeStop];
    labels.push({ lon: st.lon, lat: st.lat, text: 'EVENT SURGE' });
  }
  layers.push(new TextLayer({
    id: 'site-labels', data: labels, getPosition: (d: { lon: number; lat: number }) => [d.lon, d.lat], getText: (d: { text: string }) => d.text, getSize: 10.5,
    getColor: [233, 236, 239, 255], fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, getPixelOffset: [0, 26],
    background: true, getBackgroundColor: [20, 23, 28, 235], backgroundPadding: [5, 2, 5, 2], getBorderColor: [57, 135, 229, 255], getBorderWidth: 1,
    getTextAnchor: 'middle', getAlignmentBaseline: 'center', updateTriggers: { getText: labels.map((l) => l.text).join('|') },
  }));
  return layers;
}

function tooltip(info: { object?: unknown; layer?: { id: string } | null }) {
  if (!info.object || !info.layer) return null;
  const style = { background: '#14171c', color: '#e9ecef', border: '1px solid #2a303a', borderRadius: '4px', font: '12px "IBM Plex Sans", sans-serif', padding: '6px 8px', maxWidth: '260px' };
  if (info.layer.id === 'buses') {
    const b = info.object as BusPt;
    const band = ['Empty', 'Seated', 'Standing', 'Crush'][b.band];
    const extra = [(b.flags & 1) !== 0 ? 'Bunched' : '', (b.flags & 2) !== 0 ? 'Holding' : '', (b.flags & 4) !== 0 ? 'Sensor fault: ticket fallback' : '', b.state === ST.BROKEN ? 'Broken down' : ''].filter(Boolean).join(' · ');
    return { html: `<b style="font-family:'IBM Plex Mono',monospace">${b.code}</b> &nbsp;${band} (about ${Math.round(b.est)} riders)${extra ? `<br><span style="color:#a4abb5">${extra}</span>` : ''}`, style };
  }
  if (info.layer.id === 'stops') {
    const st = info.object as StopPt;
    return { html: `<b>${st.name}</b><br><span style="color:#a4abb5">${st.wait} waiting</span>`, style };
  }
  return null;
}

function frame(): void {
  requestAnimationFrame(frame);
  const host = getMapHost();
  if (!host.ready || !host.overlay) return;
  const s = useStore.getState();
  if (s.view !== 'live' && s.view !== 'forecast') return; // map is hidden behind a full-page view
  const interpolating = live.prev !== null && performance.now() - live.tRecv < live.interval + 30;
  const key = `${live.tRecv}|${s.arm}|${s.selectedBus}|${s.selectedStop}|${live.waitVersion}|${Math.round(mapZoom() * 4)}|${host.kind}|${s.detail?.pattern ?? -1}`;
  if (!interpolating && key === lastKey) return;
  lastKey = key;
  host.overlay.setProps({ layers: buildLayers() as never, getTooltip: tooltip as never, pickingRadius: 6 });
  if (s.follow && s.detail && s.selectedBus >= 0 && performance.now() - lastFollow > 1000) {
    lastFollow = performance.now();
    easeTo(s.detail.lon, s.detail.lat);
  }
}

export function startRenderLoop(): void {
  const w = window as unknown as { __samamLoop?: boolean };
  if (w.__samamLoop) return;
  w.__samamLoop = true;
  const go = () => requestAnimationFrame(frame);
  // make sure the label font is ready before deck.gl builds its glyph atlas
  if (document.fonts?.load) Promise.all([document.fonts.load('700 12px "IBM Plex Mono"'), document.fonts.load('600 12px "IBM Plex Mono"')]).then(go, go);
  else go();
}
