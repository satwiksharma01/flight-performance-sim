/**
 * Aerodynamics: the parabolic drag polar and its closed-form optima.
 *
 * Model: CD = CD0 + k*CL^2, with k = 1/(pi*e*AR).
 *
 * Every characteristic speed below has an exact analytic solution. Scanning a
 * sampled curve for its minimum would be slower, less accurate, and dependent
 * on sample spacing — and it would hide the fact that these speeds are fixed
 * ratios of one another, which is one of the more elegant results in the
 * subject.
 */

import { G0 } from './constants.js';

export interface Aircraft {
  readonly name: string;
  /** Mass [kg] */
  readonly mass: number;
  /** Reference wing area [m^2] */
  readonly wingArea: number;
  /** Aspect ratio b^2/S [-] */
  readonly aspectRatio: number;
  /** Oswald span efficiency factor [-] */
  readonly oswaldEfficiency: number;
  /** Zero-lift drag coefficient [-] */
  readonly cd0: number;
  /** Maximum lift coefficient, clean [-] */
  readonly clMax: number;
  /** Maximum lift coefficient, full flap [-] */
  readonly clMaxFlaps?: number;
}

/** Weight [N]. */
export function weight(mass: number): number {
  return mass * G0;
}

/** Wing loading W/S [N/m^2]. */
export function wingLoading(aircraft: Aircraft): number {
  return weight(aircraft.mass) / aircraft.wingArea;
}

/**
 * Induced drag factor k = 1/(pi*e*AR).
 *
 * A high aspect ratio and a clean span loading both shrink k, which is why
 * gliders look the way they do.
 */
export function inducedDragFactor(aspectRatio: number, oswaldEfficiency: number): number {
  if (aspectRatio <= 0) throw new RangeError('Aspect ratio must be greater than zero');
  if (oswaldEfficiency <= 0 || oswaldEfficiency > 1) {
    throw new RangeError('Oswald efficiency must lie in (0, 1]');
  }
  return 1 / (Math.PI * oswaldEfficiency * aspectRatio);
}

export function k(aircraft: Aircraft): number {
  return inducedDragFactor(aircraft.aspectRatio, aircraft.oswaldEfficiency);
}

/** Lift coefficient required for steady level flight at this speed. */
export function clRequired(
  aircraft: Aircraft,
  tas: number,
  density: number,
  loadFactor = 1,
): number {
  return (
    (2 * loadFactor * weight(aircraft.mass)) / (density * tas * tas * aircraft.wingArea)
  );
}

/** Drag coefficient from the polar. */
export function cdFromCl(cl: number, cd0: number, kFactor: number): number {
  return cd0 + kFactor * cl * cl;
}

/** Lift [N]. */
export function lift(cl: number, tas: number, density: number, wingArea: number): number {
  return 0.5 * density * tas * tas * wingArea * cl;
}

export interface DragBreakdown {
  /** Parasite (zero-lift) drag [N] — grows as V^2 */
  readonly parasite: number;
  /** Induced (lift-dependent) drag [N] — falls as 1/V^2 */
  readonly induced: number;
  /** Total drag [N] */
  readonly total: number;
  readonly cl: number;
  readonly cd: number;
  readonly liftToDrag: number;
}

/**
 * Drag in steady level flight, split into its two components.
 *
 * Returning the split rather than just the total is deliberate: the U-shaped
 * drag curve is only illuminating once you can see the two terms crossing, and
 * they cross exactly at the minimum-drag speed.
 */
export function dragAtSpeed(
  aircraft: Aircraft,
  tas: number,
  density: number,
  loadFactor = 1,
): DragBreakdown {
  if (tas <= 0) throw new RangeError('True airspeed must be greater than zero');

  const q = 0.5 * density * tas * tas;
  const cl = clRequired(aircraft, tas, density, loadFactor);
  const kFactor = k(aircraft);
  const cd = cdFromCl(cl, aircraft.cd0, kFactor);

  const parasite = q * aircraft.wingArea * aircraft.cd0;
  const induced = q * aircraft.wingArea * kFactor * cl * cl;

  return {
    parasite,
    induced,
    total: parasite + induced,
    cl,
    cd,
    liftToDrag: cl / cd,
  };
}

/**
 * Stall speed in TAS [m/s].
 *
 * Note the density dependence: in EAS this value is a constant, which is why
 * the stall speeds in a pilot's operating handbook need no altitude correction.
 */
export function stallSpeed(
  aircraft: Aircraft,
  density: number,
  loadFactor = 1,
  clMax = aircraft.clMax,
): number {
  if (clMax <= 0) throw new RangeError('CLmax must be greater than zero for a stall speed');
  if (loadFactor < 0) throw new RangeError('Load factor must not be negative');
  return Math.sqrt(
    (2 * loadFactor * weight(aircraft.mass)) / (density * aircraft.wingArea * clMax)
  );
}

// --- Closed-form optima ---------------------------------------------------

/** CL at minimum drag: CL_md = sqrt(CD0/k). Setting d(CD/CL)/dCL = 0. */
export function clMinDrag(aircraft: Aircraft): number {
  return Math.sqrt(aircraft.cd0 / k(aircraft));
}

/**
 * Maximum lift-to-drag ratio: (L/D)max = 1/(2*sqrt(CD0*k)).
 *
 * Depends only on the polar — not on weight, altitude or wing area. The *speed*
 * at which it occurs depends on all three, but the ratio itself does not.
 */
export function maxLiftToDrag(aircraft: Aircraft): number {
  return 1 / (2 * Math.sqrt(aircraft.cd0 * k(aircraft)));
}

/** Minimum drag [N], = W/(L/D)max. At this point parasite drag equals induced drag. */
export function minimumDrag(aircraft: Aircraft): number {
  return 2 * weight(aircraft.mass) * Math.sqrt(aircraft.cd0 * k(aircraft));
}

/**
 * Minimum-drag speed V_md [m/s].
 *
 * Also the max-L/D speed, the best glide speed, and the propeller best-range
 * speed — all the same condition seen from different directions.
 */
export function vMinDrag(aircraft: Aircraft, density: number): number {
  return Math.sqrt(
    (2 * weight(aircraft.mass)) / (density * aircraft.wingArea)
  ) * Math.pow(k(aircraft) / aircraft.cd0, 0.25);
}

/**
 * Minimum-power speed V_mp = V_md / 3^(1/4) ~= 0.760 * V_md.
 *
 * Minimises D*V rather than D. This is the minimum-sink glide speed and the
 * propeller best-endurance speed. It maximises CL^(3/2)/CD.
 */
export function vMinPower(aircraft: Aircraft, density: number): number {
  return vMinDrag(aircraft, density) / Math.pow(3, 0.25);
}

/**
 * Jet best-range speed V_jr = V_md * 3^(1/4) ~= 1.316 * V_md.
 *
 * Maximises CL^(1/2)/CD. A jet's best range is therefore *faster* than its best
 * L/D, while a propeller aircraft's is exactly at best L/D — the single most
 * counter-intuitive result in cruise performance, and worth showing as three
 * markers on one drag curve.
 */
export function vJetRange(aircraft: Aircraft, density: number): number {
  return vMinDrag(aircraft, density) * Math.pow(3, 0.25);
}

/** Maximum of CL^(3/2)/CD — the propeller endurance parameter. */
export function maxClThreeHalvesOverCd(aircraft: Aircraft): number {
  const kf = k(aircraft);
  const cl = Math.sqrt((3 * aircraft.cd0) / kf);
  return Math.pow(cl, 1.5) / cdFromCl(cl, aircraft.cd0, kf);
}

/** Maximum of CL^(1/2)/CD — the jet range parameter. */
export function maxClHalfOverCd(aircraft: Aircraft): number {
  const kf = k(aircraft);
  const cl = Math.sqrt(aircraft.cd0 / (3 * kf));
  return Math.sqrt(cl) / cdFromCl(cl, aircraft.cd0, kf);
}

/** Validate an aircraft definition, returning human-readable problems. */
export function validateAircraft(aircraft: Aircraft): string[] {
  const problems: string[] = [];
  if (aircraft.mass <= 0) problems.push('Mass must be greater than zero.');
  if (aircraft.wingArea <= 0) problems.push('Wing area must be greater than zero.');
  if (aircraft.aspectRatio <= 0) problems.push('Aspect ratio must be greater than zero.');
  if (aircraft.oswaldEfficiency <= 0 || aircraft.oswaldEfficiency > 1) {
    problems.push('Oswald efficiency must lie between 0 and 1.');
  }
  if (aircraft.cd0 <= 0) problems.push('CD0 must be greater than zero.');
  if (aircraft.clMax <= 0) problems.push('CLmax must be greater than zero.');
  return problems;
}
