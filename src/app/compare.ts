/**
 * The comparison: a second aircraft flown at the same condition, and the
 * numbers that matter side by side. Pure, like the other models.
 *
 * Like for like: the second aircraft flies at the same pressure altitude, ISA
 * day, bank, runway and wind, and at the same fraction of its own maximum
 * takeoff mass. Comparing a 172 at 2,550 lb with a jet at 2,550 lb would
 * compare nothing.
 */

import { atPressureAltitude } from '../physics/atmosphere.js';
import { RUNWAY_SURFACES, landing, takeoff } from '../physics/performance/field.js';
import { breguet, fuelAboard } from '../physics/performance/range.js';
import { headwindOf, operatingMass, surfaceOf, type Scenario } from '../state/url.js';
import type { Comparison } from './permalink.js';
import { buildChartModel, toLength, toMass, type ChartModel, type ChartWindow, type ViewSettings } from './model.js';
import { toDistance } from './cruise.js';

/** The second aircraft's scenario: the first's condition, its own aircraft, the same MTOW fraction. */
export function comparisonScenario(scenario: Scenario, compare: Comparison): Scenario {
  const fraction = operatingMass(scenario) / scenario.aircraft.mass;
  const { mass: _first, ...condition } = scenario;
  return {
    ...condition,
    presetId: compare.presetId,
    aircraft: compare.aircraft,
    ...(fraction < 1 ? { mass: fraction * compare.aircraft.mass } : {}),
  };
}

export interface ComparisonRow {
  readonly label: string;
  /** In display units; null where the aircraft has no such figure */
  readonly first: number | null;
  readonly second: number | null;
  readonly unit: string;
  readonly decimals: number;
}

/** Everything one aircraft contributes to the table, in SI. */
function figures(model: ChartModel, scenario: Scenario) {
  const marker = (kind: string) => model.markers.find((m) => m.kind === kind) ?? null;
  const aircraft = { ...scenario.aircraft, mass: operatingMass(scenario) };
  const atmosphere = atPressureAltitude(scenario.altitude, scenario.deltaISA);
  const runway = RUNWAY_SURFACES[surfaceOf(scenario)];
  const to = takeoff(aircraft, atmosphere, runway, headwindOf(scenario));
  const ld = landing(aircraft, atmosphere, runway, headwindOf(scenario));
  const cruise = breguet(aircraft, atmosphere.density, fuelAboard(aircraft));
  return {
    mtow: scenario.aircraft.mass,
    mass: aircraft.mass,
    stall: marker('stall')?.x ?? null,
    vmd: marker('min-drag')?.x ?? null,
    ld: model.maxLiftToDrag,
    vy: model.climb?.vy.x ?? null,
    roc: model.climb?.vy.rocFpm ?? null,
    vmax: model.climb?.vmax?.x ?? null,
    service: model.climb?.serviceCeilingFt ?? null,
    absolute: model.climb?.absoluteCeilingFt ?? null,
    glide: model.glide.best.ratio,
    sink: model.glide.minSink.sinkFpm,
    takeoff: to.ok ? to.total : null,
    landing: ld.ok ? ld.total : null,
    range: cruise?.range.value ?? null,
    endurance: cruise ? cruise.endurance.value / 3600 : null,
  };
}

export function comparisonRows(
  first: { model: ChartModel; scenario: Scenario },
  second: { model: ChartModel; scenario: Scenario },
  view: ViewSettings,
): ComparisonRow[] {
  const a = figures(first.model, first.scenario);
  const b = figures(second.model, second.scenario);
  const speedUnit = view.axis === 'mach' ? 'M' : view.unit === 'mps' ? 'm/s' : view.unit === 'kmh' ? 'km/h' : 'kt';
  const speedDecimals = view.axis === 'mach' ? 3 : view.unit === 'mps' ? 1 : 0;
  const massUnit = view.system === 'us' ? 'lb' : 'kg';
  const lengthUnit = view.system === 'us' ? 'ft' : 'm';
  const axis = view.axis.toUpperCase();

  const map = (x: number | null, f: (v: number) => number) => (x === null ? null : f(x));
  const row = (label: string, first: number | null, second: number | null, unit: string, decimals: number): ComparisonRow => ({
    label,
    first,
    second,
    unit,
    decimals,
  });
  const mass = (v: number) => toMass(v, view.system);
  const len = (v: number) => toLength(v, view.system);
  const dist = (v: number) => toDistance(v, view);

  return [
    row('Max takeoff mass', mass(a.mtow), mass(b.mtow), massUnit, 0),
    row('Flying at', mass(a.mass), mass(b.mass), massUnit, 0),
    row(`Stall speed (${axis})`, a.stall, b.stall, speedUnit, speedDecimals),
    row(`Best L/D speed, V_md (${axis})`, a.vmd, b.vmd, speedUnit, speedDecimals),
    row('(L/D)max', a.ld, b.ld, '', 2),
    row(`Best rate-of-climb speed, V_y (${axis})`, a.vy, b.vy, speedUnit, speedDecimals),
    row('Best rate of climb', a.roc, b.roc, 'ft/min', 0),
    row(`Maximum level speed (${axis})`, a.vmax, b.vmax, speedUnit, speedDecimals),
    row('Service ceiling', a.service, b.service, 'ft', 0),
    row('Absolute ceiling', a.absolute, b.absolute, 'ft', 0),
    row('Best glide ratio', a.glide, b.glide, ': 1', 1),
    row('Minimum sink', a.sink, b.sink, 'ft/min', 0),
    row('Takeoff over 50 ft', map(a.takeoff, len), map(b.takeoff, len), lengthUnit, 0),
    row('Landing from 50 ft', map(a.landing, len), map(b.landing, len), lengthUnit, 0),
    row('Best range, Breguet', map(a.range, dist), map(b.range, dist), view.unit === 'kt' ? 'NM' : 'km', 0),
    row('Best endurance, Breguet', a.endurance, b.endurance, 'h', 1),
  ];
}

export interface ComparisonModel {
  readonly scenario: Scenario;
  readonly model: ChartModel;
  readonly rows: readonly ComparisonRow[];
}

/** The second aircraft's chart model and the table, or null when it can't be computed. */
export function buildComparison(
  scenario: Scenario,
  model: ChartModel,
  compare: Comparison,
  view: ViewSettings,
): ComparisonModel | { readonly error: string } {
  const second = comparisonScenario(scenario, compare);
  try {
    const other = buildChartModel(second, view);
    return { scenario: second, model: other, rows: comparisonRows({ model, scenario }, { model: other, scenario: second }, view) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** A chart window wide and tall enough for both aircraft. */
export function unionWindow(a: ChartWindow, b: ChartWindow): ChartWindow {
  return {
    xMax: Math.max(a.xMax, b.xMax),
    dragMax: Math.max(a.dragMax, b.dragMax),
    powerMax: Math.max(a.powerMax, b.powerMax),
    liftToDragMax: Math.max(a.liftToDragMax, b.liftToDragMax),
    rocMin: Math.min(a.rocMin, b.rocMin),
    rocMax: Math.max(a.rocMax, b.rocMax),
    altitudeMaxFt: Math.max(a.altitudeMaxFt, b.altitudeMaxFt),
  };
}
