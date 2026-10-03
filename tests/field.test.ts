import { describe, expect, it } from 'vitest';
import { atPressureAltitude } from '../src/physics/atmosphere.js';
import { k, weight, type Aircraft } from '../src/physics/aero.js';
import {
  LANDING_TECHNIQUE,
  OBSTACLE_HEIGHT,
  RUNWAY_SURFACES,
  groundLiftCoefficient,
  landing,
  takeoff,
  type LandingDistances,
  type TakeoffDistances,
} from '../src/physics/performance/field.js';
import { PRESETS } from '../src/data/aircraft/presets.js';

const G = 9.80665;
const KT = 1852 / 3600;
const dry = RUNWAY_SURFACES['dry-paved'];
const sl = atPressureAltitude(0);

function ok<T extends { ok: boolean }>(r: T | { ok: false; reason: string }): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`expected a result, got: ${(r as { reason: string }).reason}`);
  return r as Extract<T, { ok: true }>;
}

const jet = PRESETS['jet-trainer'];

describe('takeoff ground run', () => {
  it('matches the closed form for constant thrust, where a = A - B V^2', () => {
    // A jet's thrust doesn't vary with speed here, so the integral is exact:
    // s = -ln(1 - B V^2 / A) / (2 B).
    const r: TakeoffDistances = ok(takeoff(jet, sl, dry));
    const w = weight(jet.mass);
    const cl = r.groundCl;
    const cd = jet.cd0 + k(jet) * cl * cl;
    const A = G * (14000 / w - dry.rolling);
    const B = (G / w) * 0.5 * sl.density * jet.wingArea * (cd - dry.rolling * cl);
    const v = r.liftOffSpeed;
    // Simpson's rule on 512 panels: agreement to parts in 10^8.
    expect(r.groundRun / (-Math.log(1 - (B * v * v) / A) / (2 * B))).toBeCloseTo(1, 7);
  });

  it('lifts off at 1.1 V_s and clears the obstacle at 1.15 V_s, in the takeoff configuration', () => {
    const r = ok(takeoff(PRESETS.c172, sl, dry));
    expect(r.stallSpeed / KT).toBeCloseTo(50, 0); // the 10°-flap calibration
    expect(r.liftOffSpeed / r.stallSpeed).toBeCloseTo(1.1, 12);
    expect(r.obstacleSpeed / r.stallSpeed).toBeCloseTo(1.15, 12);
  });

  it('holds the ground-attitude CL that minimises rolling resistance', () => {
    const r = ok(takeoff(PRESETS.c172, sl, dry));
    expect(r.groundCl).toBeCloseTo(dry.rolling / (2 * k(PRESETS.c172)), 12);
    // Clipped to CLmax when friction is high and the wing short.
    const stubby: Aircraft = { ...PRESETS.c172, aspectRatio: 2 };
    expect(groundLiftCoefficient(stubby, 0.6, 1.2)).toBe(1.2);
    // And never so high that lift reaches weight before lift-off.
    const glider = PRESETS.sailplane;
    expect(groundLiftCoefficient(glider, 0.04, glider.clMax, 1.15)).toBeCloseTo(glider.clMax / 1.15 ** 2, 12);
  });

  it('adds one second of rotation at lift-off speed', () => {
    const r = ok(takeoff(PRESETS.c172, sl, dry));
    expect(r.rotation).toBeCloseTo(r.liftOffSpeed, 12);
    expect(r.groundRoll).toBeCloseTo(r.groundRun + r.rotation, 12);
  });
});

describe('takeoff air distance', () => {
  it('flies the transition arc then a straight climb to 50 ft', () => {
    const r = ok(takeoff(PRESETS.c172, sl, dry));
    const radius = r.obstacleSpeed ** 2 / (G * 0.2);
    const hTransition = radius * (1 - Math.cos(r.climbAngle));
    expect(hTransition).toBeLessThan(OBSTACLE_HEIGHT);
    expect(r.transition).toBeCloseTo(radius * Math.sin(r.climbAngle), 9);
    expect(r.climb).toBeCloseTo((OBSTACLE_HEIGHT - hTransition) / Math.tan(r.climbAngle), 9);
    expect(r.total).toBeCloseTo(r.groundRoll + r.transition + r.climb, 9);
  });

  it('clears the obstacle inside the arc when the climb is steep', () => {
    const rocket: Aircraft = { ...jet, propulsion: { kind: 'turbofan', thrust: 40000, lapseExponent: 1 } };
    const r = ok(takeoff(rocket, sl, dry));
    expect(r.climb).toBe(0);
    const radius = r.obstacleSpeed ** 2 / (G * 0.2);
    expect(r.transition).toBeCloseTo(Math.sqrt(radius ** 2 - (radius - OBSTACLE_HEIGHT) ** 2), 9);
  });
});

describe('takeoff conditions', () => {
  const base = ok(takeoff(PRESETS.c172, sl, dry));

  it('is shortened by a headwind and lengthened by a tailwind', () => {
    const head = ok(takeoff(PRESETS.c172, sl, dry, 10 * KT));
    const tail = ok(takeoff(PRESETS.c172, sl, dry, -5 * KT));
    expect(head.total).toBeLessThan(base.total);
    expect(tail.total).toBeGreaterThan(base.total);
    // The POH's rule of thumb: 10 % shorter per 9 kt of headwind. Here it is
    // nearer 20 %: the run shrinks with the square of the ground speed.
    expect(ok(takeoff(PRESETS.c172, sl, dry, 9 * KT)).groundRoll / base.groundRoll).toBeLessThan(0.9);
  });

  it('needs no ground run when the headwind exceeds lift-off speed', () => {
    const r = ok(takeoff(PRESETS.c172, sl, dry, 60 * KT));
    expect(r.groundRun).toBe(0);
    expect(r.rotation).toBe(0);
  });

  it('grows with density altitude, from pressure altitude and from temperature', () => {
    const high = ok(takeoff(PRESETS.c172, atPressureAltitude(5000 * 0.3048), dry));
    const hot = ok(takeoff(PRESETS.c172, atPressureAltitude(0, 25), dry));
    expect(high.groundRoll).toBeGreaterThan(1.4 * base.groundRoll);
    expect(hot.groundRoll).toBeGreaterThan(base.groundRoll);
  });

  it('is longer on soft turf than on dry pavement', () => {
    expect(ok(takeoff(PRESETS.c172, sl, RUNWAY_SURFACES['soft-turf'])).groundRoll).toBeGreaterThan(base.groundRoll);
  });

  it('refuses a glider, and an aircraft too heavy to accelerate', () => {
    expect(takeoff(PRESETS.sailplane, sl, dry).ok).toBe(false);
    expect(takeoff({ ...PRESETS.c172, mass: PRESETS.c172.mass * 3 }, sl, dry).ok).toBe(false);
  });
});

describe('landing', () => {
  const r: LandingDistances = ok(landing(PRESETS.c172, sl, dry));

  it('approaches at 1.3 V_s0, flares at 1.23 and touches down at 1.15, full flap', () => {
    expect(r.stallSpeed / KT).toBeCloseTo(48, 0);
    expect(r.approachSpeed / r.stallSpeed).toBeCloseTo(1.3, 12);
    expect(r.flareSpeed / r.stallSpeed).toBeCloseTo(1.23, 12);
    expect(r.touchdownSpeed / r.stallSpeed).toBeCloseTo(1.15, 12);
  });

  it('descends at 3° to the flare, then flares on an arc at n = 1.2', () => {
    const radius = r.flareSpeed ** 2 / (G * 0.2);
    const theta = LANDING_TECHNIQUE.approachAngle;
    expect(r.flare).toBeCloseTo(radius * Math.sin(theta), 9);
    expect(r.approach).toBeCloseTo((OBSTACLE_HEIGHT - radius * (1 - Math.cos(theta))) / Math.tan(theta), 9);
  });

  it('brakes by the closed form, where the deceleration is A + B V^2', () => {
    const c = PRESETS.c172;
    const w = weight(c.mass);
    const cl = groundLiftCoefficient(c, dry.rolling, c.clMaxFlaps!, 1.15);
    const cd = c.cd0 + k(c) * cl * cl;
    const A = G * dry.braking;
    const B = (G / w) * 0.5 * sl.density * c.wingArea * (cd - dry.braking * cl);
    const v = r.touchdownSpeed;
    expect(r.braking / (Math.log(1 + (B * v * v) / A) / (2 * B))).toBeCloseTo(1, 7);
    expect(r.freeRoll).toBeCloseTo(v, 12);
    expect(r.groundRoll).toBeCloseTo(r.freeRoll + r.braking, 12);
  });

  it('stops shorter into wind, and much longer on ice', () => {
    expect(ok(landing(PRESETS.c172, sl, dry, 10 * KT)).total).toBeLessThan(r.total);
    expect(ok(landing(PRESETS.c172, sl, RUNWAY_SURFACES['icy-paved'])).braking).toBeGreaterThan(3 * r.braking);
  });

  it('lands a glider too', () => {
    expect(landing(PRESETS.sailplane, sl, dry).ok).toBe(true);
  });
});
