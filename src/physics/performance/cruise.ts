/**
 * Level flight at a set power: cruise as a POH tabulates it.
 *
 * The setting is a fraction of the engine's sea-level rating, as the POH's
 * "% MCP" is: 75 % is 135 hp of the 172's 180, at whatever altitude the pilot
 * sets it. A propeller turns it into thrust power at the cruise efficiency,
 * eta P = D V; a jet's setting is thrust, T = D. Of the two speeds that
 * balance, cruise is the faster: the slower lies on the back of the power
 * curve, where speed is unstable.
 *
 * The full-throttle thrust line in propulsion.ts is not used here. Fitted to
 * the climb at 74 KIAS, it describes a fixed-pitch propeller holding the
 * engine below its rated RPM; at a set cruise power the engine gives what is
 * set, and the propeller runs near its design point.
 *
 * Whether the engine can give the setting at this altitude is the caller's
 * question: compare it with lapseRatio.
 */

import type { AtmosphereState } from '../atmosphere.js';
import { dragAtSpeed, stallSpeed, vMinDrag, vMinPower } from '../aero.js';
import type { PoweredAircraft } from './climb.js';
import { CRUISE_PROPELLER_EFFICIENCY } from './range.js';

/**
 * True airspeed [m/s] in level flight with the engine at `setting` of its
 * sea-level rating, or null if that setting can't hold level flight above the
 * stall.
 */
export function cruiseSpeed(aircraft: PoweredAircraft, atmosphere: AtmosphereState, setting: number): number | null {
  const engine = aircraft.propulsion;
  const { density } = atmosphere;
  const thrust =
    engine.kind === 'turbofan'
      ? () => setting * engine.thrust
      : (v: number) => (CRUISE_PROPELLER_EFFICIENCY * setting * engine.power) / v;
  const excess = (v: number) => thrust(v) - dragAtSpeed(aircraft, v, density).total;

  // Excess thrust peaks at V_md for a jet; for a propeller, excess power peaks at V_mp.
  let low = engine.kind === 'turbofan' ? vMinDrag(aircraft, density) : vMinPower(aircraft, density);
  if (!(setting > 0) || excess(low) <= 0) return null;
  let high = 2 * low;
  for (let i = 0; i < 60 && excess(high) > 0; i++) high *= 2;
  for (let i = 0; i < 200 && high - low > 1e-10 * high; i++) {
    const mid = 0.5 * (low + high);
    if (excess(mid) > 0) low = mid;
    else high = mid;
  }
  const tas = 0.5 * (low + high);
  return tas >= stallSpeed(aircraft, density) ? tas : null;
}
