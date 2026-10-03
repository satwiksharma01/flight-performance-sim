/**
 * The validation dataset: every published figure the model is held to.
 *
 * One list, two readers. `tests/published.test.ts` asserts each case within
 * its tolerance, and the /validation page renders the same cases, computed
 * live in the browser. A figure can't be checked by one and shown
 * differently by the other.
 *
 * Each case has a role, because "matches published data" means different
 * things:
 * - reference: a standard or textbook value the physics must reproduce
 * - calibration: a figure a parameter was fitted to. Reproducing it proves the
 *   fit, not the model
 * - check: a figure the fit never saw. These are the real test
 * - discrepancy: a known miss, pinned to a band with its cause, not tuned away
 */

import { atPressureAltitude } from '../../physics/atmosphere.js';
import { pitotPressureRatio } from '../../physics/airspeed.js';
import { maxLiftToDrag, stallSpeed, vMinDrag, type Aircraft } from '../../physics/aero.js';
import { ceilings, climbPerformance, type PoweredAircraft } from '../../physics/performance/climb.js';
import { CESSNA_172S } from '../aircraft/presets.js';

export type Role = 'reference' | 'calibration' | 'check' | 'discrepancy';

export interface ValidationCase {
  readonly id: string;
  readonly group: GroupId;
  readonly quantity: string;
  readonly condition: string;
  readonly role: Role;
  readonly published: number;
  /** Unit of both values, as displayed */
  readonly unit: string;
  readonly decimals: number;
  /** The model's value, in the same unit */
  readonly model: () => number;
  /** Largest acceptable |model - published|, absolute in `unit` or relative */
  readonly tolerance: { readonly absolute: number } | { readonly relative: number };
  /** For a discrepancy: the band the model is pinned inside */
  readonly band?: readonly [number, number];
  readonly source: string;
  readonly note?: string;
}

export type GroupId = 'atmosphere' | 'compressible' | 'textbook' | 'c172';

export interface ValidationGroup {
  readonly id: GroupId;
  readonly title: string;
  readonly intro: string;
}

export const GROUPS: readonly ValidationGroup[] = [
  {
    id: 'atmosphere',
    title: 'Standard atmosphere',
    intro:
      'The layered ISA against the US Standard Atmosphere 1976 tables, at geopotential altitude. The tables use R = 287.0531 J/(kg·K); the model uses ISO 2533’s 287.05287, which accounts for the last few parts per million.',
  },
  {
    id: 'compressible',
    title: 'Compressible flow',
    intro:
      'The pitot relations behind CAS, against the NACA Report 1135 tables: isentropic below Mach 1, Rayleigh’s normal-shock formula above it.',
  },
  {
    id: 'textbook',
    title: 'Textbook worked examples',
    intro:
      'Anderson, Introduction to Flight: the light single CP-1 (modelled on a Cessna Skylane) and the business jet CP-2. The book quotes (L/D)max to three figures.',
  },
  {
    id: 'c172',
    title: 'Cessna 172S against its POH',
    intro:
      '2,550 lb, sea level, standard day, clean. Each fitted parameter takes exactly two published figures; the checks are figures the fit never used. POH speeds are KIAS: at these speeds the 172S’s position error is about a knot, so KIAS ≈ KCAS, and at sea level KCAS = KTAS.',
  },
];

const KT = 1852 / 3600;
const FT = 0.3048;
const LB = 0.45359237;
const FPM = 60 / FT;

const SOURCE = {
  ussa: 'US Standard Atmosphere 1976, table I',
  naca: 'NACA Report 1135 (1953), tables I and II',
  anderson: 'Anderson, Introduction to Flight, ch. 6, CP-1 and CP-2',
  poh: 'Cessna 172S Pilot’s Operating Handbook, sections 1, 4 and 5',
} as const;

/** An aircraft from a textbook's imperial data. Only W, S, AR, e and CD0 matter. */
function fromBook(weightLb: number, areaFt2: number, aspectRatio: number, e: number, cd0: number): Aircraft {
  return { name: 'book', mass: weightLb * LB, wingArea: areaFt2 * FT * FT, aspectRatio, oswaldEfficiency: e, cd0, clMax: 1.5 };
}

/** Evaluated once, on first use: ceilings take a few milliseconds. */
function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

const seaLevel = lazy(() => atPressureAltitude(0));
const c172 = CESSNA_172S as PoweredAircraft;
const c172Climb = lazy(() => climbPerformance(c172, seaLevel()));
const c172Ceilings = lazy(() => ceilings(c172));

const atmosphereRows = (
  [
    [0, 288.15, 101325, 1.225],
    [5000, 255.65, 54019.9, 0.736116],
    [11000, 216.65, 22632.1, 0.363918],
    [20000, 216.65, 5474.89, 0.0880349],
    [32000, 228.65, 868.019, 0.013225],
  ] as const
).flatMap(([h, t, p, rho]): ValidationCase[] => {
  const at = lazy(() => atPressureAltitude(h));
  const condition = `${(h / 1000).toLocaleString('en-US')} km`;
  return [
    {
      id: `isa-t-${h}`,
      group: 'atmosphere',
      quantity: 'Temperature',
      condition,
      role: 'reference',
      published: t,
      unit: 'K',
      decimals: 2,
      model: () => at().temperature,
      tolerance: { relative: 1e-9 },
      source: SOURCE.ussa,
    },
    {
      id: `isa-p-${h}`,
      group: 'atmosphere',
      quantity: 'Pressure',
      condition,
      role: 'reference',
      published: p,
      unit: 'Pa',
      decimals: p < 1000 ? 3 : p < 10000 ? 2 : 1,
      model: () => at().pressure,
      tolerance: { relative: 1e-5 },
      source: SOURCE.ussa,
    },
    {
      id: `isa-rho-${h}`,
      group: 'atmosphere',
      quantity: 'Density',
      condition,
      role: 'reference',
      published: rho,
      unit: 'kg/m³',
      decimals: rho < 0.1 ? 7 : 6,
      model: () => at().density,
      tolerance: { relative: 1e-5 },
      source: SOURCE.ussa,
    },
  ];
});

export const CASES: readonly ValidationCase[] = [
  ...atmosphereRows,
  {
    id: 'isa-a-0',
    group: 'atmosphere',
    quantity: 'Speed of sound',
    condition: 'sea level',
    role: 'reference',
    published: 340.294,
    unit: 'm/s',
    decimals: 3,
    model: () => seaLevel().speedOfSound,
    tolerance: { relative: 1e-5 },
    source: SOURCE.ussa,
  },
  {
    id: 'isa-a-11000',
    group: 'atmosphere',
    quantity: 'Speed of sound',
    condition: '11 km',
    role: 'reference',
    published: 295.07,
    unit: 'm/s',
    decimals: 2,
    model: () => atPressureAltitude(11000).speedOfSound,
    tolerance: { relative: 1e-5 },
    source: SOURCE.ussa,
  },

  {
    id: 'naca-isentropic-0.8',
    group: 'compressible',
    quantity: 'Total over static pressure, isentropic',
    condition: 'Mach 0.8',
    role: 'reference',
    published: 1 / 0.65602,
    unit: '',
    decimals: 4,
    model: () => pitotPressureRatio(0.8),
    tolerance: { relative: 1e-4 },
    source: SOURCE.naca,
    note: 'Tabulated as p/p₀ = 0.65602.',
  },
  {
    id: 'naca-pitot-1.5',
    group: 'compressible',
    quantity: 'Pitot over static pressure, normal shock',
    condition: 'Mach 1.5',
    role: 'reference',
    published: 3.413,
    unit: '',
    decimals: 3,
    model: () => pitotPressureRatio(1.5),
    tolerance: { absolute: 0.0005 },
    source: SOURCE.naca,
  },
  {
    id: 'naca-pitot-2',
    group: 'compressible',
    quantity: 'Pitot over static pressure, normal shock',
    condition: 'Mach 2',
    role: 'reference',
    published: 5.64,
    unit: '',
    decimals: 3,
    model: () => pitotPressureRatio(2),
    tolerance: { absolute: 0.0005 },
    source: SOURCE.naca,
  },

  {
    id: 'anderson-cp1-ld',
    group: 'textbook',
    quantity: '(L/D)max',
    condition: 'CP-1: 2,950 lb, 174 ft², AR 7.37, e 0.8, CD₀ 0.025',
    role: 'reference',
    published: 13.6,
    unit: '',
    decimals: 2,
    model: () => maxLiftToDrag(fromBook(2950, 174, 7.37, 0.8, 0.025)),
    tolerance: { absolute: 0.05 },
    source: SOURCE.anderson,
  },
  {
    id: 'anderson-cp2-ld',
    group: 'textbook',
    quantity: '(L/D)max',
    condition: 'CP-2: 19,815 lb, 318 ft², AR 8.93, e 0.81, CD₀ 0.02',
    role: 'reference',
    published: 16.9,
    unit: '',
    decimals: 2,
    model: () => maxLiftToDrag(fromBook(19815, 318, 8.93, 0.81, 0.02)),
    tolerance: { absolute: 0.05 },
    source: SOURCE.anderson,
  },

  {
    id: 'c172-stall-clean',
    group: 'c172',
    quantity: 'Stall speed, clean',
    condition: 'V_s1',
    role: 'calibration',
    published: 53,
    unit: 'kt',
    decimals: 1,
    model: () => stallSpeed(c172, seaLevel().density) / KT,
    tolerance: { absolute: 0.5 },
    source: SOURCE.poh,
    note: 'Sets CLmax = 1.54.',
  },
  {
    id: 'c172-stall-flaps',
    group: 'c172',
    quantity: 'Stall speed, full flap',
    condition: 'V_s0',
    role: 'calibration',
    published: 48,
    unit: 'kt',
    decimals: 1,
    model: () => stallSpeed(c172, seaLevel().density, 1, c172.clMaxFlaps) / KT,
    tolerance: { absolute: 0.5 },
    source: SOURCE.poh,
    note: 'Sets flap CLmax = 1.88.',
  },
  {
    id: 'c172-glide-speed',
    group: 'c172',
    quantity: 'Best glide speed',
    condition: 'V_md, propeller windmilling',
    role: 'calibration',
    published: 68,
    unit: 'kt',
    decimals: 1,
    model: () => vMinDrag(c172, seaLevel().density) / KT,
    tolerance: { absolute: 0.5 },
    source: SOURCE.poh,
    note: 'With the glide ratio, sets CD₀ = 0.052 and e = 0.717.',
  },
  {
    id: 'c172-glide-ratio',
    group: 'c172',
    quantity: 'Best glide ratio',
    condition: '(L/D)max',
    role: 'calibration',
    published: 9,
    unit: ': 1',
    decimals: 2,
    model: () => maxLiftToDrag(c172),
    tolerance: { absolute: 0.05 },
    source: SOURCE.poh,
    note: 'Read from the POH maximum-glide chart.',
  },
  {
    id: 'c172-vy',
    group: 'c172',
    quantity: 'Best rate-of-climb speed',
    condition: 'V_y, full power',
    role: 'calibration',
    published: 74,
    unit: 'kt',
    decimals: 1,
    model: () => c172Climb().vy.tas / KT,
    tolerance: { absolute: 0.5 },
    source: SOURCE.poh,
    note: 'With the rate, sets the propeller: 3,035 N static thrust, falling to zero at 175.9 m/s.',
  },
  {
    id: 'c172-roc',
    group: 'c172',
    quantity: 'Best rate of climb',
    condition: 'at V_y, exact climb',
    role: 'calibration',
    published: 730,
    unit: 'ft/min',
    decimals: 0,
    model: () => c172Climb().vy.rateOfClimb * FPM,
    tolerance: { absolute: 5 },
    source: SOURCE.poh,
  },
  {
    id: 'c172-vx',
    group: 'c172',
    quantity: 'Best angle-of-climb speed',
    condition: 'V_x, full power',
    role: 'check',
    published: 62,
    unit: 'kt',
    decimals: 1,
    model: () => c172Climb().vx.tas / KT,
    tolerance: { absolute: 2 },
    source: SOURCE.poh,
    note: 'Never fitted: it depends on the shape of the thrust and drag curves, not just their values at V_y.',
  },
  {
    id: 'c172-service-ceiling',
    group: 'c172',
    quantity: 'Service ceiling',
    condition: '100 ft/min, standard day',
    role: 'check',
    published: 14000,
    unit: 'ft',
    decimals: 0,
    model: () => c172Ceilings().service! / FT,
    tolerance: { absolute: 150 },
    source: SOURCE.poh,
    note: 'Never fitted: it tests the Gagg–Farrar power lapse and how the polar scales with density, all the way up.',
  },
  {
    id: 'c172-vmax',
    group: 'c172',
    quantity: 'Maximum level speed',
    condition: 'full power, sea level',
    role: 'discrepancy',
    published: 126,
    unit: 'kt',
    decimals: 1,
    model: () => c172Climb().maxLevelSpeed! / KT,
    tolerance: { absolute: 2 },
    band: [110, 120],
    source: SOURCE.poh,
    note: 'The polar was fitted to a glide flown with the propeller windmilling. That drag is real in the glide but absent in powered flight, so the model overstates drag at high speed. Pinned, not retuned: if a change moves it, that is worth noticing.',
  },
];

export interface Evaluated {
  readonly model: number;
  /** model - published, in the case's unit */
  readonly delta: number;
  /** delta / published */
  readonly relative: number;
  /** Within tolerance; for a discrepancy, inside its pinned band */
  readonly pass: boolean;
}

export function evaluate(c: ValidationCase): Evaluated {
  const model = c.model();
  const delta = model - c.published;
  const relative = delta / c.published;
  const within =
    'absolute' in c.tolerance ? Math.abs(delta) <= c.tolerance.absolute : Math.abs(relative) <= c.tolerance.relative;
  const pass = c.band ? model >= c.band[0] && model <= c.band[1] : within;
  return { model, delta, relative, pass };
}
