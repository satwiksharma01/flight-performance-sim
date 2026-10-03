import { describe, expect, it } from 'vitest';
import { atPressureAltitude } from '../src/physics/atmosphere.js';
import { dragAtSpeed, weight } from '../src/physics/aero.js';
import { climbAt, isPowered } from '../src/physics/performance/climb.js';
import { energyHeight, specificExcessPower } from '../src/physics/performance/energy.js';
import { glideAtSpeed } from '../src/physics/performance/glide.js';
import { cornerSpeed, liftLimitedLoadFactor, sustainedLoadFactor, turnLimits, turnRate } from '../src/physics/performance/turn.js';
import { thrustAvailable, lapseRatio } from '../src/physics/propulsion.js';
import { PRESETS } from '../src/data/aircraft/presets.js';

const c172 = PRESETS.c172;
const atm = atPressureAltitude(1500, 5);

describe('specific excess power', () => {
  it('is the small-angle rate of climb at 1 g', () => {
    if (!isPowered(c172)) throw new Error('powered');
    for (const v of [35, 50, 60]) {
      expect(specificExcessPower(c172, atm, v)).toBeCloseTo(climbAt(c172, atm, v).rateOfClimbSmallAngle, 12);
    }
  });

  it('falls in a turn by V times the extra drag over W', () => {
    const v = 55;
    const extra = dragAtSpeed(c172, v, atm.density, 1.5).total - dragAtSpeed(c172, v, atm.density).total;
    expect(specificExcessPower(c172, atm, v) - specificExcessPower(c172, atm, v, 1.5)).toBeCloseTo((v * extra) / weight(c172.mass), 12);
  });

  it('is minus the power-off sink for a glider, to the small-angle approximation', () => {
    const glider = PRESETS.sailplane;
    const ps = specificExcessPower(glider, atm, 30);
    const glide = glideAtSpeed(glider, atm, 30);
    expect(-ps / (glide?.sinkRate ?? NaN)).toBeCloseTo(1, 3);
  });

  it('adds kinetic energy to height in the energy height', () => {
    expect(energyHeight(1000, 100)).toBeCloseTo(1000 + 100 ** 2 / (2 * 9.80665), 12);
  });
});

describe('turn limits', () => {
  const lapse = lapseRatio(c172.propulsion!, atm);

  it('reaches CLmax exactly at the lift-limited load factor', () => {
    const v = 45;
    const n = liftLimitedLoadFactor(c172, atm.density, v);
    expect(dragAtSpeed(c172, v, atm.density, n).cl).toBeCloseTo(c172.clMax, 12);
  });

  it('sustains the load factor whose drag equals the thrust', () => {
    const v = 50;
    const thrust = thrustAvailable(c172.propulsion!, v, lapse);
    const n = sustainedLoadFactor(c172, atm.density, v, thrust);
    expect(n).not.toBeNull();
    expect(dragAtSpeed(c172, v, atm.density, n!).total).toBeCloseTo(thrust, 8);
  });

  it('meets the structural limit at the corner speed', () => {
    const vc = cornerSpeed(c172, atm.density, 3.8);
    expect(liftLimitedLoadFactor(c172, atm.density, vc)).toBeCloseTo(3.8, 12);
    const limits = turnLimits(c172, atm.density, vc * 1.2, null, 3.8);
    expect(limits.instantaneous).toBe(3.8);
    expect(limits.instantaneousRate).toBeCloseTo(turnRate(vc * 1.2, 3.8), 12);
  });

  it('caps the sustained turn at the instantaneous one, and gives a glider none', () => {
    const slow = turnLimits(c172, atm.density, 33, 1e9, 3.8);
    expect(slow.sustained).toBe(slow.instantaneous);
    expect(turnLimits(PRESETS.sailplane, atm.density, 30, null, 5.3).sustained).toBeNull();
  });
});
