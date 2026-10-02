/**
 * Writes the TypeScript core's outputs across a sweep of conditions to
 * validation/out/ts-output.json, for reference.py to check independently.
 */

import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isa } from '../src/physics/atmosphere.js';
import { airspeeds } from '../src/physics/airspeed.js';
import { dragAtSpeed, maxLiftToDrag, stallSpeed, vJetRange, vMinDrag, vMinPower } from '../src/physics/aero.js';
import { PRESETS } from '../src/data/aircraft/presets.js';

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

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'ts-output.json'), JSON.stringify({ atmosphere, aero }, null, 1));
});
