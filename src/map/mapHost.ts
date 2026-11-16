// One map for the whole app. Created once per page load and kept on `window`, so hot reloads and
// view changes never create another Mapbox map (the token is on a usage-limited tier).
// Fallback chain: Mapbox Standard (night, 3D) -> MapLibre + free CARTO dark basemap -> plain dark canvas.
import { MapboxOverlay } from '@deck.gl/mapbox';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useStore } from '../ui/store';

// The two libraries share the methods we use; keep the type loose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMap = any;

export interface MapHost {
  container: HTMLDivElement;
  map: AnyMap;
  overlay: MapboxOverlay;
  kind: 'mapbox' | 'maplibre' | 'plain';
  onReady: (() => void)[];
  ready: boolean;
}

const VIEW = { center: [80.1005, 12.9] as [number, number], zoom: 11.7, pitch: 56, bearing: 28 };
const FALLBACK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const PLAIN_STYLE = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0b0e12' } }] };

type Win = { __samamMap?: MapHost };
const w = window as unknown as Win;

function notice(text: string | null, kind: string): void {
  useStore.setState({ mapNotice: text, mapKind: kind });
}

function attachOverlay(host: MapHost): void {
  host.overlay = new MapboxOverlay({ interleaved: false, layers: [] });
  host.map.addControl(host.overlay);
  host.ready = true;
  for (const fn of host.onReady.splice(0)) fn();
}

async function startMapLibre(host: MapHost, reason: string, plain: boolean): Promise<void> {
  const maplibregl = await import('maplibre-gl');
  await import('maplibre-gl/dist/maplibre-gl.css');
  host.container.innerHTML = '';
  const map = new maplibregl.Map({
    container: host.container, style: (plain ? PLAIN_STYLE : FALLBACK_STYLE) as never, center: VIEW.center, zoom: VIEW.zoom, pitch: VIEW.pitch, bearing: VIEW.bearing,
    maxPitch: 70, minZoom: 8.5, attributionControl: { compact: true },
  });
  host.map = map;
  host.kind = plain ? 'plain' : 'maplibre';
  host.ready = false;
  let loaded = false;
  const toPlain = () => {
    if (loaded || host.kind === 'plain') return;
    host.kind = 'plain';
    map.setStyle(PLAIN_STYLE as never);
    notice(`${reason} The free basemap is also unreachable, so only the network is drawn.`, 'plain');
  };
  map.on('error', () => { if (!loaded) toPlain(); });
  const timer = setTimeout(toPlain, 9000);
  map.on('load', () => {
    loaded = true;
    clearTimeout(timer);
    try {
      const b = (map.getStyle().layers as any[])?.find((l: any) => l['source-layer'] === 'building') as { source?: string } | undefined;
      if (b?.source) {
        map.addLayer({
          id: 'samam-3d-buildings', type: 'fill-extrusion', source: b.source, 'source-layer': 'building', minzoom: 13,
          paint: { 'fill-extrusion-color': '#1c222b', 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 10], 'fill-extrusion-opacity': 0.75 },
        } as never);
      }
    } catch { /* buildings are optional */ }
  });
  attachOverlay(host);
  notice(plain ? `${reason} Showing the network on a plain background.` : `${reason} Showing the free MapLibre basemap instead.`, host.kind);
}

function startMapbox(host: MapHost, token: string): void {
  mapboxgl.accessToken = token;
  let failed = false, loaded = false;
  const fail = (why: string) => {
    if (failed) return;
    failed = true;
    try { host.map.remove(); } catch { /* already gone */ }
    void startMapLibre(host, why, false);
  };
  let map: AnyMap;
  try {
    map = new mapboxgl.Map({
      container: host.container, style: 'mapbox://styles/mapbox/standard',
      config: { basemap: { lightPreset: 'night', showPointOfInterestLabels: false, showTransitLabels: false } },
      center: VIEW.center, zoom: VIEW.zoom, pitch: VIEW.pitch, bearing: VIEW.bearing, maxPitch: 70, minZoom: 8.5, antialias: true,
    } as never);
  } catch (e) {
    void startMapLibre(host, `Mapbox could not start (${(e as Error).message}).`, false);
    return;
  }
  host.map = map;
  host.kind = 'mapbox';
  map.on('error', (e: { error?: { status?: number; message?: string } }) => {
    const st = e.error?.status;
    if (st === 401 || st === 403) fail('The Mapbox token was rejected.');
    else if (st === 429) fail('The Mapbox usage limit has been reached.');
    else if (!loaded && /style|token|unauthor/i.test(e.error?.message ?? '')) fail('The Mapbox style could not be loaded.');
  });
  const timer = setTimeout(() => { if (!loaded) fail('Mapbox did not respond in time.'); }, 12000);
  map.on('load', () => { loaded = true; clearTimeout(timer); });
  attachOverlay(host);
  notice(null, 'mapbox');
}

export function getMapHost(): MapHost {
  if (w.__samamMap) return w.__samamMap;
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;inset:0;';
  const host: MapHost = { container, map: null, overlay: null as unknown as MapboxOverlay, kind: 'plain', onReady: [], ready: false };
  w.__samamMap = host;
  // The container must be in the document before the map is created.
  const parked = document.createElement('div');
  parked.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;visibility:hidden;pointer-events:none;';
  parked.id = 'samam-map-park';
  document.body.appendChild(parked);
  parked.appendChild(container);
  const force = new URLSearchParams(location.search).get('basemap');
  const token = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined)?.trim();
  if (force === 'plain') void startMapLibre(host, 'Basemap switched off by ?basemap=plain.', true);
  else if (force === 'maplibre') void startMapLibre(host, 'Mapbox skipped by ?basemap=maplibre.', false);
  else if (!token) void startMapLibre(host, 'No Mapbox token in .env.', false);
  else startMapbox(host, token);
  return host;
}

/** Move the single map container into the given element (called by the React map view). */
export function mountMap(el: HTMLElement): void {
  const host = getMapHost();
  if (host.container.parentElement !== el) {
    el.appendChild(host.container);
    document.getElementById('samam-map-park')?.remove();
  }
  requestAnimationFrame(() => host.map?.resize());
}

export function flyTo(lon: number, lat: number, zoom = 14.6): void {
  const host = getMapHost();
  if (!host.map) return;
  host.map.flyTo({ center: [lon, lat], zoom: Math.max(host.map.getZoom(), zoom), pitch: 60, speed: 0.9, curve: 1.35, essential: true });
}

export function easeTo(lon: number, lat: number): void {
  const host = getMapHost();
  host.map?.easeTo({ center: [lon, lat], duration: 950, easing: (x: number) => x });
}

export function resetView(): void {
  const host = getMapHost();
  host.map?.flyTo({ ...VIEW, speed: 0.9, curve: 1.35, essential: true });
}

export function mapZoom(): number {
  const host = getMapHost();
  return host.map ? host.map.getZoom() : VIEW.zoom;
}
