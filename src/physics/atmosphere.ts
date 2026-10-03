/**
 * International Standard Atmosphere, layered from sea level to 84 852 m.
 *
 * The original single-formula troposphere model (`T = T0 - Lh`) is wrong above
 * 11 km, where the atmosphere becomes isothermal and pressure decays
 * exponentially rather than as a power of the temperature ratio. Since the UI
 * exposes altitudes well past the tropopause, the full layer table is used.
 */

import {
  A0,
  EARTH_RADIUS,
  G0,
  GAMMA,
  ISA_CEILING,
  ISA_LAYERS,
  P0,
  R_AIR,
  RHO0,
  SUTHERLAND_MU0,
  SUTHERLAND_S,
  SUTHERLAND_T0,
  T0,
  type AtmosphereLayer,
} from './constants.js';

export interface AtmosphereState {
  /**
   * Geometric altitude [m]. From {@link isa}: as supplied. From
   * {@link atPressureAltitude}: the true height of the pressure level on this day.
   */
  readonly geometricAltitude: number;
  /** Geopotential counterpart of {@link geometricAltitude} [m] */
  readonly geopotentialAltitude: number;
  /** Static temperature, including any ISA deviation [K] */
  readonly temperature: number;
  /** Standard temperature at this altitude, excluding deviation [K] */
  readonly standardTemperature: number;
  /** ISA deviation applied [K] */
  readonly deltaISA: number;
  /** Static pressure [Pa] */
  readonly pressure: number;
  /** Density [kg/m^3] */
  readonly density: number;
  /** Speed of sound [m/s] */
  readonly speedOfSound: number;
  /** Pressure ratio p/p0 [-] */
  readonly pressureRatio: number;
  /** Temperature ratio T/T0 [-] */
  readonly temperatureRatio: number;
  /** Density ratio rho/rho0, "sigma" — the single most used quantity here [-] */
  readonly densityRatio: number;
  /** Dynamic viscosity by Sutherland's law [Pa*s] */
  readonly dynamicViscosity: number;
  /** Altitude in the standard atmosphere having this pressure [m] */
  readonly pressureAltitude: number;
  /** Altitude in the standard atmosphere having this density [m] */
  readonly densityAltitude: number;
}

/**
 * Geometric to geopotential altitude.
 *
 * Geopotential altitude absorbs the variation of gravity with height, which is
 * what lets the ISA equations treat g as the constant g0. The difference is
 * ~0.2 % at 11 km — small, but free to get right.
 */
export function geopotentialAltitude(geometric: number): number {
  return (EARTH_RADIUS * geometric) / (EARTH_RADIUS + geometric);
}

export function geometricAltitude(geopotential: number): number {
  return (EARTH_RADIUS * geopotential) / (EARTH_RADIUS - geopotential);
}

function layerFor(geopotential: number): AtmosphereLayer {
  let selected = ISA_LAYERS[0];
  if (selected === undefined) throw new Error('ISA layer table is empty');

  for (const layer of ISA_LAYERS) {
    if (geopotential >= layer.baseAltitude) selected = layer;
    else break;
  }
  return selected;
}

/** Standard temperature at a geopotential altitude [K]. */
function standardTemperatureAt(geopotential: number): number {
  const layer = layerFor(geopotential);
  return layer.baseTemperature + layer.lapseRate * (geopotential - layer.baseAltitude);
}

/** Standard pressure at a geopotential altitude [Pa]. */
function standardPressureAt(geopotential: number): number {
  const layer = layerFor(geopotential);
  const dh = geopotential - layer.baseAltitude;

  if (layer.lapseRate === 0) {
    return layer.basePressure * Math.exp((-G0 * dh) / (R_AIR * layer.baseTemperature));
  }

  const temperature = layer.baseTemperature + layer.lapseRate * dh;
  return (
    layer.basePressure *
    Math.pow(temperature / layer.baseTemperature, -G0 / (layer.lapseRate * R_AIR))
  );
}

/** Standard density at a geopotential altitude [kg/m^3]. */
function standardDensityAt(geopotential: number): number {
  return standardPressureAt(geopotential) / (R_AIR * standardTemperatureAt(geopotential));
}

/**
 * Invert a monotonically decreasing profile by bisection.
 *
 * Pressure and density both fall monotonically with altitude across every
 * layer, so bisection is unconditionally convergent. A closed-form inverse
 * exists per layer, but it needs a separate branch for gradient and isothermal
 * layers plus layer selection by pressure rather than altitude — more surface
 * area for an error, in exchange for microseconds nobody will notice.
 */
function invertProfile(
  target: number,
  profile: (geopotential: number) => number,
  tolerance = 1e-9,
): number {
  let low = -5000;
  let high = ISA_CEILING;

  if (target >= profile(low)) return low;
  if (target <= profile(high)) return high;

  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (low + high);
    if (profile(mid) > target) low = mid;
    else high = mid;
    if (high - low < tolerance) break;
  }

  return 0.5 * (low + high);
}

/** Pressure altitude: the standard altitude at which pressure equals `pressure`. */
export function pressureAltitude(pressure: number): number {
  return invertProfile(pressure, standardPressureAt);
}

/** Density altitude: the standard altitude at which density equals `density`. */
export function densityAltitude(density: number): number {
  return invertProfile(density, standardDensityAt);
}

/** Dynamic viscosity by Sutherland's law [Pa*s]. */
export function dynamicViscosity(temperature: number): number {
  return (
    SUTHERLAND_MU0 *
    Math.pow(temperature / SUTHERLAND_T0, 1.5) *
    ((SUTHERLAND_T0 + SUTHERLAND_S) / (temperature + SUTHERLAND_S))
  );
}

/** Speed of sound [m/s]. */
export function speedOfSound(temperature: number): number {
  return Math.sqrt(GAMMA * R_AIR * temperature);
}

/**
 * Evaluate the atmosphere at a geometric altitude, mapped to its standard-day
 * pressure level. Prefer {@link atPressureAltitude} for performance work: with a
 * deviation, this treats the standard-day height as the input, so the geometric
 * altitude it returns is nominal rather than true.
 *
 * @param geometricAlt Geometric altitude [m]
 * @param deltaISA     Temperature deviation from standard [K]. A hot day is a
 *                     positive offset.
 *
 * On the ISA deviation: pressure is left at its standard value and only
 * temperature is offset, so density falls as `1/T`. That is the convention in
 * performance work, and it is physically the right one for this purpose — an
 * altimeter set to QNH indicates pressure altitude regardless of temperature,
 * so a "2000 m hot day" means the pressure of 2000 m with the temperature of a
 * hot day. This is exactly why density altitude exceeds pressure altitude on a
 * hot day, and why hot-and-high takeoffs are dangerous.
 */
export function isa(geometricAlt: number, deltaISA = 0): AtmosphereState {
  const h = geopotentialAltitude(geometricAlt);
  checkLevel(h, `Altitude ${geometricAlt} m`);
  const pressure = standardPressureAt(h);
  return evaluate(h, deltaISA, {
    geometricAltitude: geometricAlt,
    geopotentialAltitude: h,
    pressureAltitude: pressureAltitude(pressure),
  });
}

/**
 * Evaluate the atmosphere at a pressure altitude: the input performance work
 * actually uses.
 *
 * @param pressureAlt Pressure altitude [m], geopotential: what an altimeter set
 *                    to 1013.25 hPa reads. FL350 is 35 000 ft of it.
 * @param deltaISA    Temperature deviation from standard [K].
 *
 * Pressure is the standard pressure at that altitude, by definition, and only
 * temperature is offset. That is how POH charts, flight test and performance
 * engineering all state a condition: pressure altitude and OAT.
 *
 * The altitude fields of the result give the *true* height of this pressure
 * level on this day, assuming 1013.25 hPa at sea level and the same deviation
 * all the way up. Warm air is less dense, so the column stretches: on an ISA +10
 * day, FL100 sits about 360 ft higher than its pressure altitude. That is the
 * pilot's "4 % per 10 °C", here integrated exactly through every layer.
 */
export function atPressureAltitude(pressureAlt: number, deltaISA = 0): AtmosphereState {
  checkLevel(pressureAlt, `Pressure altitude ${pressureAlt} m`);
  const trueGeopotential = pressureAlt + deltaISA * inverseTemperatureIntegral(pressureAlt);
  return evaluate(pressureAlt, deltaISA, {
    geometricAltitude: geometricAltitude(trueGeopotential),
    geopotentialAltitude: trueGeopotential,
    pressureAltitude: pressureAlt,
  });
}

function checkLevel(geopotential: number, described: string): void {
  if (!Number.isFinite(geopotential)) {
    throw new RangeError(`${described} is not a finite altitude`);
  }
  if (geopotential > ISA_CEILING) {
    throw new RangeError(`${described} is above the modelled ceiling of ${ISA_CEILING} m geopotential`);
  }
}

/**
 * The integral of 1/T_std from sea level to a geopotential altitude [m/K].
 *
 * Hydrostatics gives dH = -(R T / g0) dp/p, so at the same pressure a column at
 * T_std + ΔT is taller than the standard one by ΔT times this integral. Exact per
 * layer: ln(T_top/T_base)/L where temperature varies, Δh/T where it doesn't.
 */
function inverseTemperatureIntegral(geopotential: number): number {
  const segment = (layer: AtmosphereLayer, from: number, to: number): number => {
    if (layer.lapseRate === 0) return (to - from) / layer.baseTemperature;
    const tAt = (h: number) => layer.baseTemperature + layer.lapseRate * (h - layer.baseAltitude);
    return Math.log(tAt(to) / tAt(from)) / layer.lapseRate;
  };

  const first = ISA_LAYERS[0];
  if (first === undefined) throw new Error('ISA layer table is empty');
  // Below sea level the troposphere's gradient simply extends downwards.
  if (geopotential <= 0) return segment(first, 0, geopotential);

  let total = 0;
  for (const [i, layer] of ISA_LAYERS.entries()) {
    const top = Math.min(geopotential, ISA_LAYERS[i + 1]?.baseAltitude ?? Infinity);
    if (top <= layer.baseAltitude) break;
    total += segment(layer, layer.baseAltitude, top);
  }
  return total;
}

/** Everything that follows from a pressure level and a temperature deviation. */
function evaluate(
  levelGeopotential: number,
  deltaISA: number,
  altitudes: Pick<AtmosphereState, 'geometricAltitude' | 'geopotentialAltitude' | 'pressureAltitude'>,
): AtmosphereState {
  const standardTemp = standardTemperatureAt(levelGeopotential);
  const temperature = standardTemp + deltaISA;

  if (temperature <= 0) {
    throw new RangeError(
      `ISA deviation of ${deltaISA} K gives a non-physical temperature of ${temperature} K`,
    );
  }

  const pressure = standardPressureAt(levelGeopotential);
  const density = pressure / (R_AIR * temperature);

  return {
    ...altitudes,
    temperature,
    standardTemperature: standardTemp,
    deltaISA,
    pressure,
    density,
    speedOfSound: speedOfSound(temperature),
    pressureRatio: pressure / P0,
    temperatureRatio: temperature / T0,
    densityRatio: density / RHO0,
    dynamicViscosity: dynamicViscosity(temperature),
    densityAltitude: densityAltitude(density),
  };
}

/** Sea-level standard speed of sound, re-exported for airspeed conversions. */
export { A0 };
