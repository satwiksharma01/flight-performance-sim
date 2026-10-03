/**
 * Propulsion: what the engine can give at a given altitude and airspeed.
 *
 * Three engine models, each the minimum that makes ceilings meaningful:
 *
 * - Piston, normally aspirated: shaft power lapses with density by the
 *   Gagg-Farrar relation, P/P0 = 1.132 sigma - 0.132. Turbocharged: full power
 *   up to a critical altitude, then the same lapse relative to it.
 * - Turboprop: P/P0 = sigma^m.
 * - Turbofan: T/T0 = sigma^m, m from about 0.7 (high bypass) to 1.
 *
 * Propellers turn power into thrust. The ideal T = eta P / V goes to infinity
 * as V goes to zero, and a constant-efficiency propeller puts the best-rate-of-
 * climb speed down at the stall, which no fixed-pitch propeller does. So thrust
 * here falls in a straight line from its static value,
 *
 *   T(V) = T_static (1 - V / V_zero),
 *
 * capped at T = P / V so efficiency can never exceed 1, and scaled by the
 * engine's power lapse. Two parameters describe the propeller, and both can be
 * fitted to two published climb figures; see the Cessna 172S preset.
 *
 * Not modelled: Mach effects on jet thrust, flat-rated turboprops, and the
 * change of a fixed-pitch propeller's RPM with altitude.
 */

import { atPressureAltitude, type AtmosphereState } from './atmosphere.js';

export interface Propeller {
  /** Thrust at zero airspeed, sea level, full power [N] */
  readonly staticThrust: number;
  /** True airspeed at which the straight thrust line would reach zero [m/s] */
  readonly zeroThrustSpeed: number;
}

export interface PistonEngine {
  readonly kind: 'piston';
  /** Rated shaft power at sea level [W] */
  readonly power: number;
  /** Turbocharged: full power up to this pressure altitude [m]. Absent: normally aspirated */
  readonly criticalAltitude?: number;
  readonly propeller: Propeller;
}

export interface TurbopropEngine {
  readonly kind: 'turboprop';
  /** Rated shaft power at sea level [W] */
  readonly power: number;
  /** m in P/P0 = sigma^m [-] */
  readonly lapseExponent: number;
  readonly propeller: Propeller;
}

export interface TurbofanEngine {
  readonly kind: 'turbofan';
  /** Static thrust at sea level [N] */
  readonly thrust: number;
  /** m in T/T0 = sigma^m [-] */
  readonly lapseExponent: number;
}

export type Propulsion = PistonEngine | TurbopropEngine | TurbofanEngine;

/** Gagg-Farrar: the fraction of sea-level power a normally aspirated piston engine keeps. */
export function gaggFarrar(densityRatio: number): number {
  return Math.max(0, 1.132 * densityRatio - 0.132);
}

/**
 * The fraction of its sea-level rating the engine gives here [-]: power for a
 * piston or turboprop, thrust for a turbofan.
 */
export function lapseRatio(propulsion: Propulsion, atmosphere: AtmosphereState): number {
  const sigma = atmosphere.densityRatio;
  switch (propulsion.kind) {
    case 'piston': {
      const critical = propulsion.criticalAltitude;
      if (critical === undefined) return gaggFarrar(sigma);
      // The turbocharger holds sea-level manifold pressure up to its critical
      // altitude; above it, the engine lapses as if that altitude were sea level.
      if (atmosphere.pressureAltitude <= critical) return 1;
      return gaggFarrar(sigma / atPressureAltitude(critical).densityRatio);
    }
    case 'turboprop':
    case 'turbofan':
      return Math.pow(sigma, propulsion.lapseExponent);
  }
}

/**
 * Thrust available at full power [N].
 *
 * @param lapse The engine's lapse ratio here, from {@link lapseRatio}.
 */
export function thrustAvailable(propulsion: Propulsion, tas: number, lapse: number): number {
  if (propulsion.kind === 'turbofan') return propulsion.thrust * lapse;

  const { staticThrust, zeroThrustSpeed } = propulsion.propeller;
  const line = staticThrust * (1 - tas / zeroThrustSpeed);
  // Efficiency T V / P can't exceed 1: the propeller can't make power.
  const ideal = tas > 0 ? propulsion.power / tas : Infinity;
  return Math.max(0, Math.min(line, ideal)) * lapse;
}

/** Power available at full power [W]: thrust times true airspeed. */
export function powerAvailable(propulsion: Propulsion, tas: number, lapse: number): number {
  return thrustAvailable(propulsion, tas, lapse) * tas;
}

export type EngineKind = Propulsion['kind'];
export const ENGINE_KINDS: readonly EngineKind[] = ['piston', 'turboprop', 'turbofan'];

/**
 * Supported ranges for engine parameters, inclusive. Shared by the permalink
 * decoder and the editor, like the aircraft's own limits.
 */
export const PROPULSION_LIMITS = {
  power: { label: 'Engine power', min: 1_000, max: 20_000_000 },
  thrust: { label: 'Engine thrust', min: 10, max: 500_000 },
  lapseExponent: { label: 'Lapse exponent', min: 0.3, max: 1.5 },
  criticalAltitude: { label: 'Critical altitude', min: 0, max: 15_000 },
  staticThrust: { label: 'Static thrust', min: 10, max: 200_000 },
  zeroThrustSpeed: { label: 'Zero-thrust speed', min: 20, max: 400 },
} as const;

/** A starting point for each engine kind, used when the kind is switched. */
export const DEFAULT_ENGINES: Record<EngineKind, Propulsion> = {
  piston: { kind: 'piston', power: 134_000, propeller: { staticThrust: 3000, zeroThrustSpeed: 170 } },
  turboprop: {
    kind: 'turboprop',
    power: 500_000,
    lapseExponent: 0.75,
    propeller: { staticThrust: 9000, zeroThrustSpeed: 200 },
  },
  turbofan: { kind: 'turbofan', thrust: 14_000, lapseExponent: 1 },
};

/** Propeller efficiency implied at this speed [-]: T V / P. Null for a jet. */
export function propellerEfficiency(propulsion: Propulsion, tas: number): number | null {
  if (propulsion.kind === 'turbofan') return null;
  return (thrustAvailable(propulsion, tas, 1) * tas) / propulsion.power;
}
