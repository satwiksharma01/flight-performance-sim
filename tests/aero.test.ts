import { describe, expect, it } from 'vitest';
import { isa } from '../src/physics/atmosphere.js';
import { tasToEas } from '../src/physics/airspeed.js';
import {
  clMinDrag,
  dragAtSpeed,
  inducedDragFactor,
  maxClHalfOverCd,
  maxClThreeHalvesOverCd,
  maxLiftToDrag,
  minimumDrag,
  stallSpeed,
  vJetRange,
  vMinDrag,
  vMinPower,
  validateAircraft,
  weight,
  type Aircraft,
} from '../src/physics/aero.js';
import { CESSNA_172S, GENERIC_SAILPLANE } from '../src/data/aircraft/presets.js';
import { mpsToKnots, mps } from '../src/physics/units.js';

const SEA_LEVEL = isa(0);

/** Brute-force minimiser used only to verify the closed forms. */
function scanForMinimum(
  objective: (v: number) => number,
  low = 5,
  high = 400,
  steps = 400_000,
): number {
  let best = low;
  let bestValue = Number.POSITIVE_INFINITY;
  const step = (high - low) / steps;
  for (let v = low; v <= high; v += step) {
    const value = objective(v);
    if (value < bestValue) {
      bestValue = value;
      best = v;
    }
  }
  return best;
}

describe('drag polar', () => {
  it('computes k = 1/(pi*e*AR)', () => {
    expect(inducedDragFactor(7.32, 0.75)).toBeCloseTo(1 / (Math.PI * 0.75 * 7.32), 12);
  });

  it('rejects a non-physical aspect ratio or efficiency', () => {
    expect(() => inducedDragFactor(0, 0.8)).toThrow(RangeError);
    expect(() => inducedDragFactor(7, 1.5)).toThrow(RangeError);
  });

  it('grows parasite drag as V^2 and shrinks induced drag as 1/V^2', () => {
    const slow = dragAtSpeed(CESSNA_172S, 40, SEA_LEVEL.density);
    const fast = dragAtSpeed(CESSNA_172S, 80, SEA_LEVEL.density);

    expect(fast.parasite / slow.parasite).toBeCloseTo(4, 6);
    expect(fast.induced / slow.induced).toBeCloseTo(0.25, 6);
  });

  it('balances lift against weight in level flight', () => {
    const state = dragAtSpeed(CESSNA_172S, 55, SEA_LEVEL.density);
    const l =
      0.5 * SEA_LEVEL.density * 55 * 55 * CESSNA_172S.wingArea * state.cl;
    expect(l).toBeCloseTo(weight(CESSNA_172S.mass), 6);
  });

  it('rejects a zero or negative airspeed', () => {
    expect(() => dragAtSpeed(CESSNA_172S, 0, SEA_LEVEL.density)).toThrow(RangeError);
  });
});

describe('closed-form optima match a brute-force scan', () => {
  // The whole point of the analytic solutions: if these disagree, one of them
  // is wrong, and the scan is the one making no assumptions.
  const cases: Aircraft[] = [CESSNA_172S, GENERIC_SAILPLANE];

  for (const aircraft of cases) {
    it(`locates V_md for the ${aircraft.name}`, () => {
      const scanned = scanForMinimum(
        (v) => dragAtSpeed(aircraft, v, SEA_LEVEL.density).total,
      );
      expect(vMinDrag(aircraft, SEA_LEVEL.density)).toBeCloseTo(scanned, 1);
    });

    it(`locates V_mp for the ${aircraft.name}`, () => {
      const scanned = scanForMinimum(
        (v) => dragAtSpeed(aircraft, v, SEA_LEVEL.density).total * v,
      );
      expect(vMinPower(aircraft, SEA_LEVEL.density)).toBeCloseTo(scanned, 1);
    });

    it(`locates (L/D)max for the ${aircraft.name}`, () => {
      const scanned = scanForMinimum(
        (v) => -dragAtSpeed(aircraft, v, SEA_LEVEL.density).liftToDrag,
      );
      const scannedRatio = dragAtSpeed(aircraft, scanned, SEA_LEVEL.density).liftToDrag;
      expect(maxLiftToDrag(aircraft)).toBeCloseTo(scannedRatio, 4);
    });

    it(`locates the jet range parameter for the ${aircraft.name}`, () => {
      const scanned = scanForMinimum((v) => {
        const d = dragAtSpeed(aircraft, v, SEA_LEVEL.density);
        return -Math.sqrt(d.cl) / d.cd;
      });
      expect(vJetRange(aircraft, SEA_LEVEL.density)).toBeCloseTo(scanned, 1);
    });

    it(`locates the propeller endurance parameter for the ${aircraft.name}`, () => {
      const scanned = scanForMinimum((v) => {
        const d = dragAtSpeed(aircraft, v, SEA_LEVEL.density);
        return -Math.pow(d.cl, 1.5) / d.cd;
      });
      const d = dragAtSpeed(aircraft, scanned, SEA_LEVEL.density);
      expect(maxClThreeHalvesOverCd(aircraft)).toBeCloseTo(
        Math.pow(d.cl, 1.5) / d.cd,
        3,
      );
    });
  }
});

describe('relationships between the characteristic speeds', () => {
  it('splits drag equally between parasite and induced at V_md', () => {
    // This equality *is* the minimum-drag condition. It is the cleanest
    // available check that V_md is correct.
    const vmd = vMinDrag(CESSNA_172S, SEA_LEVEL.density);
    const d = dragAtSpeed(CESSNA_172S, vmd, SEA_LEVEL.density);
    expect(d.parasite).toBeCloseTo(d.induced, 6);
  });

  it('holds V_mp = V_md / 3^(1/4) and V_jr = V_md * 3^(1/4)', () => {
    const vmd = vMinDrag(CESSNA_172S, SEA_LEVEL.density);
    expect(vMinPower(CESSNA_172S, SEA_LEVEL.density) / vmd).toBeCloseTo(
      Math.pow(3, -0.25),
      9,
    );
    expect(vJetRange(CESSNA_172S, SEA_LEVEL.density) / vmd).toBeCloseTo(
      Math.pow(3, 0.25),
      9,
    );
  });

  it('puts CL at minimum drag at sqrt(CD0/k)', () => {
    const vmd = vMinDrag(CESSNA_172S, SEA_LEVEL.density);
    expect(dragAtSpeed(CESSNA_172S, vmd, SEA_LEVEL.density).cl).toBeCloseTo(
      clMinDrag(CESSNA_172S),
      6,
    );
  });

  it('makes minimum drag equal W/(L/D)max', () => {
    expect(minimumDrag(CESSNA_172S)).toBeCloseTo(
      weight(CESSNA_172S.mass) / maxLiftToDrag(CESSNA_172S),
      6,
    );
  });

  it('leaves (L/D)max independent of weight and altitude', () => {
    // It depends only on the polar. The speed at which it occurs does not.
    const heavier: Aircraft = { ...CESSNA_172S, mass: CESSNA_172S.mass * 1.3 };
    expect(maxLiftToDrag(heavier)).toBeCloseTo(maxLiftToDrag(CESSNA_172S), 12);
    expect(vMinDrag(heavier, SEA_LEVEL.density)).toBeGreaterThan(
      vMinDrag(CESSNA_172S, SEA_LEVEL.density),
    );
  });

  it('gives the sailplane a far better L/D than the trainer', () => {
    expect(maxLiftToDrag(GENERIC_SAILPLANE)).toBeGreaterThan(
      2 * maxLiftToDrag(CESSNA_172S),
    );
  });

  it('computes a positive jet range parameter', () => {
    expect(maxClHalfOverCd(CESSNA_172S)).toBeGreaterThan(0);
  });
});

describe('stall speed', () => {
  it('is constant in EAS at every altitude', () => {
    // The result that makes the airspeed module worth having: a pilot's
    // handbook stall speed needs no altitude correction, because the indicator
    // and the wing are both reading dynamic pressure.
    const reference = tasToEas(
      stallSpeed(CESSNA_172S, SEA_LEVEL.density),
      SEA_LEVEL.density,
    );

    for (const h of [0, 2000, 5000, 8000]) {
      const state = isa(h);
      const eas = tasToEas(stallSpeed(CESSNA_172S, state.density), state.density);
      expect(eas).toBeCloseTo(reference, 6);
    }
  });

  it('rises in TAS with altitude', () => {
    expect(stallSpeed(CESSNA_172S, isa(5000).density)).toBeGreaterThan(
      stallSpeed(CESSNA_172S, isa(0).density),
    );
  });

  it('scales with the square root of load factor', () => {
    const oneG = stallSpeed(CESSNA_172S, SEA_LEVEL.density);
    expect(stallSpeed(CESSNA_172S, SEA_LEVEL.density, 4)).toBeCloseTo(2 * oneG, 6);
  });

  it('reproduces published Cessna 172S stall speeds within 2 kt', () => {
    // Published (POH): Vs1 53 KCAS clean, Vs0 48 KCAS full flap, both at the
    // 2,550 lb max takeoff weight, most forward CG.
    // At sea level on a standard day CAS, EAS and TAS coincide, so a direct
    // comparison is valid here and nowhere else.
    const clean = mpsToKnots(mps(stallSpeed(CESSNA_172S, SEA_LEVEL.density)));
    const flapped = mpsToKnots(
      mps(stallSpeed(CESSNA_172S, SEA_LEVEL.density, 1, CESSNA_172S.clMaxFlaps)),
    );

    expect(Math.abs(clean - 53)).toBeLessThan(2);
    expect(Math.abs(flapped - 48)).toBeLessThan(2);
  });

  it('rejects a zero CLmax', () => {
    expect(() => stallSpeed({ ...CESSNA_172S, clMax: 0 }, SEA_LEVEL.density)).toThrow(
      RangeError,
    );
  });
});

describe('the 172S polar, calibrated to its POH glide', () => {
  it('glides at the published 9:1', () => {
    // CD0 and e were fitted to the POH best glide, 68 KIAS at 9:1. Before that
    // calibration the estimated CD0 of 0.036 gave 10.9 and was pinned as a
    // known error; see tests/references.test.ts for the full POH comparison.
    expect(maxLiftToDrag(CESSNA_172S)).toBeCloseTo(9, 1);
  });
});

describe('aircraft validation', () => {
  it('accepts every preset', () => {
    expect(validateAircraft(CESSNA_172S)).toEqual([]);
    expect(validateAircraft(GENERIC_SAILPLANE)).toEqual([]);
  });

  it('reports each physically invalid input', () => {
    const problems = validateAircraft({
      ...CESSNA_172S,
      wingArea: -10,
      clMax: 0,
      cd0: 0,
    });
    expect(problems).toHaveLength(3);
    expect(problems.some((p) => p.includes('Wing area'))).toBe(true);
  });
});
