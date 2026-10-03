/**
 * Checks against numbers published outside this codebase.
 *
 * The other suites verify the algebra against itself (closed forms against a
 * brute-force scan, round trips, continuity). These ask whether the answers
 * agree with a textbook and with figures working pilots use.
 */

import { describe, expect, it } from 'vitest';
import { atPressureAltitude } from '../src/physics/atmosphere.js';
import { pitotPressureRatio, tasToCas } from '../src/physics/airspeed.js';
import { maxLiftToDrag, minimumDrag, vMinDrag, type Aircraft } from '../src/physics/aero.js';
import { ceilings, climbPerformance, type PoweredAircraft } from '../src/physics/performance/climb.js';
import { CESSNA_172S } from '../src/data/aircraft/presets.js';

const LB = 0.45359237;
const FT = 0.3048;
const KT = 1852 / 3600;
const G0 = 9.80665;

/** An aircraft from a textbook's imperial data. Only W, S, AR, e and CD0 matter here. */
function fromBook(weightLb: number, areaFt2: number, aspectRatio: number, e: number, cd0: number): Aircraft {
  return {
    name: 'book',
    mass: weightLb * LB,
    wingArea: areaFt2 * FT * FT,
    aspectRatio,
    oswaldEfficiency: e,
    cd0,
    clMax: 1.5,
  };
}

describe('Anderson, Introduction to Flight, worked examples', () => {
  // CP-1 is the book's light single (modelled on a Cessna Skylane), CP-2 its
  // business jet (modelled on a Citation). The book quotes (L/D)max to 3 s.f.
  const cp1 = fromBook(2950, 174, 7.37, 0.8, 0.025);
  const cp2 = fromBook(19815, 318, 8.93, 0.81, 0.02);

  it('gives (L/D)max = 13.6 for CP-1', () => {
    expect(maxLiftToDrag(cp1)).toBeCloseTo(13.6, 1);
  });

  it('gives (L/D)max = 16.9 for CP-2', () => {
    expect(maxLiftToDrag(cp2)).toBeCloseTo(16.9, 1);
  });

  it('gives a minimum thrust required of about 217 lb for CP-1', () => {
    const lbf = minimumDrag(cp1) / (LB * G0);
    expect(lbf).toBeGreaterThan(216);
    expect(lbf).toBeLessThan(218);
  });
});

describe('airline figures', () => {
  // Flight levels are pressure altitudes.
  const fl350 = atPressureAltitude(35000 * FT);

  it('gives a speed of sound of 576 kt at FL350 on a standard day', () => {
    expect(fl350.speedOfSound / KT).toBeCloseTo(576.4, 1);
  });

  it('puts Mach 0.78 at FL350 at 450 KTAS and about 265 KCAS', () => {
    const tas = 0.78 * fl350.speedOfSound;
    expect(tas / KT).toBeCloseTo(449.6, 1);
    const cas = tasToCas(tas, fl350.pressure, fl350.speedOfSound) / KT;
    expect(cas).toBeGreaterThan(263.5);
    expect(cas).toBeLessThan(265.5);
  });
});

describe('NACA Report 1135, normal-shock tables', () => {
  // Above Mach 1 a pitot probe reads total pressure behind a normal shock. The
  // tables give p02/p1 directly. Found missing by the Python cross-check on
  // 2026-10-02: the core used the subsonic relation here, off by up to 6 %.
  it.each([
    [1.5, 3.413],
    [2.0, 5.640],
  ])('gives pitot total over static pressure at Mach %f as %f', (mach, table) => {
    expect(pitotPressureRatio(mach)).toBeCloseTo(table, 3);
  });
});

describe('Cessna 172S against its POH, 2,550 lb, sea level, standard day', () => {
  // POH speeds are KIAS. At these speeds the 172S's position error is about a
  // knot, so KIAS ≈ KCAS, and at sea level KCAS = KEAS = KTAS.
  const c172 = CESSNA_172S as PoweredAircraft;
  const sl = atPressureAltitude(0);
  const perf = climbPerformance(c172, sl);
  const fpm = (ms: number) => (ms / FT) * 60;

  describe('calibration: each fitted parameter reproduces the figures it was fitted to', () => {
    it('glides best at 68 kt, at 9:1', () => {
      expect(vMinDrag(c172, sl.density) / KT).toBeCloseTo(68, 0);
      expect(maxLiftToDrag(c172)).toBeCloseTo(9, 1);
    });

    it('climbs best at 74 kt and 730 ft/min', () => {
      expect(perf.vy.tas / KT).toBeCloseTo(74, 0);
      expect(fpm(perf.vy.rateOfClimb)).toBeGreaterThan(725);
      expect(fpm(perf.vy.rateOfClimb)).toBeLessThan(735);
    });
  });

  describe('validation: figures the calibration never saw', () => {
    it('puts V_x within 2 kt of the published 62 KIAS', () => {
      expect(Math.abs(perf.vx.tas / KT - 62)).toBeLessThan(2);
    });

    it('puts the service ceiling within 100 ft of the published 14,000 ft', () => {
      const service = ceilings(c172).service! / FT;
      expect(Math.abs(service - 14000)).toBeLessThan(100);
    });
  });

  describe('known discrepancy, pinned rather than tuned away', () => {
    it('reads maximum level speed about 9 % below the published 126 KTAS', () => {
      // The polar was fitted to the POH glide, which is flown with the
      // propeller windmilling. That drag is real in the glide but not in
      // powered flight, so the polar overstates drag at high speed. If a
      // change moves this, it is a result worth noticing.
      const vmax = perf.maxLevelSpeed! / KT;
      expect(vmax).toBeGreaterThan(110);
      expect(vmax).toBeLessThan(120);
    });
  });
});
