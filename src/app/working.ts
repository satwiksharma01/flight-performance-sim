/**
 * The working behind each headline tile: the equation, the numbers put into
 * it, and the result, written out as a teacher would.
 *
 * Each step is a formula in the expression language of expression.ts. The
 * same parse evaluates it, from the values listed, and draws it, with
 * symbols and then with the numbers, so the working shown is the working
 * computed. tests/working.test.ts checks every chain lands on the value its
 * tile shows, and still does when worked from the rounded numbers on screen.
 *
 * Results found numerically (V_y, the ceiling, V_max, minimum sink) show the
 * condition that was solved, at the solution, rather than a formula.
 */

import {
  G0,
  ISA_LAYERS,
  P0,
  R_AIR,
  RHO0,
  T0,
  airspeeds,
  atPressureAltitude,
  bestGlide,
  bestRateOfClimb,
  climbAt,
  isPowered,
  lapseRatio,
  minimumSink,
  type Aircraft,
  type AtmosphereState,
  type PoweredAircraft,
} from '../physics/index.js';
import { operatingMass, type Scenario } from '../state/url.js';
import { evaluate } from './expression.js';
import { axisSpeed, feet, num } from './format.js';
import type { ChartModel, ViewSettings } from './model.js';

export type TileId = 'density-altitude' | 'stall' | 'climb' | 'ceiling' | 'glide' | 'vmax' | 'min-sink' | 'glide-distance';

export interface Given {
  readonly value: number;
  readonly unit: string;
  readonly note?: string;
}

export interface Step {
  readonly name: string;
  readonly formula: string;
  readonly value: number;
  readonly unit: string;
  /** The result as the tile shows it, when that differs from the SI value */
  readonly shown?: string;
}

export interface Working {
  readonly title: string;
  readonly intro: string;
  readonly given: Readonly<Record<string, Given>>;
  readonly steps: readonly Step[];
}

type StepSpec = readonly [name: string, formula: string, unit: string, shown?: (value: number) => string];

/** Evaluate the steps in order, each able to use the givens and every step before it. */
function chain(title: string, intro: string, given: Record<string, Given>, specs: readonly StepSpec[]): Working {
  const values: Record<string, number> = Object.fromEntries(Object.entries(given).map(([k, g]) => [k, g.value]));
  const steps = specs.map(([name, formula, unit, shown]): Step => {
    const value = evaluate(formula, values);
    values[name] = value;
    return { name, formula, value, unit, ...(shown ? { shown: shown(value) } : {}) };
  });
  return { title, intro, given, steps };
}

/** Significant figures the working shows its numbers to. */
export const FIGURES = 6;

/** A number as the working shows it. */
export const rounded = (value: number) => Number(value.toPrecision(FIGURES));

/** The value a working lands on: its last step. */
export function result(working: Working): number {
  return working.steps[working.steps.length - 1]!.value;
}

const FT = 0.3048;
const FPM = 60 / FT;

const tasShown = (atmosphere: AtmosphereState, view: ViewSettings) => (tas: number) => {
  const speeds = airspeeds(tas, atmosphere.pressure, atmosphere.density, atmosphere.speedOfSound);
  return view.axis === 'tas' ? axisSpeed(speeds, view) : `${num(tas / (1852 / 3600))} kt TAS, shown as ${axisSpeed(speeds, view)}`;
};

const weightGiven = (aircraft: Aircraft): Given => ({ value: aircraft.mass * G0, unit: 'N', note: `${num(aircraft.mass, 1)} kg × g₀` });

const conditionNote = (atmosphere: AtmosphereState) =>
  `at ${feet(atmosphere.pressureAltitude)}, ISA ${atmosphere.deltaISA >= 0 ? '+' : '−'}${num(Math.abs(atmosphere.deltaISA))}`;

// --- Density altitude -------------------------------------------------------

function densityAltitudeWorking(atmosphere: AtmosphereState): Working | null {
  const tropopause = ISA_LAYERS[1]!;
  const base = {
    p: { value: atmosphere.pressure, unit: 'Pa', note: `the pressure at ${feet(atmosphere.pressureAltitude)}` },
    T_air: { value: atmosphere.temperature, unit: 'K', note: `the outside air, ${num(atmosphere.temperature - 273.15, 1)} °C` },
    R: { value: R_AIR, unit: 'J/(kg K)' },
  };
  const density: StepSpec = ['rho', 'p / (R * T_air)', 'kg/m³'];
  const intro = 'The standard-day altitude with the same air density. Density from pressure and temperature, then the ISA density law inverted.';
  const show = (h: number) => feet(h);

  if (atmosphere.density >= tropopause.basePressure / (R_AIR * tropopause.baseTemperature)) {
    return chain('Density altitude', `${intro} Below 11 km, the troposphere's.`, {
      ...base,
      p_0: { value: P0, unit: 'Pa' },
      T_0: { value: T0, unit: 'K' },
      L: { value: 0.0065, unit: 'K/m', note: 'the lapse rate' },
      g_0: { value: G0, unit: 'm/s²' },
    }, [
      density,
      ['rho_0', 'p_0 / (R * T_0)', 'kg/m³'],
      ['h_d', '(T_0 / L) * (1 - (rho / rho_0) ^ (1 / (g_0 / (L * R) - 1)))', 'm', show],
    ]);
  }
  const top = ISA_LAYERS[2]!;
  if (atmosphere.density < top.basePressure / (R_AIR * top.baseTemperature)) return null;
  return chain('Density altitude', `${intro} Between 11 and 20 km the layer is isothermal, so density falls exponentially.`, {
    ...base,
    h_11: { value: tropopause.baseAltitude, unit: 'm' },
    p_11: { value: tropopause.basePressure, unit: 'Pa', note: 'at the tropopause' },
    T_11: { value: tropopause.baseTemperature, unit: 'K' },
    g_0: { value: G0, unit: 'm/s²' },
  }, [
    density,
    ['rho_11', 'p_11 / (R * T_11)', 'kg/m³'],
    ['h_d', 'h_11 + (R * T_11 / g_0) * ln(rho_11 / rho)', 'm', show],
  ]);
}

// --- Thrust, climb and level flight ------------------------------------------

/** Full-throttle thrust at this speed: the lapse, then the engine's thrust law. */
function thrust(aircraft: PoweredAircraft, atmosphere: AtmosphereState, tas: number): { given: Record<string, Given>; steps: StepSpec[] } {
  const engine = aircraft.propulsion;
  const given: Record<string, Given> = { rho: { value: atmosphere.density, unit: 'kg/m³', note: conditionNote(atmosphere) } };
  const steps: StepSpec[] = [];

  if (engine.kind === 'piston' && engine.criticalAltitude === undefined) {
    Object.assign(given, {
      rho_0: { value: RHO0, unit: 'kg/m³' },
      T_air: { value: atmosphere.temperature, unit: 'K' },
      T_std: { value: atmosphere.standardTemperature, unit: 'K', note: 'standard at this pressure altitude' },
    });
    steps.push(['sigma_std', '(rho / rho_0) * (T_air / T_std)', '']);
    steps.push(['phi', '(1.132 * sigma_std - 0.132) * sqrt(T_std / T_air)', '']);
  } else if (engine.kind === 'piston') {
    given.phi = { value: lapseRatio(engine, atmosphere), unit: '', note: 'turbocharged: full power to the critical altitude, Gagg–Farrar above it' };
  } else {
    Object.assign(given, { rho_0: { value: RHO0, unit: 'kg/m³' }, m: { value: engine.lapseExponent, unit: '', note: 'the lapse exponent' } });
    steps.push(['phi', '(rho / rho_0) ^ m', '']);
  }

  if (engine.kind === 'turbofan') {
    given.T_SL = { value: engine.thrust, unit: 'N', note: 'sea-level static thrust' };
    steps.push(['T', 'phi * T_SL', 'N']);
  } else {
    const { staticThrust, zeroThrustSpeed } = engine.propeller;
    given.V = { value: tas, unit: 'm/s' };
    if (staticThrust * (1 - tas / zeroThrustSpeed) <= engine.power / tas) {
      Object.assign(given, { T_s: { value: staticThrust, unit: 'N', note: 'static thrust' }, V_0: { value: zeroThrustSpeed, unit: 'm/s', note: 'where the thrust line reaches zero' } });
      steps.push(['T', 'phi * T_s * (1 - V / V_0)', 'N']);
    } else {
      given.P = { value: engine.power, unit: 'W', note: 'rated power: the line would pass P/V, efficiency 1' };
      steps.push(['T', 'phi * P / V', 'N']);
    }
  }
  return { given, steps };
}

function polarGiven(aircraft: Aircraft): Record<string, Given> {
  return {
    S: { value: aircraft.wingArea, unit: 'm²' },
    e: { value: aircraft.oswaldEfficiency, unit: '' },
    AR: { value: aircraft.aspectRatio, unit: '' },
    C_D0: { value: aircraft.cd0, unit: '', note: 'power on' },
  };
}

/** The exact climb at speed V, from the converged climb angle. */
function climbWorking(title: string, intro: string, aircraft: PoweredAircraft, atmosphere: AtmosphereState, tas: number, view: ViewSettings): Working {
  const point = climbAt(aircraft, atmosphere, tas);
  const t = thrust(aircraft, atmosphere, tas);
  return chain(title, intro, {
    W: weightGiven(aircraft),
    ...t.given,
    V: { value: tas, unit: 'm/s', note: tasShown(atmosphere, view)(tas) },
    gamma: { value: point.gamma, unit: 'rad', note: 'the climb angle, solved with lift W cos γ' },
    ...polarGiven(aircraft),
  }, [
    ...t.steps,
    ['k', '1 / (pi * e * AR)', ''],
    ['C_L', '2 * W * cos(gamma) / (rho * V ^ 2 * S)', ''],
    ['C_D', 'C_D0 + k * C_L ^ 2', ''],
    ['D', '0.5 * rho * V ^ 2 * S * C_D', 'N'],
    ['sin_gamma', '(T - D) / W', ''],
    ['RoC', 'V * sin_gamma', 'm/s', (v) => `${num(v * FPM)} ft/min`],
  ]);
}

function vmaxWorking(aircraft: PoweredAircraft, atmosphere: AtmosphereState, tas: number, view: ViewSettings): Working {
  const t = thrust(aircraft, atmosphere, tas);
  return chain(
    'Maximum level speed',
    'The fastest speed where full thrust still meets level-flight drag, found by bisection. At that speed the two are equal:',
    { W: weightGiven(aircraft), ...t.given, V: { value: tas, unit: 'm/s', note: tasShown(atmosphere, view)(tas) }, ...polarGiven(aircraft) },
    [
      ...t.steps,
      ['k', '1 / (pi * e * AR)', ''],
      ['C_L', '2 * W / (rho * V ^ 2 * S)', ''],
      ['C_D', 'C_D0 + k * C_L ^ 2', ''],
      ['D', '0.5 * rho * V ^ 2 * S * C_D', 'N'],
      ['T_minus_D', 'T - D', 'N'],
    ],
  );
}

// --- Glide --------------------------------------------------------------------

/** A steady glide power off, at a given lift coefficient or, without one, at maximum L/D. */
function glideSteps(aircraft: Aircraft, atmosphere: AtmosphereState, view: ViewSettings, cl?: { readonly value: number; readonly note: string }) {
  const windmill = aircraft.windmillCd0 !== undefined;
  const given: Record<string, Given> = {
    W: weightGiven(aircraft),
    rho: { value: atmosphere.density, unit: 'kg/m³', note: conditionNote(atmosphere) },
    ...polarGiven(aircraft),
    ...(windmill ? { dC_D0: { value: aircraft.windmillCd0!, unit: '', note: 'the windmilling propeller, power off' } } : {}),
    ...(cl ? { C_L: { value: cl.value, unit: '', note: cl.note } } : {}),
  };
  const cd0 = windmill ? 'C_D0off' : 'C_D0';
  const steps: StepSpec[] = [
    ['k', '1 / (pi * e * AR)', ''],
    ...(windmill ? [['C_D0off', 'C_D0 + dC_D0', ''] as const] : []),
    ...(cl ? [] : [['C_L', `sqrt(${cd0} / k)`, ''] as const]),
    ['C_D', `${cd0} + k * C_L ^ 2`, ''],
    ['E', 'C_L / C_D', ''],
    ['gamma', 'atan(C_D / C_L)', 'rad'],
    ['V', 'sqrt(2 * W * cos(gamma) / (rho * S * C_L))', 'm/s', tasShown(atmosphere, view)],
    ['sink', 'V * sin(gamma)', 'm/s', (v) => `${num(v * FPM)} ft/min`],
  ];
  return { given, steps };
}

// --- The tiles ----------------------------------------------------------------

/** The working for one tile, or null where the tile has no number to explain. */
export function tileWorking(id: TileId, scenario: Scenario, model: ChartModel, view: ViewSettings): Working | null {
  const aircraft: Aircraft = { ...scenario.aircraft, mass: operatingMass(scenario) };
  const { atmosphere } = model;
  const powered = isPowered(aircraft) ? aircraft : null;

  switch (id) {
    case 'density-altitude':
      return densityAltitudeWorking(atmosphere);

    case 'stall':
      return chain('Stall speed', 'The speed at which the lift needed takes the whole of CLmax. Bank raises the lift needed by the load factor n.', {
        n: { value: model.loadFactor, unit: '', note: 'load factor' },
        W: weightGiven(aircraft),
        rho: { value: atmosphere.density, unit: 'kg/m³', note: conditionNote(atmosphere) },
        S: { value: aircraft.wingArea, unit: 'm²' },
        C_Lmax: { value: aircraft.clMax, unit: '', note: 'clean' },
      }, [['V_s', 'sqrt(2 * n * W / (rho * S * C_Lmax))', 'm/s', tasShown(atmosphere, view)]]);

    case 'climb':
      if (!powered || !model.climb) return null;
      return climbWorking(
        'Best rate of climb',
        'V_y is found by golden-section search: the speed where the rate of climb is greatest. There, full thrust less drag lifts the weight up the climb path:',
        powered, atmosphere, model.climb.vy.tas, view,
      );

    case 'ceiling': {
      if (!powered || model.climb?.serviceCeilingFt == null) return null;
      const high = atPressureAltitude(model.climb.serviceCeilingFt * FT, scenario.deltaISA);
      return climbWorking(
        'Service ceiling',
        `No closed form: the ceiling is found by bisection, as the pressure altitude where the best rate of climb falls to 100 ft/min. At ${feet(high.pressureAltitude)}, at that height's V_y:`,
        powered, high, bestRateOfClimb(powered, high).tas, view,
      );
    }

    case 'vmax':
      if (!powered || !model.climb?.vmax) return null;
      return vmaxWorking(powered, atmosphere, model.climb.vmax.tas, view);

    case 'glide': {
      const best = bestGlide(aircraft, atmosphere);
      const g = glideSteps(aircraft, atmosphere, view, best.limitedByStall ? { value: aircraft.clMax, note: 'CLmax: the best-glide CL is beyond it' } : undefined);
      return chain('Best glide', 'Power off, the flattest glide is at maximum L/D, where parasite and induced drag are equal. The glide ratio is L/D itself.', g.given, g.steps);
    }

    case 'min-sink': {
      const sink = minimumSink(aircraft, atmosphere);
      const g = glideSteps(aircraft, atmosphere, view, { value: sink.cl, note: sink.limitedByStall ? 'CLmax: the optimum is beyond it' : 'found by golden-section search, near √(3 C_D0 / k)' });
      return chain('Minimum sink', 'Power off, the slowest descent. The lift coefficient is found numerically, since cos γ enters the speed.', g.given, g.steps);
    }

    case 'glide-distance':
      return chain('Glide from here', 'Distance through still air from this level down to sea level, at best glide: true height times the glide ratio.', {
        h: { value: Math.max(0, atmosphere.geometricAltitude), unit: 'm', note: 'true height: the pressure level, corrected for the ISA deviation' },
        E: { value: model.glide.best.ratio, unit: '', note: 'best glide ratio' },
      }, [['d', 'h * E', 'm', (v) => `${num(v / 1852, v < 18520 ? 1 : 0)} NM`]]);
  }
}

