/**
 * Contour lines of a sampled field, by marching squares.
 *
 * The field is sampled on a rectangular grid, z[j][i] at (x[i], y[j]); NaN
 * marks a point outside the domain (below the stall, past the Mach limit), and
 * any cell touching one is skipped. Crossings are placed by linear
 * interpolation along each cell edge, keyed by the edge, so neighbouring cells
 * share their endpoints exactly and the segments join into polylines. Saddle
 * cells are resolved by the cell's mean.
 */

export type Point = readonly [number, number];

export interface ContourLine {
  readonly level: number;
  /** Polylines in data coordinates; a closed loop repeats its first point */
  readonly lines: readonly (readonly Point[])[];
}

/** Segments per case, as pairs of edges: 0 bottom, 1 right, 2 top, 3 left. */
const CASES: Record<number, readonly (readonly [number, number])[]> = {
  1: [[3, 0]],
  2: [[0, 1]],
  3: [[3, 1]],
  4: [[1, 2]],
  6: [[0, 2]],
  7: [[3, 2]],
  8: [[2, 3]],
  9: [[2, 0]],
  11: [[2, 1]],
  12: [[1, 3]],
  13: [[1, 0]],
  14: [[0, 3]],
};

export function contours(
  x: readonly number[],
  y: readonly number[],
  z: readonly (readonly number[])[],
  levels: readonly number[],
): ContourLine[] {
  return levels.map((level) => ({ level, lines: join(segments(x, y, z, level)) }));
}

interface Crossing {
  readonly key: string;
  readonly point: Point;
}

function segments(
  x: readonly number[],
  y: readonly number[],
  z: readonly (readonly number[])[],
  level: number,
): [Crossing, Crossing][] {
  const out: [Crossing, Crossing][] = [];
  const lerp = (a: number, b: number, za: number, zb: number) => a + ((level - za) / (zb - za)) * (b - a);

  for (let j = 0; j + 1 < y.length; j++) {
    for (let i = 0; i + 1 < x.length; i++) {
      const z00 = z[j]?.[i] ?? NaN;
      const z10 = z[j]?.[i + 1] ?? NaN;
      const z11 = z[j + 1]?.[i + 1] ?? NaN;
      const z01 = z[j + 1]?.[i] ?? NaN;
      if (Number.isNaN(z00) || Number.isNaN(z10) || Number.isNaN(z11) || Number.isNaN(z01)) continue;

      const index = (z00 >= level ? 1 : 0) | (z10 >= level ? 2 : 0) | (z11 >= level ? 4 : 0) | (z01 >= level ? 8 : 0);
      if (index === 0 || index === 15) continue;

      const x0 = x[i]!;
      const x1 = x[i + 1]!;
      const y0 = y[j]!;
      const y1 = y[j + 1]!;
      const edge = (e: number): Crossing => {
        switch (e) {
          case 0:
            return { key: `h${i},${j}`, point: [lerp(x0, x1, z00, z10), y0] };
          case 1:
            return { key: `v${i + 1},${j}`, point: [x1, lerp(y0, y1, z10, z11)] };
          case 2:
            return { key: `h${i},${j + 1}`, point: [lerp(x0, x1, z01, z11), y1] };
          default:
            return { key: `v${i},${j}`, point: [x0, lerp(y0, y1, z00, z01)] };
        }
      };

      let pairs = CASES[index];
      if (index === 5 || index === 10) {
        // Saddle: whether the two high corners connect depends on the middle.
        const high = (z00 + z10 + z11 + z01) / 4 >= level;
        pairs =
          index === 5
            ? high ? [[3, 2], [1, 0]] : [[3, 0], [1, 2]]
            : high ? [[0, 3], [2, 1]] : [[0, 1], [2, 3]];
      }
      for (const [a, b] of pairs ?? []) out.push([edge(a), edge(b)]);
    }
  }
  return out;
}

/** Chain segments that share an edge crossing into polylines. */
function join(segs: [Crossing, Crossing][]): Point[][] {
  const byKey = new Map<string, number[]>();
  segs.forEach(([a, b], index) => {
    for (const c of [a, b]) {
      const list = byKey.get(c.key);
      if (list) list.push(index);
      else byKey.set(c.key, [index]);
    }
  });

  const used = new Uint8Array(segs.length);
  const lines: Point[][] = [];

  const extend = (line: Crossing[], fromEnd: boolean) => {
    for (;;) {
      const tip = fromEnd ? line[line.length - 1]! : line[0]!;
      const next = (byKey.get(tip.key) ?? []).find((s) => !used[s]);
      if (next === undefined) return;
      used[next] = 1;
      const [a, b] = segs[next]!;
      const other = a.key === tip.key ? b : a;
      if (fromEnd) line.push(other);
      else line.unshift(other);
    }
  };

  segs.forEach(([a, b], index) => {
    if (used[index]) return;
    used[index] = 1;
    const line = [a, b];
    extend(line, true);
    extend(line, false);
    lines.push(line.map((c) => c.point));
  });
  return lines;
}

const NICE = [1, 2, 2.5, 5, 10];

/** A round contour interval giving about `count` levels up to `max`. */
export function niceStep(max: number, count: number): number {
  if (!(max > 0)) return 1;
  const raw = max / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  return (NICE.find((s) => s * magnitude >= raw) ?? 10) * magnitude;
}
