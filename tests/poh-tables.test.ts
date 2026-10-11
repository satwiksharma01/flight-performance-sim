/**
 * The Cessna 172S POH tables, every cell: the pattern of the model's errors,
 * pinned.
 *
 * None of these cells was fitted. The bands are where the errors fall today,
 * with their causes on the /validation page; a change that moves any cell out
 * of its band is worth understanding before the band is moved.
 */

import { describe, expect, it } from 'vitest';
import { POH_TABLES, compareTable, summarise } from '../src/data/validation/poh-c172s.js';

const BANDS: Record<string, readonly [number, number]> = {
  climb: [-0.2, 0.1],
  'takeoff-roll': [-0.22, -0.08],
  'takeoff-total': [-0.27, -0.1],
  'landing-roll': [-0.26, -0.18],
  'landing-total': [-0.1, 0.15],
  'cruise-speed': [-0.11, 0.03],
  'cruise-fuel': [-0.015, 0.02],
};

describe('POH tables, cell by cell', () => {
  for (const table of POH_TABLES) {
    it(`${table.title}: every cell inside its pinned band`, () => {
      const cells = compareTable(table);
      const [low, high] = BANDS[table.id] ?? [0, 0];
      for (const cell of cells) {
        expect(cell.error, `${cell.altitude} ft, ${cell.temperature} °C`).not.toBeNull();
        expect(cell.error!).toBeGreaterThanOrEqual(low);
        expect(cell.error!).toBeLessThanOrEqual(high);
      }
      expect(summarise(cells).cells).toBe(table.published.flat().filter((v) => v !== null).length);
    }, 60_000);
  }

  it('transcribes the tables whole: 27 climb cells, 45 in each distance table, 111 in each cruise table', () => {
    expect(POH_TABLES.map((t) => compareTable(t).length)).toEqual([27, 45, 45, 45, 45, 111, 111]);
  });

  it('reproduces the two cruise cells the fuel-flow line was fitted to', () => {
    const fuel = compareTable(POH_TABLES.find((t) => t.id === 'cruise-fuel')!);
    const cell = (feet: number, rpm: string) => fuel.find((c) => c.column === 1 && POH_TABLES[6]!.rows![c.row] === `${feet.toLocaleString('en-US')} · ${rpm}`)!;
    expect(cell(2000, '2550').model).toBeCloseTo(10.5, 10);
    expect(cell(12000, '2300').model).toBeCloseTo(6.6, 10);
  });

  it('has the cruise speed within 3 % in all but the six low-power hot cells high up', () => {
    const misses = compareTable(POH_TABLES.find((t) => t.id === 'cruise-speed')!).filter((c) => Math.abs(c.error!) > 0.03);
    expect(misses).toHaveLength(6);
    for (const c of misses) expect(c.published).toBeLessThanOrEqual(100); // the slow end of the table
  });

  it('agrees with the specifications page, which is the tables at 15 °C', () => {
    // 960 / 1630 ft takeoff and 575 / 1335 ft landing sit midway between the
    // 10 and 20 °C columns at sea level.
    const mid = (id: string, col: number) => {
      const row = POH_TABLES.find((t) => t.id === id)!.published[0]!;
      return (row[col]! + row[col + 1]!) / 2;
    };
    expect(mid('takeoff-roll', 1)).toBe(960);
    expect(Math.abs(mid('takeoff-total', 1) - 1630)).toBeLessThanOrEqual(5);
    expect(mid('landing-roll', 1)).toBe(575);
    expect(mid('landing-total', 1)).toBe(1335);
  });
});

describe('piston power on a hot day', () => {
  it('keeps the old climb errors out: Gagg-Farrar on the actual density missed the hot cells by up to 66 %', () => {
    // The worst cell today, 12,000 ft and -20 °C, is the cold corner; every hot cell is within 7 %.
    const hot = compareTable(POH_TABLES[0]!).filter((c) => c.temperature === 40);
    for (const cell of hot) expect(Math.abs(cell.error!)).toBeLessThan(0.07);
  });
});
