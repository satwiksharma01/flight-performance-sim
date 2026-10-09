/**
 * Range and endurance by the Breguet equations: constant altitude, constant
 * lift coefficient, engine throttled to hold it, all usable fuel burned.
 *
 * Each case is best at a different point on the polar:
 *
 *                Max range              Max endurance
 *   propeller    max L/D       (V_md)   max CL^1.5/CD  (V_mp)
 *   jet          max CL^0.5/CD (V_jr)   max L/D        (V_md)
 *
 *   prop range       R = (eta/c) (L/D) ln(W0/W1)
 *   prop endurance   E = (eta/c) (CL^1.5/CD) sqrt(2 rho S) (W1^-0.5 - W0^-0.5)
 *   jet range        R = (2/ct) sqrt(2/(rho S)) (CL^0.5/CD) (sqrt W0 - sqrt W1)
 *   jet endurance    E = (1/ct) (L/D) ln(W0/W1)
 *
 * c and ct are fuel *weight* per unit power or thrust per second, so the
 * engines' mass-based SFC is multiplied by g. An optimum slower than 1.2 V_s
 * can't be held in practice, so the lift coefficient is capped at
 * CLmax / 1.2^2 and the case flagged: the 172's V_mp is below its stall.
 *
 * No reserve, no climb or descent, and no part-power fuel-flow model: the POH
 * quotes range at set power, which is a different calculation.
 */

import { G0 } from '../constants.js';
import { k, weight, type Aircraft } from '../aero.js';

/**
 * Cruise propeller efficiency, Anderson's 0.8.
 * ponytail: a constant; make it an aircraft input if a preset needs another value.
 */
export const CRUISE_PROPELLER_EFFICIENCY = 0.8;

/** The slowest cruise flown, as a multiple of the stall speed. */
export const MIN_CRUISE_STALL_MARGIN = 1.2;

export interface CruiseCase {
  /** Lift coefficient flown [-] */
  readonly cl: number;
  /** The optimum is slower than 1.2 V_s, so 1.2 V_s is flown instead */
  readonly stallLimited: boolean;
  /** True airspeed at the start and end weight [m/s] */
  readonly tasStart: number;
  readonly tasEnd: number;
  /** Range [m] or endurance [s] */
  readonly value: number;
}

export interface RangeEndurance {
  readonly kind: 'propeller' | 'jet';
  /** Fuel burned [kg] */
  readonly fuel: number;
  readonly range: CruiseCase;
  readonly endurance: CruiseCase;
}

/** Usable fuel aboard at this mass [kg]: tanks filled first, up to capacity. */
export function fuelAboard(aircraft: Aircraft): number {
  if (aircraft.emptyMass === undefined || aircraft.fuelCapacity === undefined) return 0;
  return Math.max(0, Math.min(aircraft.fuelCapacity, aircraft.mass - aircraft.emptyMass));
}

/**
 * Best range and best endurance, burning `fuel` [kg] from the aircraft's
 * mass at this density. Null without an engine, an SFC, or fuel.
 */
export function breguet(aircraft: Aircraft, density: number, fuel: number): RangeEndurance | null {
  const engine = aircraft.propulsion;
  if (!engine?.sfc || !(fuel > 0) || !(fuel < aircraft.mass)) return null;

  const w0 = weight(aircraft.mass);
  const w1 = weight(aircraft.mass - fuel);
  const kf = k(aircraft);
  const cd0 = aircraft.cd0;
  const rhoS = density * aircraft.wingArea;
  const c = engine.sfc * G0; // fuel weight per (W s) for a propeller, per (N s) for a jet
  const jet = engine.kind === 'turbofan';

  const flown = (optimum: number, value: (cl: number, cd: number) => number): CruiseCase => {
    const clCap = aircraft.clMax / MIN_CRUISE_STALL_MARGIN ** 2;
    const cl = Math.min(optimum, clCap);
    const cd = cd0 + kf * cl * cl;
    return {
      cl,
      stallLimited: optimum > clCap,
      tasStart: Math.sqrt((2 * w0) / (rhoS * cl)),
      tasEnd: Math.sqrt((2 * w1) / (rhoS * cl)),
      value: value(cl, cd),
    };
  };

  const clMinDrag = Math.sqrt(cd0 / kf);
  const logRatio = Math.log(w0 / w1);
  if (jet) {
    return {
      kind: 'jet',
      fuel,
      range: flown(Math.sqrt(cd0 / (3 * kf)), (cl, cd) => (2 / c) * Math.sqrt(2 / rhoS) * (Math.sqrt(cl) / cd) * (Math.sqrt(w0) - Math.sqrt(w1))),
      endurance: flown(clMinDrag, (cl, cd) => (1 / c) * (cl / cd) * logRatio),
    };
  }
  const eta = CRUISE_PROPELLER_EFFICIENCY;
  return {
    kind: 'propeller',
    fuel,
    range: flown(clMinDrag, (cl, cd) => (eta / c) * (cl / cd) * logRatio),
    endurance: flown(Math.sqrt((3 * cd0) / kf), (cl, cd) => (eta / c) * (cl ** 1.5 / cd) * Math.sqrt(2 * rhoS) * (1 / Math.sqrt(w1) - 1 / Math.sqrt(w0))),
  };
}

export interface PayloadRangePoint {
  /** Payload [kg] */
  readonly payload: number;
  /** Best range [m] */
  readonly range: number;
}

/**
 * The payload-range diagram at this density: at maximum takeoff mass, trade
 * payload for fuel until the tanks are full, then shed payload to the ferry
 * range. Max payload is the whole useful load: there is no zero-fuel limit.
 * Null without an empty mass, a fuel capacity, or an SFC.
 */
export function payloadRange(aircraft: Aircraft, density: number, steps = 24): PayloadRangePoint[] | null {
  const { emptyMass, fuelCapacity } = aircraft;
  if (emptyMass === undefined || fuelCapacity === undefined || !aircraft.propulsion?.sfc) return null;
  const useful = aircraft.mass - emptyMass;
  if (!(useful > 0)) return null;

  const rangeOf = (mass: number, fuel: number) =>
    fuel > 0 ? (breguet({ ...aircraft, mass }, density, fuel)?.range.value ?? 0) : 0;

  const points: PayloadRangePoint[] = [];
  const fullTanks = Math.min(fuelCapacity, useful);
  // At MTOW: payload falls as fuel rises.
  for (let i = 0; i <= steps; i++) {
    const fuel = (fullTanks * i) / steps;
    points.push({ payload: useful - fuel, range: rangeOf(aircraft.mass, fuel) });
  }
  // Tanks full: shed payload, so the aircraft is lighter and flies further.
  const left = useful - fullTanks;
  for (let i = 1; i <= steps && left > 0; i++) {
    const payload = left * (1 - i / steps);
    points.push({ payload, range: rangeOf(emptyMass + fullTanks + payload, fullTanks) });
  }
  return points;
}
