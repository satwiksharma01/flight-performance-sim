/**
 * /validation: the model against published data, computed live.
 *
 * Every row comes from src/data/validation/cases.ts, the same dataset
 * tests/published.test.ts asserts, evaluated here by the same physics the
 * explorer runs. The independent-implementation table is the last recorded
 * run of validation/reference.py, which can't run in a browser.
 */

import { useEffect, useMemo } from 'react';
import { CASES, GROUPS, evaluate, type Role, type ValidationCase } from '../data/validation/cases.js';
import { CROSS_CHECK } from '../data/validation/cross-check.generated.js';
import { POH_SOURCE, POH_TABLES, compareTable, summarise, type CellResult, type PohTable } from '../data/validation/poh-c172s.js';

const REPO_URL = 'https://github.com/satwiksharma01/flight-performance-sim';

const ROLE: Record<Role, { readonly label: string; readonly meaning: string }> = {
  reference: { label: 'Reference', meaning: 'A standard or textbook value the physics must reproduce.' },
  calibration: {
    label: 'Calibration',
    meaning: 'A figure a parameter was fitted to. Reproducing it proves the fit, not the model.',
  },
  check: { label: 'Check', meaning: 'A figure the fit never saw. These are the real test.' },
  discrepancy: { label: 'Known discrepancy', meaning: 'A miss the model is known to make, pinned with its cause rather than tuned away.' },
};

const QUANTITY_LABEL: Record<string, string> = {
  T: 'Temperature',
  p: 'Pressure',
  rho: 'Density',
  a: 'Speed of sound',
  EAS: 'Equivalent airspeed',
  Mach: 'Mach number',
  mu: 'Viscosity',
  'pressure alt [m]': 'Pressure altitude',
  'density alt [m]': 'Density altitude',
  'CAS, M<1': 'CAS, subsonic',
  'CAS, M>=1': 'CAS, supersonic (Rayleigh)',
  vs: 'Stall speed',
  ldmax: '(L/D)max',
  d60: 'Drag at 60 m/s',
  vmd: 'V_md against a minimiser',
  vmp: 'V_mp against a minimiser',
  vjr: 'V_jr against a minimiser',
  'engine lapse': 'Engine lapse',
  thrust: 'Thrust available',
  'climb angle': 'Climb angle against a root-finder',
  V_y: 'Best rate-of-climb speed',
  V_x: 'Best angle-of-climb speed',
  'ROC at V_y': 'Best rate of climb',
  V_max: 'Maximum level speed',
  'ceilings [m]': 'Absolute and service ceilings',
  'best glide': 'Best glide',
  'min-sink speed': 'Minimum-sink speed',
  'min sink': 'Minimum sink rate',
  'glide into wind': 'Best glide into wind',
  'V-n speeds': 'V_s, V_A and the negative corner, against a root-finder',
  'V-n boundaries': 'V-n envelope and gust lines, from their vertices',
  'gust factor': 'Gust alleviation factor',
  'turn load factor': 'Lift-limited and sustained load factor',
  'specific excess power': 'Specific excess power',
  'takeoff distances': 'Takeoff distances, integrated in time',
  'landing distances': 'Landing distances, integrated in time',
};

/** Quantities compared as an absolute difference, and its unit; the rest are relative. */
const ABSOLUTE_UNIT: Record<string, string> = {
  'pressure alt [m]': 'm',
  'density alt [m]': 'm',
  'ceilings [m]': 'm',
  'climb angle': 'rad',
  'V-n boundaries': 'g',
};

const QUANTITY_NOTE: Record<string, string> = {
  mu: 'Two published forms of Sutherland’s law, β T^1.5/(T+S) and μ₀ (T/T₀)^1.5 (T₀+S)/(T+S), differ at this level.',
};

function fmt(value: number, decimals: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** A small number as 3.4e-6; zero as 0. */
function sci(value: number): string {
  if (value === 0) return '0';
  const [mantissa, exponent] = value.toExponential(1).split('e');
  return `${mantissa}e${Number(exponent)}`;
}

/** The difference as people read it: percent when it's material, scientific when it's tiny. */
function relativeText(relative: number): string {
  const abs = Math.abs(relative);
  if (abs === 0) return 'exact';
  if (abs >= 1e-3) return `${relative > 0 ? '+' : '−'}${fmt(abs * 100, abs >= 0.01 ? 1 : 2)} %`;
  return `${relative > 0 ? '+' : '−'}${sci(abs)}`;
}

function toleranceText(c: ValidationCase): string {
  if (c.band) return `pinned ${fmt(c.band[0], 0)}–${fmt(c.band[1], 0)} ${c.unit}`.trim();
  return 'absolute' in c.tolerance
    ? `±${fmt(c.tolerance.absolute, c.tolerance.absolute < 1 ? Math.max(1, -Math.floor(Math.log10(c.tolerance.absolute))) : 0)} ${c.unit}`.trim()
    : `±${sci(c.tolerance.relative)}`;
}

function Status({ pass, discrepancy }: { pass: boolean; discrepancy: boolean }) {
  if (!pass) {
    return (
      <span className="status-chip status-chip--critical">
        <span aria-hidden="true">✕</span> outside
      </span>
    );
  }
  if (discrepancy) {
    return (
      <span className="status-chip status-chip--warning">
        <span aria-hidden="true">▲</span> pinned
      </span>
    );
  }
  return (
    <span className="status-chip status-chip--good">
      <span aria-hidden="true">✓</span> within
    </span>
  );
}

function CaseTable({ cases }: { cases: readonly (ValidationCase & { result: ReturnType<typeof evaluate> })[] }) {
  return (
    <div className="table-scroll">
      <table className="validation-table">
        <thead>
          <tr>
            <th scope="col">Quantity</th>
            <th scope="col">Role</th>
            <th scope="col" className="n">
              Published
            </th>
            <th scope="col" className="n">
              Model
            </th>
            <th scope="col" className="n">
              Difference
            </th>
            <th scope="col">Tolerance</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr key={c.id} className={c.role === 'check' ? 'is-check' : undefined}>
              <th scope="row">
                <span className="quantity">{c.quantity}</span>
                <span className="condition">{c.condition}</span>
                {c.note && <span className="case-note">{c.note}</span>}
              </th>
              <td>
                <span className={`role role--${c.role}`} title={ROLE[c.role].meaning}>
                  {ROLE[c.role].label}
                </span>
              </td>
              <td className="n">
                {fmt(c.published, c.decimals)} <span className="dim">{c.unit}</span>
              </td>
              <td className="n">
                {fmt(c.result.model, c.decimals)} <span className="dim">{c.unit}</span>
              </td>
              <td className="n">{relativeText(c.result.relative)}</td>
              <td className="dim">{toleranceText(c)}</td>
              <td>
                <Status pass={c.result.pass} discrepancy={c.role === 'discrepancy'} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Error bins for the POH grids: within 5, 10, 20 % and beyond. */
function errorClass(error: number | null): string {
  if (error === null) return 'err err--none';
  const e = Math.abs(error);
  return `err err--${e < 0.05 ? 0 : e < 0.1 ? 1 : e < 0.2 ? 2 : 3}`;
}

const POH_NOTE: Record<PohTable['id'], string> = {
  climb:
    'Good at sea level, 10–18 % low at altitude on cold days. The hot side is close since the engine lapse was corrected for temperature in v0.5: before, the hot cells missed by up to 66 %.',
  'takeoff-roll':
    '11–20 % short everywhere, worsening with heat: a fixed shortfall in low-speed thrust, plus a temperature effect still a little weak.',
  'takeoff-total': 'The ground roll’s shortfall carried through, and a climb to 50 ft a little steeper than the POH’s.',
  'landing-roll':
    'A uniform 20–24 % short at every altitude and temperature: the braking coefficient (0.4 here, about 0.29 in the POH), not the density effect.',
  'landing-total':
    'Within 11 %, but partly by compensation: the 3° approach is longer than the POH’s steeper power-idle one, and the braking shorter. Read the ground roll, not this.',
};

function PohGrid({ table, cells }: { table: PohTable; cells: readonly CellResult[] }) {
  const summary = summarise(cells);
  const at = (h: number, t: number) => cells.find((c) => c.altitude === h && c.temperature === t);
  const pct = (e: number) => `${e > 0 ? '+' : e < 0 ? '−' : ''}${Math.abs(e * 100).toFixed(0)}`;
  return (
    <div className="poh-grid">
      <h3>{table.title}</h3>
      <p className="card-sub">
        {table.conditions} Mean {pct(summary.mean)} %, from {pct(summary.min)} to {pct(summary.max)} % over {summary.cells} cells.
      </p>
      <div className="table-scroll">
        <table className="validation-table poh-table">
          <thead>
            <tr>
              <th scope="col" title="Pressure altitude [ft] by OAT [°C]">ft \ °C</th>
              {table.temperatures.map((t) => (
                <th key={t} scope="col" className="n">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.altitudes.map((h) => (
              <tr key={h}>
                <th scope="row">{h === 0 ? 'SL' : h.toLocaleString('en-US')}</th>
                {table.temperatures.map((t) => {
                  const cell = at(h, t);
                  if (!cell) return <td key={t} className="n dim">–</td>;
                  return (
                    <td
                      key={t}
                      className={`n ${errorClass(cell.error)}`}
                      title={`Model ${cell.model === null ? '–' : Math.round(cell.model).toLocaleString('en-US')}, POH ${cell.published.toLocaleString('en-US')} ${table.unit}`}
                    >
                      {cell.error === null ? 'n/a' : `${pct(cell.error)} %`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="card-foot">{POH_NOTE[table.id]}</p>
    </div>
  );
}

export function ValidationPage() {
  const evaluated = useMemo(() => CASES.map((c) => ({ ...c, result: evaluate(c) })), []);

  const counted = (role: Role) => evaluated.filter((c) => c.role === role);
  const notDiscrepancy = evaluated.filter((c) => c.role !== 'discrepancy');
  const passing = notDiscrepancy.filter((c) => c.result.pass).length;
  const checks = counted('check');
  const crossPassing = CROSS_CHECK.checks.filter((c) => c.pass).length;
  // Distinct documents: a source is cited by section, so count what precedes the first comma or bracket.
  const sources = new Set(evaluated.map((c) => c.source.split(/[,(]/)[0]!.trim())).size;

  // The page renders after load, so follow a #fragment once it exists.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
  const discrepancies = counted('discrepancy').length;
  const checksPassing = checks.filter((c) => c.result.pass).length;
  const worstCheck = Math.max(...checks.map((c) => Math.abs(c.result.relative)));
  const pohCells = useMemo(() => POH_TABLES.map((table) => ({ table, cells: compareTable(table) })), []);
  const pohCount = pohCells.reduce((n, t) => n + t.cells.length, 0);

  return (
    <div className="app validation">
      <header className="top">
        <div>
          <p className="eyebrow">
            <a href="./">Flight Performance Simulator</a>
          </p>
          <h1>Validation</h1>
          <p className="tagline">
            The model against published data, computed live in your browser by the same code the explorer runs. Every
            row below is also asserted by the test suite, from the same dataset.
          </p>
        </div>
        <div className="top-actions">
          <a className="button" href="./">
            Open the explorer
          </a>
          <a className="button button--quiet" href={`${REPO_URL}/blob/master/src/data/validation/cases.ts`} target="_blank" rel="noreferrer">
            Dataset
          </a>
        </div>
      </header>

      <div className="tiles">
        <div className="card tile">
          <span className="tile-label">Published figures</span>
          <span className="tile-value">{evaluated.length}</span>
          <span className="tile-sub">from {sources} sources</span>
        </div>
        <div className="card tile">
          <span className="tile-label">Within tolerance</span>
          <span className="tile-value">
            {passing} of {notDiscrepancy.length}
          </span>
          <span className="tile-sub">
            plus {discrepancies} known {discrepancies === 1 ? 'discrepancy' : 'discrepancies'}, pinned
          </span>
        </div>
        <div className="card tile">
          <span className="tile-label">Checks the fit never saw</span>
          <span className="tile-value">
            {checksPassing} of {checks.length}
          </span>
          <span className="tile-sub">worst {(worstCheck * 100).toFixed(1)} %, and {pohCount} POH table cells below</span>
        </div>
      </div>

      <section className="card legend-card" aria-labelledby="roles-h">
        <h2 id="roles-h">How to read this</h2>
        <dl className="roles">
          {(Object.keys(ROLE) as Role[]).map((role) => (
            <div key={role}>
              <dt>
                <span className={`role role--${role}`}>{ROLE[role].label}</span>
              </dt>
              <dd>{ROLE[role].meaning}</dd>
            </div>
          ))}
        </dl>
      </section>

      {GROUPS.map((group) => (
        <section key={group.id} id={group.id} className="card table-card" aria-labelledby={`${group.id}-h`}>
          <h2 id={`${group.id}-h`}>{group.title}</h2>
          <p className="card-sub">{group.intro}</p>
          <CaseTable cases={evaluated.filter((c) => c.group === group.id)} />
          <p className="card-foot">Source: {[...new Set(evaluated.filter((c) => c.group === group.id).map((c) => c.source))].join('; ')}.</p>
        </section>
      ))}

      <section className="card table-card" aria-labelledby="poh-h" id="poh-tables">
        <h2 id="poh-h">Cessna 172S POH tables, every cell</h2>
        <p className="card-sub">
          The single figures above are the headlines. These are the rest of the evidence: the POH&apos;s climb, takeoff and
          landing tables at 2,550 lb, transcribed whole, with the model&apos;s error in each cell. Nothing here was fitted,
          and no cell is left out. Hover a cell for both values.
        </p>
        <div className="err-key" aria-hidden="true">
          <span className="err err--0">within 5 %</span>
          <span className="err err--1">5–10 %</span>
          <span className="err err--2">10–20 %</span>
          <span className="err err--3">over 20 %</span>
        </div>
        {pohCells.map(({ table, cells }) => (
          <PohGrid key={table.id} table={table} cells={cells} />
        ))}
        <p className="card-foot">Source: {POH_SOURCE}. The pattern of every table is pinned by tests/poh-tables.test.ts.</p>
      </section>

      <section className="card table-card" aria-labelledby="cross-h">
        <h2 id="cross-h">Independent implementation</h2>
        <p className="card-sub">
          <code>validation/reference.py</code> rebuilds the core in Python from the standards, not from the TypeScript:
          the atmosphere integrated layer by layer, CAS by root-solving the pitot relation, characteristic speeds and
          climb optima by numerical minimisation, the exact climb as a root of its force balance, ceilings by
          root-finding. It sweeps {CROSS_CHECK.sweep}, and reports the worst disagreement for each quantity.
        </p>
        <div className="table-scroll">
          <table className="validation-table">
            <thead>
              <tr>
                <th scope="col">Quantity</th>
                <th scope="col" className="n">
                  Worst disagreement
                </th>
                <th scope="col">Tolerance</th>
                <th scope="col">Where</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {CROSS_CHECK.checks.map((c) => {
                const unit = ABSOLUTE_UNIT[c.quantity];
                const note = QUANTITY_NOTE[c.quantity];
                return (
                  <tr key={c.quantity}>
                    <th scope="row">
                      <span className="quantity">{QUANTITY_LABEL[c.quantity] ?? c.quantity}</span>
                      <span className="condition">{unit ? `absolute, ${unit}` : 'relative'}</span>
                      {note && <span className="case-note">{note}</span>}
                    </th>
                    <td className="n">{sci(c.worst)}</td>
                    <td className="dim">{sci(c.limit)}</td>
                    <td className="dim where">{c.where || 'every point exact'}</td>
                    <td>
                      <Status pass={c.pass} discrepancy={false} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="card-foot">
          {crossPassing} of {CROSS_CHECK.checks.length} within tolerance. Last recorded run {CROSS_CHECK.ranOn}, Python{' '}
          {CROSS_CHECK.python}, SciPy {CROSS_CHECK.scipy}. Run it yourself with <code>npm run validate</code>.
        </p>
      </section>

      <section className="card table-card" aria-labelledby="limits-h">
        <h2 id="limits-h">What the model does not do</h2>
        <ul className="limits">
          <li>
            <strong>The polar is parabolic,</strong> C<sub>D</sub> = C<sub>D0</sub> + kC<sub>L</sub>², with constant
            C<sub>D0</sub>: no Reynolds-number effects, and no growth of profile drag with C<sub>L</sub>. Fitted at one
            point, it can be off elsewhere; the 172S&apos;s maximum speed is the case shown above.
          </li>
          <li>
            <strong>No wave drag.</strong> Charts shade everything past Mach 0.7 and draw nothing past 0.9. Climb results
            that depend on that regime are flagged as optimistic.
          </li>
          <li>
            <strong>Full power only,</strong> through a propeller whose thrust falls in a straight line from its static
            value. There are no part-power settings yet, so no cruise, range or endurance.
          </li>
          <li>
            <strong>No flap or gear drag.</strong> Flaps change only the stall speed, which is part of why the takeoff
            and landing distances run short.
          </li>
          <li>
            <strong>Takeoff and landing are first-order,</strong> by Raymer&apos;s method: textbook speed ratios, one
            second of rotation and of free roll, a 3° approach, Gudmundsson&apos;s tabulated friction, no ground effect
            and no runway slope.
          </li>
          <li>
            <strong>The V-n diagram is clean-wing only,</strong> with the gust lift slope from the aspect ratio alone and
            the negative-stall C<sub>L</sub> assumed where it isn&apos;t published.
          </li>
          <li>
            <strong>The ISA deviation holds through the whole column,</strong> and true altitude assumes 1013.25 hPa at
            sea level.
          </li>
          <li>
            <strong>Climb is steady and wings level; turns are level.</strong> Specific excess power shows the energy
            picture, but nothing is integrated through time: no climb schedules flown, no climbing turns.
          </li>
          <li>
            <strong>CAS, not IAS.</strong> Position error is aircraft-specific calibration data, and isn&apos;t
            modelled.
          </li>
        </ul>
      </section>

      <footer className="footer">
        <p>
          Aircraft figures are simplified and representative, for education, not certification data. Not for operational
          use.
        </p>
      </footer>
    </div>
  );
}
