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
import type { Propulsion } from './propulsion.js';
import type { StructuralLimits } from './performance/vn.js';

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
  /** Maximum lift coefficient, takeoff flap [-]. Absent: takeoff is flown clean */
  readonly clMaxTakeoff?: number;
  /** The engine, or absent for a glider */
  readonly propulsion?: Propulsion;
  /** Limit load factors and design speeds, for the V-n diagram. Absent: none drawn */
  readonly structure?: StructuralLimits;
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

type LimitedField = keyof Omit<Aircraft, 'name' | 'propulsion' | 'structure'>;

/**
 * Supported parameter ranges, inclusive.
 *
 * Wide enough for anything from a hand-launched model to a wide-body, narrow
 * enough that no combination overflows a double anywhere in the atmosphere.
 * Outside them the numbers stop describing an aircraft: a wing area of 1e-320
 * m^2 is positive, but it sends the stall speed to infinity.
 */
export const AIRCRAFT_LIMITS: Record<LimitedField, { readonly label: string; readonly min: number; readonly max: number }> = {
  mass: { label: 'Mass', min: 0.1, max: 1e6 },
  wingArea: { label: 'Wing area', min: 0.01, max: 2000 },
  aspectRatio: { label: 'Aspect ratio', min: 0.5, max: 50 },
  oswaldEfficiency: { label: 'Oswald efficiency', min: 0.1, max: 1 },
  cd0: { label: 'CD0', min: 1e-4, max: 0.5 },
  clMax: { label: 'CLmax', min: 0.05, max: 5 },
  clMaxFlaps: { label: 'CLmax with flaps', min: 0.05, max: 6 },
  clMaxTakeoff: { label: 'CLmax, takeoff flap', min: 0.05, max: 6 },
};

/** Validate an aircraft definition, returning one human-readable problem per bad field. */
export function validateAircraft(aircraft: Aircraft): string[] {
  const problems: string[] = [];
  for (const [field, { label, min, max }] of Object.entries(AIRCRAFT_LIMITS)) {
    const value = aircraft[field as LimitedField];
    if (value === undefined) continue;
    if (!(value > 0)) problems.push(`${label} must be greater than zero.`);
    else if (value < min || value > max) problems.push(`${label} must lie between ${min} and ${max}.`);
  }
  return problems;
}
