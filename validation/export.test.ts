/**
 * Writes the TypeScript core's outputs across a sweep of conditions to
 * validation/out/ts-output.json, for reference.py to check independently.
 */

import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atPressureAltitude, isa } from '../src/physics/atmosphere.js';
import { airspeeds } from '../src/physics/airspeed.js';
import { dragAtSpeed, maxLiftToDrag, stallSpeed, vJetRange, vMinDrag, vMinPower } from '../src/physics/aero.js';
import { PRESETS } from '../src/data/aircraft/presets.js';
import { ceilings, climbAt, climbPerformance, isPowered, type PoweredAircraft } from '../src/physics/performance/climb.js';
import { bestGlide, bestGlideInWind, minimumSink } from '../src/physics/performance/glide.js';
import { lapseRatio, thrustAvailable } from '../src/physics/propulsion.js';
import type { Aircraft } from '../src/physics/aero.js';

/** Engines no preset uses, so every model is checked. */
const EXTRA: Record<string, Aircraft> = {
  'turbo-piston': {
    ...PRESETS.c172,
    name: 'turbocharged single',
    propulsion: { kind: 'piston', power: 200_000, criticalAltitude: 4500, propeller: { staticThrust: 4200, zeroThrustSpeed: 190 } },
  },
  turboprop: {
    name: 'turboprop trainer',
    mass: 2700,
    wingArea: 16.3,
    aspectRatio: 7.0,
    oswaldEfficiency: 0.8,
    cd0: 0.025,
    clMax: 1.5,
    propulsion: { kind: 'turboprop', power: 900_000, lapseExponent: 0.75, propeller: { staticThrust: 15000, zeroThrustSpeed: 260 } },
  },
};

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');

it('exports the sweep', () => {
  const altitudes = [-500, 0, 1000, 3048, 5000, 8000, 11000, 11019, 15000, 20000, 25000, 32000, 40000, 47000, 51000, 60000, 71000, 80000, 84000];
  const deviations = [-20, 0, 15];
  const tasValues = [30, 100, 200, 300, 400];

  const atmosphere = altitudes.flatMap((h) =>
    deviations.map((d) => {
      const a = isa(h, d);
      return {
        h, d,
        T: a.temperature, p: a.pressure, rho: a.density, a: a.speedOfSound, mu: a.dynamicViscosity,
        hp: a.pressureAltitude, hd: a.densityAltitude,
        speeds: tasValues.map((tas) => airspeeds(tas, a.pressure, a.density, a.speedOfSound)),
      };
    }),
  );

  const aero = Object.entries(PRESETS).flatMap(([id, ac]) =>
    [0, 3000, 10000].map((h) => {
      const rho = isa(h).density;
      return {
        id, ac, h, rho,
        vs: stallSpeed(ac, rho), vmd: vMinDrag(ac, rho), vmp: vMinPower(ac, rho), vjr: vJetRange(ac, rho),
        ldmax: maxLiftToDrag(ac), d60: dragAtSpeed(ac, 60, rho).total,
      };
    }),
  );

  const all: Record<string, Aircraft> = { ...PRESETS, ...EXTRA };
  const conditions = [[0, 0], [3000, 0], [3000, 15], [6000, -10]] as const;

  const performance = Object.entries(all).flatMap(([id, ac]) =>
    conditions.map(([hp, d]) => {
      const atm = atPressureAltitude(hp, d);
      const glide = {
        best: bestGlide(ac, atm),
        sink: minimumSink(ac, atm),
        headwind: bestGlideInWind(ac, atm, 10)?.glide ?? null,
      };
      if (!isPowered(ac)) return { id, ac, hp, d, rho: atm.density, glide, climb: null };
      const pa = ac as PoweredAircraft;
      const perf = climbPerformance(pa, atm);
      const lapse = lapseRatio(pa.propulsion, atm);
      return {
        id, ac, hp, d, rho: atm.density, sigma: atm.densityRatio, pressureAltitude: atm.pressureAltitude, glide,
        climb: {
          lapse,
          thrustAt: [40, 80, 150].map((v) => ({ v, t: thrustAvailable(pa.propulsion, v, lapse) })),
          at: [40, 80, 150].map((v) => climbAt(pa, atm, v)),
          vy: perf.vy, vx: perf.vx, maxLevelSpeed: perf.maxLevelSpeed,
        },
      };
    }),
  );

  const ceilingRows = Object.entries(all)
    .filter(([, ac]) => isPowered(ac))
    .flatMap(([id, ac]) => [0, 15].map((d) => ({ id, ac, d, ...ceilings(ac as PoweredAircraft, d) })));

  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, 'ts-output.json'),
    JSON.stringify({ atmosphere, aero, performance, ceilings: ceilingRows }, null, 1),
  );
});
