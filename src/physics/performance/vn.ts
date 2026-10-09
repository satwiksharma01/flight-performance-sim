/**
 * The V-n diagram: the structural flight envelope, in equivalent airspeed and
 * load factor.
 *
 * Two kinds of boundary are drawn together:
 *
 * - Manoeuvre. Below the manoeuvring speed the wing stalls before the
 *   structure is at its limit, n = q S CL_max / W. Above it the limit load
 *   factor caps the envelope, out to the design dive speed V_D. On the
 *   negative side the same holds with the negative stall, and the negative
 *   limit varies linearly from its value at V_C to 0 at V_D for the normal
 *   and commuter categories, and to -1.0 at V_D for utility and aerobatic
 *   (former 14 CFR 23.333(b)).
 * - Gust. A sharp-edged vertical gust of U_de adds
 *
 *     Δn = K_g ρ0 U_de V_e a / (2 W/S)
 *
 *   (former 14 CFR 23.341, the Pratt formula), where K_g = 0.88 μ / (5.3 + μ)
 *   alleviates it for the time the wing takes to penetrate the gust, and
 *   μ = 2 (W/S) / (ρ c a g) is the aeroplane's mass ratio. Design gusts are
 *   50 ft/s at V_C and 25 ft/s at V_D (former 14 CFR 23.333(c)).
 *
 * "Former": Amendment 23-64 (2017) replaced Part 23's prescriptive load rules
 * with performance-based ones, accepting industry standards (ASTM F3116) as
 * the means of compliance. The classic rules cited here are the ones every
 * light aircraft flying today, the 172S included, was certificated to.
 *
 * In EAS the manoeuvre boundary doesn't depend on altitude: q is fixed by the
 * EAS. The gust boundary does, a little, through μ.
 *
 * The lift-curve slope comes from the aspect ratio alone, by the Helmbold /
 * DATCOM relation for an unswept wing at low Mach, without the fuselage's
 * contribution. Flaps-down envelopes are not drawn.
 */

import { G0, RHO0 } from '../constants.js';
import { weight, type Aircraft } from '../aero.js';

/** Certification category. Absent means normal (commuter follows the same rule). */
export type Category = 'normal' | 'utility' | 'aerobatic';
export const CATEGORIES: readonly Category[] = ['normal', 'utility', 'aerobatic'];

export interface StructuralLimits {
  /** Positive limit load factor, flaps up [-]: 3.8 normal, 4.4 utility, 6 aerobatic category */
  readonly nPositive: number;
  /** Negative limit load factor, flaps up [-], below zero */
  readonly nNegative: number;
  /** Design cruising speed V_C [m/s EAS] */
  readonly cruiseSpeed: number;
  /** Design dive speed V_D [m/s EAS]. The never-exceed speed is 0.9 V_D (former 14 CFR 23.1505) */
  readonly diveSpeed: number;
  /** Lift coefficient at the negative stall, clean [-], below zero */
  readonly clMin: number;
  /** Sets the negative limit at V_D: 0 for normal, -1.0 for utility and aerobatic */
  readonly category?: Category;
}

/** The negative manoeuvre limit at V_D, by category (former 14 CFR 23.333(b)(3)). */
export function negativeLimitAtDive(limits: StructuralLimits): number {
  return (limits.category ?? 'normal') === 'normal' ? 0 : -1;
}

/** The numeric limits, which have ranges. */
export type NumericLimit = Exclude<keyof StructuralLimits, 'category'>;

/** Supported ranges, inclusive, for the permalink decoder and the editor. */
export const STRUCTURE_LIMITS = {
  nPositive: { label: 'Positive limit load factor', min: 1.5, max: 15 },
  nNegative: { label: 'Negative limit load factor', min: -10, max: -0.1 },
  cruiseSpeed: { label: 'Design cruising speed', min: 5, max: 400 },
  diveSpeed: { label: 'Design dive speed', min: 5, max: 500 },
  clMin: { label: 'CL at the negative stall', min: -5, max: -0.05 },
} as const;

/** One problem per bad field, including the speeds' order. Empty when the limits are usable. */
export function validateStructure(s: StructuralLimits): string[] {
  const problems: string[] = [];
  for (const [field, { label, min, max }] of Object.entries(STRUCTURE_LIMITS)) {
    const value = s[field as NumericLimit];
    if (!(value >= min && value <= max)) problems.push(`${label} must lie between ${min} and ${max}.`);
  }
  if (s.category !== undefined && !CATEGORIES.includes(s.category)) {
    problems.push(`Unknown category "${s.category}". Expected one of: ${CATEGORIES.join(', ')}.`);
  }
  if (problems.length === 0 && !(s.diveSpeed > s.cruiseSpeed)) {
    problems.push('The design dive speed must be faster than the design cruising speed.');
  }
  return problems;
}

/** V_NE = 0.9 V_D [m/s EAS]. */
export const NEVER_EXCEED_FRACTION = 0.9;

/**
 * Lift-curve slope of the wing [1/rad]: a = 2πA / (2 + sqrt(4 + A²/η²)), with
 * the section's slope taken as η = 0.95 of 2π. Unswept, low Mach.
 */
export function liftCurveSlope(aspectRatio: number): number {
  const eta = 0.95;
  return (2 * Math.PI * aspectRatio) / (2 + Math.sqrt(4 + (aspectRatio * aspectRatio) / (eta * eta)));
}

/** Design gust velocities [m/s EAS] at V_C and V_D, at a pressure altitude [m]. */
export function designGusts(pressureAltitude: number): { readonly cruise: number; readonly dive: number } {
  // 50 and 25 ft/s up to 20,000 ft, then falling linearly to half at 50,000 ft.
  const ft = pressureAltitude / 0.3048;
  const scale = ft <= 20_000 ? 1 : ft >= 50_000 ? 0.5 : 1 - (0.5 * (ft - 20_000)) / 30_000;
  return { cruise: 50 * 0.3048 * scale, dive: 25 * 0.3048 * scale };
}

export interface GustAlleviation {
  /** Mass ratio μ = 2 (W/S) / (ρ c a g) [-] */
  readonly massRatio: number;
  /** K_g = 0.88 μ / (5.3 + μ) [-] */
  readonly factor: number;
  /** Lift-curve slope used [1/rad] */
  readonly liftSlope: number;
}

/** Gust alleviation at this density. The chord is the mean geometric chord, S/b. */
export function gustAlleviation(aircraft: Aircraft, density: number): GustAlleviation {
  const liftSlope = liftCurveSlope(aircraft.aspectRatio);
  const chord = Math.sqrt(aircraft.wingArea / aircraft.aspectRatio);
  const wingLoading = weight(aircraft.mass) / aircraft.wingArea;
  const massRatio = (2 * wingLoading) / (density * chord * liftSlope * G0);
  return { massRatio, factor: (0.88 * massRatio) / (5.3 + massRatio), liftSlope };
}

export interface VnDiagram {
  readonly limits: StructuralLimits;
  /** 1-g stall, flaps up [m/s EAS] */
  readonly stallSpeed: number;
  /** Manoeuvring speed V_A, where the stall curve reaches n+ [m/s EAS] */
  readonly maneuveringSpeed: number;
  /** Where the negative stall curve reaches n- [m/s EAS] */
  readonly negativeCornerSpeed: number;
  /** V_NE = 0.9 V_D [m/s EAS] */
  readonly neverExceedSpeed: number;
  /** Design gusts here [m/s EAS] */
  readonly gusts: { readonly cruise: number; readonly dive: number };
  readonly alleviation: GustAlleviation;
  /** Load factor per unit EAS on each stall curve, n = c V^2 [s^2/m^2] */
  readonly positiveStallCoefficient: number;
  readonly negativeStallCoefficient: number;
  /** Gust Δn per unit EAS [s/m], for the V_C gust and the V_D gust */
  readonly cruiseGustSlope: number;
  readonly diveGustSlope: number;
}

/**
 * The V-n diagram at this aircraft's mass, for gusts at this pressure altitude
 * and density.
 */
export function vnDiagram(
  aircraft: Aircraft,
  limits: StructuralLimits,
  pressureAltitude: number,
  density: number,
): VnDiagram {
  const wingLoading = weight(aircraft.mass) / aircraft.wingArea;
  const positiveStallCoefficient = (0.5 * RHO0 * aircraft.clMax) / wingLoading;
  const negativeStallCoefficient = (0.5 * RHO0 * limits.clMin) / wingLoading;
  const gusts = designGusts(pressureAltitude);
  const alleviation = gustAlleviation(aircraft, density);
  const perGust = (alleviation.factor * RHO0 * alleviation.liftSlope) / (2 * wingLoading);
  return {
    limits,
    stallSpeed: Math.sqrt(1 / positiveStallCoefficient),
    maneuveringSpeed: Math.sqrt(limits.nPositive / positiveStallCoefficient),
    negativeCornerSpeed: Math.sqrt(limits.nNegative / negativeStallCoefficient),
    neverExceedSpeed: NEVER_EXCEED_FRACTION * limits.diveSpeed,
    gusts,
    alleviation,
    positiveStallCoefficient,
    negativeStallCoefficient,
    cruiseGustSlope: perGust * gusts.cruise,
    diveGustSlope: perGust * gusts.dive,
  };
}

export interface LoadRange {
  readonly upper: number;
  readonly lower: number;
}

export interface VnBoundaries {
  /** Manoeuvre envelope: stall curves, limit load factors, V_C-V_D taper */
  readonly maneuver: LoadRange;
  /** Gust lines: the V_C gust out to V_C, then straight to the V_D gust at V_D */
  readonly gust: LoadRange;
  /** The design envelope: whichever is wider, never past the stall */
  readonly design: LoadRange;
}

/** The boundaries at one EAS [m/s], or null beyond V_D or below zero. */
export function vnBoundaries(d: VnDiagram, eas: number): VnBoundaries | null {
  const { nPositive, nNegative, cruiseSpeed: vc, diveSpeed: vd } = d.limits;
  if (!(eas >= 0 && eas <= vd)) return null;

  const stallUp = d.positiveStallCoefficient * eas * eas;
  const stallDown = d.negativeStallCoefficient * eas * eas;
  const atDive = negativeLimitAtDive(d.limits);
  const taper = eas <= vc ? nNegative : nNegative + ((atDive - nNegative) * (eas - vc)) / (vd - vc);
  const maneuver = { upper: Math.min(stallUp, nPositive), lower: Math.max(stallDown, taper) };

  // Δn at V_C on the V_C gust, and at V_D on the V_D gust, joined by a straight line.
  const atCruise = d.cruiseGustSlope * Math.min(eas, vc);
  const delta = eas <= vc ? atCruise : atCruise + ((d.diveGustSlope * vd - atCruise) * (eas - vc)) / (vd - vc);
  const gust = { upper: 1 + delta, lower: 1 - delta };

  return {
    maneuver,
    gust,
    design: {
      upper: Math.min(stallUp, Math.max(maneuver.upper, gust.upper)),
      lower: Math.max(stallDown, Math.min(maneuver.lower, gust.lower)),
    },
  };
}
