/**
 * Airspeed conversions: TAS, EAS, CAS and Mach.
 *
 * Why this module exists at all: "velocity" is not one quantity. An aircraft at
 * 10 000 m doing 200 kt indicated is doing roughly 340 kt true. Performance
 * equations want TAS; the pilot reads something close to CAS; the structure
 * cares about EAS; compressibility cares about Mach. Collapsing these into a
 * single number makes several of the most interesting results in the whole tool
 * impossible to express — most notably that stall speed is constant in EAS but
 * climbs steadily in TAS as you go up.
 *
 *   TAS  true airspeed, actual speed through the air mass
 *   EAS  equivalent airspeed, the sea-level speed giving the same dynamic pressure
 *   CAS  calibrated airspeed, what a perfect pitot-static system would indicate
 *   IAS  indicated airspeed — CAS plus instrument and position error, which is
 *        aircraft-specific calibration data and therefore not modelled here
 */

import { A0, GAMMA, P0, RHO0 } from './constants.js';

/** Dynamic pressure q = 1/2 rho V^2 [Pa]. */
export function dynamicPressure(tas: number, density: number): number {
  return 0.5 * density * tas * tas;
}

/**
 * TAS to EAS.
 *
 * EAS = TAS * sqrt(sigma). Because EAS fixes dynamic pressure, any result that
 * depends only on `q` — stall speed, the whole drag polar in coefficient form,
 * structural limits — is altitude-invariant when plotted against EAS.
 */
export function tasToEas(tas: number, density: number): number {
  return tas * Math.sqrt(density / RHO0);
}

export function easToTas(eas: number, density: number): number {
  return eas / Math.sqrt(density / RHO0);
}

export function tasToMach(tas: number, speedOfSound: number): number {
  return tas / speedOfSound;
}

export function machToTas(mach: number, speedOfSound: number): number {
  return mach * speedOfSound;
}

/**
 * Impact (differential) pressure from Mach number, subsonic [Pa].
 *
 * qc = p * [ (1 + (gamma-1)/2 * M^2)^(gamma/(gamma-1)) - 1 ]
 *
 * This is the compressible form. The incompressible `q = 1/2 rho V^2` is only
 * accurate to about M 0.3; using it for CAS would put a visible error into every
 * jet case.
 */
export function impactPressure(mach: number, pressure: number): number {
  const exponent = GAMMA / (GAMMA - 1);
  return pressure * (Math.pow(1 + ((GAMMA - 1) / 2) * mach * mach, exponent) - 1);
}

/** Mach number from impact and static pressure, subsonic. */
export function machFromImpactPressure(qc: number, pressure: number): number {
  const exponent = (GAMMA - 1) / GAMMA;
  return Math.sqrt((2 / (GAMMA - 1)) * (Math.pow(qc / pressure + 1, exponent) - 1));
}

/**
 * TAS to CAS, subsonic.
 *
 * The airspeed indicator senses impact pressure and converts it using sea-level
 * standard constants. So: get qc from the real flight condition, then ask what
 * speed that qc would represent at sea level.
 */
export function tasToCas(tas: number, pressure: number, speedOfSound: number): number {
  const mach = tas / speedOfSound;
  const qc = impactPressure(mach, pressure);
  const machAtSeaLevel = machFromImpactPressure(qc, P0);
  return machAtSeaLevel * A0;
}

/** CAS to TAS, subsonic. Inverse of {@link tasToCas}. */
export function casToTas(cas: number, pressure: number, speedOfSound: number): number {
  const machAtSeaLevel = cas / A0;
  const qc = impactPressure(machAtSeaLevel, P0);
  const mach = machFromImpactPressure(qc, pressure);
  return mach * speedOfSound;
}

/**
 * The compressibility correction, CAS - EAS [m/s].
 *
 * Zero by definition at sea level, and growing with both altitude and Mach.
 * Worth surfacing in the UI: it is the entire reason CAS and EAS are different
 * quantities, and it is invisible in the low-and-slow cases where most people
 * first meet these terms.
 */
export function compressibilityCorrection(
  tas: number,
  pressure: number,
  density: number,
  speedOfSound: number,
): number {
  return tasToCas(tas, pressure, speedOfSound) - tasToEas(tas, density);
}

export interface AirspeedSet {
  readonly tas: number;
  readonly eas: number;
  readonly cas: number;
  readonly mach: number;
  readonly dynamicPressure: number;
}

/** Every airspeed representation for one flight condition. */
export function airspeeds(
  tas: number,
  pressure: number,
  density: number,
  speedOfSound: number,
): AirspeedSet {
  return {
    tas,
    eas: tasToEas(tas, density),
    cas: tasToCas(tas, pressure, speedOfSound),
    mach: tas / speedOfSound,
    dynamicPressure: dynamicPressure(tas, density),
  };
}
