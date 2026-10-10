# Aerospace Flight Performance Simulator — Revised Plan

A revision of the original design doc. Sections marked **[CHANGE]** depart from the
original, **[ADD]** is new scope, **[CUT]** is removed scope.

---

## 0. The one-line identity

> A browser-native aircraft performance analysis tool whose physics core is
> independently cross-validated against a second implementation and against
> published aircraft data.

Everything below serves that sentence. The differentiator is not "it has graphs" —
thousands of repos have graphs. It is **provable correctness** plus **the plots only
a performance engineer knows to draw** (flight envelope, V-n diagram, Ps contours).

---

## 1. Architecture [CHANGE] — cut the Python backend from the MVP

The original stack was Next.js → FastAPI → NumPy/SciPy. Drop the service:

1. **No computation needs it.** Every equation in the original doc is closed-form
   algebra. NumPy and SciPy buy nothing. The heaviest MVP workload is evaluating a
   drag polar at 200 velocities — microseconds in JavaScript.

2. **It kills the headline feature.** §18 promises real-time sliders. A network round
   trip is 50–300 ms; continuous feedback needs <16 ms. You would be forced to
   debounce, and "immediate feedback" — the entire reason this beats a spreadsheet —
   dies.

3. **It makes the project un-runnable for visitors.** Two processes, CORS, a
   Dockerfile, a hosting bill. A reviewer gives a repo about 40 seconds. A dead
   free-tier backend link is worse than no link at all.

### Revised structure

```
flight-performance-simulator/
├── src/
│   ├── physics/              # ZERO dependencies. No React, no Next. Pure TS.
│   │   ├── units.ts          # branded types + conversions
│   │   ├── atmosphere.ts     # ISA to 32 km, dISA offset, density altitude
│   │   ├── airspeed.ts       # TAS/EAS/CAS/Mach
│   │   ├── aero.ts           # drag polar, CL, closed-form optima
│   │   ├── propulsion.ts     # piston / turboprop / turbofan lapse
│   │   ├── performance/
│   │   │   ├── climb.ts      # exact + small-angle ROC, ceilings
│   │   │   ├── glide.ts      # best glide distance vs min sink
│   │   │   ├── cruise.ts     # Breguet range & endurance, 4 cases
│   │   │   ├── field.ts      # takeoff & landing ground roll
│   │   │   ├── maneuver.ts   # load factor, turn rate/radius, V-n
│   │   │   └── envelope.ts   # Ps contours, envelope boundary
│   │   └── sensitivity.ts    # finite-difference d(output)/d(input)
│   ├── app/                  # Vite + React single page (was: Next.js routes)
│   │   └── components/
│   └── data/aircraft/        # presets as plain JSON
├── validation/               # Python. The backend, repurposed.
│   ├── reference.py          # independent NumPy implementation
│   ├── test_vs_isa_table.py  # vs published ISA tables
│   ├── test_vs_typescript.py # cross-check both implementations
│   └── test_vs_poh.py        # vs manufacturer published performance
└── tests/                    # Vitest, unit tests of the TS core
```

**Keep Python — repurpose it.** Instead of a CRUD API it becomes an *independent
second implementation* that cross-validates the TypeScript core to 1e-9. This is what
safety-critical aerospace software actually does (dissimilar redundant
implementations, DO-178C). It is a far stronger engineering story than
`POST /simulate` returning one lift number, and NumPy still appears in the repo.

**When a backend earns its place (later):** mission-profile numerical integration, Ps
sweeps over 200×200 grids, trajectory optimization. Real compute. Not before.

The physics core having zero dependencies is deliberate — it can ship as a standalone
npm package, which is a second portfolio artifact for free.

---

## 2. Physics corrections [CHANGE]

Places where the original model is wrong or incomplete enough that a knowledgeable
reviewer would find the hole.

### 2.1 The ISA model stops too low

The original gives only `T = T0 - Lh` (troposphere), but §23 puts a slider at 12 km.
Above 11 km that formula is wrong — the stratosphere is isothermal.

Implement layered ISA to at least 32 km:

| Layer | Base alt | Base T | Lapse rate |
|---|---|---|---|
| Troposphere  | 0 m      | 288.15 K | −6.5 K/km |
| Tropopause   | 11 000 m | 216.65 K | 0 (isothermal) |
| Stratosphere | 20 000 m | 216.65 K | +1.0 K/km |
| Stratosphere | 32 000 m | 228.65 K | +2.8 K/km |

- Gradient layer: `p = p_b * (T/T_b)^(-g0/(L*R))` → exponent 5.25588 in troposphere
- Isothermal layer: `p = p_b * exp(-g0*(h-h_b)/(R*T_b))`

Constants: `g0 = 9.80665`, `R = 287.05287`, `gamma = 1.4`, `T0 = 288.15`,
`p0 = 101325`, `rho0 = 1.225`.

Also add:

- **Geopotential vs geometric altitude:** `h_geopot = R_E*h/(R_E + h)`, R_E = 6 356 766 m.
  Small, but the kind of detail that signals you read the actual standard.
- **Non-standard day (ΔISA offset).** Hot day → lower density → worse performance.
  This is the entire reason density altitude exists, and it is absent from the original.
- **Density altitude** as a headline output — the pressure altitude at which standard
  density equals actual density. Pilots care about this number more than any other in
  the document.

### 2.2 Airspeed is treated as a single number [ADD] — the biggest conceptual gap

Real performance work distinguishes TAS, EAS, CAS, IAS and Mach. The original uses one
`velocity` everywhere. Consequences:

- Stall speed is **constant in EAS** but **rises with altitude in TAS**. That is a
  genuinely surprising, genuinely educational result the current model cannot express.
- Every chart axis is ambiguous. Drag vs TAS and drag vs EAS are different curves —
  and drag vs EAS collapses onto a single altitude-independent line, a beautiful
  teaching moment that is invisible without the distinction.

```
sigma = rho / rho0
EAS   = TAS * sqrt(sigma)
Mach  = TAS / sqrt(gamma * R * T)
CAS   via the compressible impact-pressure relation (subsonic St-Venant)
```

Add a TAS/EAS/CAS toggle on every chart axis, and a unit toggle (m/s, kt, km/h, Mach).
This single addition is what moves the tool from "student calculator" to "made by
someone who understands flight."

### 2.3 Use the closed-form optima, do not scan [CHANGE]

The original implies numerically scanning curves for optima. The analytic results
exist, are exact, are instant, and prove you did the derivation:

```
k        = 1 / (pi * e * AR)
CL_md    = sqrt(CD0 / k)                       # min-drag lift coefficient
(L/D)max = 1 / (2*sqrt(CD0*k))
D_min    = 2*W*sqrt(CD0*k)
V_md     = sqrt(2W/(rho*S)) * (k/CD0)^0.25     # min drag / max L/D / best glide
V_mp     = V_md / 3^0.25  ~= 0.760 * V_md      # min power required
V_jr     = V_md * 3^0.25  ~= 1.316 * V_md      # jet best range
```

Use these to place labelled markers on the curves. Fall back to numerics only where no
closed form exists (e.g. ceiling with a nonlinear thrust lapse).

### 2.4 The climb formula is an unlabelled approximation [CHANGE]

`ROC = (P_A - P_R)/W` assumes a small climb angle and `L = W`. Exact steady climb:

```
L = W*cos(gamma)
T - D - W*sin(gamma) = 0
ROC = V*sin(gamma)
```

Solve by fixed-point iteration (converges in ~3 passes). For a Cessna the error is
under 1 %; for a fighter at 30° climb it is ~13 %. Implement the exact solution, keep
the approximation behind a toggle, and **display the difference** — that turns a
caveat into a feature.

### 2.5 Propulsion is too naive for ceiling calculations [CHANGE]

Without altitude lapse, service ceiling is meaningless. Minimum viable models:

- **Piston, normally aspirated** (Gagg–Farrar): `P/P0 = 1.132*sigma - 0.132`
- **Piston, turbocharged:** flat to critical altitude, then lapse
- **Turbofan:** `T/T0 = sigma^m`, m ≈ 0.7 (high bypass) to 1.0
- **Propeller efficiency is not constant.** At minimum use `eta(J)` or a simple falloff
  curve. Note the real bug you will hit: `T = P/V` diverges as `V → 0`, so plotting
  from zero velocity produces infinite thrust. Cap it with a static-thrust model, or
  start plots at `0.3*V_stall`.

### 2.6 Range and endurance are hand-waved [CHANGE]

One of the richest teaching payloads in flight performance, and the key insight — that
each case optimizes a *different* aerodynamic parameter — is missing:

|            | Max range             | Max endurance          |
|------------|-----------------------|------------------------|
| Propeller  | max L/D (V_md)        | max CL^1.5/CD (V_mp)   |
| Jet        | max CL^0.5/CD (V_jr)  | max L/D (V_md)         |

```
Prop range:      R = (eta/c) * (L/D) * ln(W0/W1)
Prop endurance:  E = (eta/c) * (CL^1.5/CD) * sqrt(2*rho*S) * (W1^-0.5 - W0^-0.5)
Jet range:       R = (2/ct) * sqrt(2/(rho*S)) * (CL^0.5/CD) * (sqrt(W0) - sqrt(W1))
Jet endurance:   E = (1/ct) * (L/D) * ln(W0/W1)
```

**Feature:** plot all three optimum speeds as markers on one drag curve, then let the
user flip between jet and prop and watch which marker becomes "best." A better teaching
moment than any AI-generated explanation.

### 2.7 Glide: distinguish best glide from minimum sink [CHANGE]

The original §16 mentions only L/D. Two different speeds matter:

- **Best glide distance** at `V_md` (max L/D) — go the farthest
- **Minimum sink rate** at `V_mp` — stay up the longest

`glide range = altitude * (L/D)`, `tan(gamma) = 1/(L/D)`. Add a wind-corrected glide
option (a headwind pushes best-glide speed up) — genuinely practical.

---

## 3. New scope worth adding [ADD]

Each is high-visual-impact and none is more than a few hundred lines.

### 3.1 V-n diagram / maneuvering envelope
Load factor limits, stall boundaries (`n = (V/V_s)^2`), corner speed
`V_A = V_s*sqrt(n_max)`, gust lines, never-exceed speed. Instantly recognisable to
anyone in aerospace. Probably the best value-per-line-of-code feature available.

### 3.2 Turn performance
```
n = L/W
turn radius: R = V^2 / (g*sqrt(n^2 - 1))
turn rate:   omega = g*sqrt(n^2 - 1) / V
```
Bounded by CLmax, thrust available, and the structural limit. Feeds the doghouse plot.

### 3.3 Specific excess power (Ps) contours — the signature plot
```
Ps = V*(T - D)/W
```
Contoured over the altitude–Mach plane, with the `Ps = 0` line as the flight envelope
boundary. This is *the* plot that says "aerospace performance engineer." It is also the
first genuinely expensive computation (200×200 grid), which finally justifies a Web
Worker — and, later, a real backend.

### 3.4 Takeoff and landing [ADD to roadmap]
Listed in §1 of the original, then absent from every phase. Ground roll:
```
s_TO ~= 1.44*W^2 / (g*rho*S*CLmax*(T - D - mu*(W-L)))   evaluated at 0.7*V_LOF
V_LOF ~= 1.1 * V_stall
```
Plus obstacle-clearance distance. Pairs with density altitude to model hot-and-high
runway performance — a real safety topic and a compelling demo.

### 3.5 Payload–range diagram
The airliner classic. Break points at max payload, max fuel, and ferry.

---

## 4. Validation strategy [CHANGE] — the credibility multiplier

The original §28 says "test the ISA against known values" and stops. Go further and
make validation a *user-facing feature*:

1. **ISA table check** — vs published values at 0/5/11/20/32 km, assert < 0.1 % error.
2. **Cross-implementation check** — TypeScript vs the Python reference, agreement to
   1e-9 across a randomized sweep of the input space.
3. **Whole-aircraft check** — model output vs manufacturer published performance. For a
   Cessna 172S: stall speeds, service ceiling, sea-level ROC, glide ratio.
4. **Ship a `/validation` page** that renders this comparison live from the test
   fixtures — model vs published vs delta.

**Report the errors honestly, including where the simple model disagrees, and explain
why.** A drag polar with constant CD0 will miss real published numbers by some margin;
explaining *why* (fixed-gear interference drag, cooling drag, propeller efficiency
variation) demonstrates far more understanding than a table of suspiciously perfect
matches. This page is what no other student project has.

---

## 5. Units discipline [ADD]

Internally strict SI, always. UI in aviation units (kt, ft, fpm, lb, in·Hg, °C).

Use TypeScript branded types so a unit mix-up is a **compile error**:
```ts
type Metres = number & { readonly __brand: 'm' };
type Feet   = number & { readonly __brand: 'ft' };
```
Mention the Mars Climate Orbiter in the README. It is the right kind of engineering signal.

---

## 6. Cuts [CUT]

- **PostgreSQL, user profiles, saved simulations.** Replace with URL-encoded state:
  `?ac=c172&h=2000&v=55&dISA=15`. Shareable, bookmarkable, zero infrastructure, works
  offline. Every scenario becomes a permalink you can paste into a report.
- **Docker / docker-compose** for the MVP. A static export needs no container.
- **The AI explainer as an early goal.** What §33 describes ("increasing aspect ratio
  would reduce induced drag") is *deterministic sensitivity analysis*: perturb each
  input ±1 %, compute ∂output/∂input by finite difference, rank by influence, template
  a sentence. Always correct, no API key, no latency, works offline — and it is real
  numerical method. Add an LLM later, only for free-form Q&A, and only on top of
  computed results.

---

## 7. Roadmap [CHANGE] — vertical slices, not horizontal layers

The original six-phase plan builds all the physics before any visualization, so nothing
is demoable for weeks. Motivation dies there. Reorder so **every release is a complete,
deployed, shareable thing.**

### v0.1 — "It works and it's live" (one weekend)
- [x] Vite + React + TS, static build — *Vite, not Next.js: one page, no routes yet,
      and a plain static `dist/`. Plain CSS rather than Tailwind*
- [ ] Deployed — *the build is ready for any static host*
- [x] `units.ts` with branded types
- [x] ISA to 32 km + density altitude + ΔISA — *to 84 852 m*
- [x] Drag polar, CL required, stall speed
- [x] **One chart:** drag vs velocity, with V_md marked — *three charts, four markers*
- [x] **One slider:** altitude, updating live
- [x] Vitest tests for atmosphere and drag polar

Exit criterion: a public URL where a stranger drags a slider and watches a correct drag
curve move. A complete product at a tiny scope.

### v0.2 — Airspeed and the full curve set
- [x] TAS / EAS / CAS / Mach, with the axis toggle and a kt / m/s / km/h unit toggle
- [x] Thrust required, power required, L/D vs velocity
- [x] Closed-form optima as labelled markers (V_md, V_mp, V_jr)
- [x] Aircraft preset registry — *typed TS rather than JSON; ids are URL API*
- [x] URL state encoding — delta-encoded, non-throwing decode
- [x] Custom aircraft editor — *validated inline; edits stay delta-encoded in the URL*

### v0.3 — Propulsion and climb
- [x] Piston / turboprop / turbofan lapse models — *plus turbocharging; propeller
      thrust as a straight line from static thrust, capped at η = 1*
- [x] Exact climb solution + small-angle toggle showing the delta — *both drawn on
      the rate-of-climb chart, the difference stated in the Climb card*
- [x] ROC vs velocity, ROC vs altitude
- [x] Absolute and service ceiling
- [x] Glide: best distance vs minimum sink — *plus best glide in wind (physics), and
      the sink polar as a chart*

### v0.4 — The validation release *(the credibility release)*
- [x] Python reference implementation — *`validation/reference.py`, `npm run validate`*
- [x] Cross-implementation test — *1e-16 for closed forms; 1e-8 where an optimiser
      or root-finder sets the precision*
- [x] Cessna 172S validation vs published data — *calibrated on stall, glide and
      climb; checked on V_x and service ceiling; V_max discrepancy pinned*
- [x] Public `/validation` page — *`validation.html`, rendered live from the dataset the
      tests assert: 31 figures, 4 sources, roles reference / calibration / check /
      known discrepancy, plus the Python cross-check's last run*
- [x] CI running both test suites — *GitHub Actions: typecheck, tests, build,
      `npm run validate`*

### v0.5 — Envelope and maneuver *(the "wow" release)*
- [x] V-n diagram — *manoeuvre envelope (negative limit at V_D by category), former
      14 CFR 23.341 gust lines, design envelope;
      172S limits from its POH, `V_A` checked at three weights*
- [x] Turn performance — *instantaneous and sustained turn rate (the doghouse),
      corner speed, constant-radius lines*
- [x] Ps contours + flight envelope boundary — *96 × 72 grid in about 4 ms, cached,
      so no Web Worker; best-climb schedule and energy-height lines*
- [x] Takeoff / landing ground roll + density altitude effects — *Raymer's method,
      ground runs integrated exactly, seven runway surfaces, wind; checked cell by
      cell against the 172S POH tables, misses pinned with their causes*
- [x] *Found on the way:* the piston lapse overstated hot-day power loss twofold;
      corrected to the engine makers' √(T_std/T)

### v0.6 — Cruise and comparison
- [x] Breguet range/endurance, all four cases — *checked against an independent
      quadrature of the fuel burn to 1e-15, and against Anderson's published CP-1
      answers (Example 6.19: 1,207 mi, 14.4 h) to 0.25 %; CP-2 pending a verified
      source. An optimum slower than 1.2 V_s is held there (the 172's V_mp is
      below its stall)*
- [x] Payload–range diagram — *no zero-fuel-mass limit: max payload is the useful load*
- [ ] Cruise at set power, checked against the 172S POH cruise and range tables
      *(deferred from the Breguet item: needs a part-power fuel-flow model)*
- [x] Two-aircraft overlay comparison — *second aircraft fully editable (`vs.` keys),
      same condition at the same MTOW fraction, overlaid on the curves tab with a
      side-by-side table*
- [ ] Sensitivity analysis panel (finite-difference, deterministic)

### v1.0 — Polish
- [ ] Educational mode: click a result → the equation **with the actual numbers
      substituted**, not just symbols. The substitution is what makes it teach.
- [ ] Export chart as PNG / data as CSV
- [ ] Publish `physics/` as a standalone npm package

### Later — genuine backend territory
Mission-profile integration, envelope optimization, trajectory solving, Mach and
wave-drag effects, compressibility corrections.

---

## 8. Tooling decisions

- **Charts:** uPlot. Recharts re-renders too slowly for 60 fps slider dragging
  with multiple series; Plotly's bundle is ~3 MB. Engineering plots need log axes,
  custom markers and crosshairs — uPlot's draw hooks give all three.
- **Framework:** Vite + React. A single page with no routes doesn't need Next.js;
  revisit if `/validation` grows into a real second page.
- **Tests:** Vitest (TS) + pytest (Python reference).
- **Hosting:** static export, no server.
- **State:** the URL is the source of truth.

---

## 9. What makes this land as a portfolio project

Ranked by contribution:

1. The `/validation` page with honest error reporting against published data.
2. Ps contours / flight envelope — the plot only a performance engineer draws.
3. Dual-implementation cross-validation (TS + Python to 1e-9).
4. EAS/CAS/TAS correctness and density altitude — domain fluency.
5. V-n diagram — instantly recognisable, cheap to build.
6. Zero-dependency physics core, publishable as its own package.
7. Instant, permalinked, always online, because there is no backend to die.

The README should lead with a GIF of a slider moving and curves responding, then the
validation table. Those two things, in that order.
