/**
 * Chart model: the pure layer between the physics core and the charts.
 *
 * Everything the explorer draws is computed here, with no DOM and no React, so
 * it can be tested like the physics it sits on. The components only paint it.
 *
 * Two decisions shape it:
 *
 * 1. The chart window is fixed per aircraft. It is fitted once, in the standard
 *    sea-level atmosphere, and does not refit as altitude or ΔISA change. An
 *    auto-fitting axis would rescale with the curve and make it look still,
 *    hiding the very effect the altitude slider exists to show: in TAS the
 *    drag curve slides right as the air thins, and in EAS it does not move.
 *
 * 2. Sampling stops at Mach 0.9. The drag polar has no wave-drag term and the
 *    CAS relation is the subsonic one, so neither means anything beyond that.
 *    From Mach 0.7 the chart shades the region as outside the model rather than
 *    pretending the parabolic polar still holds.
 */

import {
  G0,
  airspeeds,
  casToTas,
  easToTas,
  evaluatePoint,
  generateCurve,
  atPressureAltitude,
  machToTas,
  maxLiftToDrag,
  stallSpeed,
  characteristicSpeeds,
  tasToCas,
  tasToEas,
  vMinDrag,
  type Aircraft,
  type AirspeedSet,
  type AtmosphereState,
  type FlightPoint,
  type MarkerKind,
} from '../physics/index.js';
import { loadFactorOf, operatingMass, type Scenario } from '../state/url.js';

export type SpeedAxis = 'tas' | 'eas' | 'cas' | 'mach';
export type SpeedUnit = 'kt' | 'mps' | 'kmh';
/** Units for force, power, mass, area and length. Speed has its own setting. */
export type UnitSystem = 'si' | 'us';

export interface ViewSettings {
  /** Which airspeed the x-axis shows */
  readonly axis: SpeedAxis;
  /** Unit for every speed except Mach */
  readonly unit: SpeedUnit;
  /** SI (N, kW, kg, m²) or US customary (lbf, hp, lb, ft²) */
  readonly system: UnitSystem;
}

export const DEFAULT_VIEW: ViewSettings = { axis: 'tas', unit: 'kt', system: 'si' };

/** Highest Mach number sampled. Beyond it the subsonic relations do not hold. */
export const MACH_LIMIT = 0.9;

/** Mach number from which the chart marks the region as outside the model. */
export const COMPRESSIBILITY_ONSET = 0.7;

/** Window width as a multiple of the sea-level minimum-drag speed. */
const WINDOW_SPEED_RATIO = 2.5;

const MPS_PER_UNIT: Record<SpeedUnit, number> = {
  kt: 1852 / 3600,
  mps: 1,
  kmh: 1 / 3.6,
};

/** Convert a speed in m/s to a display unit. */
export function toUnit(speed: number, unit: SpeedUnit): number {
  return speed / MPS_PER_UNIT[unit];
}

/** Convert a speed in a display unit to m/s. */
export function fromUnit(speed: number, unit: SpeedUnit): number {
  return speed * MPS_PER_UNIT[unit];
}

/** Symbols for each unit system. */
export const SYSTEM_UNITS: Record<UnitSystem, Record<'force' | 'power' | 'mass' | 'area' | 'length', string>> = {
  si: { force: 'N', power: 'kW', mass: 'kg', area: 'm²', length: 'm' },
  us: { force: 'lbf', power: 'hp', mass: 'lb', area: 'ft²', length: 'ft' },
};

// Exact definitions: the international pound and foot, and mechanical horsepower.
const KG_PER_LB = 0.45359237;
const M_PER_FT = 0.3048;
const N_PER_LBF = KG_PER_LB * 9.80665;
const KW_PER_HP = 0.745699872;

/** Force [N] in the system's unit. */
export function toForce(newtons: number, system: UnitSystem): number {
  return system === 'us' ? newtons / N_PER_LBF : newtons;
}

/** Power [kW] in the system's unit. */
export function toPower(kilowatts: number, system: UnitSystem): number {
  return system === 'us' ? kilowatts / KW_PER_HP : kilowatts;
}

/** Mass [kg] in the system's unit, and back. */
export function toMass(kg: number, system: UnitSystem): number {
  return system === 'us' ? kg / KG_PER_LB : kg;
}
export function fromMass(value: number, system: UnitSystem): number {
  return system === 'us' ? value * KG_PER_LB : value;
}

/** Area [m²] in the system's unit, and back. */
export function toArea(m2: number, system: UnitSystem): number {
  return system === 'us' ? m2 / (M_PER_FT * M_PER_FT) : m2;
}
export function fromArea(value: number, system: UnitSystem): number {
  return system === 'us' ? value * M_PER_FT * M_PER_FT : value;
}

/** Length [m] in the system's unit. */
export function toLength(metres: number, system: UnitSystem): number {
  return system === 'us' ? metres / M_PER_FT : metres;
}

/** Pick one airspeed out of a set, in display units (Mach is unitless). */
export function axisValue(speeds: AirspeedSet, view: ViewSettings): number {
  if (view.axis === 'mach') return speeds.mach;
  return toUnit(speeds[view.axis], view.unit);
}

/** True airspeed [m/s] to the x-axis value at this atmosphere. */
export function tasToAxis(tas: number, atmosphere: AtmosphereState, view: ViewSettings): number {
  switch (view.axis) {
    case 'tas':
      return toUnit(tas, view.unit);
    case 'eas':
      return toUnit(tasToEas(tas, atmosphere.density), view.unit);
    case 'cas':
      return toUnit(tasToCas(tas, atmosphere.pressure, atmosphere.speedOfSound), view.unit);
    case 'mach':
      return tas / atmosphere.speedOfSound;
  }
}

/** The x-axis value at this atmosphere back to true airspeed [m/s]. */
export function axisToTas(x: number, atmosphere: AtmosphereState, view: ViewSettings): number {
  switch (view.axis) {
    case 'tas':
      return fromUnit(x, view.unit);
    case 'eas':
      return easToTas(fromUnit(x, view.unit), atmosphere.density);
    case 'cas':
      return casToTas(fromUnit(x, view.unit), atmosphere.pressure, atmosphere.speedOfSound);
    case 'mach':
      return machToTas(x, atmosphere.speedOfSound);
  }
}

export interface ChartWindow {
  /** Right edge of the x-axis, in the view's axis and unit (left edge is 0) */
  readonly xMax: number;
  /** Top of the drag chart, in N or lbf */
  readonly dragMax: number;
  /** Top of the power chart, in kW or hp */
  readonly powerMax: number;
  /** Top of the L/D chart [-] */
  readonly liftToDragMax: number;
}

const NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** Round up to a clean value, so the top of an axis lands on a readable tick. */
export function niceCeiling(value: number): number {
  if (!(value > 0)) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const step = NICE_STEPS.find((s) => s * magnitude >= value * (1 - 1e-12)) ?? 10;
  return step * magnitude;
}

/**
 * The fixed chart window for an aircraft and view.
 *
 * Fitted in the standard sea-level atmosphere, ignoring the scenario's own
 * altitude and ΔISA, so that moving either slider moves the curve and not the
 * axes. Sea level is where TAS, EAS and CAS coincide, so the window is the same
 * physical speed range whichever airspeed the axis shows.
 */
export function chartWindow(aircraft: Aircraft, view: ViewSettings): ChartWindow {
  const seaLevel = atPressureAltitude(0, 0);
  const vStall = stallSpeed(aircraft, seaLevel.density);
  const tasMax = Math.min(
    WINDOW_SPEED_RATIO * vMinDrag(aircraft, seaLevel.density),
    MACH_LIMIT * seaLevel.speedOfSound,
  );

  // Both curves peak at an end of the range: drag and power climb steeply
  // towards stall and grow with speed past the bucket.
  const ends = [vStall, tasMax].map((tas) => evaluatePoint(aircraft, seaLevel, tas));
  const dragMax = Math.max(...ends.map((p) => p.drag));
  const powerMax = Math.max(...ends.map((p) => p.powerRequired)) / 1000;

  return {
    xMax: tasToAxis(tasMax, seaLevel, view),
    dragMax: niceCeiling(toForce(dragMax, view.system) * 1.05),
    powerMax: niceCeiling(toPower(powerMax, view.system) * 1.05),
    liftToDragMax: niceCeiling(maxLiftToDrag(aircraft) * 1.1),
  };
}

export interface MarkerView {
  readonly kind: MarkerKind;
  readonly label: string;
  readonly significance: string;
  /** Position on the x-axis */
  readonly x: number;
  readonly tas: number;
  readonly speeds: AirspeedSet;
  readonly attainable: boolean;
  readonly point: FlightPoint;
}

export interface SelectedPoint {
  readonly x: number;
  readonly tas: number;
  readonly point: FlightPoint;
  /** False below stall: the numbers describe a condition the aircraft cannot hold */
  readonly attainable: boolean;
  /** At or beyond the Mach limit, where the model does not apply */
  readonly beyondModel: boolean;
}

export interface ChartModel {
  readonly atmosphere: AtmosphereState;
  readonly window: ChartWindow;
  /** Sampled x-axis values, ascending. Empty when nothing can be drawn */
  readonly x: readonly number[];
  readonly drag: readonly number[];
  readonly parasiteDrag: readonly number[];
  readonly inducedDrag: readonly number[];
  /** Power required, in kW or hp by the view's system. Drag arrays are in N or lbf */
  readonly power: readonly number[];
  readonly liftToDrag: readonly number[];
  readonly markers: readonly MarkerView[];
  readonly selected: SelectedPoint;
  /** Stall speed on the x-axis */
  readonly stallX: number;
  /** Where the compressibility shading starts on the x-axis, or null if off-chart */
  readonly compressibilityX: number | null;
  /** (L/D)max, a property of the polar alone */
  readonly maxLiftToDrag: number;
  /** Operating weight [N] */
  readonly weight: number;
  /** Load factor n [-] */
  readonly loadFactor: number;
  /**
   * Stall with landing flap, at this weight and load factor, or null when the
   * aircraft has no flap CLmax. Speeds only: the drag polar is the clean one.
   */
  readonly flapStall: { readonly tas: number; readonly speeds: AirspeedSet } | null;
  /** Why the chart is empty, in plain language, or null when it is not */
  readonly emptyReason: string | null;
}

const SAMPLE_COUNT = 200;

/** Everything the explorer shows for one scenario and view. */
export function buildChartModel(scenario: Scenario, view: ViewSettings): ChartModel {
  // The window is fitted to the aircraft as designed: maximum takeoff mass, 1 g.
  // Weight and bank then move the curves within it, like altitude does.
  const window = chartWindow(scenario.aircraft, view);
  const aircraft: Aircraft = { ...scenario.aircraft, mass: operatingMass(scenario) };
  const n = loadFactorOf(scenario);
  const atmosphere = atPressureAltitude(scenario.altitude, scenario.deltaISA);
  const a = atmosphere.speedOfSound;

  const vStall = stallSpeed(aircraft, atmosphere.density, n);
  const machCap = MACH_LIMIT * a;
  const maxTas = Math.min(axisToTas(window.xMax, atmosphere, view), machCap);

  const x: number[] = [];
  const drag: number[] = [];
  const parasiteDrag: number[] = [];
  const inducedDrag: number[] = [];
  const power: number[] = [];
  const liftToDrag: number[] = [];
  let emptyReason: string | null = null;

  if (vStall >= machCap) {
    emptyReason =
      'Here the stall speed is above Mach 0.9, where the drag polar no longer applies.';
  } else if (vStall >= maxTas) {
    emptyReason = 'Here the whole curve lies beyond the right edge of the chart.';
  } else {
    const curve = generateCurve(aircraft, atmosphere, {
      points: SAMPLE_COUNT,
      minSpeed: vStall,
      maxSpeed: maxTas,
      loadFactor: n,
    });
    for (const p of curve.points) {
      x.push(axisValue(p.speeds, view));
      drag.push(toForce(p.drag, view.system));
      parasiteDrag.push(toForce(p.parasiteDrag, view.system));
      inducedDrag.push(toForce(p.inducedDrag, view.system));
      power.push(toPower(p.powerRequired / 1000, view.system));
      liftToDrag.push(p.liftToDrag);
    }
  }

  const markers = characteristicSpeeds(aircraft, atmosphere, n).map((m) => ({
    kind: m.kind,
    label: m.label,
    significance: m.significance,
    x: axisValue(m.point.speeds, view),
    tas: m.tas,
    speeds: m.point.speeds,
    attainable: m.attainable,
    point: m.point,
  }));

  const selectedPoint = evaluatePoint(aircraft, atmosphere, scenario.tas, n);
  const flapStallTas =
    aircraft.clMaxFlaps === undefined ? null : stallSpeed(aircraft, atmosphere.density, n, aircraft.clMaxFlaps);
  const onsetTas = COMPRESSIBILITY_ONSET * a;
  const onsetX = tasToAxis(onsetTas, atmosphere, view);

  return {
    atmosphere,
    window,
    x,
    drag,
    parasiteDrag,
    inducedDrag,
    power,
    liftToDrag,
    markers,
    selected: {
      x: axisValue(selectedPoint.speeds, view),
      tas: scenario.tas,
      point: selectedPoint,
      attainable: scenario.tas >= vStall,
      beyondModel: scenario.tas >= machCap,
    },
    stallX: tasToAxis(vStall, atmosphere, view),
    compressibilityX: onsetX < window.xMax ? onsetX : null,
    maxLiftToDrag: maxLiftToDrag(aircraft),
    weight: aircraft.mass * G0,
    loadFactor: n,
    flapStall:
      flapStallTas === null
        ? null
        : {
            tas: flapStallTas,
            speeds: airspeeds(flapStallTas, atmosphere.pressure, atmosphere.density, atmosphere.speedOfSound),
          },
    emptyReason,
  };
}
