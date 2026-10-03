import { describe, expect, it } from 'vitest';
import { bankForLoadFactor, loadFactorForBank, turnRadius, turnRate } from '../src/physics/performance/turn.js';

const KT = 1852 / 3600;
const FT = 0.3048;
const DEG = Math.PI / 180;

describe('level turn', () => {
  it('needs n = 2 at 60° of bank', () => {
    expect(loadFactorForBank(60 * DEG)).toBeCloseTo(2, 12);
    expect(bankForLoadFactor(2) / DEG).toBeCloseTo(60, 10);
  });

  it('matches the pilot formula R[ft] = V[kt]^2 / (11.26 tan(bank))', () => {
    // 11.26 is the rounded constant pilots learn; with standard g it is exactly
    // g / (kt^2/ft) = 11.294. Exact to the constant, within 0.4 % of the rule.
    const exact = 9.80665 / ((KT * KT) / FT);
    for (const [kt, bank] of [[100, 60], [120, 30], [250, 25]] as const) {
      const n = loadFactorForBank(bank * DEG);
      const radiusFt = turnRadius(kt * KT, n) / FT;
      expect(radiusFt).toBeCloseTo((kt * kt) / (exact * Math.tan(bank * DEG)), 6);
      expect(radiusFt / ((kt * kt) / (11.26 * Math.tan(bank * DEG)))).toBeCloseTo(1, 2);
    }
  });

  it('flies a standard-rate turn (3°/s) at 120 KTAS with about 18° of bank', () => {
    // tan(bank) = omega V / g; the rule of thumb TAS/10 + 7 says 19°.
    const n = loadFactorForBank(18.24 * DEG);
    expect(turnRate(120 * KT, n) / DEG).toBeCloseTo(3, 2);
  });

  it('turns infinitely wide and infinitely slowly at 1 g', () => {
    expect(turnRadius(50, 1)).toBe(Infinity);
    expect(turnRate(50, 1)).toBe(0);
  });

  it('rejects impossible inputs', () => {
    expect(() => loadFactorForBank(Math.PI / 2)).toThrow(RangeError);
    expect(() => bankForLoadFactor(0.5)).toThrow(RangeError);
  });
});
