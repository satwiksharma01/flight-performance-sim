import { describe, expect, it } from 'vitest';
import {
  atPressureAltitude,
  densityAltitude,
  geometricAltitude,
  geopotentialAltitude,
  isa,
  pressureAltitude,
  speedOfSound,
} from '../src/physics/atmosphere.js';
import { P0, RHO0, T0 } from '../src/physics/constants.js';

const relativeError = (actual: number, expected: number) =>
  Math.abs(actual - expected) / Math.abs(expected);

// The published USSA-1976 table lives in src/data/validation/cases.ts, checked
// by tests/published.test.ts and shown on the /validation page.
describe('ISA at sea level', () => {
  it('reproduces sea-level standard conditions exactly', () => {
    const sl = isa(0);
    expect(sl.temperature).toBeCloseTo(T0, 10);
    expect(sl.pressure).toBeCloseTo(P0, 10);
    expect(sl.density).toBeCloseTo(RHO0, 3);
    expect(sl.densityRatio).toBeCloseTo(1, 3);
    expect(sl.speedOfSound).toBeCloseTo(340.294, 2);
  });
});

describe('layer structure', () => {
  it('is continuous across every layer boundary', () => {
    // A tabulated base pressure with too few digits would show up here as a
    // step, and would then appear as a kink in every derived curve.
    for (const boundary of [11000, 20000, 32000, 47000, 51000, 71000]) {
      const below = isa(geometricAltitude(boundary - 0.001));
      const above = isa(geometricAltitude(boundary + 0.001));
      expect(relativeError(above.pressure, below.pressure)).toBeLessThan(1e-6);
      expect(relativeError(above.temperature, below.temperature)).toBeLessThan(1e-6);
    }
  });

  it('holds temperature constant through the tropopause', () => {
    expect(isa(geometricAltitude(11000)).temperature).toBeCloseTo(216.65, 6);
    expect(isa(geometricAltitude(15000)).temperature).toBeCloseTo(216.65, 6);
    expect(isa(geometricAltitude(20000)).temperature).toBeCloseTo(216.65, 6);
  });

  it('warms again in the stratosphere above 20 km', () => {
    // The single-formula troposphere model gets this backwards, which is the
    // reason the layer table exists.
    expect(isa(geometricAltitude(30000)).temperature).toBeGreaterThan(216.65);
  });

  it('decreases pressure and density monotonically with altitude', () => {
    let previous = isa(0);
    for (let h = 500; h <= 80000; h += 500) {
      const current = isa(geometricAltitude(h));
      expect(current.pressure).toBeLessThan(previous.pressure);
      expect(current.density).toBeLessThan(previous.density);
      previous = current;
    }
  });
});

describe('altitude conversions', () => {
  it('round-trips geometric and geopotential altitude', () => {
    for (const h of [0, 1000, 11000, 30000]) {
      expect(geometricAltitude(geopotentialAltitude(h))).toBeCloseTo(h, 6);
    }
  });

  it('places geopotential altitude below geometric altitude', () => {
    expect(geopotentialAltitude(11000)).toBeLessThan(11000);
    expect(geopotentialAltitude(11000)).toBeGreaterThan(10950);
  });

  it('inverts the pressure and density profiles', () => {
    for (const h of [0, 5000, 11000, 20000, 32000]) {
      const state = isa(geometricAltitude(h));
      expect(pressureAltitude(state.pressure)).toBeCloseTo(h, 4);
      expect(densityAltitude(state.density)).toBeCloseTo(h, 4);
    }
  });
});

describe('ISA deviation and density altitude', () => {
  it('equates density altitude with pressure altitude on a standard day', () => {
    const state = isa(2000);
    expect(state.densityAltitude).toBeCloseTo(state.pressureAltitude, 3);
  });

  it('pushes density altitude above pressure altitude on a hot day', () => {
    const hot = isa(2000, 20);
    expect(hot.densityAltitude).toBeGreaterThan(hot.pressureAltitude);
    expect(hot.density).toBeLessThan(isa(2000).density);
    // Rule of thumb: about 118 ft (36 m) of density altitude per degree of ISA
    // deviation. Loose bounds — this is a sanity check, not a specification.
    const excess = hot.densityAltitude - hot.pressureAltitude;
    expect(excess).toBeGreaterThan(550);
    expect(excess).toBeLessThan(850);
  });

  it('leaves pressure untouched by the ISA deviation', () => {
    expect(isa(3000, 25).pressure).toBeCloseTo(isa(3000).pressure, 9);
  });

  it('raises the speed of sound on a hot day', () => {
    expect(isa(0, 30).speedOfSound).toBeGreaterThan(isa(0).speedOfSound);
    expect(speedOfSound(288.15)).toBeCloseTo(340.294, 2);
  });
});

describe('input validation', () => {
  it('rejects altitudes above the modelled ceiling', () => {
    expect(() => isa(90000)).toThrow(RangeError);
  });

  it('rejects an ISA deviation that drives temperature non-physical', () => {
    expect(() => isa(11000, -300)).toThrow(RangeError);
  });

  it('rejects a non-finite altitude', () => {
    expect(() => isa(Number.NaN)).toThrow(RangeError);
  });
});

describe('pressure altitude as the input', () => {
  it('matches the geometric entry point on a standard day', () => {
    for (const hp of [-500, 0, 3048, 11000, 25000, 60000]) {
      const a = atPressureAltitude(hp);
      const b = isa(geometricAltitude(hp));
      expect(a.pressure).toBeCloseTo(b.pressure, 9);
      expect(a.temperature).toBeCloseTo(b.temperature, 12);
      expect(a.geometricAltitude).toBeCloseTo(geometricAltitude(hp), 9);
    }
  });

  it('reports the pressure altitude it was given exactly, whatever the temperature', () => {
    // No more "5,000 ft gives a pressure altitude of 4,999 ft".
    expect(atPressureAltitude(1524, 25).pressureAltitude).toBe(1524);
  });

  it('holds pressure and offsets only temperature', () => {
    const std = atPressureAltitude(3048);
    const hot = atPressureAltitude(3048, 20);
    expect(hot.pressure).toBe(std.pressure);
    expect(hot.temperature - std.temperature).toBeCloseTo(20, 12);
  });

  it('lifts FL100 about 360 ft on an ISA +10 day: the pilot rule of 4 % per 10 °C', () => {
    // Troposphere closed form: dH = dT * ln(T0/T(Hp)) / L.
    const hp = 3048;
    const tHp = T0 - 0.0065 * hp;
    const expected = (10 * Math.log(T0 / tHp)) / 0.0065;
    const hot = atPressureAltitude(hp, 10);
    expect(hot.geopotentialAltitude - hp).toBeCloseTo(expected, 9);
    expect((hot.geopotentialAltitude - hp) / 0.3048).toBeCloseTo(359.5, 0);
  });

  it('integrates the column stretch exactly through every layer', () => {
    // Independent check: Simpson's rule on 1/T_std, using only the standard
    // temperature profile, against the per-layer closed forms.
    const hp = 52000;
    const dT = -15;
    const n = 52000;
    const step = hp / n;
    let sum = 0;
    for (let i = 0; i <= n; i++) {
      const weight = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2;
      sum += weight / atPressureAltitude(i * step).standardTemperature;
    }
    const integral = (sum * step) / 3;
    expect(atPressureAltitude(hp, dT).geopotentialAltitude).toBeCloseTo(hp + dT * integral, 6);
  });

  it('puts the aircraft lower than the altimeter on a cold day', () => {
    // "From high to low, or hot to cold, look out below."
    expect(atPressureAltitude(3048, -15).geometricAltitude).toBeLessThan(geometricAltitude(3048));
  });

  it('rejects a pressure altitude above the modelled ceiling', () => {
    expect(() => atPressureAltitude(90000)).toThrow(RangeError);
  });
});
