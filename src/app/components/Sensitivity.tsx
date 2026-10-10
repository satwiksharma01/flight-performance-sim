import { useState } from 'react';
import { capitalise, type OutputId, type SensitivityModel } from '../sensitivity.js';
import { signed } from '../format.js';

interface Props {
  readonly model: SensitivityModel;
  /** A second aircraft is loaded; this covers the first only */
  readonly comparing: boolean;
}

/** One result at a time: every input's elasticity as a signed bar, strongest first. */
export function SensitivityTab({ model, comparing }: Props) {
  const [chosen, setChosen] = useState<OutputId>('takeoff');
  const row = model.rows.find((r) => r.id === chosen) ?? model.rows[0];
  if (!row) return null;
  const largest = Math.max(...row.ranked.map((r) => Math.abs(r.elasticity ?? 0)));

  return (
    <div className="tables">
      <section className="card table-card" aria-labelledby="sens-h">
        <h3 id="sens-h">Sensitivity</h3>
        <p className="card-sub">
          Each input nudged 1 % either way on its own, everything else held. The number is the per cent change in the
          result for 1 % more of the input, by central difference: +2.00 means 1 % more raises the result by 2 %.
        </p>
        <div className="field sens-pick">
          <label htmlFor="sens-out">Result</label>
          <select id="sens-out" value={row.id} onChange={(e) => setChosen(e.target.value as OutputId)}>
            {model.rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <p className="sens-sentence">{row.sentence}</p>
        <ol className="sens-bars">
          {row.ranked.map((r) => (
            <li key={r.input}>
              <span>{capitalise(r.input)}</span>
              <span className="sens-track" aria-hidden="true">
                {r.elasticity !== null && largest > 0 && (
                  <span
                    className={r.elasticity < 0 ? 'sens-bar sens-bar--down' : 'sens-bar'}
                    style={{ width: `${(50 * Math.abs(r.elasticity)) / largest}%` }}
                  />
                )}
              </span>
              <span className="n">{r.elasticity === null ? '—' : signed(r.elasticity, 2)}</span>
            </li>
          ))}
        </ol>
        <p className="card-foot">
          Wings level, at this weight, altitude, ISA day, runway and wind; speeds are true airspeeds. Weight is loaded
          tanks first, as on the range tab. More engine power scales the thrust at every speed with it.
          {comparing && ' The comparison aircraft is not included.'}
        </p>
      </section>
    </div>
  );
}
