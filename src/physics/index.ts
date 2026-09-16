/**
 * Flight performance physics core.
 *
 * Zero runtime dependencies, no framework coupling, all SI internally. This
 * package is intended to stand alone — it should stay publishable on its own,
 * which means nothing in here may import from the UI or state layer.
 */

export * from './constants.js';
export * from './units.js';
export * from './atmosphere.js';
export * from './airspeed.js';
export * from './aero.js';
export * from './performance/curves.js';
