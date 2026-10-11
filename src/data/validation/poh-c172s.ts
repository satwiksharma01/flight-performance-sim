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
 * 2007), section 5: Maximum Rate of Climb, Short Field Takeoff Distance,
 * Short Field Landing Distance, Cruise Performance (figure 5-8), and Time,
 * Fuel and Distance to Climb (figure 5-7), all at 2,550 lb. The cruise table
 * was extracted from the PDF's text in stream order, which keeps its rows
 * whole, and checked against a layout reading.
 */

import { atPressureAltitude } from '../../physics/atmosphere.js';
import { maxRateOfClimb, type PoweredAircraft } from '../../physics/performance/climb.js';
import { RUNWAY_SURFACES, landing, takeoff } from '../../physics/performance/field.js';
import { cruiseSpeed } from '../../physics/performance/cruise.js';
import { fuelFlow } from '../../physics/propulsion.js';
import { CESSNA_172S } from '../aircraft/presets.js';

export interface PohTable {
  readonly id: 'climb' | 'takeoff-roll' | 'takeoff-total' | 'landing-roll' | 'landing-total' | 'cruise-speed' | 'cruise-fuel';
  readonly title: string;
  readonly conditions: string;
  readonly unit: string;
  /** Pressure altitudes of the rows [ft] */
  readonly altitudes: readonly number[];
  /** Outside air temperatures of the columns [°C], or ISA deviations where `columns` says so */
  readonly temperatures: readonly number[];
  /** Row labels, where altitude alone doesn't name a row (the cruise table's RPM) */
  readonly rows?: readonly string[];
  /** What the columns are, if not OAT */
  readonly columns?: 'isa';
  /** Published values, rows by columns; null where the POH leaves a cell blank */
  readonly published: readonly (readonly (number | null)[])[];
  /** The model's value for a cell, in the same unit */
  readonly model: (altitudeFt: number, temperature: number, row: number, column: number) => number | null;
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

/**
 * Figure 5-8, cruise performance: by pressure altitude and RPM, at 20 °C below
 * standard, standard, and 20 °C above: % MCP, KTAS, GPH. With speed fairings.
 */
const CRUISE: readonly { readonly altitude: number; readonly rpm: number; readonly cells: readonly (readonly [number, number, number])[] }[] = [
  { altitude: 2000, rpm: 2550, cells: [[83, 117, 11.1], [77, 118, 10.5], [72, 117, 9.9]] },
  { altitude: 2000, rpm: 2500, cells: [[78, 115, 10.6], [73, 115, 9.9], [68, 115, 9.4]] },
  { altitude: 2000, rpm: 2400, cells: [[69, 111, 9.6], [64, 110, 9.0], [60, 109, 8.5]] },
  { altitude: 2000, rpm: 2300, cells: [[61, 105, 8.6], [57, 104, 8.1], [53, 102, 7.7]] },
  { altitude: 2000, rpm: 2200, cells: [[53, 99, 7.7], [50, 97, 7.3], [47, 95, 6.9]] },
  { altitude: 2000, rpm: 2100, cells: [[47, 92, 6.9], [44, 90, 6.6], [42, 89, 6.3]] },
  { altitude: 4000, rpm: 2600, cells: [[83, 120, 11.1], [77, 120, 10.4], [72, 119, 9.8]] },
  { altitude: 4000, rpm: 2550, cells: [[79, 118, 10.6], [73, 117, 9.9], [68, 117, 9.4]] },
  { altitude: 4000, rpm: 2500, cells: [[74, 115, 10.1], [69, 115, 9.5], [64, 114, 8.9]] },
  { altitude: 4000, rpm: 2400, cells: [[65, 110, 9.1], [61, 109, 8.5], [57, 107, 8.1]] },
  { altitude: 4000, rpm: 2300, cells: [[58, 104, 8.2], [54, 102, 7.7], [51, 101, 7.3]] },
  { altitude: 4000, rpm: 2200, cells: [[51, 98, 7.4], [48, 96, 7.0], [45, 94, 6.7]] },
  { altitude: 4000, rpm: 2100, cells: [[45, 91, 6.6], [42, 89, 6.4], [40, 87, 6.1]] },
  { altitude: 6000, rpm: 2650, cells: [[83, 122, 11.1], [77, 122, 10.4], [72, 121, 9.8]] },
  { altitude: 6000, rpm: 2600, cells: [[78, 120, 10.6], [73, 119, 9.9], [68, 118, 9.4]] },
  { altitude: 6000, rpm: 2500, cells: [[70, 115, 9.6], [65, 114, 9.0], [60, 112, 8.5]] },
  { altitude: 6000, rpm: 2400, cells: [[62, 109, 8.6], [57, 108, 8.2], [54, 106, 7.7]] },
  { altitude: 6000, rpm: 2300, cells: [[54, 103, 7.8], [51, 101, 7.4], [48, 99, 7.0]] },
  { altitude: 6000, rpm: 2200, cells: [[48, 96, 7.1], [45, 94, 6.7], [43, 92, 6.4]] },
  { altitude: 8000, rpm: 2700, cells: [[83, 125, 11.1], [77, 124, 10.4], [71, 123, 9.7]] },
  { altitude: 8000, rpm: 2650, cells: [[78, 122, 10.5], [72, 122, 9.9], [67, 120, 9.3]] },
  { altitude: 8000, rpm: 2600, cells: [[74, 120, 10.0], [68, 119, 9.4], [64, 117, 8.9]] },
  { altitude: 8000, rpm: 2500, cells: [[65, 114, 9.1], [61, 112, 8.6], [57, 111, 8.1]] },
  { altitude: 8000, rpm: 2400, cells: [[58, 108, 8.2], [54, 106, 7.8], [51, 104, 7.4]] },
  { altitude: 8000, rpm: 2300, cells: [[52, 101, 7.5], [48, 99, 7.1], [46, 97, 6.8]] },
  { altitude: 8000, rpm: 2200, cells: [[46, 94, 6.8], [43, 92, 6.5], [41, 90, 6.2]] },
  { altitude: 10000, rpm: 2700, cells: [[78, 124, 10.5], [72, 123, 9.8], [67, 122, 9.3]] },
  { altitude: 10000, rpm: 2650, cells: [[73, 122, 10.0], [68, 120, 9.4], [63, 119, 8.9]] },
  { altitude: 10000, rpm: 2600, cells: [[69, 119, 9.5], [64, 117, 9.0], [60, 115, 8.5]] },
  { altitude: 10000, rpm: 2500, cells: [[62, 113, 8.7], [57, 111, 8.2], [54, 109, 7.8]] },
  { altitude: 10000, rpm: 2400, cells: [[55, 106, 7.9], [51, 104, 7.5], [49, 102, 7.1]] },
  { altitude: 10000, rpm: 2300, cells: [[49, 100, 7.2], [46, 97, 6.8], [44, 95, 6.5]] },
  { altitude: 12000, rpm: 2650, cells: [[69, 121, 9.5], [64, 119, 8.9], [60, 117, 8.5]] },
  { altitude: 12000, rpm: 2600, cells: [[65, 118, 9.1], [61, 116, 8.5], [57, 114, 8.1]] },
  { altitude: 12000, rpm: 2500, cells: [[58, 111, 8.3], [54, 109, 7.8], [51, 107, 7.4]] },
  { altitude: 12000, rpm: 2400, cells: [[52, 105, 7.5], [49, 102, 7.1], [46, 100, 6.8]] },
  { altitude: 12000, rpm: 2300, cells: [[47, 98, 6.9], [44, 95, 6.6], [41, 92, 6.3]] },
];

const KT_MPS = 1852 / 3600;
const ISA_COLUMNS = [-20, 0, 20];
const GPH = (6 * 0.45359237) / 3600; // kg/s in one US gallon an hour of avgas, 6 lb/gal
const RATED = (c172.propulsion as { readonly power: number }).power;
const cruiseAt = memo((row, column) => {
  const r = CRUISE[row]!;
  const setting = r.cells[column]![0] / 100;
  const tas = cruiseSpeed(c172, atPressureAltitude(r.altitude * FT, ISA_COLUMNS[column]!), setting);
  return { tas, gph: fuelFlow(c172.propulsion, setting * RATED) / GPH };
});
const cruiseTable = (id: 'cruise-speed' | 'cruise-fuel', field: 1 | 2) => ({
  id,
  altitudes: CRUISE.map((r) => r.altitude),
  temperatures: ISA_COLUMNS,
  rows: CRUISE.map((r) => `${r.altitude.toLocaleString('en-US')} · ${r.rpm}`),
  columns: 'isa' as const,
  published: CRUISE.map((r) => r.cells.map((c) => c[field])),
});

/** Figure 5-7, time, fuel and distance to climb from sea level, standard day: [ft, min, gal, NM]. */
const CLIMB_FROM_SEA_LEVEL: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 0, 0], [1000, 1, 0.4, 2], [2000, 3, 0.8, 4], [3000, 4, 1.2, 6], [4000, 6, 1.5, 8],
  [5000, 8, 1.9, 10], [6000, 10, 2.2, 13], [7000, 12, 2.6, 16], [8000, 14, 3.0, 19],
  [9000, 17, 3.4, 22], [10000, 20, 3.9, 27], [11000, 24, 4.4, 32], [12000, 28, 5.0, 38],
];

/** Figure 5-7's note: start, taxi and takeoff [gal]. */
const TAXI_ALLOWANCE = 1.4;

/**
 * Range [NM] and time aloft [h] the way the POH's specifications page counts
 * them: 53 gallons, less the start, taxi, takeoff and climb allowances and a
 * 45-minute reserve, cruised at a set power and altitude, standard day,
 * 2,550 lb. The climb is the POH's own (figure 5-7, interpolated); the cruise
 * speed and fuel flow are the model's.
 */
export function pohRange(altitudeFt: number, setting: number): { readonly range: number; readonly hours: number } | null {
  const i = CLIMB_FROM_SEA_LEVEL.findIndex(([h]) => h >= altitudeFt);
  if (i < 1) return null;
  const [h0, t0, f0, d0] = CLIMB_FROM_SEA_LEVEL[i - 1]!;
  const [h1, t1, f1, d1] = CLIMB_FROM_SEA_LEVEL[i]!;
  const u = (altitudeFt - h0) / (h1 - h0);
  const minutes = t0 + u * (t1 - t0);
  const gallons = f0 + u * (f1 - f0);
  const miles = d0 + u * (d1 - d0);
  const tas = cruiseSpeed(c172, atPressureAltitude(altitudeFt * FT), setting);
  if (tas === null) return null;
  const gph = fuelFlow(c172.propulsion, setting * RATED) / GPH;
  const cruiseHours = (53 - TAXI_ALLOWANCE - gallons) / gph - 0.75;
  return { range: miles + cruiseHours * (tas / KT_MPS), hours: minutes / 60 + cruiseHours };
}

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
  {
    ...cruiseTable('cruise-speed', 1),
    title: 'Cruise speed at a set power',
    conditions: 'Recommended lean mixture, at each row’s % MCP, by ISA deviation. The model flies that power at the cruise propeller efficiency, 0.8.',
    unit: 'KTAS',
    model: (_h, _t, row, column) => {
      const tas = cruiseAt(row, column).tas;
      return tas === null ? null : tas / KT_MPS;
    },
  },
  {
    ...cruiseTable('cruise-fuel', 2),
    title: 'Cruise fuel flow at a set power',
    conditions: 'Recommended lean mixture, at each row’s % MCP, by ISA deviation. The model’s fuel flow is a straight line in power.',
    unit: 'GPH',
    model: (_h, _t, row, column) => cruiseAt(row, column).gph,
  },
];

export interface CellResult {
  readonly row: number;
  readonly column: number;
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
      const model = table.model(altitude, temperature, i, j);
      cells.push({ row: i, column: j, altitude, temperature, published, model, error: model === null ? null : model / published - 1 });
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
