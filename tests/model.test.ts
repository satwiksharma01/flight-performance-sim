import { describe, expect, it } from 'vitest';
import { isa } from '../src/physics/atmosphere.js';
import { vMinDrag } from '../src/physics/aero.js';
import {
  CESSNA_172S,
  GENERIC_JET_TRAINER,
  GENERIC_SAILPLANE,
} from '../src/data/aircraft/presets.js';
import { DEFAULT_SCENARIO, type Scenario } from '../src/state/url.js';
import {
  MACH_LIMIT,
  axisToTas,
  buildChartModel,
  chartWindow,
  fromUnit,
  niceCeiling,
  tasToAxis,
  toUnit,
  type SpeedAxis,
  type ViewSettings,
} from '../src/app/model.js';

const AXES: SpeedAxis[] = ['tas', 'eas', 'cas', 'mach'];

function scenario(overrides: Partial<Scenario>): Scenario {
  return { ...DEFAULT_SCENARIO, ...overrides };
}

function view(axis: SpeedAxis, unit: ViewSettings['unit'] = 'kt'): ViewSettings {
  return { axis, unit };
}

function marker(model: ReturnType<typeof buildChartModel>, kind: string) {
  const found = model.markers.find((m) => m.kind === kind);
  if (!found) throw new Error(`no ${kind} marker`);
  return found;
}

describe('units', () => {
  it('converts knots and km/h exactly', () => {
    expect(toUnit(1852 / 3600, 'kt')).toBeCloseTo(1, 12);
    expect(toUnit(1, 'kmh')).toBeCloseTo(3.6, 12);
    expect(fromUnit(toUnit(57.3, 'kt'), 'kt')).toBeCloseTo(57.3, 12);
  });
});

describe('axis conversion', () => {
  // A hot day at altitude, where TAS, EAS, CAS and Mach all differ.
  const atmosphere = isa(7000, 15);

  it.each(AXES)('inverts exactly on the %s axis', (axis) => {
    for (const tas of [30, 120, 240]) {
      const x = tasToAxis(tas, atmosphere, view(axis));
      expect(axisToTas(x, atmosphere, view(axis))).toBeCloseTo(tas, 9);
    }
  });

  it('orders the airspeeds as physics requires at altitude: EAS < CAS < TAS', () => {
    const tas = 150;
    const eas = tasToAxis(tas, atmosphere, view('eas', 'mps'));
    const cas = tasToAxis(tas, atmosphere, view('cas', 'mps'));
    expect(eas).toBeLessThan(cas);
    expect(cas).toBeLessThan(tas);
  });
});

describe('chart window', () => {
  it('does not depend on altitude or ISA deviation', () => {
    // The whole point of a fixed window: the sliders move the curve, not the axes.
    const low = buildChartModel(scenario({ altitude: 0 }), view('tas'));
    const high = buildChartModel(scenario({ altitude: 3000, deltaISA: 20 }), view('tas'));
    expect(high.window).toEqual(low.window);
  });

  it('spans 2.5 times the sea-level minimum-drag speed', () => {
    const vmd = vMinDrag(CESSNA_172S, isa(0).density);
    expect(chartWindow(CESSNA_172S, view('tas', 'mps')).xMax).toBeCloseTo(2.5 * vmd, 9);
  });

  it('is the same physical range on the TAS, EAS and CAS axes', () => {
    // TAS, EAS and CAS coincide at sea level, where the window is fitted. Only
    // to 1e-8, not exactly: EAS is referenced to the published RHO0 = 1.225,
    // while ISA computes sea-level density as p0/(R*T0) = 1.2250000(2).
    const tas = chartWindow(CESSNA_172S, view('tas')).xMax;
    expect(chartWindow(CESSNA_172S, view('eas')).xMax / tas).toBeCloseTo(1, 7);
    expect(chartWindow(CESSNA_172S, view('cas')).xMax / tas).toBeCloseTo(1, 7);
  });

  it('fits every curve inside its top', () => {
    const model = buildChartModel(scenario({}), view('tas'));
    expect(Math.max(...model.drag)).toBeLessThanOrEqual(model.window.dragMax);
    expect(Math.max(...model.power)).toBeLessThanOrEqual(model.window.powerMax);
    expect(Math.max(...model.liftToDrag)).toBeLessThanOrEqual(model.window.liftToDragMax);
  });
});

describe('the altitude effect', () => {
  const low = scenario({ altitude: 0 });
  const high = scenario({ altitude: 6000 });

  it('leaves the drag curve unmoved against EAS', () => {
    // Drag depends on dynamic pressure, and EAS fixes dynamic pressure, so the
    // drag-vs-EAS curve is the same line at every altitude.
    const a = buildChartModel(low, view('eas'));
    const b = buildChartModel(high, view('eas'));
    expect(b.x).toHaveLength(a.x.length);
    a.x.forEach((x, i) => {
      expect(b.x[i]).toBeCloseTo(x, 9);
      expect(b.drag[i]).toBeCloseTo(a.drag[i]!, 6);
    });
  });

  it('slides the drag curve right against TAS by the square root of the density ratio', () => {
    const a = buildChartModel(low, view('tas'));
    const b = buildChartModel(high, view('tas'));
    const ratio = marker(b, 'min-drag').x / marker(a, 'min-drag').x;
    expect(ratio).toBeCloseTo(Math.sqrt(a.atmosphere.density / b.atmosphere.density), 12);
  });

  it('keeps the minimum drag itself unchanged', () => {
    const a = buildChartModel(low, view('tas'));
    const b = buildChartModel(high, view('tas'));
    expect(marker(b, 'min-drag').point.drag).toBeCloseTo(marker(a, 'min-drag').point.drag, 6);
  });
});

describe('model limits', () => {
  // At 12 km the jet's fixed EAS window reaches past Mach 1.4 in TAS.
  const jetHigh = scenario({
    presetId: 'jet-trainer',
    aircraft: GENERIC_JET_TRAINER,
    altitude: 12000,
    tas: 150,
  });

  it('never samples beyond the Mach limit', () => {
    const model = buildChartModel(jetHigh, view('eas'));
    const fastest = axisToTas(Math.max(...model.x), model.atmosphere, view('eas'));
    expect(model.x.length).toBeGreaterThan(0);
    expect(fastest / model.atmosphere.speedOfSound).toBeCloseTo(MACH_LIMIT, 9);
  });

  it('marks where compressibility begins when it is on the chart', () => {
    const model = buildChartModel(jetHigh, view('eas'));
    const onset = tasToAxis(0.7 * model.atmosphere.speedOfSound, model.atmosphere, view('eas'));
    expect(model.compressibilityX).toBeCloseTo(onset, 9);
  });

  it('leaves compressibility off a chart that never reaches it', () => {
    expect(buildChartModel(scenario({}), view('tas')).compressibilityX).toBeNull();
  });

  it('explains an empty chart instead of drawing nothing', () => {
    // At 20 km the sailplane's TAS stall speed is past the sea-level window...
    const thin = scenario({ presetId: 'sailplane', aircraft: GENERIC_SAILPLANE, altitude: 20000, tas: 90 });
    const tas = buildChartModel(thin, view('tas'));
    expect(tas.x).toHaveLength(0);
    expect(tas.emptyReason).toMatch(/beyond the right edge/);

    // ...but in EAS the stall speed never moves, so the curve is still there.
    const eas = buildChartModel(thin, view('eas'));
    expect(eas.emptyReason).toBeNull();
    expect(eas.x.length).toBeGreaterThan(0);
  });

  it('flags a selected speed below stall as unattainable', () => {
    const model = buildChartModel(scenario({ tas: 20 }), view('tas'));
    expect(model.selected.attainable).toBe(false);
    expect(buildChartModel(scenario({ tas: 55 }), view('tas')).selected.attainable).toBe(true);
  });
});

describe('niceCeiling', () => {
  it.each([
    [3352, 4000],
    [1000, 1000],
    [12.1, 15],
    [0.84, 1],
  ])('rounds %f up to %f', (value, expected) => {
    expect(niceCeiling(value)).toBeCloseTo(expected, 9);
  });
});
