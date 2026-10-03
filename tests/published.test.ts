/**
 * Every published figure in the validation dataset, asserted.
 *
 * The /validation page renders these same cases; this is what keeps the page
 * honest. Calibration, check and reference cases must sit within their
 * tolerance. A known discrepancy must stay inside its pinned band, and must
 * not quietly start agreeing either: that would mean the cause has changed.
 */

import { describe, expect, it } from 'vitest';
import { CASES, GROUPS, evaluate } from '../src/data/validation/cases.js';

describe('validation dataset', () => {
  it('has unique ids, and every case belongs to a known group', () => {
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(GROUPS.map((g) => g.id));
    expect(CASES.every((c) => groups.has(c.group))).toBe(true);
  });

  it('has at least one check the calibration never saw', () => {
    expect(CASES.filter((c) => c.role === 'check').length).toBeGreaterThanOrEqual(2);
  });
});

for (const group of GROUPS) {
  describe(group.title, () => {
    for (const c of CASES.filter((x) => x.group === group.id)) {
      it(`${c.quantity}, ${c.condition}: ${c.role}`, () => {
        const result = evaluate(c);
        expect(Number.isFinite(result.model)).toBe(true);
        if (c.role === 'discrepancy') {
          expect(c.band).toBeDefined();
          expect(result.model).toBeGreaterThanOrEqual(c.band![0]);
          expect(result.model).toBeLessThanOrEqual(c.band![1]);
          // Still a discrepancy: outside the tolerance a match would need.
          const tol = 'absolute' in c.tolerance ? c.tolerance.absolute : c.tolerance.relative * Math.abs(c.published);
          expect(Math.abs(result.delta)).toBeGreaterThan(tol);
        } else {
          expect(result.pass).toBe(true);
        }
      });
    }
  });
}
