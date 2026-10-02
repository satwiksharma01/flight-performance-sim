/**
 * Scenario permalinks.
 *
 * The URL is the application's state. Every scenario is therefore shareable,
 * bookmarkable and pasteable into a report, with no database, no accounts and
 * no server — which is why the original plan's PostgreSQL layer was dropped.
 *
 * Two rules make the format survivable:
 *
 * 1. Delta encoding. An unmodified preset is just `?ac=c172`. Only parameters
 *    that actually differ from the preset are spelled out, so the common case
 *    stays short enough to paste into a message.
 *
 * 2. Decoding never throws. A truncated or hand-edited URL degrades to the
 *    nearest sensible state and reports what it could not use. A malformed link
 *    should cost the user a warning, not a blank page.
 */

import { AIRCRAFT_LIMITS, validateAircraft, type Aircraft } from '../physics/aero.js';
import { ISA_CEILING } from '../physics/constants.js';
import { CESSNA_172S, PRESET_IDS, getPreset } from '../data/aircraft/presets.js';

export interface Scenario {
  /** Preset this scenario started from, or null for a fully custom aircraft */
  readonly presetId: string | null;
  readonly aircraft: Aircraft;
  /** Geometric altitude [m] */
  readonly altitude: number;
  /** ISA temperature deviation [K] */
  readonly deltaISA: number;
  /** True airspeed [m/s] */
  readonly tas: number;
}

export const DEFAULT_SCENARIO: Scenario = {
  presetId: 'c172',
  aircraft: CESSNA_172S,
  altitude: 0,
  deltaISA: 0,
  tas: 55,
};

/**
 * Query-string keys.
 *
 * These are a public format: changing one breaks every link anyone has saved.
 * Treat them as append-only.
 */
const KEY = {
  preset: 'ac',
  name: 'nm',
  mass: 'm',
  wingArea: 's',
  aspectRatio: 'ar',
  oswaldEfficiency: 'e',
  cd0: 'cd0',
  clMax: 'clmax',
  clMaxFlaps: 'clf',
  altitude: 'h',
  deltaISA: 'disa',
  tas: 'v',
} as const;

const LIMITS = {
  altitude: { min: -1000, max: ISA_CEILING },
  deltaISA: { min: -60, max: 60 },
  tas: { min: 1, max: 1000 },
} as const;

/**
 * Trim floating-point noise without losing meaningful precision.
 *
 * `0.1 + 0.2` must not reach a URL as `0.30000000000000004`, and a round trip
 * through the URL must not drift the value on each pass.
 */
function formatNumber(value: number): string {
  return String(Number(value.toPrecision(8)));
}

function sameNumber(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return formatNumber(a) === formatNumber(b);
}

function sameAircraft(a: Aircraft, b: Aircraft): boolean {
  return (
    a.name === b.name &&
    sameNumber(a.mass, b.mass) &&
    sameNumber(a.wingArea, b.wingArea) &&
    sameNumber(a.aspectRatio, b.aspectRatio) &&
    sameNumber(a.oswaldEfficiency, b.oswaldEfficiency) &&
    sameNumber(a.cd0, b.cd0) &&
    sameNumber(a.clMax, b.clMax) &&
    sameNumber(a.clMaxFlaps, b.clMaxFlaps)
  );
}

/** Encode a scenario as a query string, without the leading `?`. */
export function encodeScenario(scenario: Scenario): string {
  const params = new URLSearchParams();
  const preset = scenario.presetId ? getPreset(scenario.presetId) : undefined;

  if (scenario.presetId) params.set(KEY.preset, scenario.presetId);

  // Only spell out what differs from the preset. With no preset to diff
  // against, everything is written out.
  const base = preset;
  const ac = scenario.aircraft;

  if (!base || ac.name !== base.name) params.set(KEY.name, ac.name);
  if (!base || !sameNumber(ac.mass, base.mass)) params.set(KEY.mass, formatNumber(ac.mass));
  if (!base || !sameNumber(ac.wingArea, base.wingArea)) {
    params.set(KEY.wingArea, formatNumber(ac.wingArea));
  }
  if (!base || !sameNumber(ac.aspectRatio, base.aspectRatio)) {
    params.set(KEY.aspectRatio, formatNumber(ac.aspectRatio));
  }
  if (!base || !sameNumber(ac.oswaldEfficiency, base.oswaldEfficiency)) {
    params.set(KEY.oswaldEfficiency, formatNumber(ac.oswaldEfficiency));
  }
  if (!base || !sameNumber(ac.cd0, base.cd0)) params.set(KEY.cd0, formatNumber(ac.cd0));
  if (!base || !sameNumber(ac.clMax, base.clMax)) {
    params.set(KEY.clMax, formatNumber(ac.clMax));
  }
  if (ac.clMaxFlaps !== undefined && (!base || !sameNumber(ac.clMaxFlaps, base.clMaxFlaps))) {
    params.set(KEY.clMaxFlaps, formatNumber(ac.clMaxFlaps));
  }

  // Flight condition. Defaults are omitted so the common case stays short.
  if (scenario.altitude !== DEFAULT_SCENARIO.altitude) {
    params.set(KEY.altitude, formatNumber(scenario.altitude));
  }
  if (scenario.deltaISA !== DEFAULT_SCENARIO.deltaISA) {
    params.set(KEY.deltaISA, formatNumber(scenario.deltaISA));
  }
  if (scenario.tas !== DEFAULT_SCENARIO.tas) {
    params.set(KEY.tas, formatNumber(scenario.tas));
  }

  return params.toString();
}

export interface DecodeResult {
  readonly scenario: Scenario;
  /**
   * What could not be used, in plain language. Empty when the URL was fully
   * understood. Surface these to the user rather than swallowing them — a
   * silently ignored parameter looks like a calculation bug.
   */
  readonly problems: readonly string[];
}

interface NumberFieldOptions {
  readonly min?: number;
  readonly max?: number;
  readonly exclusiveMin?: number;
}

function readNumber(
  params: URLSearchParams,
  key: string,
  label: string,
  problems: string[],
  options: NumberFieldOptions = {},
): number | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;

  const value = Number(raw);

  if (raw.trim() === '' || !Number.isFinite(value)) {
    problems.push(`${label} ("${raw}") is not a number; using the default instead.`);
    return undefined;
  }
  if (options.exclusiveMin !== undefined && value <= options.exclusiveMin) {
    problems.push(`${label} must be greater than ${options.exclusiveMin}; using the default instead.`);
    return undefined;
  }
  if (options.min !== undefined && value < options.min) {
    problems.push(`${label} is below the supported minimum of ${options.min}; using the default instead.`);
    return undefined;
  }
  if (options.max !== undefined && value > options.max) {
    problems.push(`${label} is above the supported maximum of ${options.max}; using the default instead.`);
    return undefined;
  }

  return value;
}

/** An aircraft field's supported range, rejecting zero and negatives by name. */
function range(field: keyof typeof AIRCRAFT_LIMITS): NumberFieldOptions {
  const { min, max } = AIRCRAFT_LIMITS[field];
  return { exclusiveMin: 0, min, max };
}

/**
 * Decode a query string into a scenario.
 *
 * Accepts the string with or without a leading `?`, and tolerates anything —
 * every rejected value falls back to the corresponding default and is reported.
 */
export function decodeScenario(query: string): DecodeResult {
  const problems: string[] = [];
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);

  // Establish the base aircraft: a named preset, or the default.
  let presetId: string | null = DEFAULT_SCENARIO.presetId;
  let base: Aircraft = DEFAULT_SCENARIO.aircraft;

  const requestedPreset = params.get(KEY.preset);
  if (requestedPreset !== null) {
    const preset = getPreset(requestedPreset);
    if (preset) {
      presetId = requestedPreset;
      base = preset;
    } else {
      problems.push(
        `Unknown aircraft preset "${requestedPreset}". Known presets: ${PRESET_IDS.join(', ')}.`,
      );
    }
  }

  // Apply overrides. Each is independent — one bad value does not discard the rest.
  let aircraft: Aircraft = { ...base };

  const name = params.get(KEY.name);
  if (name !== null && name.trim() !== '') aircraft = { ...aircraft, name };

  const mass = readNumber(params, KEY.mass, 'Mass', problems, range('mass'));
  if (mass !== undefined) aircraft = { ...aircraft, mass };

  const wingArea = readNumber(params, KEY.wingArea, 'Wing area', problems, range('wingArea'));
  if (wingArea !== undefined) aircraft = { ...aircraft, wingArea };

  const aspectRatio = readNumber(params, KEY.aspectRatio, 'Aspect ratio', problems, range('aspectRatio'));
  if (aspectRatio !== undefined) aircraft = { ...aircraft, aspectRatio };

  const oswald = readNumber(params, KEY.oswaldEfficiency, 'Oswald efficiency', problems, range('oswaldEfficiency'));
  if (oswald !== undefined) aircraft = { ...aircraft, oswaldEfficiency: oswald };

  const cd0 = readNumber(params, KEY.cd0, 'CD0', problems, range('cd0'));
  if (cd0 !== undefined) aircraft = { ...aircraft, cd0 };

  const clMax = readNumber(params, KEY.clMax, 'CLmax', problems, range('clMax'));
  if (clMax !== undefined) aircraft = { ...aircraft, clMax };

  const clMaxFlaps = readNumber(params, KEY.clMaxFlaps, 'CLmax with flaps', problems, range('clMaxFlaps'));
  if (clMaxFlaps !== undefined) aircraft = { ...aircraft, clMaxFlaps };

  // If anything was overridden the result is no longer the preset, so the id is
  // dropped — otherwise the link would claim to be a stock aircraft that it is
  // not, and re-encoding would silently discard the user's edits.
  const matchesPreset = presetId !== null && sameAircraft(aircraft, base);
  const resolvedPresetId = matchesPreset ? presetId : null;

  const altitude =
    readNumber(params, KEY.altitude, 'Altitude', problems, LIMITS.altitude) ??
    DEFAULT_SCENARIO.altitude;
  const deltaISA =
    readNumber(params, KEY.deltaISA, 'ISA deviation', problems, LIMITS.deltaISA) ??
    DEFAULT_SCENARIO.deltaISA;
  const tas =
    readNumber(params, KEY.tas, 'True airspeed', problems, LIMITS.tas) ?? DEFAULT_SCENARIO.tas;

  // Catch combinations that are individually plausible but jointly invalid.
  for (const problem of validateAircraft(aircraft)) {
    problems.push(problem);
  }

  return {
    scenario: { presetId: resolvedPresetId, aircraft, altitude, deltaISA, tas },
    problems,
  };
}
