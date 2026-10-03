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
 * Pitot total pressure over static pressure, p_t / p [-].
 *
 * Subsonic, the flow decelerates isentropically into the probe:
 *
 *   p_t/p = (1 + (gamma-1)/2 * M^2)^(gamma/(gamma-1))
 *
 * Supersonic, a normal shock stands in front of it, and the Rayleigh pitot
 * formula applies:
 *
 *   p_t/p = [ (gamma+1)^2 M^2 / (4 gamma M^2 - 2(gamma-1)) ]^(gamma/(gamma-1))
 *           * (1 - gamma + 2 gamma M^2) / (gamma+1)
 *
 * The two meet exactly at Mach 1, at (1.2)^3.5 for gamma = 1.4.
 */
export function pitotPressureRatio(mach: number): number {
  const g = GAMMA;
  const exponent = g / (g - 1);
  const m2 = mach * mach;
  if (mach < 1) return Math.pow(1 + ((g - 1) / 2) * m2, exponent);
  return (
    Math.pow(((g + 1) * (g + 1) * m2) / (4 * g * m2 - 2 * (g - 1)), exponent) *
    ((1 - g + 2 * g * m2) / (g + 1))
  );
}

/** p_t/p at Mach 1, where the subsonic and Rayleigh branches meet. */
const SONIC_PITOT_RATIO = pitotPressureRatio(1);

/**
 * Impact (differential) pressure from Mach number [Pa], sub- or supersonic.
 *
 * qc = p * (p_t/p - 1). This is the compressible form. The incompressible
 * `q = 1/2 rho V^2` is only accurate to about M 0.3; using it for CAS would put
 * a visible error into every jet case.
 */
export function impactPressure(mach: number, pressure: number): number {
  return pressure * (pitotPressureRatio(mach) - 1);
}

/**
 * Mach number from impact and static pressure, sub- or supersonic.
 *
 * The subsonic branch inverts in closed form. The Rayleigh branch does not, so
 * it is solved by bisection; p_t/p rises monotonically with Mach, so bisection
 * cannot miss, and 100 halvings of [1, 100] reach the last bit of a double.
 */
export function machFromImpactPressure(qc: number, pressure: number): number {
  const ratio = qc / pressure + 1;
  if (ratio <= SONIC_PITOT_RATIO) {
    const exponent = (GAMMA - 1) / GAMMA;
    return Math.sqrt((2 / (GAMMA - 1)) * (Math.pow(ratio, exponent) - 1));
  }
  let low = 1;
  let high = 100;
  for (let i = 0; i < 100 && high - low > 1e-15 * high; i++) {
    const mid = 0.5 * (low + high);
    if (pitotPressureRatio(mid) < ratio) low = mid;
    else high = mid;
  }
  return 0.5 * (low + high);
}

/**
 * TAS to CAS.
 *
 * The airspeed indicator senses impact pressure and converts it using sea-level
 * standard constants. So: get qc from the real flight condition, then ask what
 * speed that qc would represent at sea level. Both steps switch to the Rayleigh
 * pitot formula above Mach 1.
 */
export function tasToCas(tas: number, pressure: number, speedOfSound: number): number {
  const mach = tas / speedOfSound;
  const qc = impactPressure(mach, pressure);
  const machAtSeaLevel = machFromImpactPressure(qc, P0);
  return machAtSeaLevel * A0;
}

/** CAS to TAS. Inverse of {@link tasToCas}. */
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
