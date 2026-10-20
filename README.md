# Flight Performance Simulator

[![CI](https://github.com/satwiksharma01/flight-performance-sim/actions/workflows/ci.yml/badge.svg)](https://github.com/satwiksharma01/flight-performance-sim/actions/workflows/ci.yml)

Aircraft performance analysis in the browser: drag, power, climb, ceilings and glide;
the V-n diagram, turns and specific excess power; takeoff and landing. Everything
responds instantly as you drag a slider. The physics core is dependency-free
TypeScript, cross-checked against an independent Python implementation, against
published standards and textbook examples, and, for the Cessna 172S, against its POH,
table by table.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/explorer-dark.png">
  <img alt="The explorer showing a Cessna 172S at 8,000 ft pressure altitude on an ISA +15 day: density altitude 9,721 ft, best rate of climb 285 ft/min, service ceiling 12,255 ft. Charts show drag with thrust available, power required and available, L/D, rate of climb with V_x, V_y and V_max, and best rate of climb against altitude down to the ceilings." src="docs/explorer-light.png">
</picture>

**Live:** [satwiksharma01.github.io/flight-performance-sim](https://satwiksharma01.github.io/flight-performance-sim/) · [validation](https://satwiksharma01.github.io/flight-performance-sim/validation.html)

[Design notes](#design-notes) · [Contributing](CONTRIBUTING.md)

**Status:** v0.6, cruise and comparison. Five tabs: performance curves, the envelope
(V-n diagram, turn performance, P_s contours), takeoff and landing, range, and
sensitivity, and a second aircraft can be overlaid for comparison. A
[/validation](validation.html) page shows the model against every published figure
and every cell of the 172S's POH tables, and CI re-runs the tests and the independent
cross-check on every push, and deploys to GitHub Pages when they pass. See [ROADMAP.md](ROADMAP.md).

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
- **Climb at full power:**
  - Thrust and power available on the drag and power charts, meeting the curves at
    maximum level speed.
  - A rate-of-climb chart: the exact steady climb against the small-angle
    (P_A − P_R)/W, with `V_x` and `V_y`.
  - Best rate of climb against altitude, down to the service and absolute ceilings.
  - Piston (optionally turbocharged), turboprop and turbofan engine models, all
    editable.
- **Glide, power off:** best glide ratio and speed, minimum sink, and distance from
  the current altitude. For a glider the rate-of-climb chart becomes the glider polar.
- **The V-n diagram,** in EAS: stall curves, limit load factors (negative limit at
  V_D by certification category), the former 14 CFR 23.341
  gust lines with the Pratt alleviation factor, and the design envelope, with
  `V_S`, `V_A`, `V_C`, `V_NE` and `V_D`. The current speed and bank are a point on it,
  inside or outside.
- **Turn performance:** instantaneous and sustained turn rate against speed (the
  "doghouse"), the corner speed, and lines of constant radius.
- **Specific excess power,** `P_s = V(T − D)/W`, contoured over altitude and speed:
  `P_s = 0` is the edge of the steady envelope, with the stall line, the best-climb
  schedule and, for the jet, energy-height lines.
- **Takeoff and landing over 50 ft:** ground roll and total against pressure altitude
  on the current ISA day, each split into its phases, on seven runway surfaces with a
  head- or tailwind. For the stock 172S the POH's own tables are drawn over the
  curves.
- **Range and endurance** by Breguet's constant-CL cruise. With constant SFC that is
  the four textbook cases: a propeller flies best range at `V_md` and best
  endurance at `V_mp`, a jet at `V_jr` and `V_md`. Real fuel flow is a straight line
  in power with a base flow (the 172S's is fitted to its POH, and SFC rises at part
  power), so the integrals are evaluated numerically and the best speed found. A
  **payload–range diagram** shows the trade from full payload to ferry range. Fuel
  capacity, empty mass, SFC and base fuel flow are editable.
- **Cruise at a set power,** the way a POH tabulates it: pick a percentage of rated
  power and read the speed, fuel flow, and range and time on the fuel aboard with a
  45-minute reserve. For the 172S it is checked against all 111 cells of the POH's
  cruise table.
- **Two aircraft, compared.** A second aircraft, editable like the first, overlaid
  dashed on the performance curves, with a side-by-side table of speeds, climb,
  ceilings, glide, takeoff, landing and range. It flies the same condition at the same
  fraction of its own max takeoff mass. In the link it is the same keys with a
  `vs.` prefix: `?ac=c172&vs.ac=c172&vs.cd0=0.028` is a 172 against a cleaner one.
- **Sensitivity.** Each input (weight, wing area, aspect ratio, Oswald efficiency,
  CD₀ and its power-off increment, each CLmax, engine power, SFC and base fuel flow,
  fuel) nudged 1 % either way on its own, and
  every result's change found by central difference. Each is reported as an
  elasticity, the per cent change for 1 % more of the input, ranked as bars with a
  sentence naming the strongest. Where a closed form exists, the bars reproduce its
  exponents: stall speed ±0.50 in weight, wing area and CLmax.
- **SI or US units** for force, power, weight and area: N, kW and kg, or lbf, hp
  and lb.
- **The working behind every headline number.** Click a tile (density altitude,
  stall speed, best climb, service ceiling, best glide, maximum level speed) for its
  equation, then the same equation with this scenario's numbers in, then the result,
  with every input listed and sourced. The working is computed from the formulas it
  shows, and the tests check it lands on the tile.
- **Every scenario is a link.** `?ac=c172&h=2438.4&disa=15` is a Cessna at
  8,000 ft on an ISA +15 day. An edited preset stays short: `?ac=c172&cd0=0.03`.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/envelope-dark.png">
  <img alt="The envelope tab for a Cessna 172S at 5,000 ft on an ISA +10 day in a 30-degree bank: the V-n diagram with its manoeuvre envelope, gust lines and V_S, V_A, V_C, V_NE and V_D; turn rate against speed with the corner speed and the best sustained turn; and specific excess power contoured over altitude and speed, closing at P_s = 0." src="docs/envelope-light.png">
</picture>

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
6. **Climb the 172S.** Drag the altitude up and watch power available sink onto
   power required. The gap between them is the rate of climb, and it closes at the
   absolute ceiling, where V_x and V_y meet.
7. **Turbocharge it.** In the editor, give the engine a critical altitude of
   12,000 ft: the service ceiling jumps from about 14,200 ft to about 23,000.
8. **Find the corner.** On the envelope tab, click the turn chart at its peak: that is
   the corner speed, where the 172 turns fastest, at its 3.8 g limit. Slower, the
   wing stalls first; faster, the structure would break first. The same point sits
   on the V-n diagram's corner, at `V_A`.
9. **Go hot and high.** On the takeoff tab, set 5,000 ft and ISA +25. The 172's
   takeoff over 50 ft grows by two-thirds, and the POH's dots move with the curves.
10. **Fly the jet up its P_s map.** The dashed best-climb line leans to higher speeds
    as it climbs, and the faint energy-height lines show why a jet trades speed for
    height on the way up.
11. **Clean up a 172.** Compare the stock 172 with one at CD₀ 0.028 and AR 9:
    (L/D)max rises 18 %, the glide ratio only 15 % (power off, the windmilling
    propeller's drag is still there), and the range 13 %: the engine's base fuel
    flow makes the best cruise faster than V_md, where the induced drag that aspect
    ratio cuts matters less. The stall speed doesn't move.
12. **Ask what matters.** On the sensitivity tab, the 172's takeoff over 50 ft is
    led by weight at +2.06: the ground roll goes nearly as W². Switch to best range:
    the fuel line's slope and base flow share the fuel flow between them, −0.75 and
    −0.25, summing to −1 as scaling both must. CD₀ (−0.44) outweighs aspect ratio
    (+0.32), because the best cruise is faster than V_md, where parasite drag
    dominates.
13. **Fly the POH's cruise.** On the range tab at 8,500 ft, set 75 %: 124 KTAS at
    10.3 GPH, the POH's figures. Drop to 45 % and the speed falls to 93 KTAS but the
    range grows, because fuel flow falls faster than speed. The validation page has
    every cell of the POH's cruise table against the model.
14. **Show the working.** Click the stall-speed tile, then bank to 60°: the load factor
    n in `V_s = √(2 n W / (ρ S C_Lmax))` goes to 2, and the speed rises by √2.

## Validation

The **Validation** page (`validation.html`) lists 50 published figures from four
sources: the US Standard Atmosphere 1976 tables, NACA Report 1135, Anderson's worked
examples, and the Cessna 172S POH. Each shows published value, model value,
difference, tolerance and status, computed live in the browser. Below them are the
172S POH's climb, takeoff, landing and cruise tables, all 429 cells, each coloured by
the model's error.

Every figure has a role, because "matches published data" means different things:

| Role | Meaning |
|---|---|
| Reference | A standard or textbook value the physics must reproduce |
| Calibration | A figure a parameter was fitted to. Reproducing it proves the fit, not the model |
| Check | A figure the fit never saw. These are the real test |
| Known discrepancy | A miss pinned to a band, with its cause, not tuned away |

The figures live in one dataset, `src/data/validation/cases.ts`. The page renders it
and `tests/published.test.ts` asserts it, so the two can't disagree. The page also
shows the last run of the independent Python implementation, and CI runs both on
every push.

What the 172S comparison says, in brief:

- **Range and endurance:** Anderson's worked examples (*Introduction to Flight*, 8th
  ed.), reproduced to within 0.25 %: the propeller CP-1 (Example 6.19, 1,207 mi and
  14.4 h) and the CJ-1 jet CP-2 (Example 6.20, 3,630 mi and 13.3 h).
- **Limits:** `V_A` at all three published weights within 1.3 kt, never fitted.
- **Cruise at a set power:** 105 of the POH's 111 cruise speeds within 3 %, mean
  −0.7 %, from one fitted figure; the six misses are low power on hot days high up.
  Fuel flow within 2 % in every cell. Range and time aloft at 75 % and 45 % power,
  counted the POH's way, within 2.6 %.
- **Climb:** within 4 % at sea level; up to 13 % low at altitude on cold days.
- **Takeoff:** 14–21 % short, a pinned discrepancy. The growth with density altitude
  is right to 7 %, which is what a hot-and-high calculation needs.
- **Landing ground roll:** 21 % short, uniformly: Gudmundsson's braking coefficient
  for dry pavement (0.4) against the 0.29 the POH implies.

## Running it

```bash
npm install
npm run dev          # the explorer at http://localhost:5173, validation at /validation.html
npm test             # 434 tests
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
| `src/physics/aero.ts` | Parabolic drag polar, power on and power off (a windmilling propeller's drag), stall speed, and closed-form characteristic speeds |
| `src/physics/performance/curves.ts` | Drag, thrust required, power required and L/D curves, with characteristic-speed markers at any load factor |
| `src/physics/performance/turn.ts` | Level-turn load factor, radius and rate; lift-limited and sustained load factor, corner speed |
| `src/physics/performance/vn.ts` | The V-n diagram: manoeuvre envelope by category, former 14 CFR 23.341 gust lines, design envelope |
| `src/physics/performance/energy.ts` | Specific excess power at any load factor, and energy height |
| `src/physics/performance/range.ts` | Breguet's constant-CL cruise integrated with the engine's fuel-flow line, at the best CL; the payload–range diagram |
| `src/physics/performance/cruise.ts` | Level flight at a set power or thrust: the POH's cruise |
| `src/physics/performance/field.ts` | Takeoff and landing over 50 ft by Raymer's method, ground runs integrated exactly; runway friction for seven surfaces |
| `src/physics/propulsion.ts` | Piston (Gagg–Farrar with the hot-day correction, turbocharged), turboprop and turbofan lapse; propeller thrust that is finite at zero speed; fuel flow a straight line in output |
| `src/physics/performance/climb.ts` | Exact steady climb and the small-angle form; V_y, V_x, maximum level speed; absolute and service ceilings |
| `src/physics/performance/glide.ts` | Glide from the polar: best glide, minimum sink, best glide in wind, the sink polar |
| `src/data/aircraft/presets.ts` | Id-keyed preset registry — ids are part of the URL format, so treat them as append-only |
| `src/state/url.ts` | Scenario permalinks: delta-encoded, and decoding never throws |
| `src/app/model.ts` | Everything the charts draw, as pure functions: axis conversions, the fixed chart window, sampled curves |
| `src/app/permalink.ts` | View settings in the URL, and delta encoding for edited presets |
| `src/app/envelope.ts`, `runway.ts`, `cruise.ts`, `contour.ts` | The envelope, takeoff and range tabs' models, and marching-squares contours |
| `src/app/compare.ts` | The second aircraft: same condition, same MTOW fraction, and the side-by-side table |
| `src/app/sensitivity.ts` | Elasticities by central difference, ranked, with a templated sentence |
| `src/app/working.ts`, `expression.ts` | The working behind each tile: formulas in a small expression language, evaluated and drawn from one parse |
| `src/data/validation/` | The validation dataset, the POH tables, and the cross-check's last run |
| `src/app/components/` | React controls, readouts, and the uPlot chart with its marker overlays |

434 tests, covering the published ISA table at five altitudes, layer continuity,
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

**Calibrated on some published numbers, checked on others.** Each fitted parameter of
the Cessna 172S comes from one POH figure:
- CLmax: the clean and full-flap stall speeds
- Oswald e and CD₀ power off: best glide, 68 KIAS at 9:1, propeller windmilling
- CD₀ power on: 124 KTAS at 75 % power and 8,500 ft
- the propeller's full-throttle thrust line: best rate of climb, 730 ft/min at 74 KIAS

The two CD₀s, 0.052 and 0.0326, differ by the windmilling propeller: a fixed-pitch
propeller at idle is a drag brake. One polar fitted to the glide, as earlier versions
had, left powered flight 17 % slow at a set power. Figures the fit never saw then test
it: V_x comes out at 60.0 kt against the published 62.

**Known model limits are pinned, not hidden.** The 172S's maximum level speed comes
out at 117.4 KTAS against the published 126, 7 % low. Full throttle runs on a straight
thrust line fitted to the climb, and a fixed-pitch propeller's RPM, and so its power,
rise with airspeed in a way a straight line can't follow. The service ceiling, 14,215 ft
against a rounded 14,000, is pinned the same way. Tests pin the size of each error
rather than retuning it away. The polar has no wave
drag either, so the charts shade everything above Mach 0.7, draw nothing past Mach
0.9, and flag any climb speed or ceiling that depends on that regime as optimistic.

**Hot days, corrected.** Gagg–Farrar was first fed the actual density, so power fell
as 1/T on a hot day: twice the engine makers' 1/√T. The POH's climb table showed it,
with the hot cells off by up to 66 %. Power is now Gagg–Farrar at the standard day's
density for the pressure altitude, times √(T_std/T); the worst hot cell is now within
7 %, and standard days didn't change.

**Field lengths are textbook, and say so.** Takeoff and landing use Raymer's speeds
and segments with the ground runs integrated exactly, and nothing is fitted to the
POH's distances. Where they miss, the miss is pinned with its cause, the same way as
`V_max`.

**No Web Worker.** The roadmap planned one for the P_s map. At 96 × 72 points the grid
builds in about 4 ms and is cached per aircraft, weight and day, so a worker would
add a message protocol and buy nothing.

**A propeller with finite static thrust.** The textbook `T = ηP/V` goes to infinity
at zero speed, and a constant-efficiency propeller puts the 172's V_y down at the
stall with 1,190 ft/min. Thrust here falls in a straight line from its static value,
capped so efficiency never exceeds 1. That is the simplest model that puts V_y where
a fixed-pitch propeller does.

## Physics references

- ISO 2533 / US Standard Atmosphere 1976 — atmospheric model
- Anderson, *Aircraft Performance and Design* — drag polar, characteristic speeds
- Hull, *Fundamentals of Airplane Flight Mechanics* — climb and cruise formulations
- Raymer, *Aircraft Design: A Conceptual Approach*, §17.8–17.9 — takeoff and landing
- Gudmundsson, *General Aviation Aircraft Design* (2014) — runway friction coefficients
- 14 CFR Part 23 before Amendment 23-64 (2017) (§23.333, §23.335, §23.341, §23.1505) — the V-n diagram, gusts and V_NE. The current Part 23 is performance-based and accepts ASTM F3116 for these loads; the classic rules are what today's light aircraft were certificated to

Aircraft parameters in `src/data/aircraft/` are simplified representative figures for
education, not certification data.
