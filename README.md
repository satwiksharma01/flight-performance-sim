# Flight Performance Simulator

Aircraft performance analysis in the browser. The physics core is dependency-free
TypeScript, validated against published atmospheric tables and — from v0.4 — against
an independent Python implementation and manufacturer performance data.

**Status:** v0.2 in progress. Physics core, performance curves and scenario
permalinks are complete and tested. No UI yet. See [ROADMAP.md](ROADMAP.md).

## Running the tests

```bash
npm install
npm test
npm run typecheck
npm run test:watch
```

## What is implemented

| Module | Contents |
|---|---|
| `src/physics/constants.ts` | ISA constants and the layer table, base pressures derived for continuity |
| `src/physics/units.ts` | Branded unit types and conversions; SI internally, aviation units at the boundary |
| `src/physics/atmosphere.ts` | Layered ISA to 84 852 m, ΔISA deviation, pressure and density altitude, Sutherland viscosity |
| `src/physics/airspeed.ts` | TAS / EAS / CAS / Mach, compressible impact pressure |
| `src/physics/aero.ts` | Parabolic drag polar, stall speed, and closed-form characteristic speeds |
| `src/physics/performance/curves.ts` | Drag, thrust required, power required and L/D curves, with characteristic-speed markers |
| `src/data/aircraft/presets.ts` | Id-keyed preset registry — ids are part of the URL format, so treat them as append-only |
| `src/state/url.ts` | Scenario permalinks: delta-encoded, and decoding never throws |

111 tests, covering the published ISA table at five altitudes, layer continuity,
profile inversion, every closed-form optimum cross-checked against a brute-force
scan, and permalink round-trip stability.

Two exact identities are pinned as tests because they catch algebra errors that
plausible-looking numbers would hide: every characteristic speed is altitude-invariant
in EAS while varying in TAS, and `V_mp` and `V_jr` share the same L/D and the same
drag, sitting on opposite sides of the polar at `sqrt(3)*CL_md/(4*CD0)`.

## Design notes

**No backend.** Every equation here is closed-form algebra; a network round trip
would only add latency to a tool whose main feature is continuous response to a
slider. Python returns in v0.4 as an independent reference implementation for
cross-validation, which is a better use for it than a CRUD API.

**SI internally, always.** Unit conversion happens once, at the boundary. Branded
types make a feet-for-metres mix-up a compile error rather than a Mars Climate
Orbiter.

**Closed forms over scanning.** `V_md`, `V_mp`, `V_jr` and `(L/D)max` all have exact
analytic solutions. The tests verify them against a 400 000-point scan, so if the
algebra is ever wrong the suite says so.

**Known model limits are pinned, not hidden.** The parabolic polar overestimates the
Cessna 172's glide ratio by roughly 20 % — it cannot represent fixed-gear
interference drag or the CL-dependence of parasite drag. There is a test asserting
the size of that error rather than a tuned CD0 that conceals it.

## Physics references

- ISO 2533 / US Standard Atmosphere 1976 — atmospheric model
- Anderson, *Aircraft Performance and Design* — drag polar, characteristic speeds
- Hull, *Fundamentals of Airplane Flight Mechanics* — climb and cruise formulations

Aircraft parameters in `src/data/aircraft/` are simplified representative figures for
education, not certification data.
