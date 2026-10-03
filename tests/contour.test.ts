import { describe, expect, it } from 'vitest';
import { contours, niceStep } from '../src/app/contour.js';

const grid = (n: number, lo: number, hi: number) => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));

describe('contours', () => {
  it('traces a circle as one closed loop of the right radius', () => {
    const x = grid(81, -2, 2);
    const y = grid(81, -2, 2);
    const z = y.map((yv) => x.map((xv) => Math.hypot(xv, yv)));
    const [ring] = contours(x, y, z, [1]);
    expect(ring?.lines).toHaveLength(1);
    const line = ring!.lines[0]!;
    expect(line[0]).toEqual(line[line.length - 1]); // closed
    for (const [px, py] of line) expect(Math.hypot(px, py)).toBeCloseTo(1, 2);
  });

  it('places a linear field’s contour exactly', () => {
    const x = grid(11, 0, 10);
    const y = grid(6, 0, 5);
    const z = y.map(() => x.map((xv) => 2 * xv));
    const [line] = contours(x, y, z, [7]);
    expect(line?.lines).toHaveLength(1);
    for (const [px] of line!.lines[0]!) expect(px).toBeCloseTo(3.5, 12);
    expect(line!.lines[0]!.length).toBe(6); // one crossing per row
  });

  it('skips cells that touch a NaN, splitting the line', () => {
    const x = grid(11, 0, 10);
    const y = grid(11, 0, 10);
    const z = y.map((yv) => x.map((xv) => (yv === 5 ? NaN : xv)));
    const [line] = contours(x, y, z, [4.5]);
    expect(line?.lines).toHaveLength(2);
  });

  it('returns nothing for a level outside the field', () => {
    const z = [[0, 1], [1, 2]];
    expect(contours([0, 1], [0, 1], z, [5])[0]?.lines).toEqual([]);
  });
});

describe('contour interval', () => {
  it('rounds to 1, 2, 2.5 or 5 times a power of ten', () => {
    expect(niceStep(730, 6)).toBe(200);
    expect(niceStep(5000, 6)).toBe(1000);
    expect(niceStep(90, 6)).toBe(20);
    expect(niceStep(14, 6)).toBe(2.5);
  });
});
