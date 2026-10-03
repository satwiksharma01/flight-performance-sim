/**
 * Specific excess power: the energy view of performance.
 *
 * An aircraft's energy per unit weight is its energy height,
 *
 *   h_e = h + V^2 / (2 g),
 *
 * and full power changes it at
 *
 *   P_s = dh_e/dt = V (T - D) / W.
 *
 * At constant speed P_s is the rate of climb; in level flight it is the rate
 * the aircraft can accelerate, as dV/dt = g P_s / V. Contoured over altitude
 * and speed, P_s = 0 is the edge of the steady flight envelope: the ceiling at
 * the top, maximum speed on the right. At load factor n the drag is the
 * drag of that turn, so the same map shows sustained manoeuvre.
 *
 * Here P_s is the small-angle form: drag at L = nW. It is the textbook
 * quantity, and for a light aircraft it is within 1 % of the exact climb.
 */

import { G0 } from '../constants.js';
import type { AtmosphereState } from '../atmosphere.js';
import { dragAtSpeed, weight, type Aircraft } from '../aero.js';
import { lapseRatio, thrustAvailable } from '../propulsion.js';

/**
 * P_s at full power [m/s]. For a glider, thrust is zero and P_s is minus the
 * power-off sink rate.
 *
 * @param lapse The engine's lapse ratio here; computed when omitted.
 */
export function specificExcessPower(
  aircraft: Aircraft,
  atmosphere: AtmosphereState,
  tas: number,
  loadFactor = 1,
  lapse = aircraft.propulsion ? lapseRatio(aircraft.propulsion, atmosphere) : 0,
): number {
  const thrust = aircraft.propulsion ? thrustAvailable(aircraft.propulsion, tas, lapse) : 0;
  const drag = dragAtSpeed(aircraft, tas, atmosphere.density, loadFactor).total;
  return (tas * (thrust - drag)) / weight(aircraft.mass);
}

/** Energy height h + V^2 / (2 g) [m], from a geometric altitude [m]. */
export function energyHeight(geometricAltitude: number, tas: number): number {
  return geometricAltitude + (tas * tas) / (2 * G0);
}
