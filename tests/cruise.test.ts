import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO, type Scenario } from '../src/state/url.js';
import { DEFAULT_VIEW, type ViewSettings } from '../src/app/model.js';
import { buildCruiseModel } from '../src/app/cruise.js';
import { PRESETS } from '../src/data/aircraft/presets.js';

const view: ViewSettings = { ...DEFAULT_VIEW, tab: 'range', system: 'us' };

describe('range tab', () => {
  it('puts the 172 at max weight on the knee: full tanks, the rest payload', () => {
    const m = buildCruiseModel(DEFAULT_SCENARIO, view);
    expect(m.result).not.toBeNull();
    expect(m.chart!.selected.payload).toBeCloseTo(2550 - 1663 - 318, 6); // lb
    expect(m.chart!.selected.range).toBeGreaterThan(600); // NM
    expect(m.chart!.selected.range).toBeLessThanOrEqual(m.chart!.xMax);
    expect(m.beyondModel).toBe(false);
  });

  it('flies further with less payload', () => {
    const light = buildCruiseModel({ ...DEFAULT_SCENARIO, mass: 1000 }, view);
    expect(light.result!.range.value).toBeGreaterThan(buildCruiseModel(DEFAULT_SCENARIO, view).result!.range.value);
  });

  it('says why when there is nothing to compute', () => {
    const glider: Scenario = { ...DEFAULT_SCENARIO, presetId: 'sailplane', aircraft: PRESETS.sailplane, tas: 25 };
    const g = buildCruiseModel(glider, view);
    expect(g.result).toBeNull();
    expect(g.chart).toBeNull();
    expect(g.reason).toMatch(/glider/);
    const empty = buildCruiseModel({ ...DEFAULT_SCENARIO, mass: PRESETS.c172.emptyMass! - 1 }, view);
    expect(empty.reason).toMatch(/No fuel aboard/);
  });

  it('keeps the jet’s high-altitude point on the chart', () => {
    const jet: Scenario = { ...DEFAULT_SCENARIO, presetId: 'jet-trainer', aircraft: PRESETS['jet-trainer'], tas: 150, altitude: 10000 };
    const m = buildCruiseModel(jet, view);
    expect(m.chart!.selected.range).toBeLessThanOrEqual(m.chart!.xMax);
  });
});

describe('cruise at a set power', () => {
  const at8500: Scenario = { ...DEFAULT_SCENARIO, altitude: 8500 * 0.3048 };
  const GPH = (6 * 0.45359237) / 3600;

  it('flies the 172 at the POH’s 124 KTAS at 75 %, burning the fuel line’s 10.3 GPH', () => {
    const p = buildCruiseModel(at8500, view).setPower!;
    expect(p.setting).toBe(0.75);
    expect(p.tas! / (1852 / 3600)).toBeCloseTo(124, 0);
    expect(p.fuelFlow! / GPH).toBeCloseTo(1.4 + (3.9 / 33) * 75, 9);
  });

  it('keeps 45 minutes of the fuel aboard in reserve, and flies the rest at that speed', () => {
    const m = buildCruiseModel(at8500, view);
    const p = m.setPower!;
    expect(p.endurance).toBeCloseTo(m.fuel / p.fuelFlow! - 45 * 60, 6);
    expect(p.range).toBeCloseTo(p.endurance! * p.tas!, 6);
  });

  it('says when the setting is more than full throttle gives', () => {
    const p = buildCruiseModel({ ...at8500, cruisePower: 0.9 }, view).setPower!;
    expect(p.available).toBeLessThan(0.8);
    expect(p.setting).toBeGreaterThan(p.available);
  });

  it('has nothing to set for a glider', () => {
    expect(buildCruiseModel({ ...DEFAULT_SCENARIO, presetId: 'sailplane', aircraft: PRESETS.sailplane, tas: 25 }, view).setPower).toBeNull();
  });
});
