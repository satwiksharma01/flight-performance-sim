import { describe, expect, it } from 'vitest';
import { isa } from '../src/physics/atmosphere.js';
import {
  airspeeds,
  casToTas,
  compressibilityCorrection,
  easToTas,
  tasToCas,
  tasToEas,
} from '../src/physics/airspeed.js';

describe('EAS and TAS', () => {
  it('makes EAS equal TAS at standard sea level', () => {
    const sl = isa(0);
    expect(tasToEas(60, sl.density)).toBeCloseTo(60, 3);
  });

  it('puts EAS below TAS at altitude', () => {
    const high = isa(10000);
    expect(tasToEas(200, high.density)).toBeLessThan(200);
  });

  it('round-trips TAS through EAS', () => {
    const state = isa(7500);
    expect(easToTas(tasToEas(180, state.density), state.density)).toBeCloseTo(180, 9);
  });

  it('grows the TAS/EAS ratio with altitude', () => {
    let previous = 0;
    for (const h of [0, 3000, 6000, 9000, 12000]) {
      const ratio = 100 / tasToEas(100, isa(h).density);
      expect(ratio).toBeGreaterThan(previous);
      previous = ratio;
    }
  });
});

describe('CAS', () => {
  it('makes CAS equal EAS equal TAS at standard sea level', () => {
    // At sea level the indicator's assumed constants are the real ones, so all
    // three collapse together. Anywhere else they diverge.
    const sl = isa(0);
    const speeds = airspeeds(80, sl.pressure, sl.density, sl.speedOfSound);
    expect(speeds.cas).toBeCloseTo(80, 6);
    expect(speeds.eas).toBeCloseTo(80, 3);
  });

  it('round-trips TAS through CAS at altitude', () => {
    const state = isa(9000);
    const cas = tasToCas(220, state.pressure, state.speedOfSound);
    expect(casToTas(cas, state.pressure, state.speedOfSound)).toBeCloseTo(220, 6);
  });

  it('orders EAS <= CAS < TAS at altitude', () => {
    const state = isa(10000);
    const s = airspeeds(230, state.pressure, state.density, state.speedOfSound);
    expect(s.eas).toBeLessThanOrEqual(s.cas);
    expect(s.cas).toBeLessThan(s.tas);
  });

  it('leaves the compressibility correction negligible when slow and low', () => {
    const sl = isa(0);
    expect(
      Math.abs(compressibilityCorrection(50, sl.pressure, sl.density, sl.speedOfSound)),
    ).toBeLessThan(0.01);
  });

  it('grows the compressibility correction with altitude and speed', () => {
    const high = isa(11000);
    const correction = compressibilityCorrection(
      250,
      high.pressure,
      high.density,
      high.speedOfSound,
    );
    expect(correction).toBeGreaterThan(1);
  });
});

describe('Mach', () => {
  it('gives Mach 1 at the local speed of sound', () => {
    const state = isa(8000);
    const s = airspeeds(state.speedOfSound, state.pressure, state.density, state.speedOfSound);
    expect(s.mach).toBeCloseTo(1, 9);
  });

  it('raises Mach for a fixed TAS as altitude increases through the troposphere', () => {
    // Colder air means a lower speed of sound, so the same TAS is a higher Mach.
    expect(airspeeds(250, isa(11000).pressure, isa(11000).density, isa(11000).speedOfSound).mach)
      .toBeGreaterThan(
        airspeeds(250, isa(0).pressure, isa(0).density, isa(0).speedOfSound).mach,
      );
  });
});
