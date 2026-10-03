import type { Aircraft } from '../../physics/aero.js';

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
 *   CD0, Oswald e       best glide 68 KIAS at 9:1 (propeller windmilling)
 *   propeller line      best rate of climb 730 ft/min at 74 KIAS, sea level
 *
 * Checks the calibration never saw (tests/references.test.ts):
 * - V_x 60.9 kt against the published 62 KIAS
 * - service ceiling 13,972 ft against the published 14,000 ft
 * - maximum level speed 114.6 KTAS against the published 126: 9 % low. The
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
  propulsion: {
    kind: 'piston',
    power: 180 * 745.699872, // Lycoming IO-360-L2A, 180 hp at 2,700 rpm
    // Fitted to the POH best rate of climb, 730 ft/min at 74 KIAS, sea level
    propeller: { staticThrust: 3060, zeroThrustSpeed: 172 },
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
  // One small turbofan: thrust-to-weight 0.32 at sea level, thrust lapsing
  // with density.
  propulsion: { kind: 'turbofan', thrust: 14000, lapseExponent: 1.0 },
};

export const GENERIC_SAILPLANE: Aircraft = {
  name: 'Generic sailplane',
  mass: 500,
  wingArea: 11.0,
  aspectRatio: 22.0,
  oswaldEfficiency: 0.9,
  cd0: 0.012,
  clMax: 1.5,
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
