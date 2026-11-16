// Calibration constants, model parameters and scenario definitions.
// Every number here is an assumption of the simulation and is listed on the Methods page.
import { DAY_START, DAY_END } from './network';

/** Cited calibration constants (see Methods page for sources). */
export const CAL = {
  dailyPassengers: 3_500_000, // MTC passengers per day (World Bank blog)
  fleet: 4206, // MTC fleet (Urban Acres, Oct 2026)
  electricFleet: 755, // of which electric
};

export const BUS_TYPES = {
  diesel: { seats: 40, cap: 80 },
  electric: { seats: 35, cap: 70 },
};

/** Forecast / statistics time bin. */
export const BIN = 600;
export const N_BINS = (DAY_END - DAY_START) / BIN;
export const binOf = (t: number): number => Math.max(0, Math.min(N_BINS - 1, Math.floor((t - DAY_START) / BIN)));

/** Crowding bands: 0 empty, 1 seated, 2 standing, 3 crush. */
export const BAND_NAMES = ['Empty', 'Seated', 'Standing', 'Crush'] as const;
export function bandOf(load: number, seats: number, cap: number): number {
  if (load <= 0.3 * seats) return 0;
  if (load <= seats) return 1;
  if (load <= 0.85 * cap) return 2;
  return 3;
}

// ---- demand ----
export const DEMAND = {
  stopWeightExp: 0.8, // stop attractiveness = (trips/day calling at the stop in the whole feed) ^ exp
  decayM: 12_000, // trip-length decay scale (m)
  shortTripM: 700, // trips shorter than this are heavily discounted
  shortTripFactor: 0.15,
  ticketShare: 0.94, // share of boardings that produce an ETM ticket record
};

const gauss = (h: number, mu: number, sd: number) => Math.exp(-0.5 * ((h - mu) / sd) ** 2);

/** Relative passenger arrival rate at time t (s) for a pattern heading towards (inbound) or away from the centre. */
export function demandWeight(t: number, inbound: boolean): number {
  const h = t / 3600;
  const up = Math.max(0, Math.min(1, (h - 4.5) / 2));
  const down = Math.max(0, Math.min(1, (23.2 - h) / 2.2));
  const am = inbound ? 1.25 : 0.85;
  const pm = inbound ? 0.85 : 1.25;
  return up * down * (0.32 + am * gauss(h, 8.9, 1.15) + pm * gauss(h, 18.2, 1.5));
}

// ---- traffic ----
export const TRAFFIC = {
  cruiseShare: 0.8, // share of the GTFS scheduled run time that is moving time in free-flow daytime traffic
  fieldSigma: 0.12, // log-sd of the road/time traffic field (15-min buckets, shared by all buses on a road link)
  driverSigma: 0.06, // log-sd of per-bus, per-link variation
  fieldBucket: 900,
};

/** Travel-time multiplier by time of day (1 = free-flow daytime). */
export function congestion(t: number): number {
  const h = t / 3600;
  const night = h < 6 || h > 21.5 ? -0.08 : 0;
  return 1 + night + 0.28 * gauss(h, 9.2, 1.1) + 0.36 * gauss(h, 18.5, 1.4);
}

// ---- dwell ----
export const DWELL = {
  base: 5, // s, doors open/close when anyone boards or alights
  perBoard: 1.9, // s per boarding passenger
  perAlight: 1.0, // s per alighting passenger
  crowdGain: 0.6, // extra boarding time when the bus is beyond 60% of capacity
  minTurn: 120, // s minimum turnaround at a terminus
  preBoard: 45, // s before scheduled departure that doors open at the terminus
};

// ---- electric buses ----
export const EV = {
  batteryKwh: 230,
  kwhPerKm: 1.0,
  loadGain: 0.25, // extra consumption at full load
  auxKw: 3, // air-conditioning and auxiliaries while out of the depot
  chargeKw: 180,
  planKm: 140, // schedule plans a charging break before this many km since the last charge
  planBreak: 45 * 60,
  forceSoc: 0.15, // below this at a terminus the bus must charge
  resumeSoc: 0.5,
  fullSoc: 0.92,
  flexReserveSoc: 0.2, // Samam will not send an electric flex bus that would finish below this
};

// ---- sensors ----
export const SENSOR = {
  doorErr: 0.05, // sd of count error per boarding/alighting event batch, as a share of the batch
  doorCrushErr: 0.14, // additional error share when the bus is beyond 85% of capacity
  doorCrushMiss: 0.08, // share of boardings missed at crush load
  cctvBiasSd: 0.04, // per-bus calibration bias
  cctvSd0: 1.5,
  cctvSdLoad: 0.05,
  cctvCrushSd: 0.1,
  cctvCrushUnder: 0.12, // undercount at full crush (occlusion)
  ticketNoise: 0.04,
  baseFailShare: 0.02, // share of buses whose counter fails at some point on a normal day
};

// ---- Samam controller ----
export const CTRL = {
  cycle: 300, // s between forecast + dispatch decisions
  holdMax: 120, // s per stop
  holdMin: 20,
  holdEvery: 4, // every n-th stop is a holding point
  holdGain: 0.35, // share of the headway imbalance corrected at one stop
  holdTrigger: 90, // s of imbalance before a hold is considered
  holdMinBenefit: 120, // passenger-seconds of net predicted benefit needed to issue a hold
  onboardWeight: 0.5, // value of a second of delay on board relative to a second of waiting
  comfortShare: 0.7, // forecast load above this share of capacity counts as overcrowded
  flexMinScore: 6, // overcrowded passengers relieved per bus-km needed to justify an extra trip
  flexPerCycle: 2,
  flexCooldown: 600, // s before another extra trip is considered on the same pattern
  recTtl: 300, // s a short-turn / flex recommendation stays open in manual mode
  baselineCoverDelay: 45 * 60, // s a fixed-schedule operator takes to replace a broken-down bus (assumption)
  poolTurn: 180, // s before a returned pool bus is available again
};

export const DEFAULT_RESERVE = 0.08;

// ---- scenarios ----
export type ScenarioId = 'normal' | 'rain' | 'surge' | 'sensors' | 'breakdown';

export interface Scenario {
  id: ScenarioId;
  name: string;
  blurb: string;
  rain?: { from: number; to: number; timeMult: number; dwellMult: number; demandMult: number; energyMult: number; extraSigma: number };
  surge?: { t: number; dur: number; pax: number };
  sensorFailShare?: number;
  breakdowns?: number[]; // times (s) at which one in-service bus breaks down
}

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  normal: { id: 'normal', name: 'Normal weekday', blurb: 'Typical weekday demand and traffic.' },
  rain: {
    id: 'rain', name: 'Heavy rain evening',
    blurb: 'Rain from 16:30 to 21:00: slower traffic, longer dwells, more riders.',
    rain: { from: 16.5 * 3600, to: 21 * 3600, timeMult: 1.35, dwellMult: 1.25, demandMult: 1.15, energyMult: 1.1, extraSigma: 0.06 },
  },
  surge: {
    id: 'surge', name: 'Event surge',
    blurb: 'A crowd of 2,500 leaves an event at one stop over 45 minutes.',
    surge: { t: 18 * 3600, dur: 45 * 60, pax: 2500 },
  },
  sensors: {
    id: 'sensors', name: '20% sensors failing',
    blurb: 'One in five buses has a dead or blocked passenger counter during the day.',
    sensorFailShare: 0.2,
  },
  breakdown: {
    id: 'breakdown', name: 'Bus breakdown',
    blurb: 'A bus breaks down in each peak (08:45 and 17:45).',
    breakdowns: [8.75 * 3600, 17.75 * 3600],
  },
};

export interface RunOptions {
  seed: number;
  scenario: ScenarioId;
  reserveShare: number;
  demandScale: number;
  surgeStop?: number; // global stop index; default = start of the busiest segment
  surgeTime?: number;
}

export const DEFAULT_OPTIONS: RunOptions = { seed: 2026, scenario: 'normal', reserveShare: DEFAULT_RESERVE, demandScale: 1 };

export function rainAt(sc: Scenario, t: number): number {
  if (!sc.rain) return 0;
  const { from, to } = sc.rain;
  if (t < from - 900 || t > to + 900) return 0;
  // 15-minute ramps in and out
  return Math.max(0, Math.min(1, (t - (from - 900)) / 900, (to + 900 - t) / 900));
}
