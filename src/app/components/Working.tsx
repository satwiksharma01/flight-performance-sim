import { Fragment, type ReactNode } from 'react';
import { tokenize, type Token } from '../expression.js';
import { FIGURES, rounded, type Working } from '../working.js';

const GREEK: Record<string, string> = { rho: 'ρ', gamma: 'γ', sigma: 'σ', phi: 'φ', pi: 'π', eta: 'η', mdot: 'ṁ' };

const NAMED: Record<string, ReactNode> = {
  sin_gamma: 'sin γ',
  T_minus_D: 'T − D',
  eta_P_minus_D_V: 'η P − D V',
  RoC: 'RoC',
  C_D0off: (
    <>
      C<sub>D0, off</sub>
    </>
  ),
  dC_D0: (
    <>
      ΔC<sub>D0</sub>
    </>
  ),
};

/** A name as a symbol: Greek letters spelled out, and what follows an underscore as a subscript. */
export function Symbol({ name }: { name: string }) {
  const named = NAMED[name];
  if (named) return <>{named}</>;
  const [base = name, ...rest] = name.split('_');
  const symbol = GREEK[base] ?? base;
  return rest.length ? (
    <>
      {symbol}
      <sub>{rest.join(',')}</sub>
    </>
  ) : (
    <>{symbol}</>
  );
}

/** A number as the working shows it, to six figures. */
export function figure(value: number): string {
  return rounded(value).toLocaleString('en-US', { maximumSignificantDigits: FIGURES });
}

const FUNCTION_TEXT: Record<string, string> = { sqrt: '√', atan: 'tan⁻¹', ln: 'ln', cos: 'cos', sin: 'sin' };

/** Index of the bracket that closes the one at `open`. */
function closing(tokens: readonly Token[], open: number): number {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    if (tokens[i]!.text === '(') depth++;
    if (tokens[i]!.text === ')' && --depth === 0) return i;
  }
  return tokens.length - 1;
}

/** Lay out a formula: with symbols, or, given `values`, with the numbers in their place. */
function render(tokens: readonly Token[], values?: Readonly<Record<string, number>>): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const previous = tokens[i - 1];
    if (t.text === '^') {
      // Superscript the exponent: a number, a name, or a bracketed group without its brackets.
      let start = i + 1;
      const negative = tokens[start]?.text === '-';
      if (negative) start++;
      const end = tokens[start]?.text === '(' ? closing(tokens, start) : start;
      const inner = tokens[start]?.text === '(' ? tokens.slice(start + 1, end) : tokens.slice(start, end + 1);
      out.push(
        <sup key={i}>
          {negative && '−'}
          {render(inner, values)}
        </sup>,
      );
      i = end;
    } else if (t.kind === 'number') {
      out.push(t.text);
    } else if (t.kind === 'name') {
      const value = values?.[t.text];
      out.push(
        value === undefined ? <Symbol key={i} name={t.text} /> : value < 0 ? `(${figure(value)})` : figure(value),
      );
    } else if (t.kind === 'function') {
      out.push(FUNCTION_TEXT[t.text]);
    } else if (t.text === '-') {
      const unary = !previous || (previous.kind === 'op' && previous.text !== ')');
      out.push(unary ? '−' : ' − ');
    } else if (t.text === '*') {
      out.push(values ? ' × ' : ' ');
    } else if (t.text === '/' || t.text === '+') {
      out.push(` ${t.text} `);
    } else {
      out.push(t.text);
    }
  }
  return out.map((node, i) => <Fragment key={i}>{node}</Fragment>);
}

/** The button that opens a result's working. */
export function ShowWorking({ open, onToggle, controls }: { open: boolean; onToggle: () => void; controls: string }) {
  return (
    <button
      type="button"
      className="link-button working-toggle"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      onClick={onToggle}
    >
      {open ? 'Hide the working' : 'Show the working'}
    </button>
  );
}

/** The working behind one result: each step as a formula, with its numbers, and its result. */
export function WorkingCard({ working, onClose, id = 'working' }: { working: Working; onClose: () => void; id?: string }) {
  const values: Record<string, number> = Object.fromEntries([
    ...Object.entries(working.given).map(([name, g]) => [name, g.value] as const),
    ...working.steps.map((s) => [s.name, s.value] as const),
  ]);
  return (
    <section className="card working" id={id} aria-labelledby={`${id}-h`}>
      <div className="working-head">
        <h3 id={`${id}-h`}>{working.title}: the working</h3>
        <button type="button" className="button button--quiet" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="card-sub">{working.intro}</p>
      <ol className="working-steps">
        {working.steps.map((s) => {
          const tokens = tokenize(s.formula);
          return (
            <li key={s.name}>
              <div className="eq">
                <Symbol name={s.name} /> = {render(tokens)}
              </div>
              <div className="eq eq-numbers">= {render(tokens, values)}</div>
              <div className="eq">
                ={' '}
                <strong>
                  {figure(s.value)}
                  {s.unit && ` ${s.unit}`}
                </strong>
                {s.shown && <span className="dim"> · {s.shown}</span>}
              </div>
            </li>
          );
        })}
      </ol>
      <h4 className="working-where">Where</h4>
      <dl className="readout working-given">
        {Object.entries(working.given).map(([name, g]) => (
          <Fragment key={name}>
            <dt>
              <Symbol name={name} />
            </dt>
            <dd>
              {figure(g.value)}
              {g.unit && ` ${g.unit}`}
              {g.note && <span className="dim"> · {g.note}</span>}
            </dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}
