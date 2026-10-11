import type { Aircraft } from '../../physics/aero.js';
import { BSFC_LB_PER_HP_H, TSFC_LB_PER_LBF_H } from '../../physics/propulsion.js';

const KT = 1852 / 3600;

/**
 * Representative aircraft parameters for education and demonstration.
 *
 * These are *simplified representative* figures, not certification data.
 *
 * The Cessna 172S is calibrated against its POH, and checked against figures
 * the calibration didn't use. Mass, wing area and span are published. The
 * remaining parameters are fitted, one published figure each:
 *
 *   CLmax, flap CLmax   53 KCAS clean and 48 KCAS full-flap stall, at 2,550 lb
 *   takeoff CLmax       50 KCAS stall with 10° flap, the short-field setting
 *   e, CD0 power off    best glide 68 KIAS at 9:1 (propeller windmilling)
 *   CD0 power on        cruise 124 KTAS at 75 % power and 8,500 ft, at the
 *                       cruise propeller efficiency of 0.8
 *   propeller line      best rate of climb 730 ft/min at 74 KIAS, sea level
 *   fuel-flow line      two cells of the POH cruise table, 77 % and 44 % power
 *
 * The two CD0s differ by the windmilling propeller, 0.0194: a fixed-pitch
 * propeller at idle is a drag brake. One polar fitted to the glide made
 * powered flight 17 % slow at a set power (vault finding 8).
 *
 * Checks and pinned discrepancies are on the /validation page: V_x 60.0 kt
 * against 62 KIAS; maximum level speed 117.4 KTAS against 126, 7 % low,
 * because the straight full-throttle thrust line can't follow a fixed-pitch
 * propeller's RPM rising with speed. Pinned, not tuned away.
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
  oswaldEfficiency: 0.717, // fitted, with CD0 power off, to the POH best glide: 68 KIAS at 9:1
  cd0: 0.0326, // fitted: 124 KTAS at 75 % power, 8,500 ft
  windmillCd0: 0.0194, // power off, CD0 is 0.052: the glide's
  clMax: 1.54, // fitted: 53 KCAS clean stall at 2,550 lb
  clMaxFlaps: 1.88, // fitted: 48 KCAS full-flap stall at 2,550 lb
  clMaxTakeoff: 1.73, // fitted: 50 KCAS stall with 10° flap at 2,550 lb
  propulsion: {
    kind: 'piston',
    power: 180 * 745.699872, // Lycoming IO-360-L2A, 180 hp at 2,700 rpm
    // Fitted, with the exact climb, to the POH best rate of climb: 730 ft/min at 74 KIAS, sea level
    propeller: { staticThrust: 3313, zeroThrustSpeed: 103.9 },
    // Fitted: the fuel-flow line through two POH cruise cells at standard temperature,
    // 10.5 GPH at 77 % (2,000 ft, 2,550 rpm) and 6.6 GPH at 44 % (12,000 ft, 2,300 rpm),
    // avgas at 6 lb/gal. The slope is 3.9 GPH per 33 % of 180 hp; the intercept 1.4 GPH.
    sfc: ((3.9 / 33) * 6 / 1.8) * BSFC_LB_PER_HP_H, // 0.394 lb/(hp h)
    baseFuelFlow: (1.4 * 6 * 0.45359237) / 3600, // kg/s
  },
  emptyMass: 1663 * 0.45359237, // POH standard empty weight
  fuelCapacity: 53 * 6 * 0.45359237, // 53 gal usable avgas at 6 lb/gal
  // Normal category, POH section 2. V_C is taken as V_NO, the least the
  // former 14 CFR 23.1505 allows, and V_D as V_NE / 0.9, so V_NE comes out at the published
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
  structure: { nPositive: 7, nNegative: -3.5, cruiseSpeed: 300 * KT, diveSpeed: 375 * KT, clMin: -0.9, category: 'aerobatic' },
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
  structure: { nPositive: 5.3, nNegative: -2.65, cruiseSpeed: 97 * KT, diveSpeed: 150 * KT, clMin: -0.8, category: 'utility' },
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
