import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO } from '../src/state/url.js';
import { DEFAULT_VIEW, buildChartModel, type ViewSettings } from '../src/app/model.js';
import { buildComparison, comparisonScenario } from '../src/app/compare.js';
import { PRESETS } from '../src/data/aircraft/presets.js';

const view: ViewSettings = { ...DEFAULT_VIEW, system: 'us' };
const jet = { aircraft: PRESETS['jet-trainer'], presetId: 'jet-trainer', basePresetId: 'jet-trainer' };

describe('comparison scenario', () => {
  it('flies the second aircraft at the same fraction of its own MTOW, and the same condition', () => {
    const first = { ...DEFAULT_SCENARIO, mass: 0.8 * PRESETS.c172.mass, altitude: 1500, deltaISA: 10, loadFactor: 1.5 };
    const second = comparisonScenario(first, jet);
    expect(second.mass! / jet.aircraft.mass).toBeCloseTo(0.8, 12);
    expect([second.altitude, second.deltaISA, second.loadFactor]).toEqual([1500, 10, 1.5]);
    expect(second.aircraft).toBe(jet.aircraft);
  });

  it('leaves the mass at its maximum when the first aircraft is at its maximum', () => {
    expect(comparisonScenario(DEFAULT_SCENARIO, jet).mass).toBeUndefined();
  });
});

describe('comparison table', () => {
  const model = buildChartModel(DEFAULT_SCENARIO, view);

  it('reads the same as the first aircraft when compared with itself', () => {
    const self = buildComparison(DEFAULT_SCENARIO, model, { aircraft: PRESETS.c172, presetId: 'c172', basePresetId: 'c172' }, view);
    if ('error' in self) throw new Error(self.error);
    for (const row of self.rows) expect(row.second, row.label).toEqual(row.first);
  });

  it('shows the 172 against the jet the right way round', () => {
    const c = buildComparison(DEFAULT_SCENARIO, model, jet, view);
    if ('error' in c) throw new Error(c.error);
    const row = (label: string) => c.rows.find((r) => r.label.startsWith(label))!;
    expect(row('Max takeoff mass').first).toBeCloseTo(2550, 6);
    expect(row('Stall speed').second!).toBeGreaterThan(row('Stall speed').first!);
    expect(row('Best rate of climb').second!).toBeGreaterThan(row('Best rate of climb').first!);
    expect(row('Best glide ratio').second!).toBeGreaterThan(row('Best glide ratio').first!);
  });

  it('has no climb, takeoff or range figures for a glider', () => {
    const glider = { aircraft: PRESETS.sailplane, presetId: 'sailplane', basePresetId: 'sailplane' };
    const c = buildComparison(DEFAULT_SCENARIO, model, glider, view);
    if ('error' in c) throw new Error(c.error);
    for (const label of ['Best rate of climb', 'Takeoff over 50 ft', 'Best range']) {
      expect(c.rows.find((r) => r.label.startsWith(label))!.second).toBeNull();
    }
    expect(c.rows.find((r) => r.label.startsWith('Landing'))!.second).not.toBeNull();
  });
});
