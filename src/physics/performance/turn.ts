/**
 * Level turn performance.
 *
 * In a level turn the lift vector tilts by the bank angle phi, and its vertical
 * part still has to carry the weight, so the load factor is n = 1/cos(phi). The
 * horizontal part, W*sqrt(n^2 - 1), is the centripetal force.
 */

import { G0 } from '../constants.js';

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
