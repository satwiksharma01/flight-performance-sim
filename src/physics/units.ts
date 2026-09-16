/**
 * Unit handling.
 *
 * Policy: every value inside `physics/` is SI. Conversion happens only at the
 * boundary — when a value enters from the UI or leaves for display.
 *
 * Branded types are applied at that boundary rather than throughout the maths.
 * TypeScript drops a brand on arithmetic (`Metres + Metres` widens to `number`),
 * so branding intermediate results would mean re-branding after every operation:
 * noise that buys nothing. Branding the boundary is where the real bugs live —
 * a feet value reaching a function that expects metres.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

// --- Length ---------------------------------------------------------------
export type Metres = Brand<number, 'm'>;
export type Feet = Brand<number, 'ft'>;
export type NauticalMiles = Brand<number, 'NM'>;
export type Kilometres = Brand<number, 'km'>;

// --- Speed ----------------------------------------------------------------
export type MetresPerSecond = Brand<number, 'm/s'>;
export type Knots = Brand<number, 'kt'>;
export type KilometresPerHour = Brand<number, 'km/h'>;
export type FeetPerMinute = Brand<number, 'fpm'>;

// --- Mass and force -------------------------------------------------------
export type Kilograms = Brand<number, 'kg'>;
export type Pounds = Brand<number, 'lb'>;
export type Newtons = Brand<number, 'N'>;

// --- Other ----------------------------------------------------------------
export type Kelvin = Brand<number, 'K'>;
export type Celsius = Brand<number, 'degC'>;
export type Pascals = Brand<number, 'Pa'>;
export type InchesMercury = Brand<number, 'inHg'>;
export type Watts = Brand<number, 'W'>;

// --- Constructors ---------------------------------------------------------
// These assert a unit onto a raw number. Use them once, where the number
// originates; never to paper over a type error mid-calculation.

export const metres = (v: number) => v as Metres;
export const feet = (v: number) => v as Feet;
export const nauticalMiles = (v: number) => v as NauticalMiles;
export const kilometres = (v: number) => v as Kilometres;
export const mps = (v: number) => v as MetresPerSecond;
export const knots = (v: number) => v as Knots;
export const kph = (v: number) => v as KilometresPerHour;
export const fpm = (v: number) => v as FeetPerMinute;
export const kilograms = (v: number) => v as Kilograms;
export const pounds = (v: number) => v as Pounds;
export const newtons = (v: number) => v as Newtons;
export const kelvin = (v: number) => v as Kelvin;
export const celsius = (v: number) => v as Celsius;
export const pascals = (v: number) => v as Pascals;
export const inHg = (v: number) => v as InchesMercury;
export const watts = (v: number) => v as Watts;

// --- Exact conversion factors --------------------------------------------
const FT_PER_M = 1 / 0.3048;
const NM_PER_M = 1 / 1852;
const KT_PER_MPS = 3600 / 1852;
const LB_PER_KG = 1 / 0.45359237;
const PA_PER_INHG = 3386.389;

// --- Length ---------------------------------------------------------------
export const feetToMetres = (v: Feet): Metres => metres(v * 0.3048);
export const metresToFeet = (v: Metres): Feet => feet(v * FT_PER_M);
export const metresToNauticalMiles = (v: Metres): NauticalMiles =>
  nauticalMiles(v * NM_PER_M);
export const nauticalMilesToMetres = (v: NauticalMiles): Metres => metres(v * 1852);
export const metresToKilometres = (v: Metres): Kilometres => kilometres(v / 1000);

// --- Speed ----------------------------------------------------------------
export const knotsToMps = (v: Knots): MetresPerSecond => mps(v / KT_PER_MPS);
export const mpsToKnots = (v: MetresPerSecond): Knots => knots(v * KT_PER_MPS);
export const kphToMps = (v: KilometresPerHour): MetresPerSecond => mps(v / 3.6);
export const mpsToKph = (v: MetresPerSecond): KilometresPerHour => kph(v * 3.6);
/** Vertical speed: metres per second to the feet per minute pilots read. */
export const mpsToFpm = (v: MetresPerSecond): FeetPerMinute => fpm(v * FT_PER_M * 60);
export const fpmToMps = (v: FeetPerMinute): MetresPerSecond => mps(v / (FT_PER_M * 60));

// --- Mass and force -------------------------------------------------------
export const poundsToKilograms = (v: Pounds): Kilograms => kilograms(v * 0.45359237);
export const kilogramsToPounds = (v: Kilograms): Pounds => pounds(v * LB_PER_KG);

// --- Temperature ----------------------------------------------------------
export const celsiusToKelvin = (v: Celsius): Kelvin => kelvin(v + 273.15);
export const kelvinToCelsius = (v: Kelvin): Celsius => celsius(v - 273.15);

// --- Pressure -------------------------------------------------------------
export const inHgToPascals = (v: InchesMercury): Pascals => pascals(v * PA_PER_INHG);
export const pascalsToInHg = (v: Pascals): InchesMercury => inHg(v / PA_PER_INHG);
