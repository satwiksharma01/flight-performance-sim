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

import { CRUISE_PROPELLER_EFFICIENCY, G0, RHO0, isPowered, type Aircraft } from '../physics/index.js';
import type { CruiseCase } from '../physics/performance/range.js';
import { CRUISE_RESERVE, toDistance, type CruiseModel } from './cruise.js';
import type { EnvelopeModel } from './envelope.js';
import { length, num, speed } from './format.js';
import type { ViewSettings } from './model.js';
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
