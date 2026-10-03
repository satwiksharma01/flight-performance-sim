/**
 * Steady glide, power off.
 *
 * With no thrust, drag is balanced by the weight component along the path, and
 * the glide angle follows from the polar alone: tan(gamma) = CD / CL, exactly,
 * whatever the weight or altitude. Weight and density only set the speed:
 *
 *   V = sqrt(2 W cos(gamma) / (rho S CL)),   sink = V sin(gamma).
 *
 * Two speeds matter, and they are different:
 * - best glide, at CL_md: the flattest path, the farthest from a given height
 * - minimum sink, near CL_mp: the slowest descent, the longest time aloft
 *
 * Into a headwind the best-glide speed rises: you lose less ground distance by
 * flying faster through the moving air.
 */

import type { AtmosphereState } from '../atmosphere.js';
import { clMinDrag, k, weight, type Aircraft } from '../aero.js';

export interface GlidePoint {
  readonly cl: number;
  readonly tas: number;
  /** Glide angle below the horizon [rad], positive */
  readonly gamma: number;
  /** Distance through the air per unit height lost: CL/CD [-] */
  readonly glideRatio: number;
  /** Rate of descent [m/s], positive */
  readonly sinkRate: number;
}

/** The steady glide at one lift coefficient. */
export function glideAtCl(aircraft: Aircraft, atmosphere: AtmosphereState, cl: number): GlidePoint {
  const cd = aircraft.cd0 + k(aircraft) * cl * cl;
  const gamma = Math.atan(cd / cl);
  const tas = Math.sqrt((2 * weight(aircraft.mass) * Math.cos(gamma)) / (atmosphere.density * aircraft.wingArea * cl));
  return { cl, tas, gamma, glideRatio: cl / cd, sinkRate: tas * Math.sin(gamma) };
}

/**
 * The steady glide at one airspeed: power off, so sin(gamma) = D / W with the
 * wing carrying W cos(gamma). Solved by the same fixed-point iteration as the
 * climb. Plotted against speed, the sink rate is the glider's polar.
 */
export function glideAtSpeed(aircraft: Aircraft, atmosphere: AtmosphereState, tas: number): GlidePoint {
  const w = weight(aircraft.mass);
  const q = 0.5 * atmosphere.density * tas * tas;
  const kFactor = k(aircraft);
  let sin = 0;
  let cl = 0;
  for (let i = 0; i < 100; i++) {
    cl = (w * Math.sqrt(1 - sin * sin)) / (q * aircraft.wingArea);
    const next = Math.min(1, (q * aircraft.wingArea * (aircraft.cd0 + kFactor * cl * cl)) / w);
    const converged = Math.abs(next - sin) < 1e-14;
    sin = next;
    if (converged) break;
  }
  const gamma = Math.asin(sin);
  return { cl, tas, gamma, glideRatio: 1 / Math.tan(gamma), sinkRate: tas * sin };
}

const GOLDEN = (Math.sqrt(5) - 1) / 2;

/** Golden-section search for the minimum of a unimodal function on [a, b]. */
function minimise(f: (x: number) => number, a: number, b: number): number {
  let x1 = b - GOLDEN * (b - a);
  let x2 = a + GOLDEN * (b - a);
  let f1 = f(x1);
  let f2 = f(x2);
  for (let i = 0; i < 200 && b - a > 1e-12; i++) {
    if (f1 > f2) {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + GOLDEN * (b - a);
      f2 = f(x2);
    } else {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - GOLDEN * (b - a);
      f1 = f(x1);
    }
  }
  return 0.5 * (a + b);
}

export interface Glide extends GlidePoint {
  /** The optimum lies above CLmax, so this is the stall instead */
  readonly limitedByStall: boolean;
}

/** Best glide: the flattest glide, at CL_md (or CLmax, if CL_md is beyond it). */
export function bestGlide(aircraft: Aircraft, atmosphere: AtmosphereState): Glide {
  const cl = clMinDrag(aircraft);
  const limitedByStall = cl > aircraft.clMax;
  return { ...glideAtCl(aircraft, atmosphere, limitedByStall ? aircraft.clMax : cl), limitedByStall };
}

/**
 * Minimum sink: the slowest descent.
 *
 * Near CL_mp = sqrt(3 CD0 / k) but not exactly there, since cos(gamma) enters
 * the speed. Found numerically on (0, CLmax]; if the optimum is the stall, it
 * says so.
 */
export function minimumSink(aircraft: Aircraft, atmosphere: AtmosphereState): Glide {
  const cl = minimise((c) => glideAtCl(aircraft, atmosphere, c).sinkRate, 1e-3, aircraft.clMax);
  return { ...glideAtCl(aircraft, atmosphere, cl), limitedByStall: aircraft.clMax - cl < 1e-6 };
}

/**
 * The best glide into a headwind (negative: tailwind) [m/s].
 *
 * Maximises ground distance per height, (V cos(gamma) - wind) / sink. Returns
 * the glide and its ratio over the ground; null if the wind is too strong for
 * any forward progress.
 */
export function bestGlideInWind(
  aircraft: Aircraft,
  atmosphere: AtmosphereState,
  headwind: number,
): { readonly glide: Glide; readonly groundRatio: number } | null {
  const ground = (c: number) => {
    const g = glideAtCl(aircraft, atmosphere, c);
    return (g.tas * Math.cos(g.gamma) - headwind) / g.sinkRate;
  };
  const cl = minimise((c) => -ground(c), 1e-3, aircraft.clMax);
  const ratio = ground(cl);
  if (!(ratio > 0)) return null;
  return {
    glide: { ...glideAtCl(aircraft, atmosphere, cl), limitedByStall: aircraft.clMax - cl < 1e-6 },
    groundRatio: ratio,
  };
}
