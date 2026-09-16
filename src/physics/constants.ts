/**
 * Physical constants for the International Standard Atmosphere (ISA),
 * per ISO 2533 / US Standard Atmosphere 1976.
 *
 * All values are SI. This module has no dependencies and no side effects.
 */

/** Standard gravitational acceleration [m/s^2] */
export const G0 = 9.80665;

/** Specific gas constant for dry air [J/(kg*K)] */
export const R_AIR = 287.05287;

/** Ratio of specific heats for air [-] */
export const GAMMA = 1.4;

/** Sea-level standard temperature [K] */
export const T0 = 288.15;

/** Sea-level standard pressure [Pa] */
export const P0 = 101325;

/** Sea-level standard density [kg/m^3] */
export const RHO0 = 1.225;

/** Sea-level standard speed of sound [m/s] */
export const A0 = Math.sqrt(GAMMA * R_AIR * T0);

/** Effective Earth radius used for the geopotential/geometric conversion [m] */
export const EARTH_RADIUS = 6356766;

/** Sutherland's law reference viscosity [Pa*s] */
export const SUTHERLAND_MU0 = 1.716e-5;

/** Sutherland's law reference temperature [K] */
export const SUTHERLAND_T0 = 273.15;

/** Sutherland's constant for air [K] */
export const SUTHERLAND_S = 110.4;

/**
 * ISA layer table, indexed by geopotential base altitude.
 *
 * `lapseRate` is dT/dh in K/m: negative where temperature falls with altitude,
 * exactly zero in an isothermal layer. The zero case needs a different pressure
 * formula, so it is branched on rather than approximated.
 */
export interface AtmosphereLayer {
  /** Geopotential base altitude [m] */
  readonly baseAltitude: number;
  /** Temperature at the base of the layer [K] */
  readonly baseTemperature: number;
  /** Pressure at the base of the layer [Pa] */
  readonly basePressure: number;
  /** dT/dh [K/m] */
  readonly lapseRate: number;
}

/**
 * Base pressures are derived rather than tabulated so that the layers are
 * guaranteed continuous — a tabulated value with too few digits introduces a
 * step discontinuity at the layer boundary, which then shows up as a kink in
 * every derived performance curve.
 */
function nextBasePressure(layer: AtmosphereLayer, topAltitude: number): number {
  const dh = topAltitude - layer.baseAltitude;
  if (layer.lapseRate === 0) {
    return layer.basePressure * Math.exp((-G0 * dh) / (R_AIR * layer.baseTemperature));
  }
  const topTemperature = layer.baseTemperature + layer.lapseRate * dh;
  return (
    layer.basePressure *
    Math.pow(topTemperature / layer.baseTemperature, -G0 / (layer.lapseRate * R_AIR))
  );
}

function buildLayers(): AtmosphereLayer[] {
  const spec = [
    { baseAltitude: 0, lapseRate: -0.0065 },
    { baseAltitude: 11000, lapseRate: 0 },
    { baseAltitude: 20000, lapseRate: 0.001 },
    { baseAltitude: 32000, lapseRate: 0.0028 },
    { baseAltitude: 47000, lapseRate: 0 },
    { baseAltitude: 51000, lapseRate: -0.0028 },
    { baseAltitude: 71000, lapseRate: -0.002 },
  ];

  const layers: AtmosphereLayer[] = [];
  let baseTemperature = T0;
  let basePressure = P0;

  for (const [i, entry] of spec.entries()) {
    const layer: AtmosphereLayer = {
      baseAltitude: entry.baseAltitude,
      baseTemperature,
      basePressure,
      lapseRate: entry.lapseRate,
    };
    layers.push(layer);

    const next = spec[i + 1];
    if (next) {
      basePressure = nextBasePressure(layer, next.baseAltitude);
      baseTemperature =
        baseTemperature + layer.lapseRate * (next.baseAltitude - layer.baseAltitude);
    }
  }

  return layers;
}

/** ISA layers from sea level to 84 852 m geopotential. */
export const ISA_LAYERS: readonly AtmosphereLayer[] = buildLayers();

/** Upper limit of the modelled atmosphere, geopotential [m] */
export const ISA_CEILING = 84852;
