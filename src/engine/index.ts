// Engine entry point shared by the browser worker, the tests and the headless scripts.
import type { RunOptions } from './config';
import { generatePassengers, type Passengers } from './demand';
import type { ForecastModel } from './forecast';
import { buildNetwork, type Network, type RawCorridor } from './network';
import { buildFleet, type Fleet } from './schedule';
import { Sim, type SimConfig } from './sim';

export * from './config';
export * from './network';
export * from './sim';
export * from './forecast';
export { generatePassengers, defaultSurgeStop, type Passengers } from './demand';
export { buildFleet, type Fleet, type BusSpec } from './schedule';

export interface World { net: Network; pax: Passengers; fleet: Fleet; opts: RunOptions }

/** Everything that is identical for both arms of a run: network, fleet and the passenger list. */
export function createWorld(raw: RawCorridor | Network, opts: RunOptions): World {
  const net = 'maxStops' in raw ? raw : buildNetwork(raw);
  return { net, pax: generatePassengers(net, opts), fleet: buildFleet(net, opts.reserveShare), opts };
}

export const BASELINE: Omit<SimConfig, 'model'> = { samam: false, mode: 'auto', levers: { hold: false, short: false, flex: false } };
export const SAMAM: Omit<SimConfig, 'model'> = { samam: true, mode: 'auto', levers: { hold: true, short: true, flex: true } };

export function createSim(world: World, cfg: Omit<SimConfig, 'model'>, model: ForecastModel | null): Sim {
  return new Sim(world.net, world.pax, world.fleet, world.opts, { ...cfg, model });
}
