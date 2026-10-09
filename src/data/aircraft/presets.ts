import type { Aircraft } from '../../physics/aero.js';
import { BSFC_LB_PER_HP_H, TSFC_LB_PER_LBF_H } from '../../physics/propulsion.js';

const KT = 1852 / 3600;

/**
 * Representative aircraft parameters for education and demonstration.
 *
 * These are *simplified representative* figures, not certification data.
 *
 * The Cessna 172S is calibrated against its POH, and checked against figures
 * the calibration didn't use. Mass, wing area and span are published. Each
 * remaining parameter is fitted to exactly two published numbers:
 *
 *   CLmax, flap CLmax   53 KCAS clean and 48 KCAS full-flap stall, at 2,550 lb
 *   takeoff CLmax       50 KCAS stall with 10° flap, the short-field setting
 *   CD0, Oswald e       best glide 68 KIAS at 9:1 (propeller windmilling)
 *   propeller line      best rate of climb 730 ft/min at 74 KIAS, sea level
 *
 * Checks the calibration never saw (tests/references.test.ts):
 * - V_x 60.9 kt against the published 62 KIAS
 * - service ceiling 13,944 ft against the published 14,000 ft
 * - maximum level speed 114.8 KTAS against the published 126: 9 % low. The
 *   glide polar includes a windmilling propeller's drag, which overstates the
 *   drag of powered flight at high speed. The error is pinned, not tuned away.
 *
 * The generic jet trainer and sailplane are plausible, not calibrated.
 *
 * Where the simple parabolic polar cannot match reality, the discrepancy is
 * documented rather than tuned away — see `tests/aero.test.ts` and the planned
 * /validation page.
 *
 * Kept as typed TypeScript rather than JSON: these are a fixed, small set that
 * ships with the app, so loading them as data would trade compile-time
 * validation for nothing. User-defined aircraft are a separate concern and do
 * go through runtime validation.
 */

export const CESSNA_172S: Aircraft = {
  name: 'Cessna 172S (representative)',
  mass: 2550 * 0.45359237, // 2,550 lb exactly, the 172S's max takeoff weight (2,450 lb is the 172R's)
  wingArea: 174 * 0.3048 * 0.3048, // 174 ft² exactly
  aspectRatio: 7.48, // 36 ft 1 in span over 174 ft²
  oswaldEfficiency: 0.717, // fitted, with CD0, to the POH best glide: 68 KIAS at 9:1
  cd0: 0.052,
  clMax: 1.54, // fitted: 53 KCAS clean stall at 2,550 lb
  clMaxFlaps: 1.88, // fitted: 48 KCAS full-flap stall at 2,550 lb
  clMaxTakeoff: 1.73, // fitted: 50 KCAS stall with 10° flap at 2,550 lb
  propulsion: {
    kind: 'piston',
    power: 180 * 745.699872, // Lycoming IO-360-L2A, 180 hp at 2,700 rpm
    // Fitted, with the exact climb, to the POH best rate of climb: 730 ft/min at 74 KIAS, sea level
    propeller: { staticThrust: 3035, zeroThrustSpeed: 175.9 },
    sfc: 0.45 * BSFC_LB_PER_HP_H, // assumed: Anderson's CP-1 value, not from the POH
  },
  emptyMass: 1663 * 0.45359237, // POH standard empty weight
  fuelCapacity: 53 * 6 * 0.45359237, // 53 gal usable avgas at 6 lb/gal
  // Normal category, POH section 2. V_C is taken as V_NO, the least 14 CFR
  // 23.1505 allows, and V_D as V_NE / 0.9, so V_NE comes out at the published
  // 160 KCAS. The negative-stall CL isn't published: about -1.1 for the
  // NACA 2412 section, taken as -1.0 for the wing. At these speeds, at sea
  // level, CAS and EAS are the same.
  structure: {
    nPositive: 3.8,
    nNegative: -1.52,
    cruiseSpeed: 126 * KT,
    diveSpeed: (160 / 0.9) * KT,
    clMin: -1.0,
  },
};

export const GENERIC_JET_TRAINER: Aircraft = {
  name: 'Generic jet trainer',
  mass: 4500,
  wingArea: 17.5,
  aspectRatio: 6.0,
  oswaldEfficiency: 0.8,
  cd0: 0.020,
  clMax: 1.4,
  clMaxFlaps: 1.9,
  clMaxTakeoff: 1.6,
  // One small turbofan: thrust-to-weight 0.32 at sea level, thrust lapsing
  // with density.
  propulsion: { kind: 'turbofan', thrust: 14000, lapseExponent: 1.0, sfc: 0.75 * TSFC_LB_PER_LBF_H },
  emptyMass: 2800,
  fuelCapacity: 1200,
  // Aerobatic-trainer limits, V_D = 1.25 V_C.
  structure: { nPositive: 7, nNegative: -3.5, cruiseSpeed: 300 * KT, diveSpeed: 375 * KT, clMin: -0.9 },
};

export const GENERIC_SAILPLANE: Aircraft = {
  name: 'Generic sailplane',
  mass: 500,
  wingArea: 11.0,
  aspectRatio: 22.0,
  oswaldEfficiency: 0.9,
  cd0: 0.012,
  clMax: 1.5,
  // Utility category in the manner of CS-22: V_NE 135 kt, so V_D 150 kt, with
  // the rough-air speed as V_C.
  structure: { nPositive: 5.3, nNegative: -2.65, cruiseSpeed: 97 * KT, diveSpeed: 150 * KT, clMin: -0.8 },
};

/**
 * Preset registry, keyed by a short stable id.
 *
 * The ids are part of the URL format, so they are API: renaming one breaks
 * every permalink anybody has saved. Add freely, rename never.
 */
export const PRESETS = {
  c172: CESSNA_172S,
  'jet-trainer': GENERIC_JET_TRAINER,
  sailplane: GENERIC_SAILPLANE,
} as const satisfies Record<string, Aircraft>;

export type PresetId = keyof typeof PRESETS;

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

export function isPresetId(value: string): value is PresetId {
  return Object.prototype.hasOwnProperty.call(PRESETS, value);
}

export function getPreset(id: string): Aircraft | undefined {
  return isPresetId(id) ? PRESETS[id] : undefined;
}
