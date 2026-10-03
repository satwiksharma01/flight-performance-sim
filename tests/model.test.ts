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
  toMass,
  toUnit,
  type SpeedAxis,
  type ViewSettings,
} from '../src/app/model.js';

const AXES: SpeedAxis[] = ['tas', 'eas', 'cas', 'mach'];

function scenario(overrides: Partial<Scenario>): Scenario {
  return { ...DEFAULT_SCENARIO, ...overrides };
}

function view(axis: SpeedAxis, unit: ViewSettings['unit'] = 'kt', system: ViewSettings['system'] = 'si'): ViewSettings {
  return { axis, unit, system };
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

describe('weight and bank', () => {
  const vmd = (m: ReturnType<typeof buildChartModel>) => m.markers.find((k) => k.kind === 'min-drag')!.tas;

  it('moves the optima with the square root of weight', () => {
    const full = buildChartModel(scenario({}), view('tas'));
    const light = buildChartModel(scenario({ mass: 0.7 * CESSNA_172S.mass }), view('tas'));
    expect(vmd(light) / vmd(full)).toBeCloseTo(Math.sqrt(0.7), 9);
    expect(light.weight).toBeCloseTo(0.7 * full.weight, 9);
  });

  it('moves stall and the optima by sqrt(2) in a 60° banked turn', () => {
    const level = buildChartModel(scenario({}), view('tas'));
    const turning = buildChartModel(scenario({ loadFactor: 2 }), view('tas'));
    expect(vmd(turning) / vmd(level)).toBeCloseTo(Math.SQRT2, 9);
    expect(turning.stallX / level.stallX).toBeCloseTo(Math.SQRT2, 9);
  });

  it('keeps the window fixed, so weight and bank visibly move the curves', () => {
    const base = buildChartModel(scenario({}), view('tas')).window;
    expect(buildChartModel(scenario({ mass: 800, loadFactor: 1.5 }), view('tas')).window).toEqual(base);
  });

  it('gives the 172S its published 48 kt landing-flap stall at max weight', () => {
    const model = buildChartModel(scenario({}), view('cas'));
    expect(model.flapStall).not.toBeNull();
    expect(model.flapStall!.speeds.cas / (1852 / 3600)).toBeCloseTo(48, 0);
  });

  it('has no flap stall for an aircraft without flaps', () => {
    const glider = scenario({ presetId: 'sailplane', aircraft: GENERIC_SAILPLANE });
    expect(buildChartModel(glider, view('tas')).flapStall).toBeNull();
  });
});

describe('unit system', () => {
  it('converts drag to lbf and power to hp exactly', () => {
    const si = buildChartModel(scenario({}), view('tas', 'kt', 'si'));
    const us = buildChartModel(scenario({}), view('tas', 'kt', 'us'));
    si.drag.forEach((d, i) => expect(us.drag[i]!).toBeCloseTo(d / 4.4482216152605, 9));
    si.power.forEach((kw, i) => expect(us.power[i]!).toBeCloseTo(kw / 0.745699872, 9));
  });

  it('puts the chart tops on clean values in the chosen unit', () => {
    const us = buildChartModel(scenario({}), view('tas', 'kt', 'us')).window;
    expect(niceCeiling(us.dragMax)).toBe(us.dragMax);
    expect(niceCeiling(us.powerMax)).toBe(us.powerMax);
  });

  it('shows the 172S at exactly 2,550 lb', () => {
    expect(toMass(CESSNA_172S.mass, 'us')).toBeCloseTo(2550, 9);
  });
});

describe('climb and glide in the chart model', () => {
  const c172 = buildChartModel(scenario({}), view('tas'));

  it('peaks the rate-of-climb curve at the V_y readout', () => {
    const peak = Math.max(...c172.rateOfClimb.exact!);
    expect(peak).toBeLessThanOrEqual(c172.climb!.vy.rocFpm + 1e-6);
    expect(peak / c172.climb!.vy.rocFpm).toBeCloseTo(1, 3);
  });

  it('shows the power-off sink polar below zero everywhere', () => {
    expect(c172.rateOfClimb.powerOff.every((v) => v < 0)).toBe(true);
  });

  it('ends the climb profile at the absolute ceiling', () => {
    const { altitudesFt, rocFpm } = c172.climb!.profile;
    let last = rocFpm.length - 1;
    while (last > 0 && rocFpm[last] === null) last--;
    expect(rocFpm[last]).toBe(0);
    expect(altitudesFt[last]).toBeCloseTo(c172.climb!.absoluteCeilingFt!, 6);
  });

  it('gives a glider its sink polar and no climb', () => {
    const glider = buildChartModel(scenario({ presetId: 'sailplane', aircraft: GENERIC_SAILPLANE }), view('tas'));
    expect(glider.climb).toBeNull();
    expect(glider.rateOfClimb.exact).toBeNull();
    expect(glider.rateOfClimb.powerOff.length).toBeGreaterThan(0);
    expect(glider.window.rocMin).toBeLessThan(0);
  });

  it('lowers the ceilings for a hot day and raises them for a light aircraft', () => {
    const hot = buildChartModel(scenario({ deltaISA: 20 }), view('tas'));
    const light = buildChartModel(scenario({ mass: 0.85 * CESSNA_172S.mass }), view('tas'));
    expect(hot.climb!.serviceCeilingFt!).toBeLessThan(c172.climb!.serviceCeilingFt!);
    expect(light.climb!.serviceCeilingFt!).toBeGreaterThan(c172.climb!.serviceCeilingFt!);
  });

  it('measures glide distance from this altitude as height times the glide ratio', () => {
    const at = buildChartModel(scenario({ altitude: 3048 }), view('tas'));
    expect(at.glide.distanceToSeaLevel).toBeCloseTo(3048 * at.glide.best.ratio, 6);
  });
});
