import { describe, expect, it } from 'vitest';
import { atPressureAltitude } from '../src/physics/atmosphere.js';
import { clMinDrag, k, maxLiftToDrag } from '../src/physics/aero.js';
import { bestGlide, bestGlideInWind, glideAtCl, minimumSink } from '../src/physics/performance/glide.js';
import { CESSNA_172S, GENERIC_SAILPLANE } from '../src/data/aircraft/presets.js';

const SL = atPressureAltitude(0);
const HIGH = atPressureAltitude(3000);
const GLIDER = GENERIC_SAILPLANE;

describe('steady glide', () => {
  it('sets the glide angle from the polar alone: tan(gamma) = CD / CL', () => {
    const cl = 0.8;
    const g = glideAtCl(GLIDER, SL, cl);
    expect(Math.tan(g.gamma)).toBeCloseTo((GLIDER.cd0 + k(GLIDER) * cl * cl) / cl, 12);
  });

  it('balances the forces: lift W cos(gamma), drag W sin(gamma)', () => {
    const g = glideAtCl(GLIDER, SL, 0.9);
    const q = 0.5 * SL.density * g.tas * g.tas;
    const w = GLIDER.mass * 9.80665;
    expect(q * GLIDER.wingArea * 0.9).toBeCloseTo(w * Math.cos(g.gamma), 6);
  });
});

describe('best glide', () => {
  it('glides at (L/D)max, at CL_md', () => {
    const g = bestGlide(GLIDER, SL);
    expect(g.glideRatio).toBeCloseTo(maxLiftToDrag(GLIDER), 12);
    expect(g.cl).toBeCloseTo(clMinDrag(GLIDER), 12);
  });

  it('keeps the same ratio at any weight or height; only the speed changes', () => {
    const heavy = bestGlide({ ...GLIDER, mass: 600 }, HIGH);
    expect(heavy.glideRatio).toBeCloseTo(bestGlide(GLIDER, SL).glideRatio, 12);
    expect(heavy.tas).toBeGreaterThan(bestGlide(GLIDER, SL).tas);
  });
});

describe('minimum sink', () => {
  it('sinks slower than best glide, at a slower speed', () => {
    const sink = minimumSink(GLIDER, SL);
    const glide = bestGlide(GLIDER, SL);
    expect(sink.sinkRate).toBeLessThan(glide.sinkRate);
    expect(sink.tas).toBeLessThan(glide.tas);
  });

  it('sits close to CL_mp = sqrt(3 CD0 / k)', () => {
    // Not exactly there: cos(gamma) enters the speed. Within 1 % for a glider.
    const clMp = Math.sqrt((3 * GLIDER.cd0) / k(GLIDER));
    expect(minimumSink(GLIDER, SL).cl / clMp).toBeCloseTo(1, 2);
  });

  it('is limited by the stall for the 172S, whose CL_mp is above CLmax', () => {
    expect(minimumSink(CESSNA_172S, SL).limitedByStall).toBe(true);
  });
});

describe('glide in wind', () => {
  it('is best glide in still air', () => {
    expect(bestGlideInWind(GLIDER, SL, 0)!.glide.cl).toBeCloseTo(bestGlide(GLIDER, SL).cl, 5);
  });

  it('flies faster into a headwind and slower with a tailwind', () => {
    const still = bestGlide(GLIDER, SL).tas;
    expect(bestGlideInWind(GLIDER, SL, 10)!.glide.tas).toBeGreaterThan(still);
    expect(bestGlideInWind(GLIDER, SL, -10)!.glide.tas).toBeLessThan(still);
  });

  it('loses ground distance into a headwind', () => {
    expect(bestGlideInWind(GLIDER, SL, 10)!.groundRatio).toBeLessThan(maxLiftToDrag(GLIDER));
  });

  it('reports no progress into a wind faster than the aircraft', () => {
    expect(bestGlideInWind(GLIDER, SL, 200)).toBeNull();
  });
});
