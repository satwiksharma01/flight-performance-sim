/**
 * The Cessna 172S POH's performance tables, transcribed whole, and the model's
 * value for every cell.
 *
 * The single figures in cases.ts are the headline comparisons; these tables
 * are the rest of the evidence. Every cell is compared, so nothing is chosen
 * to flatter the model: the /validation page draws each table as a grid of
 * errors, and tests/poh-tables.test.ts pins the pattern.
 *
 * Source: Cessna Model 172S NAV III Pilot's Operating Handbook (172SPHBUS-00,
 * 2007), section 5: Maximum Rate of Climb, Short Field Takeoff Distance and
 * Short Field Landing Distance, all at 2,550 lb.
 */

import { atPressureAltitude } from '../../physics/atmosphere.js';
import { maxRateOfClimb, type PoweredAircraft } from '../../physics/performance/climb.js';
import { RUNWAY_SURFACES, landing, takeoff } from '../../physics/performance/field.js';
import { CESSNA_172S } from '../aircraft/presets.js';

export interface PohTable {
  readonly id: 'climb' | 'takeoff-roll' | 'takeoff-total' | 'landing-roll' | 'landing-total';
  readonly title: string;
  readonly conditions: string;
  readonly unit: string;
  /** Pressure altitudes of the rows [ft] */
  readonly altitudes: readonly number[];
  /** Outside air temperatures of the columns [°C] */
  readonly temperatures: readonly number[];
  /** Published values, rows by columns; null where the POH leaves a cell blank */
  readonly published: readonly (readonly (number | null)[])[];
  /** The model's value for a cell, in the same unit */
  readonly model: (altitudeFt: number, oatC: number) => number | null;
}

export const POH_SOURCE = 'Cessna 172S Pilot’s Operating Handbook (2007), section 5';

const FT = 0.3048;
const FPM = 60 / FT;
const c172 = CESSNA_172S as PoweredAircraft;
const dry = RUNWAY_SURFACES['dry-paved'];

/** The atmosphere at a pressure altitude [ft] and OAT [°C]. */
export function pohCondition(altitudeFt: number, oatC: number) {
  const standard = atPressureAltitude(altitudeFt * FT).standardTemperature;
  return atPressureAltitude(altitudeFt * FT, oatC + 273.15 - standard);
}

const FIELD_ALTITUDES = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000];
const FIELD_TEMPERATURES = [0, 10, 20, 30, 40];

function memo<T>(make: (h: number, t: number) => T): (h: number, t: number) => T {
  const cache = new Map<string, T>();
  return (h, t) => {
    const key = `${h}|${t}`;
    let value = cache.get(key);
    if (value === undefined) {
      value = make(h, t);
      cache.set(key, value);
    }
    return value;
  };
}

const takeoffAt = memo((h, t) => takeoff(c172, pohCondition(h, t), dry));
const landingAt = memo((h, t) => landing(c172, pohCondition(h, t), dry));
const toFeet = (m: number | null) => (m === null ? null : m / FT);

export const POH_TABLES: readonly PohTable[] = [
  {
    id: 'climb',
    title: 'Maximum rate of climb',
    conditions: 'Flaps up, full throttle, at V_y. The model climbs at its own V_y, exact climb.',
    unit: 'ft/min',
    altitudes: [0, 2000, 4000, 6000, 8000, 10000, 12000],
    temperatures: [-20, 0, 20, 40],
    published: [
      [855, 785, 710, 645],
      [760, 695, 625, 560],
      [685, 620, 555, 495],
      [575, 515, 450, 390],
      [465, 405, 345, 285],
      [360, 300, 240, 180],
      [255, 195, 135, null],
    ],
    model: (h, t) => {
      const atm = pohCondition(h, t);
      return maxRateOfClimb(c172, atm.pressureAltitude, atm.deltaISA) * FPM;
    },
  },
  {
    id: 'takeoff-roll',
    title: 'Short-field takeoff, ground roll',
    conditions: 'Flaps 10°, full throttle before brake release, paved dry runway, zero wind.',
    unit: 'ft',
    altitudes: FIELD_ALTITUDES,
    temperatures: FIELD_TEMPERATURES,
    published: [
      [860, 925, 995, 1070, 1150],
      [940, 1010, 1090, 1170, 1260],
      [1025, 1110, 1195, 1285, 1380],
      [1125, 1215, 1310, 1410, 1515],
      [1235, 1335, 1440, 1550, 1660],
      [1355, 1465, 1585, 1705, 1825],
      [1495, 1615, 1745, 1875, 2010],
      [1645, 1785, 1920, 2065, 2215],
      [1820, 1970, 2120, 2280, 2450],
    ],
    model: (h, t) => {
      const r = takeoffAt(h, t);
      return r.ok ? toFeet(r.groundRoll) : null;
    },
  },
  {
    id: 'takeoff-total',
    title: 'Short-field takeoff, total over 50 ft',
    conditions: 'As the ground roll; 56 KIAS at 50 ft.',
    unit: 'ft',
    altitudes: FIELD_ALTITUDES,
    temperatures: FIELD_TEMPERATURES,
    published: [
      [1465, 1575, 1690, 1810, 1945],
      [1600, 1720, 1850, 1990, 2135],
      [1755, 1890, 2035, 2190, 2355],
      [1925, 2080, 2240, 2420, 2605],
      [2120, 2295, 2480, 2685, 2880],
      [2345, 2545, 2755, 2975, 3205],
      [2605, 2830, 3075, 3320, 3585],
      [2910, 3170, 3440, 3730, 4045],
      [3265, 3575, 3880, 4225, 4615],
    ],
    model: (h, t) => {
      const r = takeoffAt(h, t);
      return r.ok ? toFeet(r.total) : null;
    },
  },
  {
    id: 'landing-roll',
    title: 'Short-field landing, ground roll',
    conditions: 'Full flap, power idle, maximum braking, paved dry runway, zero wind.',
    unit: 'ft',
    altitudes: FIELD_ALTITUDES,
    temperatures: FIELD_TEMPERATURES,
    published: [
      [545, 565, 585, 605, 625],
      [565, 585, 605, 625, 650],
      [585, 610, 630, 650, 670],
      [610, 630, 655, 675, 695],
      [630, 655, 675, 700, 725],
      [655, 680, 705, 725, 750],
      [680, 705, 730, 755, 780],
      [705, 730, 760, 785, 810],
      [735, 760, 790, 815, 840],
    ],
    model: (h, t) => {
      const r = landingAt(h, t);
      return r.ok ? toFeet(r.groundRoll) : null;
    },
  },
  {
    id: 'landing-total',
    title: 'Short-field landing, total from 50 ft',
    conditions: 'As the ground roll; 61 KIAS at 50 ft. The model flies a 3° approach; the POH’s is power-idle and steeper.',
    unit: 'ft',
    altitudes: FIELD_ALTITUDES,
    temperatures: FIELD_TEMPERATURES,
    published: [
      [1290, 1320, 1350, 1380, 1415],
      [1320, 1350, 1385, 1420, 1450],
      [1355, 1385, 1420, 1455, 1490],
      [1385, 1425, 1460, 1495, 1530],
      [1425, 1460, 1495, 1535, 1570],
      [1460, 1500, 1535, 1575, 1615],
      [1500, 1540, 1580, 1620, 1660],
      [1545, 1585, 1625, 1665, 1705],
      [1585, 1630, 1670, 1715, 1755],
    ],
    model: (h, t) => {
      const r = landingAt(h, t);
      return r.ok ? toFeet(r.total) : null;
    },
  },
];

export interface CellResult {
  readonly altitude: number;
  readonly temperature: number;
  readonly published: number;
  readonly model: number | null;
  /** model / published - 1, or null where the model has no answer */
  readonly error: number | null;
}

/** Every published cell of a table with the model's value beside it. */
export function compareTable(table: PohTable): CellResult[] {
  const cells: CellResult[] = [];
  table.altitudes.forEach((altitude, i) => {
    table.temperatures.forEach((temperature, j) => {
      const published = table.published[i]?.[j];
      if (published === null || published === undefined) return;
      const model = table.model(altitude, temperature);
      cells.push({ altitude, temperature, published, model, error: model === null ? null : model / published - 1 });
    });
  });
  return cells;
}

export interface TableSummary {
  readonly cells: number;
  readonly mean: number;
  readonly min: number;
  readonly max: number;
}

/** Mean, smallest and largest relative error over a table's cells. */
export function summarise(cells: readonly CellResult[]): TableSummary {
  const errors = cells.map((c) => c.error).filter((e): e is number => e !== null);
  return {
    cells: errors.length,
    mean: errors.reduce((a, b) => a + b, 0) / errors.length,
    min: Math.min(...errors),
    max: Math.max(...errors),
  };
}
