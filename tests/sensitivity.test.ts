import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO, type Scenario } from '../src/state/url.js';
import { STEP, buildSensitivity, describe as sentence, elasticity, type OutputId } from '../src/app/sensitivity.js';
import { PRESETS } from '../src/data/aircraft/presets.js';
import { k, weight } from '../src/physics/aero.js';
import { minimumSink } from '../src/physics/performance/glide.js';
import { breguet, fuelAboard } from '../src/physics/performance/range.js';
import { atPressureAltitude } from '../src/physics/atmosphere.js';

function of(scenario: Scenario, id: OutputId): Record<string, number | null> {
  const row = buildSensitivity(scenario).rows.find((r) => r.id === id);
  if (!row) throw new Error(`no ${id} row`);
  return Object.fromEntries(row.ranked.map((r) => [r.input, r.elasticity]));
}

describe('elasticities against the closed forms', () => {
  // Central difference on a power law is off by a(a-1)(a-2)h²/6, under 5e-4 for |a| <= 2.
  const close = 3;
  // For y ∝ 1/x it is exactly -1 / (1 - h²).
  const inverse = -1 / (1 - STEP ** 2);

  it('stall speed goes as sqrt(W / (S CLmax)), and nothing else', () => {
    const e = of(DEFAULT_SCENARIO, 'stall');
    expect(e.weight).toBeCloseTo(0.5, close);
    expect(e['wing area']).toBeCloseTo(-0.5, close);
    expect(e['clean CLmax']).toBeCloseTo(-0.5, close);
    for (const input of ['aspect ratio', 'Oswald efficiency', 'CD₀', 'engine power', 'specific fuel consumption']) {
      expect(e[input], input).toBe(0);
    }
  });

  it('V_md goes as sqrt(W / S) (k / CD0)^(1/4), with k = 1 / (pi e AR)', () => {
    const e = of(DEFAULT_SCENARIO, 'vmd');
    expect(e.weight).toBeCloseTo(0.5, close);
    expect(e['wing area']).toBeCloseTo(-0.5, close);
    expect(e['aspect ratio']).toBeCloseTo(-0.25, close);
    expect(e['Oswald efficiency']).toBeCloseTo(-0.25, close);
    expect(e['CD₀']).toBeCloseTo(-0.25, close);
  });

  it('(L/D)max goes as sqrt(pi e AR / CD0), whatever the weight', () => {
    const e = of({ ...DEFAULT_SCENARIO, mass: 0.8 * PRESETS.c172.mass }, 'ld');
    expect(e['aspect ratio']).toBeCloseTo(0.5, close);
    expect(e['Oswald efficiency']).toBeCloseTo(0.5, close);
    expect(e['CD₀']).toBeCloseTo(-0.5, close);
    expect(e.weight).toBe(0);
  });

  it('minimum sink held at CLmax follows the exact glide, not the small-angle one', () => {
    // sink ∝ sqrt(W / (S CL)) t (1 + t²)^(-3/4), t = tan γ = CD / CL. With CL fixed
    // at CLmax, CD0 and k share 1 - 1.5 sin²γ between them: 0.978 at the 172's 7°.
    const aircraft = PRESETS.c172;
    const glide = minimumSink(aircraft, atPressureAltitude(0));
    expect(glide.limitedByStall).toBe(true);
    const induced = k(aircraft) * aircraft.clMax ** 2;
    const cd = aircraft.cd0 + induced;
    const share = 1 - 1.5 * Math.sin(glide.gamma) ** 2;
    const e = of(DEFAULT_SCENARIO, 'sink');
    expect(e.weight).toBeCloseTo(0.5, close);
    expect(e['CD₀']).toBeCloseTo((share * aircraft.cd0) / cd, close);
    expect(e['aspect ratio']).toBeCloseTo((-share * induced) / cd, close);
    expect(e['clean CLmax']).toBeCloseTo(-0.5 + share * ((2 * induced) / cd - 1), close);
  });

  it('Breguet range goes as 1 / SFC, and as ln(W0 / W1) in weight and fuel', () => {
    // The 172 at MTOW has full tanks with payload to spare, so 1 % more weight
    // is payload and the fuel is fixed: E_W = -Wf / (W1 ln(W0/W1)), E_fuel the opposite.
    const e = of(DEFAULT_SCENARIO, 'range');
    const aircraft = PRESETS.c172;
    const fuel = fuelAboard(aircraft);
    expect(fuel).toBe(aircraft.fuelCapacity);
    const w0 = weight(aircraft.mass);
    const w1 = weight(aircraft.mass - fuel);
    const logRatio = Math.log(w0 / w1);
    expect(e['specific fuel consumption']).toBeCloseTo(inverse, 12);
    expect(e.weight).toBeCloseTo(-(w0 - w1) / (w1 * logRatio), close);
    expect(e['fuel capacity']).toBeCloseTo((w0 - w1) / (w1 * logRatio), close);
    // At V_md the prop range is (L/D)max's, so it takes its exponents too.
    expect(breguet(aircraft, atPressureAltitude(0).density, fuel)?.range.stallLimited).toBe(false);
    expect(e['aspect ratio']).toBeCloseTo(0.5, close);
    expect(e['wing area']).toBeCloseTo(0, close);
  });

  it('a jet range goes as 1 / TSFC too', () => {
    const jet = { ...DEFAULT_SCENARIO, presetId: 'jet-trainer', aircraft: PRESETS['jet-trainer'], altitude: 6000 };
    expect(of(jet, 'range')['specific fuel consumption']).toBeCloseTo(inverse, 12);
  });
});

describe('engine scaling', () => {
  it('scales the propeller’s thrust with its power, so climb answers to it', () => {
    // Excess power is a difference, so 1 % more thrust is more than 1 % more climb.
    expect(of(DEFAULT_SCENARIO, 'roc')['engine power']).toBeGreaterThan(1);
    expect(of(DEFAULT_SCENARIO, 'takeoff')['engine power']).toBeLessThan(0);
  });
});

describe('sensitivity model', () => {
  it('ranks the strongest input first as shown, unknowns last, and ties in the inputs’ order', () => {
    const { rows } = buildSensitivity(DEFAULT_SCENARIO);
    for (const row of rows) {
      const strengths = row.ranked.map((r) => (r.elasticity === null ? -1 : Number(Math.abs(r.elasticity).toFixed(2))));
      expect(strengths, row.label).toEqual([...strengths].sort((a, b) => b - a));
    }
    expect(rows.find((r) => r.id === 'stall')?.sentence).toMatch(/^Weight, wing area and clean CLmax matter equally/);
  });

  it('has no climb, engine or range for a glider', () => {
    const glider = { ...DEFAULT_SCENARIO, presetId: 'sailplane', aircraft: PRESETS.sailplane };
    const { rows } = buildSensitivity(glider);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('sink');
    expect(ids).not.toContain('roc');
    expect(ids).not.toContain('range');
    expect(rows[0]?.ranked.map((r) => r.input)).not.toContain('engine power');
  });

  it('is null where a side can’t be computed or the result is zero', () => {
    expect(elasticity(null, 1, 1)).toBeNull();
    expect(elasticity(1, null, 1)).toBeNull();
    expect(elasticity(0, 1, -1)).toBeNull();
    expect(elasticity(2, 2.02, 1.98)).toBeCloseTo(1, 12);
  });
});

describe('sentence', () => {
  it('names the strongest input', () => {
    expect(
      sentence('the takeoff distance', [
        { input: 'weight', elasticity: 2.13 },
        { input: 'engine power', elasticity: -1.4 },
      ]),
    ).toBe('Weight matters most: 1 % more weight raises the takeoff distance by 2.13 %.');
  });

  it('names every input that ties at the two decimals shown', () => {
    expect(
      sentence('the stall speed', [
        { input: 'weight', elasticity: 0.50001 },
        { input: 'wing area', elasticity: -0.49999 },
        { input: 'CD₀', elasticity: 0 },
      ]),
    ).toBe(
      'Weight and wing area matter equally: 1 % more weight raises the stall speed by 0.50 %; 1 % more wing area lowers it by 0.50 %.',
    );
  });

  it('says so when nothing moves it', () => {
    expect(sentence('(L/D)max', [{ input: 'weight', elasticity: 0.001 }, { input: 'SFC', elasticity: null }])).toBe(
      'None of these inputs changes (L/D)max.',
    );
  });
});
