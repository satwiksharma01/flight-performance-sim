/**
 * Steady, wings-level climb at full power.
 *
 * The textbook rate of climb, ROC = (P_A - P_R) / W, is a small-angle
 * approximation: it assumes the wing still carries the whole weight. In a
 * climb at angle gamma it carries only W cos(gamma), so induced drag falls and
 * the aircraft climbs a little better. The exact steady climb is
 *
 *   L = W cos(gamma),   T - D - W sin(gamma) = 0,   ROC = V sin(gamma),
 *
 * solved here by fixed-point iteration on sin(gamma). The map's slope is
 * 2 sin(gamma) D_i/W, well under 1, so it converges in a few passes. Both
 * answers are returned, so the difference can be shown rather than assumed:
 * under 1 % for a light aircraft, several percent for a jet climbing steeply.
 *
 * Thrust is taken along the flight path.
 */

import { atPressureAltitude, type AtmosphereState } from '../atmosphere.js';
import { k, stallSpeed, vMinDrag, weight, type Aircraft } from '../aero.js';
import { lapseRatio, thrustAvailable, type Propulsion } from '../propulsion.js';

/** An aircraft that has an engine. */
export type PoweredAircraft = Aircraft & { readonly propulsion: Propulsion };

export function isPowered(aircraft: Aircraft): aircraft is PoweredAircraft {
  return aircraft.propulsion !== undefined;
}

export interface ClimbPoint {
  readonly tas: number;
  /** Thrust available [N] */
  readonly thrust: number;
  /** Climb angle, exact [rad]. Negative: the aircraft can't hold altitude here */
  readonly gamma: number;
  /** Rate of climb, exact [m/s] */
  readonly rateOfClimb: number;
  /** Rate of climb from (P_A - P_R)/W [m/s] */
  readonly rateOfClimbSmallAngle: number;
  /** Fixed-point iterations the exact solution took */
  readonly iterations: number;
}

/** Service ceiling: the altitude where the best rate of climb falls to 100 ft/min. */
export const SERVICE_CEILING_RATE = (100 * 0.3048) / 60;

function dragForLift(aircraft: Aircraft, tas: number, density: number, lift: number): number {
  const q = 0.5 * density * tas * tas;
  const cl = lift / (q * aircraft.wingArea);
  return q * aircraft.wingArea * (aircraft.cd0 + k(aircraft) * cl * cl);
}

const clamp = (x: number) => Math.max(-1, Math.min(1, x));

/** The steady climb at one speed, full power, wings level. */
export function climbAt(
  aircraft: PoweredAircraft,
  atmosphere: AtmosphereState,
  tas: number,
  lapse = lapseRatio(aircraft.propulsion, atmosphere),
): ClimbPoint {
  const w = weight(aircraft.mass);
  const thrust = thrustAvailable(aircraft.propulsion, tas, lapse);
  const smallAngle = (thrust - dragForLift(aircraft, tas, atmosphere.density, w)) / w;

  let sin = clamp(smallAngle);
  let iterations = 0;
  while (iterations < 100) {
    iterations++;
    const cos = Math.sqrt(1 - sin * sin);
    const next = clamp((thrust - dragForLift(aircraft, tas, atmosphere.density, w * cos)) / w);
    const converged = Math.abs(next - sin) < 1e-14;
    sin = next;
    if (converged) break;
  }

  return {
    tas,
    thrust,
    gamma: Math.asin(sin),
    rateOfClimb: tas * sin,
    rateOfClimbSmallAngle: tas * smallAngle,
    iterations,
  };
}

const GOLDEN = (Math.sqrt(5) - 1) / 2;

/** Golden-section search for the maximum of a unimodal function on [a, b]. */
function maximise(f: (x: number) => number, a: number, b: number): number {
  let x1 = b - GOLDEN * (b - a);
  let x2 = a + GOLDEN * (b - a);
  let f1 = f(x1);
  let f2 = f(x2);
  for (let i = 0; i < 200 && b - a > 1e-10 * b; i++) {
    if (f1 < f2) {
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

/** Bisection for a root of f on [a, b], where f(a) and f(b) differ in sign. */
function bisect(f: (x: number) => number, a: number, b: number, tolerance: number): number {
  let fa = f(a);
  for (let i = 0; i < 200 && b - a > tolerance; i++) {
    const mid = 0.5 * (a + b);
    const fm = f(mid);
    if (fm === 0) return mid;
    if (fm > 0 === fa > 0) {
      a = mid;
      fa = fm;
    } else {
      b = mid;
    }
  }
  return 0.5 * (a + b);
}

export interface ClimbPerformance {
  /** Best rate of climb */
  readonly vy: ClimbPoint;
  /** Best angle of climb */
  readonly vx: ClimbPoint;
  /** Fastest speed at which level flight is possible at full power, or null if none is */
  readonly maxLevelSpeed: number | null;
  /** Stall speed at this weight [m/s]: the slowest speed searched */
  readonly stallSpeed: number;
}

/**
 * Best rate and angle of climb, and maximum level speed, at full power.
 *
 * V_y and V_x have no closed form with a propeller, so they are found by
 * golden-section search between the stall and 8 V_md, comfortably past V_max
 * for any subsonic aircraft. Both functions are unimodal there. Each is
 * clamped to the stall: if the optimum lies below it, the stall is the best
 * the wing allows.
 */
export function climbPerformance(aircraft: PoweredAircraft, atmosphere: AtmosphereState): ClimbPerformance {
  const lapse = lapseRatio(aircraft.propulsion, atmosphere);
  const vs = stallSpeed(aircraft, atmosphere.density);
  const top = 8 * Math.max(vMinDrag(aircraft, atmosphere.density), vs);

  const at = (v: number) => climbAt(aircraft, atmosphere, v, lapse);
  const vy = bestRateOfClimb(aircraft, atmosphere);
  const vx = at(maximise((v) => at(v).gamma, vs, top));

  // Level flight is possible wherever thrust covers level drag. The fastest
  // such speed is the root above V_x, where T - D is largest.
  const excess = (v: number) => thrustAvailable(aircraft.propulsion, v, lapse) - dragForLift(aircraft, v, atmosphere.density, weight(aircraft.mass));
  const vMaxExcess = maximise(excess, vs, top);
  const maxLevelSpeed =
    excess(vMaxExcess) < 0 ? null : excess(top) >= 0 ? top : bisect(excess, vMaxExcess, top, 1e-9 * top);

  return { vy, vx, maxLevelSpeed, stallSpeed: vs };
}

export interface Ceilings {
  /** Pressure altitude where the best rate of climb reaches zero [m], or null */
  readonly absolute: number | null;
  /** Pressure altitude where it reaches 100 ft/min [m], or null */
  readonly service: number | null;
}

/**
 * Best rate of climb here [m/s]: V_y alone, without V_x or V_max. The cheap
 * path for sweeps through altitude and for ceilings.
 */
export function bestRateOfClimb(aircraft: PoweredAircraft, atmosphere: AtmosphereState): ClimbPoint {
  const lapse = lapseRatio(aircraft.propulsion, atmosphere);
  const vs = stallSpeed(aircraft, atmosphere.density);
  const top = 8 * Math.max(vMinDrag(aircraft, atmosphere.density), vs);
  const at = (v: number) => climbAt(aircraft, atmosphere, v, lapse);
  return at(maximise((v) => at(v).rateOfClimb, vs, top));
}

/** Best rate of climb at a pressure altitude [m/s], at this ISA deviation. */
export function maxRateOfClimb(aircraft: PoweredAircraft, pressureAltitude: number, deltaISA = 0): number {
  return bestRateOfClimb(aircraft, atPressureAltitude(pressureAltitude, deltaISA)).rateOfClimb;
}

/** Search band for ceilings: from below sea level to 30 km [m, pressure altitude]. */
const CEILING_SEARCH = { low: -1000, high: 30000 } as const;

/**
 * Absolute and service ceilings at this ISA deviation.
 *
 * The best rate of climb falls monotonically with altitude for every engine
 * model here, so each ceiling is a single root, found by bisection to a
 * centimetre. Null when the aircraft can't reach the rate even at the bottom of
 * the search band, or still exceeds it at 30 km.
 */
export function ceilings(aircraft: PoweredAircraft, deltaISA = 0): Ceilings {
  const find = (rate: number): number | null => {
    const f = (h: number) => maxRateOfClimb(aircraft, h, deltaISA) - rate;
    if (f(CEILING_SEARCH.low) <= 0 || f(CEILING_SEARCH.high) > 0) return null;
    return bisect(f, CEILING_SEARCH.low, CEILING_SEARCH.high, 0.01);
  };
  return { absolute: find(0), service: find(SERVICE_CEILING_RATE) };
}
