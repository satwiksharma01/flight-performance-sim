/**
 * Range and endurance, Breguet's cruise: constant altitude, constant lift
 * coefficient, engine throttled to hold it, all usable fuel burned. Range and
 * endurance are the integrals over the weight burned,
 *
 *   R = ∫ V dW / (g mdot),   E = ∫ dW / (g mdot),
 *
 * with mdot the engine's fuel flow at the output the cruise needs: D V / eta
 * for a propeller, D for a jet. Fuel flow is a straight line in output
 * (propulsion.ts), so specific consumption rises at low power, and the
 * integrals are evaluated numerically, the lift coefficient chosen to
 * maximise each.
 *
 * With constant SFC (no base flow) they reduce to the Breguet equations, and
 * each case is best at a different point on the polar:
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
 * engines' mass-based SFC is multiplied by g. A base flow rewards speed, so
 * the best cruise moves a little faster than these. An optimum slower than
 * 1.2 V_s can't be held in practice, so the lift coefficient is capped at
 * CLmax / 1.2^2 and the case flagged: the 172's V_mp is below its stall.
 *
 * No reserve, no climb or descent, and no part-power fuel-flow model: the POH
 * quotes range at set power, which is a different calculation.
 */

import { G0 } from '../constants.js';
import { k, weight, type Aircraft } from '../aero.js';
import { fuelFlow } from '../propulsion.js';
import { maximise } from './climb.js';
import { simpson } from './field.js';

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

/** Simpson panels over the fuel burned: the integrands are smooth, so 64 reach 1e-12. */
const PANELS = 64;

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
  const rhoS = density * aircraft.wingArea;
  const jet = engine.kind === 'turbofan';
  const clCap = aircraft.clMax / MIN_CRUISE_STALL_MARGIN ** 2;

  // At weight W on a constant-CL cruise: the speed, and fuel weight burned per second.
  const speed = (w: number, cl: number) => Math.sqrt((2 * w) / (rhoS * cl));
  const burn = (w: number, cl: number) => {
    const drag = (w * (aircraft.cd0 + kf * cl * cl)) / cl;
    return G0 * fuelFlow(engine, jet ? drag : (drag * speed(w, cl)) / CRUISE_PROPELLER_EFFICIENCY);
  };
  const flown = (value: (cl: number) => number): CruiseCase => {
    const cl = maximise(value, 1e-3 * clCap, clCap);
    return { cl, stallLimited: cl > clCap * (1 - 1e-6), tasStart: speed(w0, cl), tasEnd: speed(w1, cl), value: value(cl) };
  };
  return {
    kind: jet ? 'jet' : 'propeller',
    fuel,
    range: flown((cl) => simpson((w) => speed(w, cl) / burn(w, cl), w1, w0, PANELS)),
    endurance: flown((cl) => simpson((w) => 1 / burn(w, cl), w1, w0, PANELS)),
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
