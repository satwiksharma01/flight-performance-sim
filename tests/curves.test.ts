import { describe, expect, it } from 'vitest';
import { isa } from '../src/physics/atmosphere.js';
import {
  characteristicSpeeds,
  evaluatePoint,
  generateCurve,
  isAttainable,
} from '../src/physics/performance/curves.js';
import {
  maxLiftToDrag,
  stallSpeed,
  vJetRange,
  vMinDrag,
  vMinPower,
  type Aircraft,
} from '../src/physics/aero.js';
import { CESSNA_172S, GENERIC_JET_TRAINER, GENERIC_SAILPLANE } from '../src/data/aircraft/presets.js';

const SEA_LEVEL = isa(0);
const ALTITUDE = isa(4000);

describe('evaluatePoint', () => {
  it('equates thrust required with drag in level flight', () => {
    const point = evaluatePoint(CESSNA_172S, SEA_LEVEL, 55);
    expect(point.thrustRequired).toBe(point.drag);
  });

  it('computes power required as drag times true airspeed', () => {
    const point = evaluatePoint(CESSNA_172S, SEA_LEVEL, 55);
    expect(point.powerRequired).toBeCloseTo(point.drag * 55, 9);
  });

  it('splits total drag into its two components', () => {
    const point = evaluatePoint(CESSNA_172S, SEA_LEVEL, 55);
    expect(point.parasiteDrag + point.inducedDrag).toBeCloseTo(point.drag, 9);
  });

  it('carries every airspeed representation', () => {
    const point = evaluatePoint(CESSNA_172S, ALTITUDE, 70);
    expect(point.speeds.tas).toBe(70);
    expect(point.speeds.eas).toBeLessThan(70);
    expect(point.speeds.cas).toBeLessThan(70);
    expect(point.speeds.mach).toBeGreaterThan(0);
    expect(point.speeds.dynamicPressure).toBeGreaterThan(0);
  });
});

describe('isAttainable', () => {
  it('rejects speeds below the stall', () => {
    const vs = stallSpeed(CESSNA_172S, SEA_LEVEL.density);
    expect(isAttainable(CESSNA_172S, SEA_LEVEL, vs * 0.9)).toBe(false);
    expect(isAttainable(CESSNA_172S, SEA_LEVEL, vs * 1.1)).toBe(true);
  });

  it('raises the boundary with load factor', () => {
    const vs = stallSpeed(CESSNA_172S, SEA_LEVEL.density);
    expect(isAttainable(CESSNA_172S, SEA_LEVEL, vs * 1.1, 2)).toBe(false);
  });
});

describe('generateCurve', () => {
  it('produces the requested number of points', () => {
    expect(generateCurve(CESSNA_172S, SEA_LEVEL).points).toHaveLength(200);
    expect(generateCurve(CESSNA_172S, SEA_LEVEL, { points: 50 }).points).toHaveLength(50);
  });

  it('starts at the stall speed by default', () => {
    const curve = generateCurve(CESSNA_172S, SEA_LEVEL);
    expect(curve.points[0]?.speeds.tas).toBeCloseTo(curve.stallSpeed, 9);
  });

  it('reaches CLmax at the first point', () => {
    // Sampling begins exactly at the stall, where by definition CL = CLmax.
    const curve = generateCurve(CESSNA_172S, SEA_LEVEL);
    expect(curve.points[0]?.cl).toBeCloseTo(CESSNA_172S.clMax, 6);
  });

  it('lands the final sample exactly on the maximum speed', () => {
    // Accumulating a step would leave the last point a rounding short, which
    // shows up as a chart that stops just before its own axis limit.
    const curve = generateCurve(CESSNA_172S, SEA_LEVEL, { maxSpeed: 90, points: 37 });
    expect(curve.points[curve.points.length - 1]?.speeds.tas).toBe(90);
  });

  it('increases speed monotonically', () => {
    const curve = generateCurve(CESSNA_172S, SEA_LEVEL, { points: 60 });
    for (let i = 1; i < curve.points.length; i++) {
      expect(curve.points[i]!.speeds.tas).toBeGreaterThan(curve.points[i - 1]!.speeds.tas);
    }
  });

  it('puts the sampled drag minimum at the minimum-drag marker', () => {
    const curve = generateCurve(CESSNA_172S, SEA_LEVEL, { points: 2000 });
    const minimum = curve.points.reduce((best, p) => (p.drag < best.drag ? p : best));
    const marker = curve.markers.find((m) => m.kind === 'min-drag');

    // Within one sample spacing of the closed-form answer.
    const spacing =
      curve.points[1]!.speeds.tas - curve.points[0]!.speeds.tas;
    expect(Math.abs(minimum.speeds.tas - marker!.tas)).toBeLessThan(spacing);
  });

  it('rejects a degenerate speed range or sample count', () => {
    expect(() => generateCurve(CESSNA_172S, SEA_LEVEL, { points: 1 })).toThrow(RangeError);
    expect(() => generateCurve(CESSNA_172S, SEA_LEVEL, { points: 2.5 })).toThrow(RangeError);
    expect(() =>
      generateCurve(CESSNA_172S, SEA_LEVEL, { minSpeed: 80, maxSpeed: 40 }),
    ).toThrow(RangeError);
    expect(() => generateCurve(CESSNA_172S, SEA_LEVEL, { minSpeed: 0 })).toThrow(RangeError);
  });

  it('reports (L/D)max independently of the sampling', () => {
    const coarse = generateCurve(CESSNA_172S, SEA_LEVEL, { points: 5 });
    const fine = generateCurve(CESSNA_172S, SEA_LEVEL, { points: 5000 });
    expect(coarse.maxLiftToDrag).toBe(fine.maxLiftToDrag);
    expect(coarse.maxLiftToDrag).toBeCloseTo(maxLiftToDrag(CESSNA_172S), 12);
  });
});

describe('characteristic speed markers', () => {
  it('provides all four kinds', () => {
    const kinds = characteristicSpeeds(CESSNA_172S, SEA_LEVEL).map((m) => m.kind);
    expect(kinds).toEqual(['stall', 'min-power', 'min-drag', 'jet-range']);
  });

  it('matches the closed-form speeds exactly', () => {
    const markers = characteristicSpeeds(CESSNA_172S, SEA_LEVEL);
    const at = (kind: string) => markers.find((m) => m.kind === kind)!.tas;

    expect(at('stall')).toBeCloseTo(stallSpeed(CESSNA_172S, SEA_LEVEL.density), 12);
    expect(at('min-power')).toBeCloseTo(vMinPower(CESSNA_172S, SEA_LEVEL.density), 12);
    expect(at('min-drag')).toBeCloseTo(vMinDrag(CESSNA_172S, SEA_LEVEL.density), 12);
    expect(at('jet-range')).toBeCloseTo(vJetRange(CESSNA_172S, SEA_LEVEL.density), 12);
  });

  it('orders V_mp < V_md < V_jr', () => {
    const markers = characteristicSpeeds(CESSNA_172S, SEA_LEVEL);
    const at = (kind: string) => markers.find((m) => m.kind === kind)!.tas;
    expect(at('min-power')).toBeLessThan(at('min-drag'));
    expect(at('min-drag')).toBeLessThan(at('jet-range'));
  });

  it('gives V_mp and V_jr the same L/D and the same drag', () => {
    // CL_mp = sqrt(3)*CL_md and CL_jr = CL_md/sqrt(3) sit on opposite sides of
    // the polar at exactly the same lift-to-drag ratio, sqrt(3)*CL_md/(4*CD0).
    // An exact identity, so it catches an algebra slip in either speed.
    const markers = characteristicSpeeds(CESSNA_172S, SEA_LEVEL);
    const at = (kind: string) => markers.find((m) => m.kind === kind)!.point;

    expect(at('min-power').liftToDrag).toBeCloseTo(at('jet-range').liftToDrag, 9);
    expect(at('min-power').drag).toBeCloseTo(at('jet-range').drag, 6);
    expect(at('min-power').liftToDrag).toBeLessThan(maxLiftToDrag(CESSNA_172S));
  });

  it('achieves (L/D)max at the minimum-drag marker', () => {
    const marker = characteristicSpeeds(CESSNA_172S, SEA_LEVEL).find(
      (m) => m.kind === 'min-drag',
    )!;
    expect(marker.point.liftToDrag).toBeCloseTo(maxLiftToDrag(CESSNA_172S), 6);
    expect(marker.point.parasiteDrag).toBeCloseTo(marker.point.inducedDrag, 6);
  });

  it('marks every characteristic speed attainable for a normal aircraft', () => {
    // Not the 172S: its polar, calibrated to the POH glide, puts CL_mp = 1.62
    // above its CLmax of 1.54, so V_mp sits just below the stall.
    for (const marker of characteristicSpeeds(GENERIC_JET_TRAINER, SEA_LEVEL)) {
      expect(marker.attainable).toBe(true);
    }
    for (const marker of characteristicSpeeds(GENERIC_SAILPLANE, SEA_LEVEL)) {
      expect(marker.attainable).toBe(true);
    }
  });

  it('flags minimum power as unattainable when CL_mp exceeds CLmax', () => {
    // CL at minimum power is sqrt(3*CD0/k) = 1.365 for this polar. Drop CLmax
    // below that and the wing stalls before reaching the minimum-power
    // condition, so V_mp lies below the stall speed and cannot be flown.
    const draggy: Aircraft = { ...CESSNA_172S, clMax: 1.2 };
    const markers = characteristicSpeeds(draggy, SEA_LEVEL);

    const minPower = markers.find((m) => m.kind === 'min-power')!;
    expect(minPower.attainable).toBe(false);
    expect(minPower.tas).toBeLessThan(stallSpeed(draggy, SEA_LEVEL.density));

    // The rest are still reachable, so the flag has to be per-marker.
    expect(markers.find((m) => m.kind === 'min-drag')!.attainable).toBe(true);
  });

  it('carries an explanation for every marker', () => {
    for (const marker of characteristicSpeeds(CESSNA_172S, SEA_LEVEL)) {
      expect(marker.label.length).toBeGreaterThan(0);
      expect(marker.significance.length).toBeGreaterThan(20);
    }
  });
});

describe('altitude and load factor', () => {
  it('raises every characteristic speed in TAS with altitude', () => {
    const low = characteristicSpeeds(CESSNA_172S, SEA_LEVEL);
    const high = characteristicSpeeds(CESSNA_172S, ALTITUDE);

    for (let i = 0; i < low.length; i++) {
      expect(high[i]!.tas).toBeGreaterThan(low[i]!.tas);
    }
  });

  it('holds every characteristic speed constant in EAS', () => {
    // Each characteristic speed is defined by a lift coefficient, and CL fixes
    // dynamic pressure — so all of them are altitude-invariant in EAS even
    // though every one of them changes in TAS.
    const low = characteristicSpeeds(CESSNA_172S, SEA_LEVEL);
    const high = characteristicSpeeds(CESSNA_172S, ALTITUDE);

    for (let i = 0; i < low.length; i++) {
      expect(high[i]!.point.speeds.eas).toBeCloseTo(low[i]!.point.speeds.eas, 6);
      expect(high[i]!.point.speeds.tas).not.toBeCloseTo(low[i]!.point.speeds.tas, 1);
    }
  });

  it('leaves (L/D)max unchanged by altitude', () => {
    expect(generateCurve(CESSNA_172S, ALTITUDE).maxLiftToDrag).toBeCloseTo(
      generateCurve(CESSNA_172S, SEA_LEVEL).maxLiftToDrag,
      12,
    );
  });

  it('raises the stall speed under load factor', () => {
    const pulling = generateCurve(CESSNA_172S, SEA_LEVEL, { loadFactor: 4 });
    const level = generateCurve(CESSNA_172S, SEA_LEVEL);
    expect(pulling.stallSpeed).toBeCloseTo(2 * level.stallSpeed, 6);
    expect(pulling.loadFactor).toBe(4);
  });
  it('moves every characteristic speed up by sqrt(n) under load', () => {
    // Before 2026-10-03 the optima stayed at their 1 g speeds whatever n was.
    const level = characteristicSpeeds(CESSNA_172S, SEA_LEVEL);
    const turning = characteristicSpeeds(CESSNA_172S, SEA_LEVEL, 2);
    level.forEach((m, i) => {
      expect(turning[i]!.tas).toBeCloseTo(Math.SQRT2 * m.tas, 9);
    });
  });

  it('puts the loaded V_md on the minimum of the loaded drag curve', () => {
    const n = 2;
    const marker = characteristicSpeeds(CESSNA_172S, SEA_LEVEL, n).find((m) => m.kind === 'min-drag')!;
    let best = 0;
    let bestDrag = Infinity;
    for (let v = 20; v <= 120; v += 0.001) {
      const d = evaluatePoint(CESSNA_172S, SEA_LEVEL, v, n).drag;
      if (d < bestDrag) {
        bestDrag = d;
        best = v;
      }
    }
    expect(marker.tas).toBeCloseTo(best, 2);
  });
});
