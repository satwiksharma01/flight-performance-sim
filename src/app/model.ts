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
import {
  bestRateOfClimb,
  ceilings,
  climbAt,
  climbPerformance,
  isPowered,
  maxRateOfClimb,
  type PoweredAircraft,
} from '../physics/performance/climb.js';
import { bestGlide, glideAtSpeed, minimumSink, type Glide } from '../physics/performance/glide.js';
import { lapseRatio, powerAvailable, propellerEfficiency, thrustAvailable } from '../physics/propulsion.js';
import { loadFactorOf, operatingMass, type Scenario } from '../state/url.js';

export type SpeedAxis = 'tas' | 'eas' | 'cas' | 'mach';
export type SpeedUnit = 'kt' | 'mps' | 'kmh';
/** Units for force, power, mass, area and length. Speed has its own setting. */
export type UnitSystem = 'si' | 'us';
/** Which part of the explorer is showing. */
export type Tab = 'curves' | 'envelope' | 'field' | 'range';
export const TABS: readonly Tab[] = ['curves', 'envelope', 'field', 'range'];

export interface ViewSettings {
  /** Which airspeed the x-axis shows */
  readonly axis: SpeedAxis;
  /** Unit for every speed except Mach */
  readonly unit: SpeedUnit;
  /** SI (N, kW, kg, m²) or US customary (lbf, hp, lb, ft²) */
  readonly system: UnitSystem;
  readonly tab: Tab;
}

export const DEFAULT_VIEW: ViewSettings = { axis: 'tas', unit: 'kt', system: 'si', tab: 'curves' };

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
  /** Rate-of-climb chart range [ft/min] */
  readonly rocMin: number;
  readonly rocMax: number;
  /** Right edge of the climb-versus-altitude chart [ft]; 0 for a glider */
  readonly altitudeMaxFt: number;
}

const FPM_PER_MPS = 60 / 0.3048;
const FT_PER_M = 1 / 0.3048;

/**
 * A small keyed cache. The window, ceilings and the climb profile don't depend
 * on the altitude or speed sliders, but they cost hundreds of optimisations
 * each, so they are computed once per aircraft (and weight, and ISA day).
 */
export function keyedCache<V>(limit: number) {
  const entries = new Map<string, V>();
  return (key: string, make: () => V): V => {
    const hit = entries.get(key);
    if (hit !== undefined) return hit;
    const value = make();
    entries.set(key, value);
    if (entries.size > limit) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    return value;
  };
}

const windowCache = keyedCache<ChartWindow>(16);

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
  return windowCache(JSON.stringify([aircraft, view.axis, view.unit, view.system]), () => fitWindow(aircraft, view));
}

function fitWindow(aircraft: Aircraft, view: ViewSettings): ChartWindow {
  const seaLevel = atPressureAltitude(0, 0);
  const vStall = stallSpeed(aircraft, seaLevel.density);
  const tasMax = Math.min(
    WINDOW_SPEED_RATIO * vMinDrag(aircraft, seaLevel.density),
    MACH_LIMIT * seaLevel.speedOfSound,
  );

  // Both curves peak at an end of the range: drag and power climb steeply
  // towards stall and grow with speed past the bucket.
  const ends = [vStall, tasMax].map((tas) => evaluatePoint(aircraft, seaLevel, tas));
  let dragMax = Math.max(...ends.map((p) => p.drag));
  let powerMax = Math.max(...ends.map((p) => p.powerRequired)) / 1000;

  // Full-power thrust and power must fit too, and the climb charts get their
  // own fixed ranges: rate of climb symmetric about zero, altitude to just past
  // the absolute ceiling. A glider's chart is its sink polar.
  let rocMax: number;
  let rocMin: number;
  let altitudeMaxFt = 0;
  if (isPowered(aircraft)) {
    const lapse = lapseRatio(aircraft.propulsion, seaLevel);
    for (const v of [vStall, tasMax]) {
      dragMax = Math.max(dragMax, thrustAvailable(aircraft.propulsion, v, lapse));
      powerMax = Math.max(powerMax, powerAvailable(aircraft.propulsion, v, lapse) / 1000);
    }
    rocMax = niceCeiling(Math.max(bestRateOfClimb(aircraft, seaLevel).rateOfClimb * FPM_PER_MPS, 100) * 1.15);
    rocMin = -rocMax;
    const absolute = ceilings(aircraft).absolute;
    altitudeMaxFt = niceCeiling(Math.max(absolute ?? 0, 1000) * FT_PER_M * 1.1);
  } else {
    const sink = minimumSink(aircraft, seaLevel).sinkRate * FPM_PER_MPS;
    rocMax = niceCeiling(sink);
    rocMin = -niceCeiling(sink * 6);
  }

  return {
    xMax: tasToAxis(tasMax, seaLevel, view),
    dragMax: niceCeiling(toForce(dragMax, view.system) * 1.05),
    powerMax: niceCeiling(toPower(powerMax, view.system) * 1.05),
    liftToDragMax: niceCeiling(maxLiftToDrag(aircraft) * 1.1),
    rocMin,
    rocMax,
    altitudeMaxFt,
  };
}

/** One climb optimum, as the readouts and chart markers need it. */
export interface ClimbMark {
  readonly tas: number;
  readonly x: number;
  readonly speeds: AirspeedSet;
  readonly rocFpm: number;
  readonly rocSmallAngleFpm: number;
  /** Climb angle, exact [rad] */
  readonly gamma: number;
  /** Past Mach 0.7, where the polar's missing wave drag makes this optimistic */
  readonly beyondModel: boolean;
}

export interface ClimbSummary {
  /** Best rate of climb */
  readonly vy: ClimbMark;
  /** Best angle of climb */
  readonly vx: ClimbMark;
  /** Maximum level speed at full power, or null if level flight is impossible */
  readonly vmax: {
    readonly tas: number;
    readonly x: number;
    readonly speeds: AirspeedSet;
    readonly beyondModel: boolean;
  } | null;
  /** Fraction of the engine's sea-level rating available here [-] */
  readonly lapse: number;
  /** Propeller efficiency at V_y [-], or null for a jet */
  readonly propEfficiencyAtVy: number | null;
  /** At this weight and ISA day [ft], null if out of reach */
  readonly absoluteCeilingFt: number | null;
  readonly serviceCeilingFt: number | null;
  /** Mach of V_y at the service ceiling: past 0.7, the ceiling is optimistic */
  readonly serviceCeilingMach: number | null;
  /** Best rate of climb against pressure altitude, to the absolute ceiling */
  readonly profile: { readonly altitudesFt: readonly number[]; readonly rocFpm: readonly (number | null)[] };
  /** At the selected speed, wings level */
  readonly selected: { readonly rocFpm: number; readonly thrust: number; readonly powerAvailable: number };
}

export interface GlideMark {
  readonly tas: number;
  readonly x: number;
  readonly speeds: AirspeedSet;
  readonly ratio: number;
  readonly sinkFpm: number;
  /** Glide angle below the horizon [rad] */
  readonly gamma: number;
  readonly limitedByStall: boolean;
}

export interface RateOfClimbChart {
  /** Sampled x-axis values, from the wings-level stall */
  readonly x: readonly number[];
  /** Full power, exact and small-angle [ft/min]; null for a glider */
  readonly exact: readonly number[] | null;
  readonly smallAngle: readonly number[] | null;
  /** Power off: the sink polar, as a negative rate of climb [ft/min] */
  readonly powerOff: readonly number[];
  /** Wings-level stall at this weight, on the x-axis */
  readonly stallX: number;
  /** Each curve at the selected speed [ft/min] */
  readonly selected: { readonly exact: number | null; readonly smallAngle: number | null; readonly powerOff: number };
}

const profileCache = keyedCache<
  Pick<ClimbSummary, 'absoluteCeilingFt' | 'serviceCeilingFt' | 'serviceCeilingMach' | 'profile'>
>(16);

/** Ceilings and the climb-versus-altitude curve: independent of altitude and speed. */
function climbProfile(aircraft: PoweredAircraft, deltaISA: number, altitudeMaxFt: number) {
  return profileCache(JSON.stringify([aircraft, deltaISA, altitudeMaxFt]), () => {
    const c = ceilings(aircraft, deltaISA);
    const altitudesFt: number[] = [];
    const rocFpm: (number | null)[] = [];
    const steps = 48;
    let reached = false;
    for (let i = 0; i <= steps; i++) {
      const ft = (altitudeMaxFt * i) / steps;
      altitudesFt.push(ft);
      if (reached) {
        rocFpm.push(null);
        continue;
      }
      const roc = maxRateOfClimb(aircraft, ft / FT_PER_M, deltaISA) * FPM_PER_MPS;
      if (roc < 0) {
        // End the line exactly at the absolute ceiling rather than one step past it.
        rocFpm.push(c.absolute === null ? null : 0);
        if (c.absolute !== null) altitudesFt[i] = c.absolute * FT_PER_M;
        reached = true;
      } else {
        rocFpm.push(roc);
      }
    }
    const atService = c.service === null ? null : atPressureAltitude(c.service, deltaISA);
    return {
      serviceCeilingMach: atService ? bestRateOfClimb(aircraft, atService).tas / atService.speedOfSound : null,
      absoluteCeilingFt: c.absolute === null ? null : c.absolute * FT_PER_M,
      serviceCeilingFt: c.service === null ? null : c.service * FT_PER_M,
      profile: { altitudesFt, rocFpm },
    };
  });
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
  /** Full-power thrust and power along x, in the display units; null for a glider */
  readonly available: { readonly thrust: readonly number[]; readonly power: readonly number[] } | null;
  readonly rateOfClimb: RateOfClimbChart;
  /** Climb at full power, wings level, at this weight. Null for a glider */
  readonly climb: ClimbSummary | null;
  /** Power-off glide at this weight */
  readonly glide: {
    readonly best: GlideMark;
    readonly minSink: GlideMark;
    /** Still-air distance from this level's true height down to sea level [m] */
    readonly distanceToSeaLevel: number;
  };
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

  // --- Climb and glide: full power or none, wings level, at this weight ---
  const powered = isPowered(aircraft) ? aircraft : null;
  const lapse = powered ? lapseRatio(powered.propulsion, atmosphere) : 0;
  const available = powered
    ? {
        thrust: (generatedTas(x, atmosphere, view)).map((v) => toForce(thrustAvailable(powered.propulsion, v, lapse), view.system)),
        power: (generatedTas(x, atmosphere, view)).map((v) =>
          toPower(powerAvailable(powered.propulsion, v, lapse) / 1000, view.system),
        ),
      }
    : null;

  const vStall1g = stallSpeed(aircraft, atmosphere.density);
  const rocX: number[] = [];
  const exact: number[] = [];
  const smallAngle: number[] = [];
  const powerOff: number[] = [];
  if (vStall1g < maxTas) {
    const count = 120;
    for (let i = 0; i < count; i++) {
      const v = vStall1g + ((maxTas - vStall1g) * i) / (count - 1);
      rocX.push(tasToAxis(v, atmosphere, view));
      powerOff.push(-glideAtSpeed(aircraft, atmosphere, v).sinkRate * FPM_PER_MPS);
      if (powered) {
        const c = climbAt(powered, atmosphere, v, lapse);
        exact.push(c.rateOfClimb * FPM_PER_MPS);
        smallAngle.push(c.rateOfClimbSmallAngle * FPM_PER_MPS);
      }
    }
  }

  const speedsAt = (v: number) => airspeeds(v, atmosphere.pressure, atmosphere.density, atmosphere.speedOfSound);
  const mark = (c: { tas: number; rateOfClimb: number; rateOfClimbSmallAngle: number; gamma: number }): ClimbMark => ({
    tas: c.tas,
    x: tasToAxis(c.tas, atmosphere, view),
    speeds: speedsAt(c.tas),
    rocFpm: c.rateOfClimb * FPM_PER_MPS,
    rocSmallAngleFpm: c.rateOfClimbSmallAngle * FPM_PER_MPS,
    gamma: c.gamma,
    beyondModel: c.tas / a >= COMPRESSIBILITY_ONSET,
  });

  let climb: ClimbSummary | null = null;
  if (powered) {
    const perf = climbPerformance(powered, atmosphere);
    const at = climbAt(powered, atmosphere, scenario.tas, lapse);
    climb = {
      vy: mark(perf.vy),
      vx: mark(perf.vx),
      vmax:
        perf.maxLevelSpeed === null
          ? null
          : {
              tas: perf.maxLevelSpeed,
              x: tasToAxis(perf.maxLevelSpeed, atmosphere, view),
              speeds: speedsAt(perf.maxLevelSpeed),
              beyondModel: perf.maxLevelSpeed / a >= COMPRESSIBILITY_ONSET,
            },
      lapse,
      propEfficiencyAtVy: propellerEfficiency(powered.propulsion, perf.vy.tas),
      ...climbProfile(powered, scenario.deltaISA, window.altitudeMaxFt),
      selected: { rocFpm: at.rateOfClimb * FPM_PER_MPS, thrust: at.thrust, powerAvailable: (at.thrust * scenario.tas) / 1000 },
    };
  }

  const glideMark = (g: Glide): GlideMark => ({
    tas: g.tas,
    x: tasToAxis(g.tas, atmosphere, view),
    speeds: speedsAt(g.tas),
    ratio: g.glideRatio,
    sinkFpm: g.sinkRate * FPM_PER_MPS,
    gamma: g.gamma,
    limitedByStall: g.limitedByStall,
  });
  const best = bestGlide(aircraft, atmosphere);

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
    available,
    rateOfClimb: {
      x: rocX,
      exact: powered ? exact : null,
      smallAngle: powered ? smallAngle : null,
      powerOff,
      stallX: tasToAxis(vStall1g, atmosphere, view),
      selected: (() => {
        const at = powered ? climbAt(powered, atmosphere, scenario.tas, lapse) : null;
        return {
          exact: at ? at.rateOfClimb * FPM_PER_MPS : null,
          smallAngle: at ? at.rateOfClimbSmallAngle * FPM_PER_MPS : null,
          powerOff: -glideAtSpeed(aircraft, atmosphere, scenario.tas).sinkRate * FPM_PER_MPS,
        };
      })(),
    },
    climb,
    glide: {
      best: glideMark(best),
      minSink: glideMark(minimumSink(aircraft, atmosphere)),
      // True height, not pressure altitude: on a hot day the level sits higher.
      distanceToSeaLevel: Math.max(0, atmosphere.geometricAltitude) * best.glideRatio,
    },
  };
}

/** True airspeeds behind a sampled x-axis, for quantities that need TAS. */
function generatedTas(x: readonly number[], atmosphere: AtmosphereState, view: ViewSettings): number[] {
  return x.map((value) => axisToTas(value, atmosphere, view));
}
