import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO, type Scenario } from '../src/state/url.js';
import { DEFAULT_VIEW, type ViewSettings } from '../src/app/model.js';
import { buildEnergyChart, buildEnvelopeModel, loadFactorForTurnRate } from '../src/app/envelope.js';
import { buildRunwayModel, interpolatePoh } from '../src/app/runway.js';
import { POH_TABLES } from '../src/data/validation/poh-c172s.js';
import { PRESETS } from '../src/data/aircraft/presets.js';
import { turnRate } from '../src/physics/performance/turn.js';

const view: ViewSettings = { ...DEFAULT_VIEW, tab: 'envelope' };
const KT = 1852 / 3600;

describe('envelope tab', () => {
  const m = buildEnvelopeModel(DEFAULT_SCENARIO, view);

  it('draws the 172’s V-n diagram in knots EAS, with its published V_NE', () => {
    expect(m.vn).not.toBeNull();
    expect(m.vn!.speeds.neverExceed).toBeCloseTo(160, 6);
    expect(m.vn!.speeds.maneuvering).toBeCloseTo(103.35, 1);
    expect(m.vn!.x[m.vn!.x.length - 1]).toBeCloseTo(m.vn!.speeds.dive, 6);
    // The corners are sampled exactly, so the envelope's vertex is sharp.
    expect(m.vn!.x).toContainEqual(m.vn!.speeds.maneuvering);
  });

  it('puts level flight at cruise inside the envelope, and 5 g outside it', () => {
    expect(m.vn!.selected.inside).toBe(true);
    const pulled: Scenario = { ...DEFAULT_SCENARIO, loadFactor: 5 };
    expect(buildEnvelopeModel(pulled, view).vn!.selected.inside).toBe(false);
  });

  it('peaks the instantaneous turn at the corner speed', () => {
    const { turn } = m;
    const peak = Math.max(...turn.instantaneous.filter((v): v is number => v !== null));
    expect(turn.corner).not.toBeNull();
    expect(peak).toBeCloseTo(turn.corner!.rate, 0);
    expect(turn.bestSustained!.rate).toBeLessThan(peak);
  });

  it('inverts a turn rate back to its load factor', () => {
    const n = loadFactorForTurnRate(50, (turnRate(50, 2.5) * 180) / Math.PI);
    expect(n).toBeCloseTo(2.5, 12);
  });

  it('closes the P_s = 0 contour near the absolute ceiling, and runs the best-climb line up the middle', () => {
    const e = m.energy!;
    const zero = e.contours.find((c) => c.level === 0)!;
    const top = Math.max(...zero.lines.flat().map(([, y]) => y));
    expect(top).toBeGreaterThan(15_500); // absolute ceiling 16,291 ft; the grid is 290 ft per row
    expect(top).toBeLessThan(16_400);
    // Best climb at sea level is V_y, 74 KIAS.
    expect(e.bestClimb[0]![0]).toBeCloseTo(74, -1);
    expect(e.energyHeights).toEqual([]); // a light single's kinetic energy is too small to draw
  });

  it('draws energy-height lines for the jet, where they slope', () => {
    const jet: Scenario = { ...DEFAULT_SCENARIO, presetId: 'jet-trainer', aircraft: PRESETS['jet-trainer'], tas: 120 };
    expect(buildEnergyChart(jet, view)!.energyHeights.length).toBeGreaterThan(0);
  });

  it('has no V-n diagram without limits, and no P_s for a glider', () => {
    const { structure: _s, ...bare } = PRESETS.c172;
    expect(buildEnvelopeModel({ ...DEFAULT_SCENARIO, presetId: null, aircraft: bare }, view).vn).toBeNull();
    const glider: Scenario = { ...DEFAULT_SCENARIO, presetId: 'sailplane', aircraft: PRESETS.sailplane, tas: 25 };
    expect(buildEnvelopeModel(glider, view).energy).toBeNull();
  });

  it('builds the P_s grid fast enough to drag the weight slider', () => {
    const start = performance.now();
    for (let i = 0; i < 5; i++) buildEnergyChart({ ...DEFAULT_SCENARIO, mass: 1000 - i }, view);
    expect((performance.now() - start) / 5).toBeLessThan(60);
  });
});

describe('takeoff and landing tab', () => {
  it('reads the POH tables bilinearly, and only inside them', () => {
    const roll = POH_TABLES.find((t) => t.id === 'takeoff-roll')!;
    expect(interpolatePoh(roll, 0, 15)).toBe(960);
    expect(interpolatePoh(roll, 500, 0)).toBe(900);
    expect(interpolatePoh(roll, 9000, 20)).toBeNull();
    expect(interpolatePoh(roll, 0, -5)).toBeNull();
  });

  it('draws the POH only for the stock 172S in the POH’s conditions', () => {
    const fieldView: ViewSettings = { ...DEFAULT_VIEW, tab: 'field', system: 'us' };
    const stock = buildRunwayModel(DEFAULT_SCENARIO, fieldView);
    expect(stock.pohApplies).toBe(true);
    // Sea level, standard day: the specifications page's 960 ft.
    expect(stock.takeoffChart!.pohGroundRoll![0]).toBe(960);
    expect(buildRunwayModel({ ...DEFAULT_SCENARIO, headwind: 5 * KT }, fieldView).pohApplies).toBe(false);
    expect(buildRunwayModel({ ...DEFAULT_SCENARIO, mass: 1000 }, fieldView).pohApplies).toBe(false);
    expect(buildRunwayModel({ ...DEFAULT_SCENARIO, surface: 'soft-turf' }, fieldView).pohApplies).toBe(false);
  });

  it('has no takeoff for a glider, but a landing', () => {
    const glider: Scenario = { ...DEFAULT_SCENARIO, presetId: 'sailplane', aircraft: PRESETS.sailplane, tas: 25 };
    const r = buildRunwayModel(glider, { ...DEFAULT_VIEW, tab: 'field' });
    expect(r.takeoffChart).toBeNull();
    expect(r.landing.ok).toBe(true);
  });
});
