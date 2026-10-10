import type { ComparisonRow } from '../compare.js';
import { num } from '../format.js';

/** Two aircraft side by side, with the second's difference from the first. */
export function ComparisonTable({ rows, first, second }: { rows: readonly ComparisonRow[]; first: string; second: string }) {
  const show = (v: number | null, r: ComparisonRow) => (v === null ? '—' : `${num(v, r.decimals)}${r.unit ? ` ${r.unit}` : ''}`);
  const difference = (r: ComparisonRow) => {
    if (r.first === null || r.second === null || r.first === 0) return '';
    const d = (r.second - r.first) / Math.abs(r.first);
    if (Math.abs(d) < 0.0005) return 'same';
    return `${d > 0 ? '+' : '−'}${num(Math.abs(d) * 100, Math.abs(d) < 0.1 ? 1 : 0)} %`;
  };
  return (
    <section className="card table-card" aria-labelledby="compare-h">
      <h3 id="compare-h">Comparison</h3>
      <p className="card-sub">
        Same altitude, ISA day, bank, runway and wind; each at the same fraction of its own max takeoff mass. The last column is
        the second aircraft against the first.
      </p>
      <div className="table-scroll">
        <table className="validation-table compare-table">
          <thead>
            <tr>
              <th scope="col">Quantity</th>
              <th scope="col" className="n">
                {first}
              </th>
              <th scope="col" className="n">
                {second}
              </th>
              <th scope="col" className="n">
                Difference
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td className="n">{show(r.first, r)}</td>
                <td className="n">{show(r.second, r)}</td>
                <td className="n dim">{difference(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
