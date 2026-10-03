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

/** No engine, or one of each kind, across its whole supported range. */
function randomEngine(rand: () => number): Pick<Aircraft, 'propulsion'> {
  const pick = Math.floor(rand() * 4);
  const propeller = { staticThrust: logUniform(rand, 10, 200_000), zeroThrustSpeed: 20 + rand() * 380 };
  if (pick === 0) return {};
  if (pick === 1) {
    return { propulsion: { kind: 'piston', power: logUniform(rand, 1e3, 2e7), propeller, ...(rand() < 0.5 ? { criticalAltitude: rand() * 15000 } : {}) } };
  }
  if (pick === 2) {
    return { propulsion: { kind: 'turboprop', power: logUniform(rand, 1e3, 2e7), lapseExponent: 0.3 + rand() * 1.2, propeller } };
  }
  return { propulsion: { kind: 'turbofan', thrust: logUniform(rand, 10, 5e5), lapseExponent: 0.3 + rand() * 1.2 } };
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
    ...randomEngine(rand),
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
  const model = buildChartModel(scenario, { axis, unit, system: unit === 'kt' ? 'us' : 'si', tab: 'curves' });
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

  const roc = model.rateOfClimb;
  expect(allFinite([...roc.x, ...roc.powerOff, ...(roc.exact ?? []), ...(roc.smallAngle ?? []), roc.stallX])).toBe(true);
  if (model.available) expect(allFinite([...model.available.thrust, ...model.available.power])).toBe(true);
  const g = model.glide;
  expect(allFinite([g.best.tas, g.best.ratio, g.best.sinkFpm, g.minSink.tas, g.minSink.sinkFpm, g.distanceToSeaLevel])).toBe(true);
  if (model.climb) {
    const c = model.climb;
    expect(allFinite([c.vy.tas, c.vy.rocFpm, c.vx.tas, c.vx.gamma, c.lapse, c.selected.rocFpm])).toBe(true);
    expect(c.profile.rocFpm.every((v) => v === null || Number.isFinite(v))).toBe(true);
  }
}

describe('random aircraft and conditions', () => {
  it('always yields finite, ordered numbers or an explained empty chart', () => {
    const rand = mulberry32(20261002);
    for (let i = 0; i < 1000; i++) {
      const scenario = randomScenario(rand);
      const axis = AXES[i % AXES.length]!;
      const unit = UNITS[i % UNITS.length]!;
      try {
        check(scenario, axis, unit);
      } catch (error) {
        throw new Error(`case ${i} (${axis}, ${unit}) failed for ${JSON.stringify(scenario)}: ${String(error)}`);
      }
    }
  }, 60_000);
});

describe('hostile links', () => {
  const KEYS = ['ac', 'nm', 'm', 's', 'ar', 'e', 'cd0', 'clmax', 'clf', 'h', 'disa', 'v', 'w', 'n', 'eng', 'pw', 'ft', 'lx', 'hc', 'ts', 'v0', 'x', 'u', 'sys'];
  const VALUES = [
    '', ' ', '0', '-0', '-1', '1e400', '-1e400', 'NaN', 'Infinity', '0x10', '1e-320', '84852', '84853',
    '-1001', '60', '-60', '61', '1000', '1001', 'c172', 'sailplane', 'jet-trainer', 'tas', 'mach', 'kt',
    '<script>', '%00', '1,5', '٣', '9'.repeat(400), 'none', 'piston', 'turboprop', 'turbofan', 'us', '0.5', '15000', '150000',
  ];

  it('never throws, whatever the query string', () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 1500; i++) {
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
  }, 60_000);
});
