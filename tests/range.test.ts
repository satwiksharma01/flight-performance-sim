import { describe, expect, it } from 'vitest';
import { atPressureAltitude } from '../src/physics/atmosphere.js';
import { dragAtSpeed, weight } from '../src/physics/aero.js';
import { CRUISE_PROPELLER_EFFICIENCY, breguet, fuelAboard, payloadRange } from '../src/physics/performance/range.js';
import { fuelFlow } from '../src/physics/propulsion.js';
import { PRESETS } from '../src/data/aircraft/presets.js';

const G = 9.80665;
const c172 = PRESETS.c172;
const jet = PRESETS['jet-trainer'];
// The 172 with constant SFC: its fuel-flow line's slope, no base flow. Breguet's closed forms hold for it.
const { baseFuelFlow: _base, ...constantSfc } = c172.propulsion!;
const c172Constant = { ...c172, propulsion: constantSfc };
const rho = atPressureAltitude(3000).density;

/**
 * For a sliver of fuel the weight barely changes, so each Breguet case must
 * reduce to plain fuel-flow arithmetic at the speed it flies:
 *   time = fuel weight / fuel-weight flow, distance = time x speed,
 * with the engine's fuel flow at D V / eta for a propeller and D for a jet.
 */
function sliver(aircraft: typeof c172, kind: 'range' | 'endurance') {
  const fuel = 1e-4 * aircraft.mass;
  const r = breguet(aircraft, rho, fuel)!;
  const point = r[kind];
  // Evaluated at the mid-weight, so the comparison is second-order in the sliver.
  const mid = { ...aircraft, mass: aircraft.mass - fuel / 2 };
  const v = Math.sqrt((2 * weight(mid.mass)) / (rho * aircraft.wingArea * point.cl));
  const drag = dragAtSpeed(mid, v, rho).total;
  const output = r.kind === 'jet' ? drag : (drag * v) / CRUISE_PROPELLER_EFFICIENCY;
  const flow = G * fuelFlow(aircraft.propulsion!, output);
  const time = (fuel * G) / flow;
  return { breguet: point.value, expected: kind === 'range' ? time * v : time };
}

describe('Breguet range and endurance', () => {
  for (const [name, aircraft] of [['propeller', c172], ['propeller, constant SFC', c172Constant], ['jet', jet]] as const) {
    for (const kind of ['range', 'endurance'] as const) {
      it(`reduces to fuel-flow arithmetic for a sliver of fuel: ${name} ${kind}`, () => {
        const { breguet: value, expected } = sliver(aircraft, kind);
        expect(value / expected).toBeCloseTo(1, 8);
      });
    }
  }

  it('with constant SFC, finds the textbook optimum of each case', () => {
    // A flat optimum is located to about the square root of machine precision.
    const prop = breguet({ ...c172Constant, clMax: 3 }, rho, 100)!; // CLmax raised so no optimum is clipped
    const kf = 1 / (Math.PI * c172.oswaldEfficiency * c172.aspectRatio);
    expect(prop.range.cl).toBeCloseTo(Math.sqrt(c172.cd0 / kf), 7); // max L/D
    expect(prop.endurance.cl).toBeCloseTo(Math.sqrt((3 * c172.cd0) / kf), 7); // max CL^1.5/CD
    const j = breguet(jet, rho, 500)!;
    const kj = 1 / (Math.PI * jet.oswaldEfficiency * jet.aspectRatio);
    expect(j.range.cl).toBeCloseTo(Math.sqrt(jet.cd0 / (3 * kj)), 7); // max CL^0.5/CD
    expect(j.endurance.cl).toBeCloseTo(Math.sqrt(jet.cd0 / kj), 7); // max L/D
  });

  it('with constant SFC, matches the closed forms', () => {
    const r = breguet({ ...c172Constant, clMax: 3 }, rho, 100)!;
    const kf = 1 / (Math.PI * c172.oswaldEfficiency * c172.aspectRatio);
    const c = constantSfc.sfc! * G;
    const w0 = weight(c172.mass);
    const w1 = weight(c172.mass - 100);
    const ld = 1 / (2 * Math.sqrt(c172.cd0 * kf));
    expect(r.range.value / ((CRUISE_PROPELLER_EFFICIENCY / c) * ld * Math.log(w0 / w1))).toBeCloseTo(1, 11);
  });

  it('with a base fuel flow, cruises faster than the textbook optimum', () => {
    // Every hour aloft burns the base flow, so time saved is fuel saved.
    const kf = 1 / (Math.PI * c172.oswaldEfficiency * c172.aspectRatio);
    expect(breguet(c172, rho, 100)!.range.cl).toBeLessThan(Math.sqrt(c172.cd0 / kf) * 0.95);
  });

  it('holds the 172 at 1.2 V_s for endurance with constant SFC: its V_mp is below the stall', () => {
    const r = breguet(c172Constant, rho, 100)!;
    expect(r.endurance.stallLimited).toBe(true);
    expect(r.endurance.cl).toBeCloseTo(c172.clMax / 1.44, 9);
    expect(r.range.stallLimited).toBe(false);
  });

  it('gives a constant-SFC propeller the same range at any altitude, and a jet more range higher up', () => {
    const low = atPressureAltitude(0).density;
    expect(breguet(c172Constant, low, 100)!.range.value).toBeCloseTo(breguet(c172Constant, rho, 100)!.range.value, 6);
    expect(breguet(jet, rho, 500)!.range.value).toBeGreaterThan(breguet(jet, low, 500)!.range.value);
  });

  it('flies the 172 further higher up, as its POH range profile does: the base flow rewards speed', () => {
    const low = atPressureAltitude(0).density;
    expect(breguet(c172, rho, 100)!.range.value).toBeGreaterThan(breguet(c172, low, 100)!.range.value);
  });

  it('has nothing to say without fuel, an SFC or an engine', () => {
    expect(breguet(c172, rho, 0)).toBeNull();
    expect(breguet(PRESETS.sailplane, rho, 10)).toBeNull();
    const { sfc: _none, ...engine } = c172.propulsion!;
    expect(breguet({ ...c172, propulsion: engine }, rho, 100)).toBeNull();
  });
});

describe('fuel aboard', () => {
  it('fills the tanks first, up to capacity', () => {
    expect(fuelAboard(c172)).toBeCloseTo(c172.fuelCapacity!, 12); // 2,550 lb leaves room for full tanks
    expect(fuelAboard({ ...c172, mass: c172.emptyMass! + 50 })).toBeCloseTo(50, 12);
    expect(fuelAboard({ ...c172, mass: c172.emptyMass! - 1 })).toBe(0);
  });
});

describe('payload-range', () => {
  const points = payloadRange(c172, rho)!;
  const useful = c172.mass - c172.emptyMass!;

  it('starts at the whole useful load and no range, and ends at zero payload and the ferry range', () => {
    expect(points[0]).toEqual({ payload: useful, range: 0 });
    const ferry = points[points.length - 1]!;
    expect(ferry.payload).toBeCloseTo(0, 9);
    const fullTanksFromEmpty = breguet({ ...c172, mass: c172.emptyMass! + c172.fuelCapacity! }, rho, c172.fuelCapacity!)!;
    expect(ferry.range).toBeCloseTo(fullTanksFromEmpty.range.value, 6);
  });

  it('passes through full tanks at maximum takeoff mass', () => {
    const knee = points.find((p) => Math.abs(p.payload - (useful - c172.fuelCapacity!)) < 1e-9)!;
    expect(knee.range).toBeCloseTo(breguet(c172, rho, c172.fuelCapacity!)!.range.value, 6);
  });

  it('only ever trades payload for range', () => {
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.range).toBeGreaterThan(points[i - 1]!.range);
      expect(points[i]!.payload).toBeLessThan(points[i - 1]!.payload);
    }
  });

  it('needs empty mass, fuel capacity and an SFC', () => {
    expect(payloadRange(PRESETS.sailplane, rho)).toBeNull();
    const { fuelCapacity: _f, ...noTanks } = c172;
    expect(payloadRange(noTanks, rho)).toBeNull();
  });

  it('flies the 172 about 770 NM on its 53 gallons, at its best constant-CL cruise with no reserve', () => {
    // The POH's 638 NM is at 45 % power with a 45-minute reserve and a climb
    // allowance: a different calculation, checked on the validation page.
    expect(breguet(c172, rho, c172.fuelCapacity!)!.range.value / 1852).toBeCloseTo(772, -1);
  });
});
