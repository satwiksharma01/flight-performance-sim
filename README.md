# Flight Performance Simulator

Aircraft performance analysis in the browser. Drag a slider and the drag, power and
lift-to-drag curves respond instantly, with the characteristic speeds marked from
their closed-form solutions. The physics core is dependency-free TypeScript,
validated against published atmospheric tables and — from v0.4 — against an
independent Python implementation and manufacturer performance data.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/explorer-dark.png">
  <img alt="The explorer showing a Cessna 172S at 8,000 ft pressure altitude on an ISA +15 day: density altitude 9,721 ft, controls for pressure altitude, ISA deviation or OAT, weight and bank angle, and drag, power and L/D curves against true airspeed with V_s, V_mp, V_md and V_jr marked." src="docs/explorer-light.png">
</picture>

**Status:** v0.2. The physics core and the curve explorer are complete, tested and
independently cross-checked; the site is not deployed yet. See [ROADMAP.md](ROADMAP.md).

## What it shows

- **Drag** (total, parasite, induced), **power required** and **L/D** against speed,
  with `V_s`, `V_mp`, `V_md` and `V_jr` marked. Click or drag on any chart to read
  off a point.
- **The speed axis in TAS, EAS, CAS or Mach**, in knots, m/s or km/h. CAS is
  compressible, with the Rayleigh pitot formula above Mach 1.
- **The condition the way performance data states it:** pressure altitude (flight
  levels from FL180), and ISA deviation or OAT. Density altitude is the headline
  number, and the true altitude of the pressure level is integrated through the
  column.
- **Weight and bank angle.** Operating weight from 40 % of max takeoff mass, and a
  bank angle that sets the load factor. Turn radius and rate at the selected speed,
  and W/δ.
- **Three presets** (Cessna 172S at its 2,550 lb gross weight, a jet trainer, a
  sailplane), and an editor for max takeoff mass, wing area, aspect ratio, Oswald
  efficiency, CD₀, CLmax and flap CLmax. The landing-flap stall speed `V_s0` is
  listed with the others.
- **SI or US units** for force, power, weight and area: N, kW and kg, or lbf, hp
  and lb.
- **Every scenario is a link.** `?ac=c172&h=2438.4&disa=15` is a Cessna at
  8,000 ft on an ISA +15 day. An edited preset stays short: `?ac=c172&cd0=0.03`.

### Things to try

1. **Drag the altitude slider against TAS.** The whole curve slides right as the air
   thins. Switch the axis to EAS and it stops moving: drag depends only on dynamic
   pressure, and EAS fixes it.
2. **Stay on EAS and watch the power chart.** It still rises with altitude, because
   power is drag times *true* airspeed.
3. **Pick the jet trainer.** `V_jr`, the jet's best-range speed, sits 32 % above
   best L/D. A propeller aircraft gets its best range at best L/D itself.
4. **Raise CD₀ in the editor.** `(L/D)max` falls and `V_md` gets slower, as
   `V_md ∝ (k/CD₀)^¼` says it should.
5. **Bank to 60°.** Every speed on the chart moves up by √2, and the minimum drag
   doubles: the wing now carries twice the weight. Lighten the aircraft and watch
   the curves move the other way, by √W.

## Running it

```bash
npm install
npm run dev          # the explorer, at http://localhost:5173
npm test             # 191 tests
npm run validate     # cross-check against the independent Python reference (needs SciPy)
npm run typecheck
npm run build        # static site in dist/, relative paths, any host
```

## What is implemented

| Module | Contents |
|---|---|
| `src/physics/constants.ts` | ISA constants and the layer table, base pressures derived for continuity |
| `src/physics/units.ts` | Branded unit types and conversions; SI internally, aviation units at the boundary |
| `src/physics/atmosphere.ts` | Layered ISA to 84 852 m, entered by pressure altitude and ΔISA; density and true altitude, Sutherland viscosity |
| `src/physics/airspeed.ts` | TAS / EAS / CAS / Mach; compressible impact pressure, Rayleigh pitot above Mach 1 |
| `src/physics/aero.ts` | Parabolic drag polar, stall speed, and closed-form characteristic speeds |
| `src/physics/performance/curves.ts` | Drag, thrust required, power required and L/D curves, with characteristic-speed markers at any load factor |
| `src/physics/performance/turn.ts` | Level-turn load factor, radius and rate |
| `src/data/aircraft/presets.ts` | Id-keyed preset registry — ids are part of the URL format, so treat them as append-only |
| `src/state/url.ts` | Scenario permalinks: delta-encoded, and decoding never throws |
| `src/app/model.ts` | Everything the charts draw, as pure functions: axis conversions, the fixed chart window, sampled curves |
| `src/app/permalink.ts` | View settings in the URL, and delta encoding for edited presets |
| `src/app/components/` | React controls, readouts, and the uPlot chart with its marker overlays |

191 tests, covering the published ISA table at five altitudes, layer continuity,
profile inversion, every closed-form optimum cross-checked against a brute-force
scan, permalink round-trip stability, and the chart model's physics: the drag curve
is identical against EAS at every altitude and slides right by `sqrt(ρ₀/ρ)` against
TAS. Against numbers from outside the code, they reproduce Anderson's CP-1 and CP-2
worked examples and put Mach 0.78 at FL350 at 450 KTAS and 265 KCAS. Property tests
run 2,000 random aircraft and 3,000 hostile links through the explorer.

`validation/reference.py` is an independent implementation in Python, written from
the standards rather than translated from the TypeScript: ISA integrated layer by
layer, CAS by root-solving the pitot relation, and the characteristic speeds by
numerical minimisation. Atmosphere and airspeeds agree to 1e-16, CAS to 1e-8 and the
speeds to 1e-8. It also caught CAS above Mach 1 using the subsonic pitot relation
instead of Rayleigh's, off by up to 6 %; that is fixed, and checked against the
NACA 1135 normal-shock tables.

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
algebra is ever wrong the suite says so. The chart markers come from the same
closed forms, so they never move with sample spacing.

**The axes don't follow the curve.** Each aircraft's chart window is fitted once, at
sea level, and never refits. An auto-scaling axis would rescale along with the curve
and make it look still, hiding the very effect the altitude slider exists to show.

**The URL is the state.** Every change passes through the permalink before it
reaches the screen, so what you see is exactly what a pasted link opens. A malformed
link degrades to defaults and says what it couldn't use.

**Known model limits are pinned, not hidden.** The parabolic polar overestimates the
Cessna 172's glide ratio by roughly 20 % — it cannot represent fixed-gear
interference drag or the CL-dependence of parasite drag. There is a test asserting
the size of that error rather than a tuned CD0 that conceals it. The polar has no
wave drag either, so the charts shade everything above Mach 0.7 and draw nothing past
Mach 0.9.

## Physics references

- ISO 2533 / US Standard Atmosphere 1976 — atmospheric model
- Anderson, *Aircraft Performance and Design* — drag polar, characteristic speeds
- Hull, *Fundamentals of Airplane Flight Mechanics* — climb and cruise formulations

Aircraft parameters in `src/data/aircraft/` are simplified representative figures for
education, not certification data.
