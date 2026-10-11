import { describe, expect, it } from 'vitest';
import { atPressureAltitude } from '../src/physics/atmosphere.js';
import { dragAtSpeed, vMinDrag, vMinPower } from '../src/physics/aero.js';
import { type PoweredAircraft } from '../src/physics/performance/climb.js';
import type { PistonEngine, TurbofanEngine } from '../src/physics/propulsion.js';
import { cruiseSpeed } from '../src/physics/performance/cruise.js';
import { CRUISE_PROPELLER_EFFICIENCY } from '../src/physics/performance/range.js';
import { PRESETS } from '../src/data/aircraft/presets.js';

const c172 = PRESETS.c172 as PoweredAircraft;
const jet = PRESETS['jet-trainer'] as PoweredAircraft;
const at8500 = atPressureAltitude(8500 * 0.3048);

describe('cruise at a set power', () => {
  it('balances thrust power and power required: eta x setting x P = D V', () => {
    for (const setting of [0.45, 0.6, 0.75]) {
      const v = cruiseSpeed(c172, at8500, setting)!;
      const required = dragAtSpeed(c172, v, at8500.density).total * v;
      expect(required / (CRUISE_PROPELLER_EFFICIENCY * setting * (c172.propulsion as PistonEngine).power)).toBeCloseTo(1, 9);
    }
  });

  it('flies the fast side of the power curve, and faster with more power', () => {
    const v45 = cruiseSpeed(c172, at8500, 0.45)!;
    const v75 = cruiseSpeed(c172, at8500, 0.75)!;
    expect(v45).toBeGreaterThan(vMinPower(c172, at8500.density));
    expect(v75).toBeGreaterThan(v45);
  });

  it('sets thrust for a jet: T = D, faster than V_md', () => {
    const atm = atPressureAltitude(6000);
    const v = cruiseSpeed(jet, atm, 0.5)!;
    expect(dragAtSpeed(jet, v, atm.density).total / (0.5 * (jet.propulsion as TurbofanEngine).thrust)).toBeCloseTo(1, 9);
    expect(v).toBeGreaterThan(vMinDrag(jet, atm.density));
  });

  it('has no level flight when the setting is too low to hold it', () => {
    expect(cruiseSpeed(c172, at8500, 0.05)).toBeNull();
    expect(cruiseSpeed(c172, at8500, 0)).toBeNull();
  });
});
