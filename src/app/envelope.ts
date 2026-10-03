/**
 * The envelope tab's model: the V-n diagram, turn performance and specific
 * excess power. Pure, like model.ts, so it is tested without a browser.
 *
 * Fixed axes again. Each chart's window is fitted to the aircraft as designed
 * (maximum takeoff mass, sea level, 1 g), so weight, altitude and bank move
 * the curves rather than the axes.
 */

import {
  G0,
  atPressureAltitude,
  stallSpeed,
  tasToEas,
  type Aircraft,
  type AtmosphereState,
} from '../physics/index.js';
import { isPowered } from '../physics/performance/climb.js';
import { specificExcessPower, energyHeight } from '../physics/performance/energy.js';
import { cornerSpeed, turnLimits, turnRate } from '../physics/performance/turn.js';
import { vnBoundaries, vnDiagram, type StructuralLimits, type VnDiagram } from '../physics/performance/vn.js';
import { lapseRatio, thrustAvailable } from '../physics/propulsion.js';
import { loadFactorOf, operatingMass, type Scenario } from '../state/url.js';
import { contours, niceStep, type ContourLine, type Point } from './contour.js';
import {
  MACH_LIMIT,
  axisToTas,
  chartWindow,
  keyedCache,
  niceCeiling,
  tasToAxis,
  toLength,
  toUnit,
  type ViewSettings,
} from './model.js';

const FT = 0.3048;
const FPM = 60 / FT;
const DEG = 180 / Math.PI;

// --- V-n diagram ---------------------------------------------------------------

export interface VnChart {
  readonly diagram: VnDiagram;
  /** EAS samples, in the view's speed unit, up to V_D */
  readonly x: readonly number[];
  readonly maneuverUpper: readonly number[];
  readonly maneuverLower: readonly number[];
  readonly gustUpper: readonly number[];
  readonly gustLower: readonly number[];
  /** The design envelope, filled */
  readonly designUpper: readonly number[];
  readonly designLower: readonly number[];
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  /** Speeds in the view's unit (EAS) */
  readonly speeds: {
    readonly stall: number;
    readonly maneuvering: number;
    readonly cruise: number;
    readonly dive: number;
    readonly neverExceed: number;
  };
  /** This scenario's point: EAS in the view's unit, and load factor */
  readonly selected: { readonly x: number; readonly n: number; readonly inside: boolean; readonly limitHere: number | null };
}

const vnWindowCache = keyedCache<{ xMax: number; yMin: number; yMax: number }>(16);

function vnWindow(aircraft: Aircraft, limits: StructuralLimits, view: ViewSettings) {
  return vnWindowCache(JSON.stringify([aircraft, view.unit]), () => {
    const d = vnDiagram(aircraft, limits, 0, atPressureAltitude(0).density);
    const atCruise = vnBoundaries(d, limits.cruiseSpeed);
    const top = Math.max(limits.nPositive, atCruise?.gust.upper ?? 0);
    const bottom = Math.min(limits.nNegative, atCruise?.gust.lower ?? 0);
    return {
      xMax: niceCeiling(toUnit(1.08 * limits.diveSpeed, view.unit)),
      yMin: Math.floor(bottom - 0.5),
      yMax: Math.ceil(top + 0.5),
    };
  });
}

export function buildVnChart(scenario: Scenario, view: ViewSettings, atmosphere: AtmosphereState): VnChart | null {
  const limits = scenario.aircraft.structure;
  if (!limits) return null;
  const aircraft: Aircraft = { ...scenario.aircraft, mass: operatingMass(scenario) };
  const d = vnDiagram(aircraft, limits, atmosphere.pressureAltitude, atmosphere.density);

  // Uniform samples, plus every corner, so the vertices are sharp.
  const corners = [d.maneuveringSpeed, d.negativeCornerSpeed, limits.cruiseSpeed, limits.diveSpeed];
  const samples = Array.from({ length: 241 }, (_, i) => (limits.diveSpeed * i) / 240)
    .concat(corners.filter((v) => v <= limits.diveSpeed))
    .sort((a, b) => a - b)
    .filter((v, i, all) => i === 0 || v - all[i - 1]! > 1e-9);

  const x: number[] = [];
  const series = { mu: [] as number[], ml: [] as number[], gu: [] as number[], gl: [] as number[], du: [] as number[], dl: [] as number[] };
  for (const eas of samples) {
    const b = vnBoundaries(d, eas);
    if (!b) continue;
    x.push(toUnit(eas, view.unit));
    series.mu.push(b.maneuver.upper);
    series.ml.push(b.maneuver.lower);
    series.gu.push(b.gust.upper);
    series.gl.push(b.gust.lower);
    series.du.push(b.design.upper);
    series.dl.push(b.design.lower);
  }

  const eas = tasToEas(scenario.tas, atmosphere.density);
  const n = loadFactorOf(scenario);
  const here = vnBoundaries(d, eas);
  return {
    diagram: d,
    x,
    maneuverUpper: series.mu,
    maneuverLower: series.ml,
    gustUpper: series.gu,
    gustLower: series.gl,
    designUpper: series.du,
    designLower: series.dl,
    ...vnWindow(scenario.aircraft, limits, view),
    speeds: {
      stall: toUnit(d.stallSpeed, view.unit),
      maneuvering: toUnit(d.maneuveringSpeed, view.unit),
      cruise: toUnit(limits.cruiseSpeed, view.unit),
      dive: toUnit(limits.diveSpeed, view.unit),
      neverExceed: toUnit(d.neverExceedSpeed, view.unit),
    },
    selected: {
      x: toUnit(eas, view.unit),
      n,
      inside: here !== null && n <= here.design.upper + 1e-9 && n >= here.design.lower - 1e-9,
      limitHere: here === null ? null : here.design.upper,
    },
  };
}

// --- Turn performance ------------------------------------------------------------

export interface RadiusLine {
  /** Radius in the view's length unit */
  readonly radius: number;
  readonly rate: readonly (number | null)[];
}

export interface TurnChart {
  readonly x: readonly number[];
  /** Turn rate [deg/s] at the lesser of CLmax and the structural limit */
  readonly instantaneous: readonly (number | null)[];
  /** At full power, thrust = drag; null where it can't hold a level turn */
  readonly sustained: readonly (number | null)[] | null;
  readonly radii: readonly RadiusLine[];
  readonly yMax: number;
  /** 1-g stall on the x-axis */
  readonly stallX: number;
  /** The structural limit used, or null when the aircraft has none */
  readonly nStructure: number | null;
  /** Corner speed on the x-axis, and the turn there */
  readonly corner: { readonly x: number; readonly rate: number; readonly radius: number } | null;
  /** The best sustained turn rate, if any */
  readonly bestSustained: { readonly x: number; readonly rate: number; readonly n: number; readonly radius: number } | null;
  /** This scenario's turn: rate [deg/s] and radius [m], or null at 1 g */
  readonly selected: { readonly rate: number; readonly radius: number | null };
}

const turnWindowCache = keyedCache<{ yMax: number; radii: number[] }>(16);

/** Fixed y range and radius lines, from the sea-level, max-mass turn. */
function turnWindow(aircraft: Aircraft, view: ViewSettings) {
  return turnWindowCache(JSON.stringify([aircraft, view.system]), () => {
    const sl = atPressureAltitude(0);
    const nCap = aircraft.structure?.nPositive ?? 4;
    const vc = cornerSpeed(aircraft, sl.density, nCap);
    const peak = turnRate(vc, nCap) * DEG;
    const cornerRadius = (vc * vc) / (G0 * Math.sqrt(nCap * nCap - 1));
    const base = niceCeiling(toLength(cornerRadius, view.system) * 1.5);
    return { yMax: niceCeiling(peak * 1.15), radii: [base, 2 * base, 4 * base] };
  });
}

export function buildTurnChart(scenario: Scenario, view: ViewSettings, atmosphere: AtmosphereState): TurnChart {
  const window = chartWindow(scenario.aircraft, view);
  const aircraft: Aircraft = { ...scenario.aircraft, mass: operatingMass(scenario) };
  const { yMax, radii } = turnWindow(scenario.aircraft, view);
  const nStructure = aircraft.structure?.nPositive ?? null;
  const lapse = aircraft.propulsion ? lapseRatio(aircraft.propulsion, atmosphere) : 0;
  const vs = stallSpeed(aircraft, atmosphere.density);
  const machCap = MACH_LIMIT * atmosphere.speedOfSound;

  const x: number[] = [];
  const instantaneous: (number | null)[] = [];
  const sustained: (number | null)[] = [];
  const tas: number[] = [];
  let best: TurnChart['bestSustained'] = null;
  for (let i = 0; i <= 240; i++) {
    const xv = (window.xMax * i) / 240;
    const v = axisToTas(xv, atmosphere, view);
    x.push(xv);
    tas.push(v);
    if (!(v >= vs && v <= machCap)) {
      instantaneous.push(null);
      sustained.push(null);
      continue;
    }
    const thrust = aircraft.propulsion ? thrustAvailable(aircraft.propulsion, v, lapse) : null;
    const t = turnLimits(aircraft, atmosphere.density, v, thrust, nStructure ?? Infinity);
    instantaneous.push(t.instantaneousRate * DEG);
    const rate = t.sustainedRate === null ? null : t.sustainedRate * DEG;
    sustained.push(rate);
    if (rate !== null && t.sustained !== null && (best === null || rate > best.rate)) {
      best = { x: xv, rate, n: t.sustained, radius: (v * v) / (G0 * Math.sqrt(Math.max(t.sustained ** 2 - 1, 1e-12))) };
    }
  }

  const toMetres = view.system === 'us' ? FT : 1;
  const radiusLines = radii.map((radius) => ({
    radius,
    rate: tas.map((v) => ((v / (radius * toMetres)) * DEG <= yMax * 1.05 ? (v / (radius * toMetres)) * DEG : null)),
  }));

  let corner: TurnChart['corner'] = null;
  if (nStructure !== null) {
    const vc = cornerSpeed(aircraft, atmosphere.density, nStructure);
    if (vc <= machCap) {
      corner = {
        x: tasToAxis(vc, atmosphere, view),
        rate: turnRate(vc, nStructure) * DEG,
        radius: (vc * vc) / (G0 * Math.sqrt(nStructure * nStructure - 1)),
      };
    }
  }

  const n = loadFactorOf(scenario);
  return {
    x,
    instantaneous,
    sustained: aircraft.propulsion ? sustained : null,
    radii: radiusLines,
    yMax,
    stallX: tasToAxis(vs, atmosphere, view),
    nStructure,
    corner,
    bestSustained: best,
    selected: {
      rate: n > 1 ? turnRate(scenario.tas, n) * DEG : 0,
      radius: n > 1 ? (scenario.tas * scenario.tas) / (G0 * Math.sqrt(n * n - 1)) : null,
    },
  };
}

/** The load factor whose level turn at this TAS has this rate [deg/s]. */
export function loadFactorForTurnRate(tas: number, rateDeg: number): number {
  const omega = rateDeg / DEG;
  return Math.sqrt(1 + ((omega * tas) / G0) ** 2);
}

// --- Specific excess power ---------------------------------------------------------

export interface EnergyChart {
  readonly xMax: number;
  /** Top of the altitude axis [ft] */
  readonly yMax: number;
  /** P_s contours [ft/min], and which level is the envelope's edge */
  readonly contours: readonly ContourLine[];
  readonly step: number;
  /** Energy-height contours [ft], when they slope enough to read */
  readonly energyHeights: readonly ContourLine[];
  /** Cells outside the steady envelope: P_s < 0, below the stall, past Mach 0.9 */
  readonly outside: readonly { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number }[];
  /** Stall speed against altitude, at this load factor */
  readonly stallLine: readonly Point[];
  /** Speed of maximum P_s at each altitude: the best-climb schedule */
  readonly bestClimb: readonly Point[];
  /** P_s at the selected point [ft/min], or null outside the model */
  readonly selected: number | null;
}

const NX = 96;
const NY = 72;

const energyCache = keyedCache<Omit<EnergyChart, 'selected'>>(8);

export function buildEnergyChart(scenario: Scenario, view: ViewSettings): EnergyChart | null {
  if (!isPowered(scenario.aircraft)) return null;
  const window = chartWindow(scenario.aircraft, view);
  const mass = operatingMass(scenario);
  const n = loadFactorOf(scenario);
  const key = JSON.stringify([scenario.aircraft, mass, n, scenario.deltaISA, view.axis, view.unit]);
  const grid = energyCache(key, () => energyGrid({ ...scenario.aircraft, mass }, n, scenario.deltaISA, view, window.xMax, window.altitudeMaxFt));

  const atmosphere = atPressureAltitude(scenario.altitude, scenario.deltaISA);
  const aircraft: Aircraft = { ...scenario.aircraft, mass };
  const inModel =
    scenario.tas >= stallSpeed(aircraft, atmosphere.density, n) && scenario.tas <= MACH_LIMIT * atmosphere.speedOfSound;
  return {
    ...grid,
    selected: inModel ? specificExcessPower(aircraft, atmosphere, scenario.tas, n) * FPM : null,
  };
}

function energyGrid(
  aircraft: Aircraft,
  n: number,
  deltaISA: number,
  view: ViewSettings,
  xMax: number,
  yMax: number,
): Omit<EnergyChart, 'selected'> {
  const xs = Array.from({ length: NX }, (_, i) => (xMax * i) / (NX - 1));
  const ys = Array.from({ length: NY }, (_, j) => (yMax * j) / (NY - 1));
  const ps: number[][] = [];
  const he: number[][] = [];
  const stallLine: Point[] = [];
  const bestClimb: Point[] = [];
  let peak = 0;
  // The largest kinetic share of energy height on the chart [ft].
  const tasMax = Math.max(
    ...[0, yMax].flatMap((ft) => xs.map((xv) => axisToTas(xv, atPressureAltitude(ft * FT, deltaISA), view))),
  );
  const heSpan = (tasMax * tasMax) / (2 * G0) / FT;

  for (const yFt of ys) {
    const atm = atPressureAltitude(yFt * FT, deltaISA);
    const lapse = aircraft.propulsion ? lapseRatio(aircraft.propulsion, atm) : 0;
    const vs = stallSpeed(aircraft, atm.density, n);
    const cap = MACH_LIMIT * atm.speedOfSound;
    const row: number[] = [];
    const heRow: number[] = [];
    let bestHere: Point | null = null;
    let bestValue = 0;
    for (const xv of xs) {
      const v = axisToTas(xv, atm, view);
      heRow.push(energyHeight(atm.geometricAltitude, v) / FT);
      if (!(v >= vs && v <= cap)) {
        row.push(NaN);
        continue;
      }
      const value = specificExcessPower(aircraft, atm, v, n, lapse) * FPM;
      row.push(value);
      if (value > bestValue) {
        bestValue = value;
        bestHere = [xv, yFt];
      }
    }
    ps.push(row);
    he.push(heRow);
    peak = Math.max(peak, bestValue);
    if (bestHere) bestClimb.push(bestHere);
    if (vs < cap) stallLine.push([tasToAxis(vs, atm, view), yFt]);
  }

  const step = niceStep(peak, 6);
  const levels = [0];
  for (let level = step; level < peak; level += step) levels.push(level);

  // Shade what lies outside, one run of cells per row.
  const outside: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const dx = xs[1]! - xs[0]!;
  const dy = ys[1]! - ys[0]!;
  ps.forEach((row, j) => {
    let start: number | null = null;
    row.forEach((value, i) => {
      const out = !(value >= 0);
      if (out && start === null) start = i;
      if ((!out || i === row.length - 1) && start !== null) {
        const end = out ? i : i - 1;
        outside.push({ x0: xs[start]! - dx / 2, x1: xs[end]! + dx / 2, y0: ys[j]! - dy / 2, y1: ys[j]! + dy / 2 });
        start = null;
      }
    });
  });

  // Energy height lines matter where kinetic energy is a real share of the
  // altitude range: a jet's, not a light single's.
  const heStep = niceStep(yMax + heSpan, 6);
  const heLevels: number[] = [];
  for (let level = heStep; level < yMax + heSpan; level += heStep) heLevels.push(level);
  const energyHeights = heSpan > 0.1 * yMax ? contours(xs, ys, he, heLevels) : [];

  return {
    xMax,
    yMax,
    contours: contours(xs, ys, ps, levels),
    step,
    energyHeights,
    outside,
    stallLine,
    bestClimb,
  };
}

export interface EnvelopeModel {
  readonly atmosphere: AtmosphereState;
  readonly vn: VnChart | null;
  readonly turn: TurnChart;
  readonly energy: EnergyChart | null;
}

export function buildEnvelopeModel(scenario: Scenario, view: ViewSettings): EnvelopeModel {
  const atmosphere = atPressureAltitude(scenario.altitude, scenario.deltaISA);
  return {
    atmosphere,
    vn: buildVnChart(scenario, view, atmosphere),
    turn: buildTurnChart(scenario, view, atmosphere),
    energy: buildEnergyChart(scenario, view),
  };
}
