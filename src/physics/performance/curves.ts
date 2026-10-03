/**
 * Performance curves for steady level flight.
 *
 * Produces the sampled curves the charts draw — drag, thrust required, power
 * required and L/D against velocity — plus the characteristic speeds marked on
 * them.
 *
 * Two decisions shape this module:
 *
 * 1. Every point carries all four airspeed representations. Switching a chart
 *    axis between TAS, EAS, CAS and Mach is then a pure view operation with no
 *    recomputation, which is what makes the toggle cheap enough to be instant.
 *
 * 2. Markers come from the closed-form solutions in `aero.ts`, never from
 *    scanning the sampled points. Scanning would make a marker's position
 *    depend on how many samples were requested, so a coarser chart would move
 *    the minimum-drag speed — an artefact with no physical meaning.
 */

import { airspeeds, type AirspeedSet } from '../airspeed.js';
import type { AtmosphereState } from '../atmosphere.js';
import {
  clRequired,
  dragAtSpeed,
  maxLiftToDrag,
  stallSpeed,
  vJetRange,
  vMinDrag,
  vMinPower,
  type Aircraft,
} from '../aero.js';

export interface FlightPoint {
  /** TAS, EAS, CAS, Mach and dynamic pressure at this point */
  readonly speeds: AirspeedSet;
  /** Zero-lift drag [N] */
  readonly parasiteDrag: number;
  /** Lift-dependent drag [N] */
  readonly inducedDrag: number;
  /** Total drag [N] */
  readonly drag: number;
  /** Thrust required for steady level flight [N] — equal to drag */
  readonly thrustRequired: number;
  /** Power required for steady level flight [W] — drag times true airspeed */
  readonly powerRequired: number;
  readonly cl: number;
  readonly cd: number;
  readonly liftToDrag: number;
}

export type MarkerKind = 'stall' | 'min-power' | 'min-drag' | 'jet-range';

export interface CurveMarker {
  readonly kind: MarkerKind;
  /** Short label for the chart */
  readonly label: string;
  /** Why this speed matters — text for the educational tooltip */
  readonly significance: string;
  /** True airspeed at the marker [m/s] */
  readonly tas: number;
  /**
   * Whether the aircraft can actually fly here.
   *
   * V_mp falls below stall speed whenever CL at minimum power, sqrt(3*CD0/k),
   * exceeds CLmax — the wing stalls before it reaches the minimum-power
   * condition. A real effect on draggy or low-CLmax aircraft, and the marker is
   * still worth drawing so the user can see *why* it is out of reach.
   */
  readonly attainable: boolean;
  readonly point: FlightPoint;
}

export interface PerformanceCurve {
  readonly aircraft: Aircraft;
  readonly atmosphere: AtmosphereState;
  readonly loadFactor: number;
  readonly points: readonly FlightPoint[];
  readonly markers: readonly CurveMarker[];
  /** Stall speed in TAS at this condition [m/s] */
  readonly stallSpeed: number;
  /** (L/D)max — a property of the polar alone [-] */
  readonly maxLiftToDrag: number;
}

export interface CurveOptions {
  /** Number of sample points (default 200) */
  readonly points?: number;
  /** Lowest speed to sample [m/s] (default: stall speed) */
  readonly minSpeed?: number;
  /** Highest speed to sample [m/s] (default: 2.5 * V_md) */
  readonly maxSpeed?: number;
  /** Load factor n = L/W (default 1) */
  readonly loadFactor?: number;
}

/** Evaluate one flight condition. */
export function evaluatePoint(
  aircraft: Aircraft,
  atmosphere: AtmosphereState,
  tas: number,
  loadFactor = 1,
): FlightPoint {
  const drag = dragAtSpeed(aircraft, tas, atmosphere.density, loadFactor);

  return {
    speeds: airspeeds(tas, atmosphere.pressure, atmosphere.density, atmosphere.speedOfSound),
    parasiteDrag: drag.parasite,
    inducedDrag: drag.induced,
    drag: drag.total,
    // Steady level flight: thrust balances drag exactly. Named separately
    // because the chart, and the equation display behind it, are named for it.
    thrustRequired: drag.total,
    powerRequired: drag.total * tas,
    cl: drag.cl,
    cd: drag.cd,
    liftToDrag: drag.liftToDrag,
  };
}

/**
 * Is level flight possible at this speed?
 *
 * Below stall the required CL exceeds CLmax, so the point is not a flight
 * condition at all — the equations still return numbers, but they describe an
 * aircraft that is falling out of the sky.
 */
export function isAttainable(
  aircraft: Aircraft,
  atmosphere: AtmosphereState,
  tas: number,
  loadFactor = 1,
): boolean {
  return clRequired(aircraft, tas, atmosphere.density, loadFactor) <= aircraft.clMax;
}

const MARKER_SIGNIFICANCE: Record<MarkerKind, string> = {
  stall:
    'The slowest speed at which the wing can still support the aircraft. Below this, ' +
    'the lift coefficient required exceeds CLmax and level flight is impossible.',
  'min-power':
    'Minimum power required, at CL = sqrt(3*CD0/k). Best endurance for a propeller ' +
    'aircraft, and the minimum-sink speed in a glide.',
  'min-drag':
    'Minimum drag and maximum L/D, at CL = sqrt(CD0/k). Parasite and induced drag are ' +
    'equal here. Best glide range, and best range for a propeller aircraft.',
  'jet-range':
    'Maximum CL^(1/2)/CD. Best range for a jet — notably faster than best L/D, which ' +
    'is where a propeller aircraft achieves its best range instead.',
};

const MARKER_LABEL: Record<MarkerKind, string> = {
  stall: 'V_s',
  'min-power': 'V_mp',
  'min-drag': 'V_md',
  'jet-range': 'V_jr',
};

function buildMarker(
  kind: MarkerKind,
  tas: number,
  aircraft: Aircraft,
  atmosphere: AtmosphereState,
  loadFactor: number,
): CurveMarker {
  return {
    kind,
    label: MARKER_LABEL[kind],
    significance: MARKER_SIGNIFICANCE[kind],
    tas,
    // The stall marker sits exactly on the boundary, where floating-point
    // comparison is a coin toss, so it is attainable by definition.
    attainable: kind === 'stall' || isAttainable(aircraft, atmosphere, tas, loadFactor),
    point: evaluatePoint(aircraft, atmosphere, tas, loadFactor),
  };
}

/** The four characteristic speeds, in ascending order of the usual case. */
export function characteristicSpeeds(
  aircraft: Aircraft,
  atmosphere: AtmosphereState,
  loadFactor = 1,
): CurveMarker[] {
  const density = atmosphere.density;
  // In a turn or pull-up the wing carries nW, and every optimum moves to the
  // speed it would have at that weight: up by sqrt(n). Evaluating the closed
  // forms at 1 g would leave the markers off the minima of the curves drawn.
  const loaded = loadFactor === 1 ? aircraft : { ...aircraft, mass: aircraft.mass * loadFactor };

  return [
    buildMarker('stall', stallSpeed(aircraft, density, loadFactor), aircraft, atmosphere, loadFactor),
    buildMarker('min-power', vMinPower(loaded, density), aircraft, atmosphere, loadFactor),
    buildMarker('min-drag', vMinDrag(loaded, density), aircraft, atmosphere, loadFactor),
    buildMarker('jet-range', vJetRange(loaded, density), aircraft, atmosphere, loadFactor),
  ];
}

/**
 * Sample the performance curves across a speed range.
 *
 * Sampling starts at stall speed by default. Extending below it would draw a
 * curve through conditions the aircraft cannot reach, which is worse than
 * useless on a chart someone is trying to learn from.
 */
export function generateCurve(
  aircraft: Aircraft,
  atmosphere: AtmosphereState,
  options: CurveOptions = {},
): PerformanceCurve {
  const loadFactor = options.loadFactor ?? 1;
  const count = options.points ?? 200;

  if (!Number.isInteger(count) || count < 2) {
    throw new RangeError(`Curve needs at least 2 sample points, received ${count}`);
  }

  const vStall = stallSpeed(aircraft, atmosphere.density, loadFactor);
  const minSpeed = options.minSpeed ?? vStall;
  const maxSpeed = options.maxSpeed ?? 2.5 * vMinDrag(aircraft, atmosphere.density);

  if (minSpeed <= 0) {
    throw new RangeError(`Minimum speed must be greater than zero, received ${minSpeed}`);
  }
  if (maxSpeed <= minSpeed) {
    throw new RangeError(
      `Maximum speed (${maxSpeed}) must exceed minimum speed (${minSpeed})`,
    );
  }

  const points: FlightPoint[] = [];
  const step = (maxSpeed - minSpeed) / (count - 1);

  for (let i = 0; i < count; i++) {
    // Compute the endpoint directly rather than by accumulation, so the last
    // sample lands exactly on maxSpeed instead of a step of rounding short.
    const tas = i === count - 1 ? maxSpeed : minSpeed + i * step;
    points.push(evaluatePoint(aircraft, atmosphere, tas, loadFactor));
  }

  return {
    aircraft,
    atmosphere,
    loadFactor,
    points,
    markers: characteristicSpeeds(aircraft, atmosphere, loadFactor),
    stallSpeed: vStall,
    maxLiftToDrag: maxLiftToDrag(aircraft),
  };
}
