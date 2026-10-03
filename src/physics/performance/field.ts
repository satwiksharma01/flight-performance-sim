/**
 * Takeoff and landing distances over a 50 ft obstacle.
 *
 * The method is Raymer's (Aircraft Design: A Conceptual Approach, §17.8-17.9),
 * with the ground runs integrated exactly rather than averaged at 0.7 V_LOF:
 *
 *   ground run   m dV/dt = T - D - μ (W - L), so  s = ∫ (V - V_w) dV / a(V)
 *   rotation     1 s at lift-off speed, the light-aircraft value
 *   transition   a circular arc at 1.15 V_s and n = 1.2, onto the climb path
 *   climb        straight, at the gradient (T - D)/W, up to the obstacle
 *
 * and for landing, from the obstacle: a 3° approach at 1.3 V_s0, a flare arc at
 * 1.23 V_s0 and n = 1.2, 1 s of free roll at touchdown (1.15 V_s0), then
 * braking with the engine at idle (zero thrust). V_w is the headwind: it starts
 * the run at an airspeed of V_w and shortens every segment by (V - V_w)/V.
 *
 * On the ground the wing is at its ground attitude. Its lift coefficient is
 * taken as the one that minimises the rolling resistance, CL = μ / (2k)
 * (Anderson, Aircraft Performance and Design, §6.3), for both runs, but never
 * so high that the wing would lift the aircraft off before the lift-off or
 * touchdown speed: on a sailplane's long wing, μ / (2k) alone would.
 *
 * Not modelled: ground effect, runway slope, flap drag (the polar is the clean
 * one, in every configuration), reverse thrust, and pilot technique beyond the
 * speeds above. The Cessna 172S comparison on the /validation page shows what
 * that costs.
 */

import { G0 } from '../constants.js';
import type { AtmosphereState } from '../atmosphere.js';
import { k, stallSpeed, weight, type Aircraft } from '../aero.js';
import { lapseRatio, thrustAvailable } from '../propulsion.js';

/** Friction coefficients of a runway surface [-]. */
export interface Runway {
  /** Rolling, brakes off */
  readonly rolling: number;
  /** Brakes on */
  readonly braking: number;
}

export type SurfaceId = 'dry-paved' | 'wet-paved' | 'icy-paved' | 'hard-turf' | 'firm-dirt' | 'soft-turf' | 'wet-grass';

/** Gudmundsson, General Aviation Aircraft Design (2014), p. 938. */
export const RUNWAY_SURFACES: Record<SurfaceId, Runway & { readonly label: string }> = {
  'dry-paved': { label: 'Dry asphalt or concrete', rolling: 0.04, braking: 0.4 },
  'wet-paved': { label: 'Wet asphalt or concrete', rolling: 0.05, braking: 0.225 },
  'icy-paved': { label: 'Icy asphalt or concrete', rolling: 0.02, braking: 0.08 },
  'hard-turf': { label: 'Hard turf', rolling: 0.05, braking: 0.4 },
  'firm-dirt': { label: 'Firm dirt', rolling: 0.04, braking: 0.3 },
  'soft-turf': { label: 'Soft turf', rolling: 0.07, braking: 0.2 },
  'wet-grass': { label: 'Wet grass', rolling: 0.08, braking: 0.2 },
};

export const SURFACE_IDS = Object.keys(RUNWAY_SURFACES) as SurfaceId[];

export function isSurfaceId(value: string): value is SurfaceId {
  return Object.prototype.hasOwnProperty.call(RUNWAY_SURFACES, value);
}

/** Obstacle height for both distances: 50 ft, as in light-aircraft POHs [m]. */
export const OBSTACLE_HEIGHT = 50 * 0.3048;

/** Raymer's speeds as multiples of the stall in that configuration, and his manoeuvre values. */
export const TAKEOFF_TECHNIQUE = {
  liftOff: 1.1,
  transition: 1.15,
  transitionLoadFactor: 1.2,
  /** [s] */
  rotationTime: 1,
} as const;

export const LANDING_TECHNIQUE = {
  approach: 1.3,
  flare: 1.23,
  touchdown: 1.15,
  flareLoadFactor: 1.2,
  /** [s] */
  freeRollTime: 1,
  /** [rad] */
  approachAngle: (3 * Math.PI) / 180,
} as const;

/**
 * Ground-attitude lift coefficient: least rolling resistance, CL = μ/(2k),
 * capped where lift would equal weight at `speedRatio` times the stall in
 * the configuration whose maximum is `clMax`.
 */
export function groundLiftCoefficient(aircraft: Aircraft, rolling: number, clMax: number, speedRatio = 1): number {
  return Math.min(rolling / (2 * k(aircraft)), clMax / (speedRatio * speedRatio));
}

/** Simpson's rule on [a, b] with n panels (even). */
function simpson(f: (x: number) => number, a: number, b: number, n = 512): number {
  const h = (b - a) / n;
  let sum = f(a) + f(b);
  for (let i = 1; i < n; i++) sum += (i % 2 === 1 ? 4 : 2) * f(a + i * h);
  return (sum * h) / 3;
}

/**
 * Ground distance [m] while the airspeed changes between `low` and `high`
 * under acceleration magnitude a(V), into a headwind: ∫ (V - V_w) dV / a(V).
 * Null if a(V) is not positive somewhere on the way.
 */
function groundRun(accel: (v: number) => number, low: number, high: number, headwind: number): number | null {
  if (!(high > low)) return 0;
  let ok = true;
  const integrand = (v: number) => {
    const a = accel(v);
    if (!(a > 0)) ok = false;
    return (v - headwind) / a;
  };
  // In a tailwind the airspeed passes through zero, where drag changes sign:
  // integrate each side separately, so Simpson's rule never spans the kink.
  const distance = low < 0 && high > 0 ? simpson(integrand, low, 0) + simpson(integrand, 0, high) : simpson(integrand, low, high);
  return ok ? distance : null;
}

export interface TakeoffDistances {
  readonly ok: true;
  /** Stall in the takeoff configuration, lift-off and obstacle speeds [m/s TAS] */
  readonly stallSpeed: number;
  readonly liftOffSpeed: number;
  readonly obstacleSpeed: number;
  /** Lift coefficient on the ground run [-] */
  readonly groundCl: number;
  /** Climb gradient after the transition [rad] */
  readonly climbAngle: number;
  /** Ground distances [m]: the run to lift-off speed, then rotation */
  readonly groundRun: number;
  readonly rotation: number;
  /** Air distances [m] */
  readonly transition: number;
  readonly climb: number;
  /** Ground run plus rotation: the POH's "ground roll" [m] */
  readonly groundRoll: number;
  /** Over the obstacle [m] */
  readonly total: number;
}

export type TakeoffResult = TakeoffDistances | { readonly ok: false; readonly reason: string };

/**
 * Takeoff at full power from a level runway.
 *
 * @param headwind Headwind component [m/s]; negative for a tailwind
 */
export function takeoff(aircraft: Aircraft, atmosphere: AtmosphereState, runway: Runway, headwind = 0): TakeoffResult {
  const engine = aircraft.propulsion;
  if (!engine) return { ok: false, reason: 'No engine: a glider is launched by aerotow or winch.' };

  const { density } = atmosphere;
  const w = weight(aircraft.mass);
  const s = aircraft.wingArea;
  const kf = k(aircraft);
  const clMax = aircraft.clMaxTakeoff ?? aircraft.clMax;
  const lapse = lapseRatio(engine, atmosphere);
  const thrust = (v: number) => thrustAvailable(engine, Math.max(v, 0), lapse);

  const vs = stallSpeed(aircraft, density, 1, clMax);
  const vlof = TAKEOFF_TECHNIQUE.liftOff * vs;
  const vtr = TAKEOFF_TECHNIQUE.transition * vs;
  const cl = groundLiftCoefficient(aircraft, runway.rolling, clMax, TAKEOFF_TECHNIQUE.liftOff);
  const cd = aircraft.cd0 + kf * cl * cl;

  // Airspeed can start negative in a tailwind; the air then pushes rather than drags.
  const accel = (v: number) => {
    const qs = 0.5 * density * v * v * s;
    const lift = v > 0 ? qs * cl : 0;
    return (G0 / w) * (thrust(v) - Math.sign(v) * qs * cd - runway.rolling * Math.max(w - lift, 0));
  };
  const run = groundRun(accel, Math.min(headwind, vlof), vlof, headwind);
  if (run === null) return { ok: false, reason: 'Thrust can’t overcome drag and rolling friction before lift-off speed.' };
  const rotation = Math.max(vlof - headwind, 0) * TAKEOFF_TECHNIQUE.rotationTime;

  const qs = 0.5 * density * vtr * vtr * s;
  const clTr = w / qs;
  const sinGamma = (thrust(vtr) - qs * (aircraft.cd0 + kf * clTr * clTr)) / w;
  if (!(sinGamma > 0)) return { ok: false, reason: 'Thrust can’t hold a climb at the obstacle speed.' };
  const gamma = Math.asin(Math.min(sinGamma, 1));

  const radius = (vtr * vtr) / (G0 * (TAKEOFF_TECHNIQUE.transitionLoadFactor - 1));
  const hTransition = radius * (1 - Math.cos(gamma));
  let transition: number;
  let climb: number;
  if (hTransition >= OBSTACLE_HEIGHT) {
    // The obstacle is cleared during the arc.
    transition = Math.sqrt(radius * radius - (radius - OBSTACLE_HEIGHT) ** 2);
    climb = 0;
  } else {
    transition = radius * Math.sin(gamma);
    climb = (OBSTACLE_HEIGHT - hTransition) / Math.tan(gamma);
  }
  const airWind = Math.max(vtr - headwind, 0) / vtr;
  transition *= airWind;
  climb *= airWind;

  const groundRoll = run + rotation;
  return {
    ok: true,
    stallSpeed: vs,
    liftOffSpeed: vlof,
    obstacleSpeed: vtr,
    groundCl: cl,
    climbAngle: gamma,
    groundRun: run,
    rotation,
    transition,
    climb,
    groundRoll,
    total: groundRoll + transition + climb,
  };
}

export interface LandingDistances {
  readonly ok: true;
  /** Stall in the landing configuration, approach, flare and touchdown speeds [m/s TAS] */
  readonly stallSpeed: number;
  readonly approachSpeed: number;
  readonly flareSpeed: number;
  readonly touchdownSpeed: number;
  readonly approachAngle: number;
  /** Air distances [m] */
  readonly approach: number;
  readonly flare: number;
  /** Ground distances [m] */
  readonly freeRoll: number;
  readonly braking: number;
  /** Free roll plus braking: the POH's "ground roll" [m] */
  readonly groundRoll: number;
  /** From the obstacle [m] */
  readonly total: number;
}

export type LandingResult = LandingDistances | { readonly ok: false; readonly reason: string };

/** Landing with full flap, engine at idle, over a 50 ft obstacle. */
export function landing(aircraft: Aircraft, atmosphere: AtmosphereState, runway: Runway, headwind = 0): LandingResult {
  const { density } = atmosphere;
  const w = weight(aircraft.mass);
  const s = aircraft.wingArea;
  const t = LANDING_TECHNIQUE;

  const clMaxLanding = aircraft.clMaxFlaps ?? aircraft.clMax;
  const vs0 = stallSpeed(aircraft, density, 1, clMaxLanding);
  const va = t.approach * vs0;
  const vf = t.flare * vs0;
  const vtd = t.touchdown * vs0;
  if (headwind >= vtd) return { ok: false, reason: 'The headwind is faster than the touchdown speed.' };

  const theta = t.approachAngle;
  const radius = (vf * vf) / (G0 * (t.flareLoadFactor - 1));
  const hFlare = Math.min(radius * (1 - Math.cos(theta)), OBSTACLE_HEIGHT);
  const approach = ((OBSTACLE_HEIGHT - hFlare) / Math.tan(theta)) * ((va - headwind) / va);
  const flare = radius * Math.sin(theta) * ((vf - headwind) / vf);
  const freeRoll = (vtd - headwind) * t.freeRollTime;

  const cl = groundLiftCoefficient(aircraft, runway.rolling, clMaxLanding, t.touchdown);
  const cd = aircraft.cd0 + k(aircraft) * cl * cl;
  const decel = (v: number) => {
    const qs = 0.5 * density * v * v * s;
    const lift = v > 0 ? qs * cl : 0;
    return (G0 / w) * (Math.sign(v) * qs * cd + runway.braking * Math.max(w - lift, 0));
  };
  const braking = groundRun(decel, headwind, vtd, headwind);
  if (braking === null) return { ok: false, reason: 'The brakes can’t stop the aircraft on this surface.' };

  const groundRoll = freeRoll + braking;
  return {
    ok: true,
    stallSpeed: vs0,
    approachSpeed: va,
    flareSpeed: vf,
    touchdownSpeed: vtd,
    approachAngle: theta,
    approach,
    flare,
    freeRoll,
    braking,
    groundRoll,
    total: approach + flare + groundRoll,
  };
}
