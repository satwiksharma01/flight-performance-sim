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
import {
  DEFAULT_ENGINES,
  ENGINE_KINDS,
  PROPULSION_LIMITS,
  type EngineKind,
  type Propulsion,
} from '../physics/propulsion.js';
import { ISA_CEILING } from '../physics/constants.js';
import {
  CATEGORIES,
  STRUCTURE_LIMITS,
  validateStructure,
  type Category,
  type NumericLimit,
  type StructuralLimits,
} from '../physics/performance/vn.js';
import { isSurfaceId, type SurfaceId } from '../physics/performance/field.js';
import { CESSNA_172S, PRESET_IDS, getPreset } from '../data/aircraft/presets.js';

export interface Scenario {
  /** Preset this scenario started from, or null for a fully custom aircraft */
  readonly presetId: string | null;
  readonly aircraft: Aircraft;
  /** Pressure altitude [m], geopotential: what an altimeter set to 1013.25 hPa reads */
  readonly altitude: number;
  /** ISA temperature deviation [K] */
  readonly deltaISA: number;
  /** True airspeed [m/s] */
  readonly tas: number;
  /**
   * Operating mass [kg], up to the aircraft's `mass`, which is its maximum
   * takeoff mass. Absent means at maximum takeoff mass, so it follows edits to it.
   */
  readonly mass?: number;
  /** Load factor n = L/W [-]: 1/cos(bank) in a level turn. Absent means 1 g. */
  readonly loadFactor?: number;
  /** Runway surface for takeoff and landing. Absent means dry pavement. */
  readonly surface?: SurfaceId;
  /** Headwind component on the runway [m/s], negative for a tailwind. Absent means calm. */
  readonly headwind?: number;
}

/** What the aircraft weighs in this scenario [kg]. */
export function operatingMass(scenario: Scenario): number {
  return scenario.mass ?? scenario.aircraft.mass;
}

/** The scenario's load factor [-]. */
export function loadFactorOf(scenario: Scenario): number {
  return scenario.loadFactor ?? 1;
}

/** The scenario's runway surface. */
export function surfaceOf(scenario: Scenario): SurfaceId {
  return scenario.surface ?? 'dry-paved';
}

/** The scenario's headwind component [m/s]. */
export function headwindOf(scenario: Scenario): number {
  return scenario.headwind ?? 0;
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
  clMaxTakeoff: 'clto',
  emptyMass: 'oew',
  fuelCapacity: 'fuel',
  altitude: 'h',
  deltaISA: 'disa',
  tas: 'v',
  operatingMass: 'w',
  loadFactor: 'n',
  // The engine. eng=none removes a preset's engine.
  engine: 'eng',
  power: 'pw',
  fanThrust: 'ft',
  lapseExponent: 'lx',
  criticalAltitude: 'hc',
  staticThrust: 'ts',
  zeroThrustSpeed: 'v0',
  sfc: 'sfc',
  // Structural limits for the V-n diagram. str=none removes a preset's.
  structure: 'str',
  nPositive: 'nmax',
  nNegative: 'nmin',
  cruiseSpeed: 'vc',
  diveSpeed: 'vd',
  clMin: 'clneg',
  category: 'cat',
  // The runway.
  surface: 'rw',
  headwind: 'hw',
} as const;

/** Structural limits by their query-string key. */
const STRUCTURE_KEYS: readonly (readonly [string, NumericLimit])[] = [
  [KEY.nPositive, 'nPositive'],
  [KEY.nNegative, 'nNegative'],
  [KEY.cruiseSpeed, 'cruiseSpeed'],
  [KEY.diveSpeed, 'diveSpeed'],
  [KEY.clMin, 'clMin'],
];

const LIMITS = {
  altitude: { min: -1000, max: ISA_CEILING },
  deltaISA: { min: -60, max: 60 },
  tas: { min: 1, max: 1000 },
  loadFactor: { min: 1, max: 10 },
  headwind: { min: -20, max: 40 },
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

/** The numbers that define an engine, keyed by their query-string key. */
function engineFields(p: Propulsion): Record<string, number> {
  return { ...kindFields(p), ...(p.sfc === undefined ? {} : { [KEY.sfc]: p.sfc }) };
}

function kindFields(p: Propulsion): Record<string, number> {
  switch (p.kind) {
    case 'piston':
      return {
        [KEY.power]: p.power,
        [KEY.staticThrust]: p.propeller.staticThrust,
        [KEY.zeroThrustSpeed]: p.propeller.zeroThrustSpeed,
        ...(p.criticalAltitude === undefined ? {} : { [KEY.criticalAltitude]: p.criticalAltitude }),
      };
    case 'turboprop':
      return {
        [KEY.power]: p.power,
        [KEY.lapseExponent]: p.lapseExponent,
        [KEY.staticThrust]: p.propeller.staticThrust,
        [KEY.zeroThrustSpeed]: p.propeller.zeroThrustSpeed,
      };
    case 'turbofan':
      return { [KEY.fanThrust]: p.thrust, [KEY.lapseExponent]: p.lapseExponent };
  }
}

function samePropulsion(a: Propulsion | undefined, b: Propulsion | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.kind !== b.kind) return false;
  const fa = engineFields(a);
  const fb = engineFields(b);
  const keys = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  return [...keys].every((key) => sameNumber(fa[key], fb[key]));
}

function sameStructure(a: StructuralLimits | undefined, b: StructuralLimits | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (a.category ?? 'normal') === (b.category ?? 'normal') && STRUCTURE_KEYS.every(([, field]) => sameNumber(a[field], b[field]));
}

function sameAircraft(a: Aircraft, b: Aircraft): boolean {
  return (
    samePropulsion(a.propulsion, b.propulsion) &&
    sameStructure(a.structure, b.structure) &&
    sameNumber(a.clMaxTakeoff, b.clMaxTakeoff) &&
    sameNumber(a.emptyMass, b.emptyMass) &&
    sameNumber(a.fuelCapacity, b.fuelCapacity) &&
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
  // Optional coefficients: written when they differ from what the decoder would
  // start from (the preset, or the default aircraft), with "none" for absent.
  const start = base ?? DEFAULT_SCENARIO.aircraft;
  for (const [key, field] of [
    [KEY.clMaxFlaps, 'clMaxFlaps'],
    [KEY.clMaxTakeoff, 'clMaxTakeoff'],
    [KEY.emptyMass, 'emptyMass'],
    [KEY.fuelCapacity, 'fuelCapacity'],
  ] as const) {
    const value = ac[field];
    if (!sameNumber(value, start[field])) params.set(key, value === undefined ? 'none' : formatNumber(value));
  }
  // Structural limits, like the engine, are written out whole when they differ.
  if (!sameStructure(ac.structure, start.structure)) {
    if (ac.structure === undefined) {
      params.set(KEY.structure, 'none');
    } else {
      for (const [key, field] of STRUCTURE_KEYS) params.set(key, formatNumber(ac.structure[field]));
      // Always said, so a link that changes the category back to normal keeps it.
      params.set(KEY.category, ac.structure.category ?? 'normal');
    }
  }
  // An engine that differs from the preset's is written out whole: it's short,
  // and a partial engine would be ambiguous when the kind changes.
  // With no preset, the decoder starts from the default aircraft, so even "no
  // engine" has to be said.
  if (!base || !samePropulsion(ac.propulsion, base.propulsion)) {
    if (ac.propulsion === undefined) {
      params.set(KEY.engine, 'none');
    } else {
      params.set(KEY.engine, ac.propulsion.kind);
      for (const [key, value] of Object.entries(engineFields(ac.propulsion))) {
        params.set(key, formatNumber(value));
      }
    }
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
  if (scenario.mass !== undefined && !sameNumber(scenario.mass, ac.mass)) {
    params.set(KEY.operatingMass, formatNumber(scenario.mass));
  }
  if (scenario.loadFactor !== undefined && !sameNumber(scenario.loadFactor, 1)) {
    params.set(KEY.loadFactor, formatNumber(scenario.loadFactor));
  }
  if (scenario.surface !== undefined && scenario.surface !== 'dry-paved') params.set(KEY.surface, scenario.surface);
  if (scenario.headwind !== undefined && !sameNumber(scenario.headwind, 0)) {
    params.set(KEY.headwind, formatNumber(scenario.headwind));
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

/**
 * The engine: the preset's, unless the link says otherwise. `eng` switches the
 * kind (starting from the preset's engine if it's the same kind, a default if
 * not); the other keys override single numbers.
 */
function readEngine(params: URLSearchParams, aircraft: Aircraft, problems: string[]): Aircraft {
  let engine: Propulsion | undefined = aircraft.propulsion;

  const rawKind = params.get(KEY.engine);
  if (rawKind !== null) {
    if (rawKind === 'none') {
      engine = undefined;
    } else if ((ENGINE_KINDS as readonly string[]).includes(rawKind)) {
      const kind = rawKind as EngineKind;
      engine = engine?.kind === kind ? engine : DEFAULT_ENGINES[kind];
    } else {
      problems.push(`Unknown engine "${rawKind}". Expected one of: none, ${ENGINE_KINDS.join(', ')}.`);
    }
  }

  const L = PROPULSION_LIMITS;
  const read = (key: string, limits: { readonly label: string; readonly min: number; readonly max: number }) =>
    readNumber(params, key, limits.label, problems, { min: limits.min, max: limits.max });
  const power = read(KEY.power, L.power);
  const fanThrust = read(KEY.fanThrust, L.thrust);
  const lapse = read(KEY.lapseExponent, L.lapseExponent);
  const critical = read(KEY.criticalAltitude, L.criticalAltitude);
  const staticThrust = read(KEY.staticThrust, L.staticThrust);
  const zeroSpeed = read(KEY.zeroThrustSpeed, L.zeroThrustSpeed);
  const sfc = read(KEY.sfc, engine?.kind === 'turbofan' ? L.tsfc : L.bsfc);

  const unused = (value: number | undefined, label: string) => {
    if (value === undefined) return;
    const what = engine ? `a ${engine.kind} engine` : 'an aircraft without an engine';
    problems.push(`${label} doesn't apply to ${what}; ignored.`);
  };

  if (engine === undefined) {
    unused(power, L.power.label);
    unused(fanThrust, L.thrust.label);
    unused(lapse, L.lapseExponent.label);
    unused(critical, L.criticalAltitude.label);
    unused(staticThrust, L.staticThrust.label);
    unused(zeroSpeed, L.zeroThrustSpeed.label);
    unused(sfc, L.bsfc.label);
    const { propulsion: _none, ...glider } = aircraft;
    return glider;
  }

  if (engine.kind === 'turbofan') {
    unused(power, L.power.label);
    unused(critical, L.criticalAltitude.label);
    unused(staticThrust, L.staticThrust.label);
    unused(zeroSpeed, L.zeroThrustSpeed.label);
    engine = { ...engine, thrust: fanThrust ?? engine.thrust, lapseExponent: lapse ?? engine.lapseExponent };
  } else {
    unused(fanThrust, L.thrust.label);
    const propeller = {
      staticThrust: staticThrust ?? engine.propeller.staticThrust,
      zeroThrustSpeed: zeroSpeed ?? engine.propeller.zeroThrustSpeed,
    };
    if (engine.kind === 'turboprop') {
      unused(critical, L.criticalAltitude.label);
      engine = { ...engine, power: power ?? engine.power, lapseExponent: lapse ?? engine.lapseExponent, propeller };
    } else {
      unused(lapse, L.lapseExponent.label);
      engine = {
        ...engine,
        power: power ?? engine.power,
        propeller,
        ...(critical !== undefined ? { criticalAltitude: critical } : {}),
      };
    }
  }
  return { ...aircraft, propulsion: sfc === undefined ? engine : { ...engine, sfc } };
}

/** Structural limits: the base's, overridden key by key, removed by str=none. */
function readStructure(params: URLSearchParams, aircraft: Aircraft, problems: string[]): Aircraft {
  const marker = params.get(KEY.structure);
  const values: Partial<Record<NumericLimit, number>> = {};
  for (const [key, field] of STRUCTURE_KEYS) {
    const { label, min, max } = STRUCTURE_LIMITS[field];
    const value = readNumber(params, key, label, problems, { min, max });
    if (value !== undefined) values[field] = value;
  }
  const given = Object.keys(values).length;

  if (marker !== null && marker !== 'none') problems.push(`Unknown structure option "${marker}". Expected: none.`);
  if (marker === 'none') {
    if (given > 0) problems.push('Structural limits were given for an aircraft without them; ignored.');
    const { structure: _none, ...rest } = aircraft;
    return rest;
  }
  const rawCategory = params.get(KEY.category);
  if (given === 0 && rawCategory === null) return aircraft;

  if (!aircraft.structure && given < STRUCTURE_KEYS.length) {
    problems.push('Structural limits need all five values (nmax, nmin, vc, vd, clneg); ignored.');
    return aircraft;
  }
  // Absent means normal.
  let category: Category | undefined = aircraft.structure?.category;
  if (rawCategory !== null) {
    if ((CATEGORIES as readonly string[]).includes(rawCategory)) category = rawCategory as Category;
    else problems.push(`Unknown category "${rawCategory}". Expected one of: ${CATEGORIES.join(', ')}.`);
  }
  const { category: _previous, ...base } = aircraft.structure ?? {};
  const structure = {
    ...base,
    ...values,
    ...(category !== undefined && category !== 'normal' ? { category } : {}),
  } as StructuralLimits;
  const invalid = validateStructure(structure);
  if (invalid.length > 0) {
    problems.push(...invalid.map((p) => `${p} The structural limits were ignored.`));
    return aircraft;
  }
  return { ...aircraft, structure };
}

/** An optional coefficient: a number, "none" to remove it, or absent to keep it. */
function readOptional(
  params: URLSearchParams,
  key: string,
  field: 'clMaxFlaps' | 'clMaxTakeoff' | 'emptyMass' | 'fuelCapacity',
  aircraft: Aircraft,
  problems: string[],
): Aircraft {
  if (params.get(key) === 'none') {
    const { [field]: _removed, ...rest } = aircraft;
    return rest;
  }
  const value = readNumber(params, key, AIRCRAFT_LIMITS[field].label, problems, range(field));
  return value === undefined ? aircraft : { ...aircraft, [field]: value };
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

  aircraft = readOptional(params, KEY.clMaxFlaps, 'clMaxFlaps', aircraft, problems);
  aircraft = readOptional(params, KEY.clMaxTakeoff, 'clMaxTakeoff', aircraft, problems);
  aircraft = readOptional(params, KEY.emptyMass, 'emptyMass', aircraft, problems);
  aircraft = readOptional(params, KEY.fuelCapacity, 'fuelCapacity', aircraft, problems);

  aircraft = readEngine(params, aircraft, problems);
  aircraft = readStructure(params, aircraft, problems);

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

  // Operating mass is bounded by this aircraft's maximum, so it is read last.
  const operating = readNumber(params, KEY.operatingMass, 'Operating mass', problems, {
    exclusiveMin: 0,
    min: AIRCRAFT_LIMITS.mass.min,
    max: aircraft.mass,
  });
  const loadFactor = readNumber(params, KEY.loadFactor, 'Load factor', problems, LIMITS.loadFactor);
  const headwind = readNumber(params, KEY.headwind, 'Headwind', problems, LIMITS.headwind);
  let surface: SurfaceId | undefined;
  const rawSurface = params.get(KEY.surface);
  if (rawSurface !== null) {
    if (isSurfaceId(rawSurface)) surface = rawSurface;
    else problems.push(`Unknown runway surface "${rawSurface}"; using dry pavement.`);
  }

  // Catch combinations that are individually plausible but jointly invalid.
  for (const problem of validateAircraft(aircraft)) {
    problems.push(problem);
  }

  return {
    scenario: {
      presetId: resolvedPresetId,
      aircraft,
      altitude,
      deltaISA,
      tas,
      // Values equal to the defaults are dropped, so one state has one link.
      ...(operating !== undefined && !sameNumber(operating, aircraft.mass) ? { mass: operating } : {}),
      ...(loadFactor !== undefined && !sameNumber(loadFactor, 1) ? { loadFactor } : {}),
      ...(surface !== undefined && surface !== 'dry-paved' ? { surface } : {}),
      ...(headwind !== undefined && !sameNumber(headwind, 0) ? { headwind } : {}),
    },
    problems,
  };
}
