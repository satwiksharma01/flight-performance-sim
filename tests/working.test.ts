import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/app/expression.js';
import { figure } from '../src/app/components/Working.js';
import { rounded, result, tileWorking, type TileId, type Working } from '../src/app/working.js';
import { DEFAULT_VIEW, buildChartModel, type ViewSettings } from '../src/app/model.js';
import { DEFAULT_SCENARIO, type Scenario } from '../src/state/url.js';
import { PRESETS } from '../src/data/aircraft/presets.js';
import { SERVICE_CEILING_RATE } from '../src/physics/performance/climb.js';
import { buildCruiseModel } from '../src/app/cruise.js';
import { envelopeWorking, rangeWorking, runwayWorking } from '../src/app/working-tabs.js';
import { buildRunwayModel } from '../src/app/runway.js';
import { buildEnvelopeModel } from '../src/app/envelope.js';
import { vnBoundaries } from '../src/physics/performance/vn.js';
import type { PistonEngine } from '../src/physics/propulsion.js';

const FPM = 60 / 0.3048;
const view: ViewSettings = { ...DEFAULT_VIEW, axis: 'eas' };

describe('figure', () => {
  it('shows six figures, and powers of ten below 0.001', () => {
    expect(figure(1234.5678)).toBe('1,234.57');
    expect(figure(0)).toBe('0');
    expect(figure(0.00105838)).toBe('0.00105838');
    expect(figure(6.65623e-8)).toBe('6.65623 × 10⁻⁸');
    expect(figure(-2.004371e-6)).toBe('−2.00437 × 10⁻⁶');
    expect(figure(-0.0275677)).toBe('−0.0275677');
  });
});

describe('expression', () => {
  it('follows the usual precedence, with right-associative powers', () => {
    expect(evaluate('1 + 2 * 3 ^ 2', {})).toBe(19);
    expect(evaluate('2 ^ 3 ^ 2', {})).toBe(512);
    expect(evaluate('-2 ^ 2', {})).toBe(-4);
    expect(evaluate('2 ^ -1', {})).toBe(0.5);
    expect(evaluate('(1 + 2) / 4 - -1', {})).toBe(1.75);
    expect(evaluate('sqrt(x) * ln(1) + cos(0) + atan(1) * 4 / pi', { x: 9 })).toBeCloseTo(2, 15);
    expect(evaluate('2.5e-3 * 1e3', {})).toBeCloseTo(2.5, 15);
  });

  it('refuses what it can’t evaluate', () => {
    expect(() => evaluate('a + 1', {})).toThrow(/No value for "a"/);
    expect(() => evaluate('(1 + 2', {})).toThrow(SyntaxError);
    expect(() => evaluate('1 2', {})).toThrow(SyntaxError);
    expect(() => evaluate('1 $ 2', {})).toThrow(SyntaxError);
  });
});

/** Work the chain again from the givens and every step rounded as the working shows them. */
function fromScreen(working: Working): number[] {
  const values: Record<string, number> = Object.fromEntries(Object.entries(working.given).map(([k, g]) => [k, rounded(g.value)]));
  return working.steps.map((s) => (values[s.name] = rounded(evaluate(s.formula, values))));
}

const step = (w: Working, name: string) => w.steps.find((s) => s.name === name)!.value;

const SCENARIOS: readonly [string, Scenario][] = [
  ['172, sea level', DEFAULT_SCENARIO],
  ['172, 8,000 ft, ISA +15, 30° bank, light', { ...DEFAULT_SCENARIO, altitude: 8000 * 0.3048, deltaISA: 15, loadFactor: 1 / Math.cos(Math.PI / 6), mass: 1000 }],
  ['172, cold and below sea level', { ...DEFAULT_SCENARIO, altitude: -300, deltaISA: -30 }],
  ['172 without windmilling drag', { ...DEFAULT_SCENARIO, presetId: null, aircraft: { ...PRESETS.c172, windmillCd0: undefined as never } }],
  ['jet, FL350', { ...DEFAULT_SCENARIO, presetId: 'jet-trainer', aircraft: PRESETS['jet-trainer'], altitude: 35000 * 0.3048, tas: 200 }],
  ['jet, FL410: density altitude in the isothermal layer', { ...DEFAULT_SCENARIO, presetId: 'jet-trainer', aircraft: PRESETS['jet-trainer'], altitude: 41000 * 0.3048, deltaISA: 5, tas: 200 }],
  ['172, turbocharged, 10,000 ft', { ...DEFAULT_SCENARIO, presetId: null, aircraft: { ...PRESETS.c172, propulsion: { ...(PRESETS.c172.propulsion as PistonEngine), criticalAltitude: 4000 } }, altitude: 3000 }],
  ['172 with thrust held to P/V', { ...DEFAULT_SCENARIO, presetId: null, aircraft: { ...PRESETS.c172, propulsion: { ...(PRESETS.c172.propulsion as PistonEngine), propeller: { staticThrust: 6000, zeroThrustSpeed: 200 } } } }],
  ['sailplane, 1,500 m', { ...DEFAULT_SCENARIO, presetId: 'sailplane', aircraft: PRESETS.sailplane, altitude: 1500, tas: 25 }],
];

describe('the working behind each tile', () => {
  for (const [label, scenario] of SCENARIOS) {
    describe(label, () => {
      const model = buildChartModel(scenario, view);
      const work = (id: TileId) => tileWorking(id, scenario, model, view);

      it('lands every chain on the value its tile shows', () => {
        expect(work('density-altitude')).not.toBeNull();
        const stall = model.markers.find((m) => m.kind === 'stall')!;
        expect(result(work('density-altitude')!)).toBeCloseTo(model.atmosphere.densityAltitude, 5); // m
        expect(result(work('stall')!) / stall.tas).toBeCloseTo(1, 12);

        const glide = work('glide')!;
        expect(step(glide, 'E') / model.glide.best.ratio).toBeCloseTo(1, 12);
        expect(step(glide, 'V') / model.glide.best.tas).toBeCloseTo(1, 12);
        expect((result(glide) * FPM) / model.glide.best.sinkFpm).toBeCloseTo(1, 12);
        expect((result(work('min-sink')!) * FPM) / model.glide.minSink.sinkFpm).toBeCloseTo(1, 12);
        expect(result(work('glide-distance')!)).toBeCloseTo(model.glide.distanceToSeaLevel, 6);

        const climb = model.climb;
        if (!climb) {
          expect(work('climb')).toBeNull();
          return;
        }
        const roc = work('climb')!;
        expect((result(roc) * FPM) / climb.vy.rocFpm).toBeCloseTo(1, 10);
        expect(step(roc, 'sin_gamma')).toBeCloseTo(Math.sin(roc.given.gamma!.value), 12);
        if (climb.serviceCeilingFt !== null) expect(result(work('ceiling')!) / SERVICE_CEILING_RATE).toBeCloseTo(1, 4);
        if (climb.vmax) {
          const vmax = work('vmax')!;
          expect(Math.abs(result(vmax)) / step(vmax, 'D')).toBeLessThan(1e-6);
        }
      });

      it('reworks from the rounded numbers on screen to the same results', () => {
        for (const id of ['density-altitude', 'stall', 'climb', 'ceiling', 'glide', 'vmax', 'min-sink', 'glide-distance'] as const) {
          const w = work(id);
          if (!w) continue;
          const screen = fromScreen(w);
          w.steps.forEach((s, i) => {
            // Thrust less drag cancels when the climb is shallow, so it and what follows are compared on
            // the scale of the thrust; heights and distances, which can be zero, to a tenth of a metre.
            const thrust = () => step(w, 'T') / w.given.W!.value;
            const scale =
              s.name === 'T_minus_D' ? step(w, 'D')
              : s.name === 'sin_gamma' ? thrust()
              : s.name === 'RoC' ? thrust() * w.given.V!.value
              : s.unit === 'm' ? Math.max(Math.abs(s.value), 1000)
              : Math.abs(s.value);
            expect(Math.abs(screen[i]! - s.value) / scale, `${id}: ${s.name}`).toBeLessThan(1e-4);
          });
        }
      });
    });
  }
});

describe('the working behind the range tab', () => {
  const rangeView: ViewSettings = { ...DEFAULT_VIEW, tab: 'range' };
  const { baseFuelFlow: _b, ...constantSfc } = PRESETS.c172.propulsion!;
  const jetWithBase = { ...PRESETS['jet-trainer'], propulsion: { ...PRESETS['jet-trainer'].propulsion!, baseFuelFlow: 0.02 } };
  const CASES: readonly [string, Scenario][] = [
    ['172 at sea level: fuel line, endurance held at 1.2 V_s', DEFAULT_SCENARIO],
    ['172 at 8,500 ft, raised CLmax: fuel line, endurance at its optimum', { ...DEFAULT_SCENARIO, presetId: null, aircraft: { ...PRESETS.c172, clMax: 3 }, altitude: 8500 * 0.3048 }],
    ['172 with constant SFC', { ...DEFAULT_SCENARIO, presetId: null, aircraft: { ...PRESETS.c172, propulsion: constantSfc } }],
    ['jet at FL250', { ...DEFAULT_SCENARIO, presetId: 'jet-trainer', aircraft: PRESETS['jet-trainer'], altitude: 25000 * 0.3048, tas: 200 }],
    ['jet with a base fuel flow', { ...DEFAULT_SCENARIO, presetId: null, aircraft: jetWithBase, altitude: 6000, tas: 200 }],
  ];

  for (const [label, scenario] of CASES) {
    it(`agrees with the numerical integration in closed form: ${label}`, () => {
      const cruise = buildCruiseModel(scenario, rangeView);
      for (const kind of ['range', 'endurance'] as const) {
        const w = rangeWorking(kind, scenario, cruise, rangeView)!;
        expect(result(w) / cruise.result![kind].value, kind).toBeCloseTo(1, 9);
        const screen = fromScreen(w);
        expect(screen[screen.length - 1]! / result(w), `${kind} from the screen`).toBeCloseTo(1, 3);
      }
      const p = rangeWorking('set-power', scenario, cruise, rangeView)!;
      expect(result(p) / cruise.setPower!.range!).toBeCloseTo(1, 12);
      const balance = p.steps.find((s) => s.name === 'eta_P_minus_D_V' || s.name === 'T_minus_D')!.value;
      expect(Math.abs(balance) / step(p, 'D')).toBeLessThan(1e-6);
    });
  }

  it('covers every closed form: both base-flow arctangents, both logarithms, both textbook cases', () => {
    const formulas = CASES.flatMap(([, scenario]) => {
      const cruise = buildCruiseModel(scenario, rangeView);
      return (['range', 'endurance'] as const).map((kind) => rangeWorking(kind, scenario, cruise, rangeView)!.steps.at(-1)!.formula);
    });
    for (const marker of ['ln(mdot_0 / mdot_1)', 'atan(sqrt(W_0) / q)', 'F_0 - F_1', 'sqrt(W_0) - sqrt(W_1)', 'W_1 ^ -0.5']) {
      expect(formulas.some((f) => f.includes(marker)), marker).toBe(true);
    }
  });
});

describe('the working behind the envelope tab', () => {
  const envelopeView: ViewSettings = { ...DEFAULT_VIEW, tab: 'envelope' };
  const DEG = 180 / Math.PI;
  for (const [label, scenario] of SCENARIOS) {
    it(`lands on each result the tab shows: ${label}`, () => {
      const envelope = buildEnvelopeModel(scenario, envelopeView);
      const work = (id: Parameters<typeof envelopeWorking>[0]) => envelopeWorking(id, scenario, envelope, envelopeView);
      const all = (['maneuvering', 'gust', 'corner', 'turn', 'excess-power'] as const).map(work);

      const { vn, turn, energy } = envelope;
      if (vn) {
        expect(step(all[0]!, 'V_S') / vn.diagram.stallSpeed).toBeCloseTo(1, 12);
        expect(result(all[0]!) / vn.diagram.maneuveringSpeed).toBeCloseTo(1, 12);
        expect(step(all[1]!, 'a') / vn.diagram.alleviation.liftSlope).toBeCloseTo(1, 12);
        expect(step(all[1]!, 'K_g') / vn.diagram.alleviation.factor).toBeCloseTo(1, 12);
        expect(result(all[1]!) / vnBoundaries(vn.diagram, vn.diagram.limits.cruiseSpeed)!.gust.upper).toBeCloseTo(1, 12);
      } else expect(all[0]).toBeNull();
      if (turn.corner) {
        expect((step(all[2]!, 'omega') * DEG) / turn.corner.rate).toBeCloseTo(1, 12);
        expect(result(all[2]!) / turn.corner.radius).toBeCloseTo(1, 12);
      } else expect(all[2]).toBeNull();
      if (turn.selected.radius !== null) {
        expect(step(all[3]!, 'n') / (scenario.loadFactor ?? 1)).toBeCloseTo(1, 12);
        expect((step(all[3]!, 'omega') * DEG) / turn.selected.rate).toBeCloseTo(1, 12);
        expect(result(all[3]!) / turn.selected.radius).toBeCloseTo(1, 12);
      } else expect(all[3]).toBeNull();
      if (energy?.selected != null) expect((result(all[4]!) * FPM) / energy.selected).toBeCloseTo(1, 10);
      else expect(all[4]).toBeNull();

      for (const w of all) {
        if (!w) continue;
        const screen = fromScreen(w);
        w.steps.forEach((s, i) => {
          // P_s is thrust less drag, which cancels near the envelope's edge: compare it on the scale of V T / W.
          const scale = s.name === 'P_s' ? (step(w, 'T') * w.given.V!.value) / w.given.W!.value : Math.abs(s.value);
          expect(Math.abs(screen[i]! - s.value) / scale, `${w.title}: ${s.name}`).toBeLessThan(1e-4);
        });
      }
    });
  }

  it('has a scenario for every working', () => {
    for (const id of ['maneuvering', 'gust', 'corner', 'turn', 'excess-power'] as const) {
      const shown = SCENARIOS.some(([, scenario]) => envelopeWorking(id, scenario, buildEnvelopeModel(scenario, envelopeView), envelopeView));
      expect(shown, id).toBe(true);
    }
  });
});

describe('the working behind the runway tab', () => {
  const runwayView: ViewSettings = { ...DEFAULT_VIEW, tab: 'field' };
  const jet = { ...DEFAULT_SCENARIO, presetId: 'jet-trainer', aircraft: PRESETS['jet-trainer'], tas: 100 };
  const CASES: readonly [string, Scenario][] = [
    ['172, sea level, calm', DEFAULT_SCENARIO],
    ['172, 8,000 ft, ISA +15, light, wet grass, headwind', { ...DEFAULT_SCENARIO, altitude: 8000 * 0.3048, deltaISA: 15, mass: 1000, surface: 'wet-grass', headwind: 5 }],
    ['172, icy, tailwind', { ...DEFAULT_SCENARIO, surface: 'icy-paved', headwind: -3 }],
    ['172, icy, headwind', { ...DEFAULT_SCENARIO, surface: 'icy-paved', headwind: 4 }],
    ['172 without windmilling drag, tailwind', { ...DEFAULT_SCENARIO, presetId: null, aircraft: { ...PRESETS.c172, windmillCd0: undefined as never }, headwind: -2 }],
    ['172 with thrust held to P/V', SCENARIOS[7]![1]],
    ['jet, sea level', jet],
    ['jet, 5,000 ft, tailwind', { ...jet, altitude: 1524, headwind: -4 }],
    ['sailplane', SCENARIOS[8]![1]],
  ];
  const IDS = ['takeoff-roll', 'takeoff-total', 'landing-roll', 'landing-total'] as const;
  const all = (scenario: Scenario) => {
    const runway = buildRunwayModel(scenario, runwayView);
    return { runway, works: IDS.map((id) => runwayWorking(id, scenario, runway, runwayView)) };
  };

  for (const [label, scenario] of CASES) {
    it(`agrees with the numerical integration: ${label}`, () => {
      const { runway, works } = all(scenario);
      const [roll, total, landingRoll, landingTotal] = works;
      const { takeoff, landing } = runway;
      if (takeoff.ok) {
        if (roll) {
          const run = roll.steps.filter((s) => s.name === 's_run' || s.name === 's_tail').reduce((a, s) => a + s.value, 0);
          expect(run / takeoff.groundRun).toBeCloseTo(1, 6);
          expect(result(roll) / takeoff.groundRoll).toBeCloseTo(1, 6);
        }
        expect(step(total!, 'gamma') / takeoff.climbAngle).toBeCloseTo(1, 12);
        expect(result(total!) / takeoff.total).toBeCloseTo(1, 12);
      } else expect(roll ?? total).toBeNull();
      if (!landing.ok) throw new Error(landing.reason);
      // The model integrates by Simpson's rule on 512 panels: 1e-7 short of the exact form for a sailplane,
      // whose braking deceleration nearly vanishes at touchdown, where its wing carries all its weight.
      expect(result(landingRoll!) / landing.groundRoll).toBeCloseTo(1, 6);
      expect(result(landingTotal!) / landing.total).toBeCloseTo(1, 12);

      for (const w of works) {
        if (!w) continue;
        const screen = fromScreen(w);
        expect(screen.at(-1)! / result(w), `${w.title} from the screen`).toBeCloseTo(1, 4);
      }
    });
  }

  it('leaves out the ground run only where thrust is held to P/V on it', () => {
    const { runway, works } = all(SCENARIOS[7]![1]);
    expect(runway.takeoff.ok).toBe(true);
    expect(works[0]).toBeNull();
    expect(works[1]).not.toBeNull();
  });

  it('covers every closed form and branch', () => {
    const formulas = CASES.flatMap(([, scenario]) => all(scenario).works.flatMap((w) => w?.steps.map((s) => `${s.name} = ${s.formula}`) ?? []));
    for (const marker of [
      'I = (2 / sqrt(-Delta)) * (atan(',
      'I = (1 / sqrt(Delta)) * ln(',
      'I_t = (2 / sqrt(-Delta_t)) * (atan(',
      'I_t = (1 / sqrt(Delta_t)) * ln(',
      's_B = (1 / (2 * a_2)) * ln((a_0 + a_2 * V_TD ^ 2) / (a_0 + a_2 * V_w ^ 2))',
      'a_1 = ',
      'C_L_g = mu_r / (2 * k)',
      'C_L_g = C_Lmax / 1.15 ^ 2',
      's_TR = sqrt(R ^ 2 - (R - h_obs) ^ 2)',
      's_CL = ',
    ]) {
      expect(formulas.some((f) => f.startsWith(marker) || f.includes(marker)), marker).toBe(true);
    }
  });
});
