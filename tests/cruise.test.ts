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
