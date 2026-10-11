/**
 * The range tab's model: Breguet range and endurance at this weight and
 * altitude, and the payload-range diagram. Pure, like the other tab models.
 */

import { COMPRESSIBILITY_ONSET, chartWindow, keyedCache, niceCeiling, toMass, type ViewSettings } from './model.js';
import { atPressureAltitude, type AtmosphereState } from '../physics/atmosphere.js';
import { breguet, fuelAboard, payloadRange, type RangeEndurance } from '../physics/performance/range.js';
import { cruiseSpeed } from '../physics/performance/cruise.js';
import { isPowered } from '../physics/performance/climb.js';
import { fuelFlow, lapseRatio } from '../physics/propulsion.js';
import { cruisePowerOf, operatingMass, type Scenario } from '../state/url.js';

/** The reserve a set-power cruise keeps, as the POH counts it [s]. */
export const CRUISE_RESERVE = 45 * 60;

const FT = 0.3048;

/** Range in nautical miles with knots, kilometres otherwise. */
export function toDistance(metres: number, view: ViewSettings): number {
  return view.unit === 'kt' ? metres / 1852 : metres / 1000;
}

export interface CruiseModel {
  readonly atmosphere: AtmosphereState;
  /** Usable fuel aboard at this weight [kg] */
  readonly fuel: number;
  /** Null, with the reason, when there is nothing to compute */
  readonly result: RangeEndurance | null;
  readonly reason: string | null;
  /** The best-range speed is past Mach 0.7, where the polar no longer holds */
  readonly beyondModel: boolean;
  /** The engine's fuel flow has a base flow, so SFC rises at part power */
  readonly fuelLine: boolean;
  /** Level cruise at the scenario's power setting; null without an engine */
  readonly setPower: {
    /** Fraction of the engine's sea-level rating [-] */
    readonly setting: number;
    /** What full throttle gives here, the same way [-] */
    readonly available: number;
    /** True airspeed [m/s], or null if the setting can't hold level flight */
    readonly tas: number | null;
    /** Fuel flow [kg/s], or null without an SFC */
    readonly fuelFlow: number | null;
    /** On the fuel aboard, keeping the reserve: time [s] and distance [m], or null if there's nothing to fly */
    readonly endurance: number | null;
    readonly range: number | null;
  } | null;
  /** Payload against range, in the view's distance and mass units */
  readonly chart: {
    readonly range: readonly number[];
    readonly payload: readonly number[];
    readonly xMax: number;
    readonly yMax: number;
    /** This weight: tanks filled first, the rest is payload */
    readonly selected: { readonly range: number; readonly payload: number };
  } | null;
}

const axesCache = keyedCache<{ xMax: number; yMax: number }>(16);

/** Fixed axes: the ferry range at the top of the climb chart, where a jet flies furthest. */
function axes(scenario: Scenario, view: ViewSettings) {
  return axesCache(JSON.stringify([scenario.aircraft, view.unit, view.system]), () => {
    const top = chartWindow(scenario.aircraft, view).altitudeMaxFt;
    const points = payloadRange(scenario.aircraft, atPressureAltitude(Math.min(top, 45_000) * FT).density) ?? [];
    const ferry = points[points.length - 1]?.range ?? 0;
    const useful = points[0]?.payload ?? 0;
    return {
      xMax: niceCeiling(toDistance(ferry, view) * 1.05),
      yMax: niceCeiling(toMass(useful, view.system) * 1.1),
    };
  });
}

export function buildCruiseModel(scenario: Scenario, view: ViewSettings): CruiseModel {
  const atmosphere = atPressureAltitude(scenario.altitude, scenario.deltaISA);
  const aircraft = { ...scenario.aircraft, mass: operatingMass(scenario) };
  const fuel = fuelAboard(aircraft);
  const result = breguet(aircraft, atmosphere.density, fuel);

  const reason = result
    ? null
    : !aircraft.propulsion
      ? 'No engine: a glider’s range is its glide, on the performance curves tab.'
      : !aircraft.propulsion.sfc
        ? 'This engine has no fuel consumption set. Add one in the aircraft editor.'
        : aircraft.emptyMass === undefined || aircraft.fuelCapacity === undefined
          ? 'This aircraft has no empty mass or fuel capacity. Add them in the aircraft editor.'
          : 'No fuel aboard at this weight: it is at or below the empty mass.';

  const points = payloadRange(scenario.aircraft, atmosphere.density);
  const chart = points
    ? {
        range: points.map((p) => toDistance(p.range, view)),
        payload: points.map((p) => toMass(p.payload, view.system)),
        ...axes(scenario, view),
        selected: {
          range: toDistance(result?.range.value ?? 0, view),
          payload: toMass(Math.max(aircraft.mass - (aircraft.emptyMass ?? aircraft.mass) - fuel, 0), view.system),
        },
      }
    : null;

  return {
    atmosphere,
    fuel,
    result,
    reason,
    beyondModel: result !== null && result.range.tasStart > COMPRESSIBILITY_ONSET * atmosphere.speedOfSound,
    fuelLine: Boolean(aircraft.propulsion?.baseFuelFlow),
    setPower: setPowerCruise(scenario, atmosphere, fuel),
    chart,
  };
}

/** Level flight at the scenario's set power, and how long and far it goes on the fuel aboard. */
function setPowerCruise(scenario: Scenario, atmosphere: AtmosphereState, fuel: number): CruiseModel['setPower'] {
  const aircraft = { ...scenario.aircraft, mass: operatingMass(scenario) };
  if (!isPowered(aircraft)) return null;
  const engine = aircraft.propulsion;
  const setting = cruisePowerOf(scenario);
  const tas = cruiseSpeed(aircraft, atmosphere, setting);
  const flow = engine.sfc ? fuelFlow(engine, setting * (engine.kind === 'turbofan' ? engine.thrust : engine.power)) : null;
  const endurance = flow && tas !== null && fuel / flow > CRUISE_RESERVE ? fuel / flow - CRUISE_RESERVE : null;
  return {
    setting,
    available: lapseRatio(engine, atmosphere),
    tas,
    fuelFlow: flow,
    endurance,
    range: endurance === null || tas === null ? null : endurance * tas,
  };
}
