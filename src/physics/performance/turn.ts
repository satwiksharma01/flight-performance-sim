/**
 * Level turn performance.
 *
 * In a level turn the lift vector tilts by the bank angle phi, and its vertical
 * part still has to carry the weight, so the load factor is n = 1/cos(phi). The
 * horizontal part, W*sqrt(n^2 - 1), is the centripetal force.
 */

import { G0 } from '../constants.js';
import { k, weight, type Aircraft } from '../aero.js';

/** Load factor for a level turn at a bank angle [rad]. */
export function loadFactorForBank(bank: number): number {
  if (!(bank >= 0 && bank < Math.PI / 2)) {
    throw new RangeError(`Bank angle must lie in [0, 90°), received ${bank} rad`);
  }
  return 1 / Math.cos(bank);
}

/** Bank angle [rad] for a level turn at load factor n >= 1. */
export function bankForLoadFactor(loadFactor: number): number {
  if (!(loadFactor >= 1)) throw new RangeError(`A level turn needs n >= 1, received ${loadFactor}`);
  return Math.acos(1 / loadFactor);
}

/** Turn radius [m]: R = V^2 / (g sqrt(n^2 - 1)). Infinite at n = 1. */
export function turnRadius(tas: number, loadFactor: number): number {
  return (tas * tas) / (G0 * Math.sqrt(loadFactor * loadFactor - 1));
}

/** Turn rate [rad/s]: omega = g sqrt(n^2 - 1) / V. Zero at n = 1. */
export function turnRate(tas: number, loadFactor: number): number {
  return (G0 * Math.sqrt(loadFactor * loadFactor - 1)) / tas;
}

/**
 * Load factor the wing can reach at this speed [-]: n = q S CL_max / W, the
 * aerodynamic limit on an instantaneous turn. Below 1 the aircraft can't hold
 * level flight here.
 */
export function liftLimitedLoadFactor(aircraft: Aircraft, density: number, tas: number, clMax = aircraft.clMax): number {
  return (0.5 * density * tas * tas * aircraft.wingArea * clMax) / weight(aircraft.mass);
}

/**
 * Highest load factor thrust can sustain at this speed [-]: where drag at load
 * factor n equals the thrust,
 *
 *   n = sqrt((T - q S CD0) q S / k) / W,
 *
 * Null when thrust can't even cover the zero-lift drag. Not capped by the wing
 * or the structure; {@link turnLimits} applies those.
 */
export function sustainedLoadFactor(aircraft: Aircraft, density: number, tas: number, thrust: number): number | null {
  const qs = 0.5 * density * tas * tas * aircraft.wingArea;
  const excess = thrust - qs * aircraft.cd0;
  if (excess <= 0) return null;
  return Math.sqrt((excess * qs) / k(aircraft)) / weight(aircraft.mass);
}

export interface TurnLimits {
  /** Instantaneous: the lesser of the wing's and the structure's limit [-] */
  readonly instantaneous: number;
  /** Sustained at full power, capped the same way [-]. Null when thrust can't hold even 1 g */
  readonly sustained: number | null;
  /** Turn rates at each [rad/s]; zero where n <= 1 */
  readonly instantaneousRate: number;
  readonly sustainedRate: number | null;
}

/**
 * Instantaneous and sustained turn at one speed: the two boundaries of the
 * "doghouse" plot. The instantaneous limit peaks at the corner speed, where
 * the stall meets the structural limit.
 *
 * @param thrust     Full-power thrust here [N], or null for a glider
 * @param nStructure Positive limit load factor, or Infinity when unknown
 */
export function turnLimits(
  aircraft: Aircraft,
  density: number,
  tas: number,
  thrust: number | null,
  nStructure: number,
): TurnLimits {
  const wing = liftLimitedLoadFactor(aircraft, density, tas);
  const instantaneous = Math.min(wing, nStructure);
  const raw = thrust === null ? null : sustainedLoadFactor(aircraft, density, tas, thrust);
  const sustained = raw === null || raw < 1 ? null : Math.min(raw, instantaneous);
  const rate = (n: number) => (n > 1 ? turnRate(tas, n) : 0);
  return {
    instantaneous,
    sustained,
    instantaneousRate: rate(instantaneous),
    sustainedRate: sustained === null ? null : rate(sustained),
  };
}

/** Corner speed [m/s TAS]: where the stall curve reaches the structural limit, V_s sqrt(n_max). */
export function cornerSpeed(aircraft: Aircraft, density: number, nStructure: number): number {
  return Math.sqrt((2 * nStructure * weight(aircraft.mass)) / (density * aircraft.wingArea * aircraft.clMax));
}
