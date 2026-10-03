import type { Aircraft } from '../../physics/aero.js';

/**
 * Representative aircraft parameters for education and demonstration.
 *
 * These are *simplified representative* figures, not certification data. Mass,
 * wing area and span are published. CLmax is fitted to the published stall
 * speeds at that mass. CD0 and Oswald efficiency are estimates, since no
 * manufacturer publishes either.
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
  mass: 1156.7, // 2,550 lb, the 172S's max takeoff weight (2,450 lb is the 172R's)
  wingArea: 16.17, // 174 ft²
  aspectRatio: 7.48, // 36 ft 1 in span over 174 ft²
  oswaldEfficiency: 0.75,
  cd0: 0.036,
  clMax: 1.54, // fitted: 53 KCAS clean stall at 2,550 lb
  clMaxFlaps: 1.88, // fitted: 48 KCAS full-flap stall at 2,550 lb
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
