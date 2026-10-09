/**
 * The explorer's permalink: the scenario, plus how it is being viewed.
 *
 * `state/url.ts` owns the scenario format. This layer adds two things on top of
 * it without changing it:
 *
 * - The base preset. Once an aircraft is edited, the scenario stops claiming to
 *   be the preset (`presetId` becomes null), but the link should stay short. So
 *   the edit is still encoded as a delta against the preset it came from:
 *   `?ac=c172&m=900` rather than every parameter spelled out.
 *
 * - View settings, under their own keys (`x` for the axis, `u` for the speed
 *   unit, `sys` for SI or US units, `tab` for the envelope, field or range tab).
 *   They don't change any number, but a link pasted into a report should open
 *   on the chart its author was looking at. Like the scenario keys, these are a
 *   public format: append-only.
 */

import { getPreset } from '../data/aircraft/presets.js';
import { decodeScenario, encodeScenario, type Scenario } from '../state/url.js';
import { DEFAULT_VIEW, TABS, type SpeedAxis, type SpeedUnit, type Tab, type UnitSystem, type ViewSettings } from './model.js';

const VIEW_KEY = { axis: 'x', unit: 'u', system: 'sys', tab: 'tab' } as const;

const AXES: readonly SpeedAxis[] = ['tas', 'eas', 'cas', 'mach'];
const UNITS: readonly SpeedUnit[] = ['kt', 'mps', 'kmh'];
const SYSTEMS: readonly UnitSystem[] = ['si', 'us'];

export interface Permalink {
  readonly scenario: Scenario;
  /** The preset the aircraft was derived from, kept after edits for delta encoding */
  readonly basePresetId: string | null;
  readonly view: ViewSettings;
}

export interface ReadResult extends Permalink {
  /** What could not be used, in plain language. Empty when fully understood */
  readonly problems: readonly string[];
}

function isAxis(value: string): value is SpeedAxis {
  return (AXES as readonly string[]).includes(value);
}

function isUnit(value: string): value is SpeedUnit {
  return (UNITS as readonly string[]).includes(value);
}

function isSystem(value: string): value is UnitSystem {
  return (SYSTEMS as readonly string[]).includes(value);
}

function isTab(value: string): value is Tab {
  return (TABS as readonly string[]).includes(value);
}

/** Read a query string. Like `decodeScenario`, this never throws. */
export function readPermalink(query: string): ReadResult {
  const { scenario, problems: scenarioProblems } = decodeScenario(query);
  const problems = [...scenarioProblems];
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);

  const requestedPreset = params.get('ac');
  const basePresetId =
    scenario.presetId ?? (requestedPreset !== null && getPreset(requestedPreset) ? requestedPreset : null);

  let axis = DEFAULT_VIEW.axis;
  const rawAxis = params.get(VIEW_KEY.axis);
  if (rawAxis !== null) {
    if (isAxis(rawAxis)) axis = rawAxis;
    else problems.push(`Unknown speed axis "${rawAxis}". Expected one of: ${AXES.join(', ')}.`);
  }

  let unit = DEFAULT_VIEW.unit;
  const rawUnit = params.get(VIEW_KEY.unit);
  if (rawUnit !== null) {
    if (isUnit(rawUnit)) unit = rawUnit;
    else problems.push(`Unknown speed unit "${rawUnit}". Expected one of: ${UNITS.join(', ')}.`);
  }

  let system = DEFAULT_VIEW.system;
  const rawSystem = params.get(VIEW_KEY.system);
  if (rawSystem !== null) {
    if (isSystem(rawSystem)) system = rawSystem;
    else problems.push(`Unknown unit system "${rawSystem}". Expected one of: ${SYSTEMS.join(', ')}.`);
  }

  let tab = DEFAULT_VIEW.tab;
  const rawTab = params.get(VIEW_KEY.tab);
  if (rawTab !== null) {
    if (isTab(rawTab)) tab = rawTab;
    else problems.push(`Unknown tab "${rawTab}". Expected one of: ${TABS.join(', ')}.`);
  }

  return { scenario, basePresetId, view: { axis, unit, system, tab }, problems };
}

/** Write a query string, without the leading `?`. */
export function writePermalink({ scenario, basePresetId, view }: Permalink): string {
  // An edited aircraft is encoded against the preset it came from. Decoding
  // drops the preset id again, because the values differ from the preset.
  const encodeAs =
    scenario.presetId === null && basePresetId !== null && getPreset(basePresetId)
      ? { ...scenario, presetId: basePresetId }
      : scenario;

  const params = new URLSearchParams(encodeScenario(encodeAs));
  if (view.axis !== DEFAULT_VIEW.axis) params.set(VIEW_KEY.axis, view.axis);
  if (view.unit !== DEFAULT_VIEW.unit) params.set(VIEW_KEY.unit, view.unit);
  if (view.system !== DEFAULT_VIEW.system) params.set(VIEW_KEY.system, view.system);
  if (view.tab !== DEFAULT_VIEW.tab) params.set(VIEW_KEY.tab, view.tab);
  return params.toString();
}

/**
 * Pass a state through its own permalink.
 *
 * The explorer stores exactly what the link would reproduce, so what is on
 * screen is always what a pasted link opens. It also resolves the preset id:
 * an edit that restores every preset value makes the aircraft the preset again.
 */
export function canonicalize(state: Permalink): Permalink {
  const { scenario, basePresetId, view } = readPermalink(writePermalink(state));
  return { scenario, basePresetId, view };
}
