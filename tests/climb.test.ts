import { describe, expect, it } from 'vitest';
import { atPressureAltitude } from '../src/physics/atmosphere.js';
import { k, maxLiftToDrag, vMinDrag, weight, type Aircraft } from '../src/physics/aero.js';
import { evaluatePoint } from '../src/physics/performance/curves.js';
import { lapseRatio, powerAvailable } from '../src/physics/propulsion.js';
import {
  SERVICE_CEILING_RATE,
  ceilings,
  climbAt,
  climbPerformance,
  isPowered,
  maxRateOfClimb,
  type PoweredAircraft,
} from '../src/physics/performance/climb.js';
import { CESSNA_172S, GENERIC_JET_TRAINER, GENERIC_SAILPLANE } from '../src/data/aircraft/presets.js';

const C172 = CESSNA_172S as PoweredAircraft;
const JET = GENERIC_JET_TRAINER as PoweredAircraft;
const SL = atPressureAltitude(0);

/** A jet with little thrust, where the small-angle answers are near exact. */
const WEAK_JET: PoweredAircraft = { ...JET, propulsion: { kind: 'turbofan', thrust: 4400, lapseExponent: 1 } };

describe('steady climb at one speed', () => {
  it('reduces to (P_A - P_R) / W in the small-angle form', () => {
    const v = 40;
    const lapse = lapseRatio(C172.propulsion, SL);
    const pr = evaluatePoint(C172, SL, v).powerRequired;
    const expected = (powerAvailable(C172.propulsion, v, lapse) - pr) / weight(C172.mass);
    expect(climbAt(C172, SL, v).rateOfClimbSmallAngle).toBeCloseTo(expected, 12);
  });

  it('satisfies the exact equations of a steady climb', () => {
    // T - D - W sin(gamma) = 0, with the wing carrying W cos(gamma).
    for (const [aircraft, v] of [[C172, 38], [JET, 120]] as const) {
      const c = climbAt(aircraft, SL, v);
      const w = weight(aircraft.mass);
      const q = 0.5 * SL.density * v * v;
      const cl = (w * Math.cos(c.gamma)) / (q * aircraft.wingArea);
      const drag = q * aircraft.wingArea * (aircraft.cd0 + k(aircraft) * cl * cl);
      expect(c.thrust - drag - w * Math.sin(c.gamma)).toBeCloseTo(0, 6);
      expect(c.iterations).toBeLessThan(15);
    }
  });

  it('climbs slightly better exactly than the small-angle form says', () => {
    // Less lift needed, so less induced drag. Under 1 % for the 172S at V_y.
    const c = climbPerformance(C172, SL).vy;
    const delta = (c.rateOfClimb - c.rateOfClimbSmallAngle) / c.rateOfClimbSmallAngle;
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(0.01);
  });

  it('shows a bigger difference for a jet climbing steeply', () => {
    const c172 = climbPerformance(C172, SL).vx;
    const jet = climbPerformance(JET, SL).vx;
    const rel = (c: typeof jet) => (c.rateOfClimb - c.rateOfClimbSmallAngle) / c.rateOfClimbSmallAngle;
    expect(rel(jet)).toBeGreaterThan(rel(c172));
  });
});

describe('best climb speeds against closed forms', () => {
  // For a jet with constant thrust the small-angle optima are analytic.
  const rho = SL.density;
  const w = weight(WEAK_JET.mass);
  const t = 4400;

  it('puts a jet’s V_x at minimum-drag speed', () => {
    expect(climbPerformance(WEAK_JET, SL).vx.tas / vMinDrag(WEAK_JET, rho)).toBeCloseTo(1, 2);
  });

  it('puts a jet’s V_y where Anderson’s closed form does', () => {
    const ld = maxLiftToDrag(WEAK_JET);
    const tw = t / w;
    const vy = Math.sqrt(
      ((t / WEAK_JET.wingArea) / (3 * rho * WEAK_JET.cd0)) * (1 + Math.sqrt(1 + 3 / (ld * ld * tw * tw))),
    );
    expect(climbPerformance(WEAK_JET, SL).vy.tas / vy).toBeCloseTo(1, 2);
  });

  it('finds the maximum level speed where thrust equals drag', () => {
    const perf = climbPerformance(JET, SL);
    const v = perf.maxLevelSpeed!;
    expect(evaluatePoint(JET, SL, v).drag).toBeCloseTo(14000, 3); // the preset's thrust, at sea level
  });
});

describe('ceilings', () => {
  const c = ceilings(C172);

  it('puts the best rate of climb at zero at the absolute ceiling, 100 ft/min at the service ceiling', () => {
    expect(maxRateOfClimb(C172, c.absolute!)).toBeCloseTo(0, 5);
    expect(maxRateOfClimb(C172, c.service!)).toBeCloseTo(SERVICE_CEILING_RATE, 5);
    expect(c.service!).toBeLessThan(c.absolute!);
  });

  it('lowers both on a hot day', () => {
    const hot = ceilings(C172, 20);
    expect(hot.service!).toBeLessThan(c.service!);
    expect(hot.absolute!).toBeLessThan(c.absolute!);
  });

  it('raises both when the aircraft is lighter', () => {
    const light = ceilings({ ...C172, mass: 0.8 * C172.mass });
    expect(light.service!).toBeGreaterThan(c.service!);
  });

  it('has none for an aircraft that cannot climb at sea level', () => {
    const feeble: PoweredAircraft = { ...JET, propulsion: { kind: 'turbofan', thrust: 1000, lapseExponent: 1 } };
    expect(ceilings(feeble)).toEqual({ absolute: null, service: null });
  });

  it('knows a glider has no engine', () => {
    expect(isPowered(GENERIC_SAILPLANE as Aircraft)).toBe(false);
    expect(isPowered(CESSNA_172S)).toBe(true);
  });
});
