/**
 * Sensitivity: which of the aircraft's inputs move each result most.
 *
 * Deterministic and local. Each input is scaled by 1 ± 1 % on its own, with
 * everything else held, and the result's change found by central difference.
 * The figure reported is the elasticity, the per cent change in the result for
 * a 1 % change in the input,
 *
 *   E = (y(x (1 + h)) - y(x (1 - h))) / (2 h y(x)),   h = 0.01,
 *
 * which has no units, so inputs as different as weight and CD0 rank against
 * each other. For a power law y ∝ x^a it returns a, with an error of
 * a (a - 1) (a - 2) h^2 / 6: under 0.0005 for any |a| up to 2, so the closed
 * forms' exponents (stall speed ∝ W^0.5, for one) come out exact to the two
 * decimals shown. Where a result has a kink inside the ±1 % (a cruise speed
 * meeting its 1.2 V_s floor, tanks filling) the difference averages the slopes
 * on either side.
 *
 * Results are taken wings level at the scenario's altitude, ISA day, runway
 * and wind; speeds are true airspeeds. Pure, like the other tab models.
 */

import { atPressureAltitude, maxLiftToDrag, stallSpeed, vMinDrag, type Aircraft } from '../physics/index.js';
import { ceilings, climbPerformance, isPowered } from '../physics/performance/climb.js';
import { minimumSink } from '../physics/performance/glide.js';
import { RUNWAY_SURFACES, landing, takeoff } from '../physics/performance/field.js';
import { breguet, fuelAboard } from '../physics/performance/range.js';
import type { Propulsion } from '../physics/propulsion.js';
import { headwindOf, operatingMass, surfaceOf, type Scenario } from '../state/url.js';
import { num } from './format.js';

/** Relative step of the central difference. */
export const STEP = 0.01;

/** Every result, in SI, or null where the aircraft has no such figure. */
function results(scenario: Scenario) {
  const aircraft: Aircraft = { ...scenario.aircraft, mass: operatingMass(scenario) };
  const atmosphere = atPressureAltitude(scenario.altitude, scenario.deltaISA);
  const runway = RUNWAY_SURFACES[surfaceOf(scenario)];
  const powered = isPowered(aircraft) ? aircraft : null;
  const climb = powered ? climbPerformance(powered, atmosphere) : null;
  const ceiling = powered ? ceilings(powered, scenario.deltaISA) : null;
  const to = takeoff(aircraft, atmosphere, runway, headwindOf(scenario));
  const ld = landing(aircraft, atmosphere, runway, headwindOf(scenario));
  const cruise = breguet(aircraft, atmosphere.density, fuelAboard(aircraft));
  return {
    stall: stallSpeed(aircraft, atmosphere.density),
    vmd: vMinDrag(aircraft, atmosphere.density),
    ld: maxLiftToDrag(aircraft),
    vy: climb?.vy.tas ?? null,
    roc: climb?.vy.rateOfClimb ?? null,
    vmax: climb?.maxLevelSpeed ?? null,
    service: ceiling?.service ?? null,
    absolute: ceiling?.absolute ?? null,
    sink: minimumSink(aircraft, atmosphere).sinkRate,
    takeoff: to.ok ? to.total : null,
    landing: ld.ok ? ld.total : null,
    range: cruise?.range.value ?? null,
    endurance: cruise?.endurance.value ?? null,
  };
}

export type OutputId = keyof ReturnType<typeof results>;

/** The results, in the comparison table's order. `noun` is how a sentence names it. */
export const OUTPUTS: readonly { readonly id: OutputId; readonly label: string; readonly noun: string }[] = [
  { id: 'stall', label: 'Stall speed', noun: 'the stall speed' },
  { id: 'vmd', label: 'Best L/D speed, V_md', noun: 'the best-L/D speed' },
  { id: 'ld', label: '(L/D)max', noun: '(L/D)max' },
  { id: 'vy', label: 'Best rate-of-climb speed, V_y', noun: 'the best-rate-of-climb speed' },
  { id: 'roc', label: 'Best rate of climb', noun: 'the best rate of climb' },
  { id: 'vmax', label: 'Maximum level speed', noun: 'the maximum level speed' },
  { id: 'service', label: 'Service ceiling', noun: 'the service ceiling' },
  { id: 'absolute', label: 'Absolute ceiling', noun: 'the absolute ceiling' },
  { id: 'sink', label: 'Minimum sink', noun: 'the minimum sink rate' },
  { id: 'takeoff', label: 'Takeoff over 50 ft', noun: 'the takeoff distance' },
  { id: 'landing', label: 'Landing from 50 ft', noun: 'the landing distance' },
  { id: 'range', label: 'Best range, Breguet', noun: 'the best range' },
  { id: 'endurance', label: 'Best endurance, Breguet', noun: 'the best endurance' },
];

interface Input {
  /** As it reads after "1 % more" */
  readonly label: string;
  /** The scenario with this input scaled by `factor` */
  readonly at: (factor: number) => Scenario;
}

/** Aircraft fields scaled as they stand. Optional ones are skipped when absent. */
const FIELDS = [
  ['wingArea', 'wing area'],
  ['aspectRatio', 'aspect ratio'],
  ['oswaldEfficiency', 'Oswald efficiency'],
  ['cd0', 'CD₀'],
  ['clMax', 'clean CLmax'],
  ['clMaxTakeoff', 'takeoff-flap CLmax'],
  ['clMaxFlaps', 'landing-flap CLmax'],
  ['fuelCapacity', 'fuel capacity'],
] as const;

/** Full-power thrust scaled at every speed: for a propeller, power and static thrust together, so its efficiency curve is held. */
function scaledEngine(engine: Propulsion, factor: number): Propulsion {
  if (engine.kind === 'turbofan') return { ...engine, thrust: engine.thrust * factor };
  return { ...engine, power: engine.power * factor, propeller: { ...engine.propeller, staticThrust: engine.propeller.staticThrust * factor } };
}

/** The inputs this aircraft has. Weight is the operating weight, loaded tanks first as on the range tab. */
function inputsOf(scenario: Scenario): Input[] {
  const aircraft = scenario.aircraft;
  const withAircraft = (edit: Partial<Aircraft>): Scenario => ({ ...scenario, aircraft: { ...aircraft, ...edit } });
  const inputs: Input[] = [{ label: 'weight', at: (f) => ({ ...scenario, mass: operatingMass(scenario) * f }) }];
  for (const [key, label] of FIELDS) {
    const value = aircraft[key];
    if (value !== undefined) inputs.push({ label, at: (f) => withAircraft({ [key]: value * f }) });
  }
  const engine = aircraft.propulsion;
  if (engine) {
    inputs.push({
      label: engine.kind === 'turbofan' ? 'engine thrust' : 'engine power',
      at: (f) => withAircraft({ propulsion: scaledEngine(engine, f) }),
    });
    const sfc = engine.sfc;
    if (sfc !== undefined) {
      inputs.push({
        label: 'specific fuel consumption',
        at: (f) => withAircraft({ propulsion: { ...engine, sfc: sfc * f } }),
      });
    }
  }
  return inputs;
}

export interface Influence {
  readonly input: string;
  /** Per cent change in the result per 1 % more of the input; null where either side can't be computed */
  readonly elasticity: number | null;
}

export interface SensitivityRow {
  readonly id: OutputId;
  readonly label: string;
  /** Every input, strongest first at the two decimals shown */
  readonly ranked: readonly Influence[];
  readonly sentence: string;
}

export interface SensitivityModel {
  /** Only the results this aircraft has, in OUTPUTS order */
  readonly rows: readonly SensitivityRow[];
}

/** The elasticity by central difference, or null if a side is missing or the result is zero. */
export function elasticity(base: number | null, up: number | null, down: number | null): number | null {
  if (base === null || up === null || down === null || base === 0) return null;
  const e = (up - down) / (2 * STEP * base);
  return Number.isFinite(e) ? e : null;
}

export const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function list(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** As shown, to two decimals, so a tie on screen is a tie in the sentence. */
const shown = (e: number) => Number(Math.abs(e).toFixed(2));

/** One templated sentence naming the strongest input, or each of them when they tie. */
export function describe(noun: string, ranked: readonly Influence[]): string {
  const moving = ranked.flatMap((r) => (r.elasticity !== null && shown(r.elasticity) > 0 ? [{ ...r, e: r.elasticity }] : []));
  const top = moving[0];
  if (!top) return `None of these inputs changes ${noun}.`;
  const lead = moving.filter((r) => shown(r.e) === shown(top.e));
  const effect = (r: { input: string; e: number }, i: number) =>
    `1 % more ${r.input} ${r.e > 0 ? 'raises' : 'lowers'} ${i === 0 ? noun : 'it'} by ${num(Math.abs(r.e), 2)} %`;
  const who = lead.length === 1 ? `${top.input} matters most` : `${list(lead.map((r) => r.input))} matter equally`;
  return `${capitalise(who)}: ${lead.map(effect).join('; ')}.`;
}

/** For ranking: as shown, so ties keep the inputs' order; unknown last. */
const strength = (r: Influence) => (r.elasticity === null ? -1 : shown(r.elasticity));

export function buildSensitivity(scenario: Scenario): SensitivityModel {
  const base = results(scenario);
  const perturbed = inputsOf(scenario).map((input) => ({
    input: input.label,
    up: results(input.at(1 + STEP)),
    down: results(input.at(1 - STEP)),
  }));

  const rows = OUTPUTS.flatMap(({ id, label, noun }) => {
    const value = base[id];
    if (value === null || value === 0) return [];
    const ranked = perturbed
      .map((p) => ({ input: p.input, elasticity: elasticity(value, p.up[id], p.down[id]) }))
      .sort((a, b) => strength(b) - strength(a));
    return [{ id, label, ranked, sentence: describe(noun, ranked) }];
  });
  return { rows };
}
