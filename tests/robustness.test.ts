/**
 * Property tests: thousands of random scenarios, including hostile links.
 *
 * Every permalink is user input. Whatever it says, the explorer must either
 * draw finite numbers or explain why it can't; it must never throw.
 */

import { describe, expect, it } from 'vitest';
import type { Aircraft } from '../src/physics/aero.js';
import { buildChartModel, type SpeedAxis, type SpeedUnit } from '../src/app/model.js';
import { readPermalink } from '../src/app/permalink.js';
import type { Scenario } from '../src/state/url.js';

/** Small seeded PRNG, so a failure reproduces exactly. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AXES: SpeedAxis[] = ['tas', 'eas', 'cas', 'mach'];
const UNITS: SpeedUnit[] = ['kt', 'mps', 'kmh'];

/** Log-uniform: spans orders of magnitude evenly. */
function logUniform(rand: () => number, low: number, high: number): number {
  return Math.exp(Math.log(low) + rand() * (Math.log(high) - Math.log(low)));
}

function randomScenario(rand: () => number): Scenario {
  const aircraft: Aircraft = {
    name: 'random',
    mass: logUniform(rand, 0.1, 1e6),
    wingArea: logUniform(rand, 0.01, 2000),
    aspectRatio: logUniform(rand, 0.5, 50),
    oswaldEfficiency: 0.1 + rand() * 0.9,
    cd0: logUniform(rand, 1e-4, 0.5),
    clMax: logUniform(rand, 0.05, 5),
  };
  return {
    presetId: null,
    aircraft,
    altitude: -1000 + rand() * 85_000,
    deltaISA: -60 + rand() * 120,
    tas: 1 + rand() * 999,
    mass: aircraft.mass * (0.3 + rand() * 0.7),
    loadFactor: 1 + rand() * 9,
  };
}

function allFinite(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

function check(scenario: Scenario, axis: SpeedAxis, unit: SpeedUnit) {
  const model = buildChartModel(scenario, { axis, unit, system: unit === 'kt' ? 'us' : 'si' });
  const w = model.window;

  expect(allFinite([w.xMax, w.dragMax, w.powerMax, w.liftToDragMax])).toBe(true);
  expect(w.xMax).toBeGreaterThan(0);

  for (const series of [model.x, model.drag, model.parasiteDrag, model.inducedDrag, model.power, model.liftToDrag]) {
    expect(allFinite(series)).toBe(true);
    expect(series).toHaveLength(model.x.length);
  }
  for (let i = 1; i < model.x.length; i++) {
    expect(model.x[i]!).toBeGreaterThan(model.x[i - 1]!);
  }

  expect(model.x.length === 0).toBe(model.emptyReason !== null);
  expect(allFinite(model.markers.flatMap((m) => [m.x, m.tas, m.point.drag]))).toBe(true);
  expect(allFinite([model.selected.x, model.selected.point.drag, model.selected.point.powerRequired])).toBe(true);
}

describe('random aircraft and conditions', () => {
  it('always yields finite, ordered numbers or an explained empty chart', () => {
    const rand = mulberry32(20261002);
    for (let i = 0; i < 2000; i++) {
      const scenario = randomScenario(rand);
      const axis = AXES[i % AXES.length]!;
      const unit = UNITS[i % UNITS.length]!;
      try {
        check(scenario, axis, unit);
      } catch (error) {
        throw new Error(`case ${i} (${axis}, ${unit}) failed for ${JSON.stringify(scenario)}: ${String(error)}`);
      }
    }
  });
});

describe('hostile links', () => {
  const KEYS = ['ac', 'nm', 'm', 's', 'ar', 'e', 'cd0', 'clmax', 'clf', 'h', 'disa', 'v', 'w', 'n', 'x', 'u'];
  const VALUES = [
    '', ' ', '0', '-0', '-1', '1e400', '-1e400', 'NaN', 'Infinity', '0x10', '1e-320', '84852', '84853',
    '-1001', '60', '-60', '61', '1000', '1001', 'c172', 'sailplane', 'jet-trainer', 'tas', 'mach', 'kt',
    '<script>', '%00', '1,5', '٣', '9'.repeat(400),
  ];

  it('never throws, whatever the query string', () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 3000; i++) {
      const params = new URLSearchParams();
      const count = 1 + Math.floor(rand() * 8);
      for (let j = 0; j < count; j++) {
        params.append(KEYS[Math.floor(rand() * KEYS.length)]!, VALUES[Math.floor(rand() * VALUES.length)]!);
      }
      const query = params.toString();
      try {
        const link = readPermalink(query);
        check(link.scenario, link.view.axis, link.view.unit);
        buildChartModel(link.scenario, link.view);
      } catch (error) {
        throw new Error(`query "${query}" failed: ${String(error)}`);
      }
    }
  });
});
