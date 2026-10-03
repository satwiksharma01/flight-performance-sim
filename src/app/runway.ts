/**
 * The takeoff and landing tab's model.
 *
 * Distances against pressure altitude on this ISA day, at this weight, surface
 * and wind, the way a POH chart reads. For the unmodified 172S in the POH's
 * own conditions (2,550 lb, dry pavement, calm), the POH's tables are drawn
 * over the curves, interpolated to the same day, so the comparison on the
 * /validation page can be seen at every altitude.
 */

import { atPressureAltitude, type Aircraft, type AtmosphereState } from '../physics/index.js';
import {
  RUNWAY_SURFACES,
  landing,
  takeoff,
  type LandingResult,
  type SurfaceId,
  type TakeoffResult,
} from '../physics/performance/field.js';
import { POH_TABLES, type PohTable } from '../data/validation/poh-c172s.js';
import { headwindOf, operatingMass, surfaceOf, type Scenario } from '../state/url.js';
import { keyedCache, niceCeiling, toLength, type ViewSettings } from './model.js';

const FT = 0.3048;

/** Pressure altitudes drawn [ft]: sea level to 10,000 ft, the range of nearly every runway. */
export const FIELD_ALTITUDES_FT = Array.from({ length: 41 }, (_, i) => i * 250);

export interface DistanceChart {
  readonly x: readonly number[];
  /** In the view's length unit; null where the aircraft can't */
  readonly groundRoll: readonly (number | null)[];
  readonly total: readonly (number | null)[];
  /** POH values on this ISA day, at 1,000 ft steps; null elsewhere and when the POH doesn't apply */
  readonly pohGroundRoll: readonly (number | null)[] | null;
  readonly pohTotal: readonly (number | null)[] | null;
  readonly yMax: number;
}

export interface RunwayModel {
  readonly atmosphere: AtmosphereState;
  readonly surface: SurfaceId;
  readonly headwind: number;
  readonly takeoff: TakeoffResult;
  readonly landing: LandingResult;
  readonly takeoffChart: DistanceChart | null;
  readonly landingChart: DistanceChart;
  /** True when the POH's tables are drawn: the stock 172S in the POH's conditions */
  readonly pohApplies: boolean;
}

/**
 * Bilinear interpolation in a POH table at a pressure altitude [ft] and OAT
 * [°C], or null outside the table. POH tables are meant to be read this way.
 */
export function interpolatePoh(table: PohTable, altitudeFt: number, oatC: number): number | null {
  const { altitudes: hs, temperatures: ts } = table;
  const bracket = (values: readonly number[], v: number): [number, number] | null => {
    if (v < values[0]! - 1e-9 || v > values[values.length - 1]! + 1e-9) return null;
    for (let i = 0; i + 1 < values.length; i++) if (v <= values[i + 1]! + 1e-9) return [i, (v - values[i]!) / (values[i + 1]! - values[i]!)];
    return null;
  };
  const row = bracket(hs, altitudeFt);
  const col = bracket(ts, oatC);
  if (!row || !col) return null;
  const at = (i: number, j: number) => table.published[i]?.[j] ?? null;
  const [i, fi] = row;
  const [j, fj] = col;
  const corners = [at(i, j), at(i, j + 1), at(i + 1, j), at(i + 1, j + 1)];
  if (corners.some((c) => c === null)) return null;
  const [a, b, c, d] = corners as number[];
  return (a! * (1 - fj) + b! * fj) * (1 - fi) + (c! * (1 - fj) + d! * fj) * fi;
}

const yMaxCache = keyedCache<{ takeoff: number; landing: number }>(16);

/**
 * Fixed distance axes per aircraft and surface: the longest distance at
 * 10,000 ft on an ISA +20 day, at maximum mass in calm air.
 */
function distanceAxes(aircraft: Aircraft, surface: SurfaceId, view: ViewSettings) {
  return yMaxCache(JSON.stringify([aircraft, surface, view.system]), () => {
    const runway = RUNWAY_SURFACES[surface];
    let to = 0;
    let ld = 0;
    for (const ft of [0, 5000, 10000]) {
      const atm = atPressureAltitude(ft * FT, 20);
      const t = takeoff(aircraft, atm, runway);
      const l = landing(aircraft, atm, runway);
      if (t.ok) to = Math.max(to, t.total);
      if (l.ok) ld = Math.max(ld, l.total);
    }
    return {
      takeoff: niceCeiling(toLength(Math.max(to, 100), view.system) * 1.08),
      landing: niceCeiling(toLength(Math.max(ld, 100), view.system) * 1.08),
    };
  });
}

const pohTable = (id: PohTable['id']) => POH_TABLES.find((t) => t.id === id)!;

export function buildRunwayModel(scenario: Scenario, view: ViewSettings): RunwayModel {
  const mass = operatingMass(scenario);
  const aircraft: Aircraft = { ...scenario.aircraft, mass };
  const surface = surfaceOf(scenario);
  const headwind = headwindOf(scenario);
  const runway = RUNWAY_SURFACES[surface];
  const atmosphere = atPressureAltitude(scenario.altitude, scenario.deltaISA);
  const axes = distanceAxes(scenario.aircraft, surface, view);

  const pohApplies =
    scenario.presetId === 'c172' && mass === scenario.aircraft.mass && surface === 'dry-paved' && headwind === 0;

  const length = (m: number) => toLength(m, view.system);
  const pohLength = (ft: number | null) => (ft === null ? null : view.system === 'us' ? ft : ft * FT);

  const conditions = FIELD_ALTITUDES_FT.map((ft) => atPressureAltitude(ft * FT, scenario.deltaISA));
  const oat = conditions.map((a) => a.temperature - 273.15);
  const poh = (id: PohTable['id']) =>
    pohApplies
      ? FIELD_ALTITUDES_FT.map((ft, i) => (ft % 1000 === 0 ? pohLength(interpolatePoh(pohTable(id), ft, oat[i]!)) : null))
      : null;

  const takeoffs = aircraft.propulsion ? conditions.map((a) => takeoff(aircraft, a, runway, headwind)) : null;
  const landings = conditions.map((a) => landing(aircraft, a, runway, headwind));

  return {
    atmosphere,
    surface,
    headwind,
    takeoff: takeoff(aircraft, atmosphere, runway, headwind),
    landing: landing(aircraft, atmosphere, runway, headwind),
    takeoffChart: takeoffs
      ? {
          x: FIELD_ALTITUDES_FT,
          groundRoll: takeoffs.map((r) => (r.ok ? length(r.groundRoll) : null)),
          total: takeoffs.map((r) => (r.ok ? length(r.total) : null)),
          pohGroundRoll: poh('takeoff-roll'),
          pohTotal: poh('takeoff-total'),
          yMax: axes.takeoff,
        }
      : null,
    landingChart: {
      x: FIELD_ALTITUDES_FT,
      groundRoll: landings.map((r) => (r.ok ? length(r.groundRoll) : null)),
      total: landings.map((r) => (r.ok ? length(r.total) : null)),
      pohGroundRoll: poh('landing-roll'),
      pohTotal: poh('landing-total'),
      yMax: axes.landing,
    },
    pohApplies,
  };
}
