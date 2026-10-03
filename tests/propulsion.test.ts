import { describe, expect, it } from 'vitest';
import { atPressureAltitude } from '../src/physics/atmosphere.js';
import {
  gaggFarrar,
  lapseRatio,
  powerAvailable,
  propellerEfficiency,
  thrustAvailable,
  type Propulsion,
} from '../src/physics/propulsion.js';
import { CESSNA_172S } from '../src/data/aircraft/presets.js';

const piston: Propulsion = {
  kind: 'piston',
  power: 134_000,
  propeller: { staticThrust: 3000, zeroThrustSpeed: 170 },
};

describe('engine lapse', () => {
  it('keeps full power at sea level, and follows Gagg-Farrar above it', () => {
    expect(gaggFarrar(1)).toBeCloseTo(1, 12);
    expect(gaggFarrar(0.5)).toBeCloseTo(0.434, 12);
    expect(gaggFarrar(0.05)).toBe(0); // never negative power
  });

  it('holds a turbocharged engine at full power up to its critical altitude, continuously', () => {
    const turbo: Propulsion = { ...piston, criticalAltitude: 5000 };
    expect(lapseRatio(turbo, atPressureAltitude(3000))).toBe(1);
    expect(lapseRatio(turbo, atPressureAltitude(5000))).toBe(1);
    expect(lapseRatio(turbo, atPressureAltitude(5000.01))).toBeCloseTo(1, 4);
    expect(lapseRatio(turbo, atPressureAltitude(8000))).toBeLessThan(1);
    // Above its critical altitude it beats the normally aspirated engine.
    expect(lapseRatio(turbo, atPressureAltitude(8000))).toBeGreaterThan(lapseRatio(piston, atPressureAltitude(8000)));
  });

  it('lapses a turbofan as sigma^m', () => {
    const fan: Propulsion = { kind: 'turbofan', thrust: 10_000, lapseExponent: 0.8 };
    const atm = atPressureAltitude(9000);
    expect(lapseRatio(fan, atm)).toBeCloseTo(Math.pow(atm.densityRatio, 0.8), 12);
  });

  it('loses power on a hot day, through density', () => {
    expect(lapseRatio(piston, atPressureAltitude(1500, 20))).toBeLessThan(lapseRatio(piston, atPressureAltitude(1500)));
  });
});

describe('propeller thrust', () => {
  it('gives the static thrust at zero speed, finite where T = P/V is not', () => {
    expect(thrustAvailable(piston, 0, 1)).toBe(3000);
  });

  it('falls in a straight line from the static value', () => {
    const t1 = thrustAvailable(piston, 20, 1);
    const t2 = thrustAvailable(piston, 40, 1);
    expect(t1 - t2).toBeCloseTo(3000 * (20 / 170), 9);
  });

  it('never implies an efficiency above 1', () => {
    for (let v = 1; v < 200; v += 0.5) {
      expect(propellerEfficiency(piston, v)!).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it('never goes negative past the zero-thrust speed', () => {
    expect(thrustAvailable(piston, 250, 1)).toBe(0);
  });

  it('scales with the engine lapse, and gives power = thrust x speed', () => {
    expect(thrustAvailable(piston, 40, 0.7)).toBeCloseTo(0.7 * thrustAvailable(piston, 40, 1), 9);
    expect(powerAvailable(piston, 40, 0.7)).toBeCloseTo(40 * thrustAvailable(piston, 40, 0.7), 9);
  });

  it('implies a plausible efficiency for the 172S propeller in the climb', () => {
    // 74 KIAS, best rate of climb: fixed-pitch propellers run 0.6-0.8 here.
    const eta = propellerEfficiency(CESSNA_172S.propulsion!, 74 * (1852 / 3600))!;
    expect(eta).toBeGreaterThan(0.6);
    expect(eta).toBeLessThan(0.85);
  });
});
