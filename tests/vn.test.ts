import { describe, expect, it } from 'vitest';
import { atPressureAltitude } from '../src/physics/atmosphere.js';
import { RHO0 } from '../src/physics/constants.js';
import { weight } from '../src/physics/aero.js';
import {
  designGusts,
  gustAlleviation,
  liftCurveSlope,
  validateStructure,
  vnBoundaries,
  vnDiagram,
  type StructuralLimits,
} from '../src/physics/performance/vn.js';
import { PRESETS } from '../src/data/aircraft/presets.js';

const KT = 1852 / 3600;
const FT = 0.3048;

const c172 = PRESETS.c172;
const limits = c172.structure as StructuralLimits;
const sl = atPressureAltitude(0);
const diagram = vnDiagram(c172, limits, 0, sl.density);

describe('lift-curve slope', () => {
  it('tends to the section slope, 0.95 x 2π, as the aspect ratio grows', () => {
    expect(liftCurveSlope(1e6)).toBeCloseTo(0.95 * 2 * Math.PI, 4);
  });

  it('tends to the slender-wing πA/2 as the aspect ratio shrinks', () => {
    expect(liftCurveSlope(0.01) / ((Math.PI * 0.01) / 2)).toBeCloseTo(1, 4);
  });

  it('gives about 4.6 per radian for the 172’s wing', () => {
    expect(liftCurveSlope(7.48)).toBeCloseTo(4.64, 2);
  });
});

describe('design gusts (14 CFR 23.333(c))', () => {
  it('are 50 and 25 ft/s up to 20,000 ft', () => {
    for (const ft of [0, 10_000, 20_000]) {
      const g = designGusts(ft * FT);
      expect(g.cruise / FT).toBeCloseTo(50, 10);
      expect(g.dive / FT).toBeCloseTo(25, 10);
    }
  });

  it('fall linearly to half at 50,000 ft, and stay there', () => {
    expect(designGusts(35_000 * FT).cruise / FT).toBeCloseTo(37.5, 10);
    expect(designGusts(50_000 * FT).dive / FT).toBeCloseTo(12.5, 10);
    expect(designGusts(60_000 * FT).cruise / FT).toBeCloseTo(25, 10);
  });
});

describe('gust alleviation', () => {
  it('matches the Pratt formula worked by hand for the 172 at sea level', () => {
    const a = liftCurveSlope(7.48);
    const chord = Math.sqrt(c172.wingArea / 7.48);
    const ws = weight(c172.mass) / c172.wingArea;
    const mu = (2 * ws) / (RHO0 * chord * a * 9.80665);
    const g = gustAlleviation(c172, RHO0);
    expect(g.massRatio).toBeCloseTo(mu, 12);
    expect(g.factor).toBeCloseTo((0.88 * mu) / (5.3 + mu), 12);
    // Δn at V_C = 126 KEAS on the 50 ft/s gust, in the regulation's own units:
    // n = 1 + K_g U V a / (498 W/S), V in knots, U in ft/s, W/S in lb/ft².
    const wsPsf = 2550 / 174;
    const imperial = (g.factor * 50 * 126 * a) / (498 * wsPsf);
    const b = vnBoundaries(diagram, 126 * KT);
    expect(b?.gust.upper).toBeCloseTo(1 + imperial, 2); // 498 is itself rounded
  });

  it('alleviates less as the air thins and the mass ratio grows', () => {
    const high = gustAlleviation(c172, atPressureAltitude(6000).density);
    expect(high.massRatio).toBeGreaterThan(gustAlleviation(c172, RHO0).massRatio);
    expect(high.factor).toBeGreaterThan(gustAlleviation(c172, RHO0).factor);
  });
});

describe('V-n diagram, Cessna 172S', () => {
  it('stalls at the calibrated 53 KEAS and turns the corner at V_s sqrt(3.8)', () => {
    expect(diagram.stallSpeed / KT).toBeCloseTo(53, 0);
    expect(diagram.maneuveringSpeed / diagram.stallSpeed).toBeCloseTo(Math.sqrt(3.8), 12);
  });

  it('puts V_NE at the published 160 KCAS, as 0.9 V_D', () => {
    expect(diagram.neverExceedSpeed / KT).toBeCloseTo(160, 10);
  });

  it('follows the stall curve up to V_A, then the limit', () => {
    const below = vnBoundaries(diagram, 0.8 * diagram.maneuveringSpeed);
    expect(below?.maneuver.upper).toBeCloseTo(3.8 * 0.64, 10);
    expect(vnBoundaries(diagram, diagram.maneuveringSpeed)?.maneuver.upper).toBeCloseTo(3.8, 10);
    expect(vnBoundaries(diagram, limits.cruiseSpeed)?.maneuver.upper).toBe(3.8);
  });

  it('tapers the negative limit from V_C to zero at V_D', () => {
    expect(vnBoundaries(diagram, limits.cruiseSpeed)?.maneuver.lower).toBeCloseTo(-1.52, 12);
    const mid = 0.5 * (limits.cruiseSpeed + limits.diveSpeed);
    expect(vnBoundaries(diagram, mid)?.maneuver.lower).toBeCloseTo(-0.76, 12);
    expect(vnBoundaries(diagram, limits.diveSpeed)?.maneuver.lower).toBeCloseTo(0, 12);
  });

  it('ends at V_D', () => {
    expect(vnBoundaries(diagram, limits.diveSpeed * 1.0001)).toBeNull();
    expect(vnBoundaries(diagram, -1)).toBeNull();
  });

  it('starts every gust line at 1 g', () => {
    const b = vnBoundaries(diagram, 0);
    expect(b?.gust.upper).toBe(1);
    expect(b?.gust.lower).toBe(1);
  });

  it('never lets the design envelope past the stall, and never inside the manoeuvre envelope', () => {
    for (let v = 1; v <= limits.diveSpeed; v += 0.5) {
      const b = vnBoundaries(diagram, v);
      if (!b) throw new Error('expected boundaries');
      expect(b.design.upper).toBeLessThanOrEqual(diagram.positiveStallCoefficient * v * v + 1e-12);
      expect(b.design.lower).toBeGreaterThanOrEqual(diagram.negativeStallCoefficient * v * v - 1e-12);
      expect(b.design.upper).toBeGreaterThanOrEqual(b.maneuver.upper - 1e-12);
      expect(b.design.lower).toBeLessThanOrEqual(b.maneuver.lower + 1e-12);
    }
  });

  it('lets the V_C gust exceed the negative limit, as is usual for a light aircraft', () => {
    const b = vnBoundaries(diagram, limits.cruiseSpeed);
    expect(b?.gust.lower).toBeLessThan(-1.52);
    expect(b?.gust.upper).toBeLessThan(3.8);
  });

  it('moves V_A with the square root of weight', () => {
    const light = vnDiagram({ ...c172, mass: c172.mass * 0.8 }, limits, 0, sl.density);
    expect(light.maneuveringSpeed / diagram.maneuveringSpeed).toBeCloseTo(Math.sqrt(0.8), 12);
  });
});

describe('structural limits', () => {
  it('accepts every preset’s limits', () => {
    for (const aircraft of Object.values(PRESETS)) {
      if (aircraft.structure) expect(validateStructure(aircraft.structure)).toEqual([]);
    }
  });

  it('rejects a dive speed below the cruising speed, and values out of range', () => {
    expect(validateStructure({ ...limits, diveSpeed: limits.cruiseSpeed })).toHaveLength(1);
    expect(validateStructure({ ...limits, nNegative: 1 })).toHaveLength(1);
    expect(validateStructure({ ...limits, clMin: Number.NaN })).toHaveLength(1);
  });
});
