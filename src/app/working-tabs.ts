/**
 * The working behind the tabs' results, in the same form as the tiles'.
 *
 * Range and endurance: Breguet's integrals, R = ∫ V dW / (g ṁ) and
 * E = ∫ dW / (g ṁ), at constant CL, with fuel flow the engine's straight
 * line ṁ = m₀ + s × output. range.ts integrates them by Simpson's rule;
 * here they are in closed form, which they have for every case:
 *
 *   propeller range    (2/3) (η / g s) (CL/CD) ln(ṁ₀/ṁ₁)
 *   jet endurance      (CL / g s CD) ln(ṁ₀/ṁ₁)
 *   propeller endurance, jet range: an atan antiderivative with a base
 *   flow, the textbook Breguet forms without one.
 *
 * So the working is also a second, analytic check on the numerical
 * integration, and tests/working.test.ts holds them together.
 *
 * The envelope tab's results are closed forms already: V_A, the gust load,
 * the corner, a level turn, and P_s at the selected point.
 */

import { CRUISE_PROPELLER_EFFICIENCY, G0, RHO0, isPowered, k, type Aircraft } from '../physics/index.js';
import { LANDING_TECHNIQUE, OBSTACLE_HEIGHT, RUNWAY_SURFACES, TAKEOFF_TECHNIQUE } from '../physics/performance/field.js';
import type { CruiseCase } from '../physics/performance/range.js';
import { CRUISE_RESERVE, toDistance, type CruiseModel } from './cruise.js';
import type { EnvelopeModel } from './envelope.js';
import { evaluate } from './expression.js';
import { length, num, speed } from './format.js';
import type { ViewSettings } from './model.js';
import type { RunwayModel } from './runway.js';
import { chain, conditionNote, polarGiven, tasShown, thrust, weightGiven, type Given, type StepSpec, type Working } from './working.js';
import { cruisePowerOf, loadFactorOf, operatingMass, type Scenario } from '../state/url.js';

export type RangeWorkingId = 'range' | 'endurance' | 'set-power';

const GPH = (6 * 0.45359237) / 3600;

/** The fuel-flow line's terms, as givens. */
function fuelGiven(aircraft: Aircraft): Record<string, Given> {
  const engine = aircraft.propulsion!;
  const jet = engine.kind === 'turbofan';
  return {
    s: { value: engine.sfc!, unit: jet ? 'kg/(N s)' : 'kg/(W s)', note: 'the fuel line’s slope: SFC' },
    m_0: { value: engine.baseFuelFlow ?? 0, unit: 'kg/s', note: engine.baseFuelFlow ? 'the fuel line’s intercept: flow at zero output' : 'none: SFC is constant' },
  };
}

function breguetWorking(kind: 'range' | 'endurance', aircraft: Aircraft, cruise: CruiseModel, view: ViewSettings): Working | null {
  const result = cruise.result;
  if (!result || !aircraft.propulsion) return null;
  const flown: CruiseCase = result[kind];
  const jet = result.kind === 'jet';
  const base = Boolean(aircraft.propulsion.baseFuelFlow);
  const { atmosphere } = cruise;
  const distance = (m: number) => `${num(toDistance(m, view))} ${view.unit === 'kt' ? 'NM' : 'km'}`;
  const hours = (s: number) => `${num(s / 3600, 2)} h`;

  const given: Record<string, Given> = {
    W_0: { value: aircraft.mass * G0, unit: 'N', note: 'at the start' },
    W_1: { value: (aircraft.mass - cruise.fuel) * G0, unit: 'N', note: `at the end, the ${num(cruise.fuel, 1)} kg of fuel burned` },
    rho: { value: atmosphere.density, unit: 'kg/m³', note: conditionNote(atmosphere) },
    ...polarGiven(aircraft),
    C_L: {
      value: flown.cl,
      unit: '',
      note: flown.stallLimited
        ? 'held at 1.2 V_s: CLmax / 1.44, since the optimum is slower'
        : 'the lift coefficient that maximises the integral, by golden-section search',
    },
    ...fuelGiven(aircraft),
    g_0: { value: G0, unit: 'm/s²' },
    ...(jet ? {} : { eta: { value: CRUISE_PROPELLER_EFFICIENCY, unit: '', note: 'cruise propeller efficiency' } }),
  };
  // Drag is W CD/CL; the output the engine makes is that drag (jet) or its power at the propeller (propeller).
  const output = (end: '0' | '1'): StepSpec =>
    jet ? [`T_${end}`, `(C_D / C_L) * W_${end}`, 'N'] : [`P_${end}`, `(C_D / C_L) * W_${end} * V_${end} / eta`, 'W'];
  const steps: StepSpec[] = [
    ['k', '1 / (pi * e * AR)', ''],
    ['C_D', 'C_D0 + k * C_L ^ 2', ''],
    ['V_0', 'sqrt(2 * W_0 / (rho * S * C_L))', 'm/s', tasShown(atmosphere, view)],
    ['V_1', 'sqrt(2 * W_1 / (rho * S * C_L))', 'm/s', tasShown(atmosphere, view)],
    output('0'),
    output('1'),
    ['mdot_0', `m_0 + s * ${jet ? 'T_0' : 'P_0'}`, 'kg/s'],
    ['mdot_1', `m_0 + s * ${jet ? 'T_1' : 'P_1'}`, 'kg/s'],
  ];

  let intro: string;
  if (kind === 'range' && !jet) {
    intro = 'R = ∫ V dW / (g ṁ) at constant CL. Speed goes as √W and shaft power as W^1.5, so with fuel flow a straight line in power the integral is a logarithm of the fuel flows; with no base flow it is Breguet’s (η/c)(L/D) ln(W₀/W₁).';
    steps.push(['R', '(2 / 3) * (eta / (g_0 * s)) * (C_L / C_D) * ln(mdot_0 / mdot_1)', 'm', distance]);
  } else if (kind === 'endurance' && jet) {
    intro = 'E = ∫ dW / (g ṁ) at constant CL. Thrust is drag, W CD/CL, so fuel flow is a straight line in weight and the integral is a logarithm of the fuel flows.';
    steps.push(['E', '(C_L / (g_0 * s * C_D)) * ln(mdot_0 / mdot_1)', 's', hours]);
  } else if (!base) {
    if (kind === 'range') {
      intro = 'R = ∫ V dW / (g ṁ) at constant CL, with constant SFC: Breguet’s jet range, best at maximum CL^½/CD.';
      steps.push(['R', '(2 / (g_0 * s)) * sqrt(2 / (rho * S)) * (sqrt(C_L) / C_D) * (sqrt(W_0) - sqrt(W_1))', 'm', distance]);
    } else {
      intro = 'E = ∫ dW / (g ṁ) at constant CL, with constant SFC: Breguet’s propeller endurance, best at maximum CL^1.5/CD.';
      steps.push(['E', '(eta / (g_0 * s)) * (C_L ^ 1.5 / C_D) * sqrt(2 * rho * S) * (W_1 ^ -0.5 - W_0 ^ -0.5)', 's', hours]);
    }
  } else if (kind === 'range') {
    // ∫ √W dW / (A + B W) = (2/B) [√W − q atan(√W / q)], q = √(A/B), with A = m₀ and B = s CD/CL.
    intro = 'R = ∫ V dW / (g ṁ) at constant CL. Speed goes as √W and fuel flow is a straight line in W, so the integral has an arctangent: R = (a/g)(2/B)[√W − q tan⁻¹(√W/q)] from W₁ to W₀.';
    steps.push(
      ['a', 'sqrt(2 / (rho * S * C_L))', ''],
      ['B', 's * C_D / C_L', 'kg/(N s)'],
      ['q', 'sqrt(m_0 / B)', ''],
      ['R', '(a / g_0) * (2 / B) * (sqrt(W_0) - sqrt(W_1) - q * (atan(sqrt(W_0) / q) - atan(sqrt(W_1) / q)))', 'm', distance],
    );
  } else {
    // With w = √W: ∫ dW / (A + B W^1.5) = 2 ∫ w dw / (A + B w³), and ∫ w dw / (w³ + c³) is a table integral.
    intro = 'E = ∫ dW / (g ṁ) at constant CL. Shaft power goes as W^1.5, so with w = √W the integrand is w / (A + B w³), whose antiderivative is a logarithm and an arctangent: the table integral F(w) below.';
    steps.push(
      ['a', 'sqrt(2 / (rho * S * C_L))', ''],
      ['B', 's * a * C_D / (C_L * eta)', 'kg/(N^1.5 s)'],
      ['c', '(m_0 / B) ^ (1 / 3)', ''],
      ['w_0', 'sqrt(W_0)', ''],
      ['w_1', 'sqrt(W_1)', ''],
      ['F_0', '(1 / (6 * c)) * ln((w_0 ^ 2 - c * w_0 + c ^ 2) / (w_0 + c) ^ 2) + (1 / (c * sqrt(3))) * atan((2 * w_0 - c) / (c * sqrt(3)))', ''],
      ['F_1', '(1 / (6 * c)) * ln((w_1 ^ 2 - c * w_1 + c ^ 2) / (w_1 + c) ^ 2) + (1 / (c * sqrt(3))) * atan((2 * w_1 - c) / (c * sqrt(3)))', ''],
      ['E', '(2 / (g_0 * B)) * (F_0 - F_1)', 's', hours],
    );
  }
  return chain(kind === 'range' ? 'Best range' : 'Best endurance', intro, given, steps);
}

function setPowerWorking(aircraft: Aircraft, scenario: Scenario, cruise: CruiseModel, view: ViewSettings): Working | null {
  const p = cruise.setPower;
  if (!p || p.tas === null || !isPowered(aircraft)) return null;
  const engine = aircraft.propulsion;
  const jet = engine.kind === 'turbofan';
  const { atmosphere } = cruise;
  const fuel = p.fuelFlow !== null && p.endurance !== null;
  const given: Record<string, Given> = {
    f: { value: cruisePowerOf(scenario), unit: '', note: 'the setting, a fraction of the sea-level rating' },
    ...(jet ? { T_SL: { value: engine.thrust, unit: 'N', note: 'rated thrust' } } : { P_r: { value: engine.power, unit: 'W', note: 'rated power' }, eta: { value: CRUISE_PROPELLER_EFFICIENCY, unit: '', note: 'cruise propeller efficiency' } }),
    W: { value: aircraft.mass * G0, unit: 'N' },
    rho: { value: atmosphere.density, unit: 'kg/m³', note: conditionNote(atmosphere) },
    V: { value: p.tas, unit: 'm/s', note: `the faster level speed for this setting, by bisection: ${tasShown(atmosphere, view)(p.tas)}` },
    ...polarGiven(aircraft),
    ...(fuel ? { ...fuelGiven(aircraft), m_f: { value: cruise.fuel, unit: 'kg', note: 'fuel aboard' }, t_r: { value: CRUISE_RESERVE, unit: 's', note: '45 minutes in reserve' } } : {}),
  };
  const steps: StepSpec[] = [
    ['k', '1 / (pi * e * AR)', ''],
    ['C_L', '2 * W / (rho * V ^ 2 * S)', ''],
    ['C_D', 'C_D0 + k * C_L ^ 2', ''],
    ['D', '0.5 * rho * V ^ 2 * S * C_D', 'N'],
    ...(jet
      ? ([['T', 'f * T_SL', 'N'], ['T_minus_D', 'T - D', 'N']] as const)
      : ([['P', 'f * P_r', 'W'], ['eta_P_minus_D_V', 'eta * P - D * V', 'W']] as const)),
  ];
  if (fuel) {
    steps.push(
      ['mdot', `m_0 + s * ${jet ? 'T' : 'P'}`, 'kg/s', (v) => (jet ? `${num(v * 3600)} kg/h` : `${num(v / GPH, 1)} GPH of avgas`)],
      ['t', 'm_f / mdot - t_r', 's', (v) => `${num(v / 3600, 1)} h`],
      ['R', 't * V', 'm', (v) => `${num(toDistance(v, view))} ${view.unit === 'kt' ? 'NM' : 'km'}`],
    );
  }
  return chain(
    'Cruise at a set power',
    jet
      ? 'Level flight with the thrust set to a fraction of its rating: the faster speed where it equals drag. Then the fuel line gives the flow, and the fuel aboard less the reserve gives the time and distance.'
      : 'Level flight with the power set to a fraction of the rating: the faster speed where the propeller’s thrust power, η P, equals the power required, D V. Then the fuel line gives the flow, and the fuel aboard less the reserve gives the time and distance.',
    given,
    steps,
  );
}

/** The working behind one of the range tab's results, or null where it has none. */
export function rangeWorking(id: RangeWorkingId, scenario: Scenario, cruise: CruiseModel, view: ViewSettings): Working | null {
  const aircraft: Aircraft = { ...scenario.aircraft, mass: operatingMass(scenario) };
  return id === 'set-power' ? setPowerWorking(aircraft, scenario, cruise, view) : breguetWorking(id, aircraft, cruise, view);
}

// --- The envelope tab ------------------------------------------------------------

export type EnvelopeWorkingId = 'maneuvering' | 'gust' | 'corner' | 'turn' | 'excess-power';

const DEG = 180 / Math.PI;
const FPM = 60 / 0.3048;

/** The working behind one of the envelope tab's results, or null where it has none. */
export function envelopeWorking(id: EnvelopeWorkingId, scenario: Scenario, envelope: EnvelopeModel, view: ViewSettings): Working | null {
  const aircraft: Aircraft = { ...scenario.aircraft, mass: operatingMass(scenario) };
  const { atmosphere } = envelope;
  const W = weightGiven(aircraft);
  const g_0: Given = { value: G0, unit: 'm/s²' };
  const rho: Given = { value: atmosphere.density, unit: 'kg/m³', note: conditionNote(atmosphere) };
  const eas = (v: number) => `${speed(v, view.unit)} EAS`;
  const turn = (V: string): StepSpec[] => [
    ['omega', `g_0 * sqrt(n ^ 2 - 1) / ${V}`, 'rad/s', (v) => `${num(v * DEG, 1)} °/s`],
    ['R', `${V} ^ 2 / (g_0 * sqrt(n ^ 2 - 1))`, 'm', (v) => length(v, view.system)],
  ];

  if (id === 'maneuvering' || id === 'gust') {
    const vn = envelope.vn;
    if (!vn) return null;
    const { limits } = vn.diagram;
    if (id === 'maneuvering') {
      return chain(
        'Manoeuvring speed',
        'Below this speed the wing stalls before the structure reaches its limit load. In equivalent airspeed the stall curve, n = ½ ρ₀ V² S CLmax / W, is the same at every altitude, so the speed where it reaches the limit is the stall speed times √n.',
        { W, rho_0: { value: RHO0, unit: 'kg/m³', note: 'sea level: these speeds are EAS' }, S: { value: aircraft.wingArea, unit: 'm²' }, C_Lmax: { value: aircraft.clMax, unit: '', note: 'flaps up' }, n_max: { value: limits.nPositive, unit: '', note: 'the positive limit load factor' } },
        [
          ['V_S', 'sqrt(2 * W / (rho_0 * S * C_Lmax))', 'm/s', eas],
          ['V_A', 'V_S * sqrt(n_max)', 'm/s', eas],
        ],
      );
    }
    const gustNote = vn.diagram.gusts.cruise < 50 * 0.3048 ? '50 ft/s, scaled down above 20,000 ft' : '50 ft/s';
    return chain(
      'Gust load factor',
      'At the design cruising speed. A sharp-edged vertical gust U changes the angle of attack by U/V, and so the lift. The Pratt formula (former 14 CFR 23.341) eases that by an alleviation factor, for the time the wing takes to fly into the gust, which depends on its mass ratio μ.',
      {
        W,
        S: { value: aircraft.wingArea, unit: 'm²' },
        AR: { value: aircraft.aspectRatio, unit: '' },
        rho,
        rho_0: { value: RHO0, unit: 'kg/m³' },
        g_0,
        U_de: { value: vn.diagram.gusts.cruise, unit: 'm/s', note: `the design gust, EAS: ${gustNote}` },
        V_C: { value: limits.cruiseSpeed, unit: 'm/s', note: `design cruising speed, ${eas(limits.cruiseSpeed)}` },
      },
      [
        ['a', '2 * pi * AR / (2 + sqrt(4 + AR ^ 2 / 0.95 ^ 2))', '1/rad'],
        ['c', 'sqrt(S / AR)', 'm'],
        ['mu', '2 * (W / S) / (rho * c * a * g_0)', ''],
        ['K_g', '0.88 * mu / (5.3 + mu)', ''],
        ['dn', 'K_g * rho_0 * U_de * V_C * a / (2 * W / S)', ''],
        ['n', '1 + dn', ''],
      ],
    );
  }

  if (id === 'corner') {
    const n = envelope.turn.nStructure;
    if (n === null || !envelope.turn.corner) return null;
    return chain(
      'Corner speed',
      'The slowest speed at which the wing can pull the structural limit: where the stall meets it. Turn rate peaks here and radius is at its least.',
      { W, rho, S: { value: aircraft.wingArea, unit: 'm²' }, C_Lmax: { value: aircraft.clMax, unit: '' }, n: { value: n, unit: '', note: 'the positive limit load factor' }, g_0 },
      [['V_corner', 'sqrt(2 * n * W / (rho * S * C_Lmax))', 'm/s', tasShown(atmosphere, view)], ...turn('V_corner')],
    );
  }

  if (id === 'turn') {
    const n = loadFactorOf(scenario);
    if (n <= 1) return null;
    return chain(
      'This turn',
      'In a level turn the lift tilts with the bank, its vertical part still carrying the weight, so n = 1/cos φ; its horizontal part, W √(n² − 1), turns the aircraft.',
      { phi: { value: Math.acos(1 / n), unit: 'rad', note: `${num(Math.acos(1 / n) * DEG, 1)}° of bank` }, V: { value: scenario.tas, unit: 'm/s', note: tasShown(atmosphere, view)(scenario.tas) }, g_0 },
      [['n', '1 / cos(phi)', ''], ...turn('V')],
    );
  }

  if (!envelope.energy || envelope.energy.selected === null || !isPowered(aircraft)) return null;
  const t = thrust(aircraft, atmosphere, scenario.tas);
  return chain(
    'Specific excess power',
    'The rate full power can add to the energy height h + V²/2g: the climb rate at this speed, or g Pₛ / V of acceleration in level flight. Drag is taken at L = nW.',
    { W, ...t.given, V: { value: scenario.tas, unit: 'm/s', note: tasShown(atmosphere, view)(scenario.tas) }, n: { value: loadFactorOf(scenario), unit: '', note: loadFactorOf(scenario) > 1 ? `1/cos φ, at ${num(Math.acos(1 / loadFactorOf(scenario)) * DEG)}° of bank` : 'wings level' }, ...polarGiven(aircraft) },
    [
      ...t.steps,
      ['k', '1 / (pi * e * AR)', ''],
      ['C_L', '2 * n * W / (rho * V ^ 2 * S)', ''],
      ['C_D', 'C_D0 + k * C_L ^ 2', ''],
      ['D', '0.5 * rho * V ^ 2 * S * C_D', 'N'],
      ['P_s', 'V * (T - D) / W', 'm/s', (v) => `${num(v * FPM)} ft/min`],
    ],
  );
}

// --- The runway tab ----------------------------------------------------------------

export type RunwayWorkingId = 'takeoff-roll' | 'takeoff-total' | 'landing-roll' | 'landing-total';

/** Coefficients of a ground run's acceleration, a(V) = c0 + c1 V + c2 V², as step names; c1 may be absent. */
type Quadratic = readonly [c0: string, c1: string | null, c2: string];

/**
 * ∫ (V − V_w) dV / a(V) from `lo` to `hi`, in closed form: a logarithm of a(V), less a
 * multiple of ∫ dV / a(V), which is an arctangent or a logarithm by the sign of the
 * discriminant. With no linear term and no wind, the second part vanishes.
 */
function runSteps(name: string, sfx: string, [c0, c1, c2]: Quadratic, lo: string, hi: string, values: Record<string, number>): StepSpec[] {
  const at = (v: string) => `${c0}${c1 ? ` + ${c1} * ${v}` : ''} + ${c2} * ${v} ^ 2`;
  const log = `(1 / (2 * ${c2})) * ln((${at(hi)}) / (${at(lo)}))`;
  if (!c1 && values.V_w === 0) return [[name, log, 'm']];
  const factor = c1 ? `(${c1} / (2 * ${c2}) + V_w)` : 'V_w';
  const d = `Delta${sfx}`;
  const u = (v: string) => `(2 * ${c2} * ${v}${c1 ? ` + ${c1}` : ''})`;
  const discriminant = c1 ? `${c1} ^ 2 - 4 * ${c0} * ${c2}` : `-4 * ${c0} * ${c2}`;
  const integral =
    evaluate(discriminant, values) > 0
      ? `(1 / sqrt(${d})) * ln(((${u(hi)} - sqrt(${d})) / (${u(hi)} + sqrt(${d}))) / ((${u(lo)} - sqrt(${d})) / (${u(lo)} + sqrt(${d}))))`
      : `(2 / sqrt(-${d})) * (atan(${u(hi)} / sqrt(-${d})) - atan(${u(lo)} / sqrt(-${d})))`;
  return [
    [d, discriminant, ''],
    [`I${sfx}`, integral, 's²/m'],
    [name, `${log} - ${factor} * I${sfx}`, 'm'],
  ];
}

/** The values a chain's formulas see: its givens, then its steps. */
function valuesOf(given: Record<string, Given>, steps: readonly StepSpec[]): Record<string, number> {
  const worked = chain('', '', given, steps);
  return Object.fromEntries([...Object.entries(given).map(([n, g]) => [n, g.value] as const), ...worked.steps.map((s) => [s.name, s.value] as const)]);
}

/** The working behind one of the runway tab's results, or null where it has none. */
export function runwayWorking(id: RunwayWorkingId, scenario: Scenario, runway: RunwayModel, view: ViewSettings): Working | null {
  const aircraft: Aircraft = { ...scenario.aircraft, mass: operatingMass(scenario) };
  const { atmosphere, headwind } = runway;
  const surface = RUNWAY_SURFACES[runway.surface];
  const metres = (v: number) => length(v, view.system);
  const tas = (v: number) => `${speed(v, view.unit)} TAS`;
  const base: Record<string, Given> = {
    W: weightGiven(aircraft),
    rho: { value: atmosphere.density, unit: 'kg/m³', note: conditionNote(atmosphere) },
    S: { value: aircraft.wingArea, unit: 'm²' },
    g_0: { value: G0, unit: 'm/s²' },
    V_w: { value: headwind, unit: 'm/s', note: headwind === 0 ? 'calm' : headwind > 0 ? 'headwind' : 'tailwind' },
  };
  const groundCl = (ratio: string, ratioValue: number, clMax: number): StepSpec =>
    surface.rolling / (2 * k(aircraft)) <= clMax / ratioValue ** 2 ? ['C_L_g', 'mu_r / (2 * k)', ''] : ['C_L_g', `C_Lmax / ${ratio} ^ 2`, ''];
  const tailwind =
    headwind < 0
      ? ' In a tailwind the airspeed starts below zero, where the air pushes rather than drags and the wing lifts nothing, so that part of the run has its own a(V).'
      : '';

  if (id === 'takeoff-roll' || id === 'takeoff-total') {
    const r = runway.takeoff;
    if (!r.ok || !isPowered(aircraft) || headwind >= r.liftOffSpeed) return null;
    const engine = aircraft.propulsion;
    const jet = engine.kind === 'turbofan';
    const clMax = aircraft.clMaxTakeoff ?? aircraft.clMax;
    const stall: StepSpec = ['V_s', 'sqrt(2 * W / (rho * S * C_Lmax))', 'm/s', tas];
    const common: Record<string, Given> = {
      ...base,
      ...polarGiven(aircraft),
      C_Lmax: { value: clMax, unit: '', note: aircraft.clMaxTakeoff ? 'takeoff flap' : 'clean' },
    };

    if (id === 'takeoff-total') {
      const t = thrust(aircraft, atmosphere, r.obstacleSpeed);
      const { V: _speed, ...thrustGiven } = t.given;
      const cleared = r.climb === 0;
      return chain(
        'Takeoff over 50 ft',
        `After lift-off the aircraft pulls up at n = 1.2 on a circular arc at 1.15 V_s, onto its steepest steady climb, sin γ = (T − D)/W, then climbs straight to 50 ft${cleared ? '; here it clears 50 ft during the arc' : ''}. A headwind shortens each part by (V − V_w)/V. Raymer, §17.8.`,
        {
          ...common,
          ...thrustGiven,
          n: { value: TAKEOFF_TECHNIQUE.transitionLoadFactor, unit: '', note: 'the pull-up' },
          h_obs: { value: OBSTACLE_HEIGHT, unit: 'm', note: '50 ft' },
          s_G: { value: r.groundRoll, unit: 'm', note: 'the ground roll, which has its own working' },
        },
        [
          stall,
          ['V', '1.15 * V_s', 'm/s', tas],
          ...t.steps,
          ['k', '1 / (pi * e * AR)', ''],
          ['C_L', '2 * W / (rho * V ^ 2 * S)', ''],
          ['C_D', 'C_D0 + k * C_L ^ 2', ''],
          ['D', '0.5 * rho * V ^ 2 * S * C_D', 'N'],
          ['gamma', 'asin((T - D) / W)', 'rad', (v) => `${num(v * DEG, 2)}°`],
          ['R', 'V ^ 2 / (g_0 * (n - 1))', 'm'],
          ['h_TR', 'R * (1 - cos(gamma))', 'm'],
          ...(cleared
            ? ([['s_TR', 'sqrt(R ^ 2 - (R - h_obs) ^ 2) * (V - V_w) / V', 'm', metres]] as const)
            : ([
                ['s_TR', 'R * sin(gamma) * (V - V_w) / V', 'm', metres],
                ['s_CL', '(h_obs - h_TR) / tan(gamma) * (V - V_w) / V', 'm', metres],
              ] as const)),
          ['s_50', cleared ? 's_G + s_TR' : 's_G + s_TR + s_CL', 'm', metres],
        ],
      );
    }

    if (!jet) {
      // ponytail: no working when thrust is held to P/V anywhere on the run; it would need the run split there, with a cubic a(V).
      const { staticThrust, zeroThrustSpeed } = engine.propeller;
      const v = Math.min(r.liftOffSpeed, zeroThrustSpeed / 2);
      if (r.liftOffSpeed >= zeroThrustSpeed || staticThrust * v * (1 - v / zeroThrustSpeed) > engine.power) return null;
    }
    const t = thrust(aircraft, atmosphere, r.liftOffSpeed);
    const { V: _speed, ...thrustGiven } = t.given;
    const given: Record<string, Given> = {
      ...common,
      ...thrustGiven,
      mu_r: { value: surface.rolling, unit: '', note: `rolling friction, ${surface.label.toLowerCase()}` },
      t_r: { value: TAKEOFF_TECHNIQUE.rotationTime, unit: 's', note: 'rotation' },
    };
    const steps: StepSpec[] = [
      stall,
      ['V_LOF', '1.1 * V_s', 'm/s', tas],
      ...(jet ? t.steps : t.steps.filter(([name]) => name !== 'T')),
      ['k', '1 / (pi * e * AR)', ''],
      groundCl('1.1', TAKEOFF_TECHNIQUE.liftOff, clMax),
      ['C_D_g', 'C_D0 + k * C_L_g ^ 2', ''],
      ['a_0', jet ? '(g_0 / W) * (T - mu_r * W)' : '(g_0 / W) * (phi * T_s - mu_r * W)', 'm/s²'],
      ...(jet ? [] : ([['a_1', '-(g_0 / W) * phi * T_s / V_0', '1/s']] as const)),
      ['a_2', '-(g_0 / W) * 0.5 * rho * S * (C_D_g - mu_r * C_L_g)', '1/m'],
      ...(headwind < 0 ? ([['b_2', '(g_0 / W) * 0.5 * rho * S * C_D_g', '1/m']] as const) : []),
    ];
    const values = valuesOf(given, steps);
    const ahead: Quadratic = ['a_0', jet ? null : 'a_1', 'a_2'];
    if (headwind < 0) steps.push(...runSteps('s_tail', '_t', ['a_0', null, 'b_2'], 'V_w', '0', values), ...runSteps('s_run', '', ahead, '0', 'V_LOF', values));
    else steps.push(...runSteps('s_run', '', ahead, 'V_w', 'V_LOF', values));
    steps.push(['s_rot', '(V_LOF - V_w) * t_r', 'm', metres], ['s_G', headwind < 0 ? 's_tail + s_run + s_rot' : 's_run + s_rot', 'm', metres]);
    return chain(
      'Takeoff ground roll',
      `From brake release to lift-off at 1.1 V_s, then a second of rotation. On the run m dV/dt = T − D − μ(W − L), with the wing at the lift coefficient of least rolling resistance, μ/2k, or less if that would lift off early. ${jet ? 'Thrust is constant' : 'Thrust is a straight line in speed'}, so the acceleration is a quadratic, a(V) = a₀ + ${jet ? '' : 'a₁V + '}a₂V², and the distance ∫ (V − V_w) dV / a(V) has a closed form.${tailwind}`,
      given,
      steps,
    );
  }

  const r = runway.landing;
  if (!r.ok) return null;
  const clMax = aircraft.clMaxFlaps ?? aircraft.clMax;
  const common: Record<string, Given> = { ...base, C_Lmax: { value: clMax, unit: '', note: aircraft.clMaxFlaps ? 'landing flap' : 'clean' } };
  const stall: StepSpec = ['V_s0', 'sqrt(2 * W / (rho * S * C_Lmax))', 'm/s', tas];

  if (id === 'landing-total') {
    const t = LANDING_TECHNIQUE;
    const capped = (r.flareSpeed ** 2 / (G0 * (t.flareLoadFactor - 1))) * (1 - Math.cos(t.approachAngle)) >= OBSTACLE_HEIGHT;
    return chain(
      'Landing from 50 ft',
      'A 3° approach at 1.3 V_s0 down to the flare, a circular arc at 1.23 V_s0 and n = 1.2 that levels off, then the ground roll. A headwind shortens each part in the air by (V − V_w)/V. Raymer, §17.9.',
      {
        ...common,
        theta: { value: t.approachAngle, unit: 'rad', note: '3°, the approach path' },
        n: { value: t.flareLoadFactor, unit: '', note: 'the flare' },
        h_obs: { value: OBSTACLE_HEIGHT, unit: 'm', note: '50 ft' },
        s_G: { value: r.groundRoll, unit: 'm', note: 'the ground roll, which has its own working' },
      },
      [
        stall,
        ['V_A', '1.3 * V_s0', 'm/s', tas],
        ['V_F', '1.23 * V_s0', 'm/s', tas],
        ['R', 'V_F ^ 2 / (g_0 * (n - 1))', 'm'],
        ['h_F', capped ? 'h_obs' : 'R * (1 - cos(theta))', 'm'],
        ['s_A', '(h_obs - h_F) / tan(theta) * (V_A - V_w) / V_A', 'm', metres],
        ['s_F', 'R * sin(theta) * (V_F - V_w) / V_F', 'm', metres],
        ['s_50', 's_A + s_F + s_G', 'm', metres],
      ],
    );
  }

  const windmill = aircraft.windmillCd0 !== undefined;
  const given: Record<string, Given> = {
    ...common,
    ...polarGiven(aircraft),
    ...(windmill ? { dC_D0: { value: aircraft.windmillCd0!, unit: '', note: 'the windmilling propeller, engine at idle' } } : {}),
    mu_r: { value: surface.rolling, unit: '', note: `rolling friction, ${surface.label.toLowerCase()}: sets the wing’s lift coefficient` },
    mu_b: { value: surface.braking, unit: '', note: 'braking friction' },
    t_fr: { value: LANDING_TECHNIQUE.freeRollTime, unit: 's', note: 'free roll before the brakes' },
  };
  const cd0 = windmill ? 'C_D0off' : 'C_D0';
  const steps: StepSpec[] = [
    stall,
    ['V_TD', '1.15 * V_s0', 'm/s', tas],
    ['s_FR', '(V_TD - V_w) * t_fr', 'm', metres],
    ['k', '1 / (pi * e * AR)', ''],
    groundCl('1.15', LANDING_TECHNIQUE.touchdown, clMax),
    ...(windmill ? ([['C_D0off', 'C_D0 + dC_D0', '']] as const) : []),
    ['C_D_g', `${cd0} + k * C_L_g ^ 2`, ''],
    ['a_0', 'g_0 * mu_b', 'm/s²'],
    ['a_2', '(g_0 / W) * 0.5 * rho * S * (C_D_g - mu_b * C_L_g)', '1/m'],
    ...(headwind < 0 ? ([['b_2', '-(g_0 / W) * 0.5 * rho * S * C_D_g', '1/m']] as const) : []),
  ];
  const values = valuesOf(given, steps);
  if (headwind < 0) steps.push(...runSteps('s_tail', '_t', ['a_0', null, 'b_2'], 'V_w', '0', values), ...runSteps('s_B', '', ['a_0', null, 'a_2'], '0', 'V_TD', values));
  else steps.push(...runSteps('s_B', '', ['a_0', null, 'a_2'], 'V_w', 'V_TD', values));
  steps.push(['s_G', headwind < 0 ? 's_FR + s_tail + s_B' : 's_FR + s_B', 'm', metres]);
  return chain(
    'Landing ground roll',
    `A second of free roll at touchdown, 1.15 V_s0, then full braking with the engine at idle: m dV/dt = −D − μ_b(W − L). Without thrust the deceleration is a(V) = a₀ + a₂V², and the distance ∫ (V − V_w) dV / a(V) is a logarithm, with an arctangent or a second logarithm when there is wind.${tailwind}`,
    given,
    steps,
  );
}
