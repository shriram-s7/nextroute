// Minimal RFC-4180 CSV reader (handles quoted fields, embedded commas/quotes, CRLF).
import { readFileSync } from 'node:fs';

export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** Read a CSV file into an array of objects keyed by header. */
export function readCsv(path) {
  const rows = parseCsv(readFileSync(path, 'utf8'));
  const header = rows[0].map((h) => h.trim());
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 1 && r[0] === '') continue;
    const o = {};
    for (let j = 0; j < header.length; j++) o[header[j]] = r[j] ?? '';
    out.push(o);
  }
  return out;
}

/** GTFS HH:MM:SS (may exceed 24h) -> seconds, or NaN. */
export function gtfsTime(s) {
  const m = /^(\d+):(\d\d):(\d\d)$/.exec((s || '').trim());
  if (!m) return NaN;
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
