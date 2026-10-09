import type { ReactNode } from 'react';
import { CRUISE_PROPELLER_EFFICIENCY, tasToCas, type CruiseCase } from '../../physics/index.js';
import type { CruiseModel } from '../cruise.js';
import { SYSTEM_UNITS, type ViewSettings } from '../model.js';
import { mass, num, speed, tick } from '../format.js';
import { Chart } from './Chart.js';

interface Props {
  readonly cruise: CruiseModel;
  readonly view: ViewSettings;
  readonly theme: string;
}

const distanceUnit = (view: ViewSettings) => (view.unit === 'kt' ? 'NM' : 'km');

export function CruiseTab({ cruise, view, theme }: Props) {
  const { result, chart, atmosphere } = cruise;
  const at = (c: CruiseCase) => (
    <>
      {speed(tasToCas(c.tasStart, atmosphere.pressure, atmosphere.speedOfSound), view.unit)} CAS{' '}
      <span className="dim">
        {speed(c.tasStart, view.unit)} falling to {speed(c.tasEnd, view.unit)} TAS, C<sub>L</sub> {num(c.cl, 2)}
        {c.stallLimited && ', held at 1.2 V_s: the optimum is slower'}
      </span>
    </>
  );
  const jet = result?.kind === 'jet';

  return (
    <>
      <div className="charts">
        {chart ? (
          <Chart
            wide
            title="Payload–range"
            description="At maximum takeoff mass, payload traded for fuel until the tanks are full, then payload shed to the ferry range. Best-range speed throughout, at this altitude, no reserve. The dot is this weight with its tanks filled first."
            x={chart.range}
            series={[{ label: 'Payload', values: chart.payload, colorVar: '--series-1' }]}
            xMax={chart.xMax}
            yMax={chart.yMax}
            xLabel={`Range (${distanceUnit(view)})`}
            yLabel={`Payload (${SYSTEM_UNITS[view.system].mass})`}
            formatX={(v) => num(v)}
            formatY={tick}
            markers={[]}
            bands={[]}
            selectedX={chart.selected.range}
            selectedY={[chart.selected.payload]}
            emptyReason={null}
            height={300}
            theme={theme}
            onPick={() => undefined}
            syncKey="cruise"
          />
        ) : (
          <div className="card chart chart--wide chart-note">
            <h3>Payload–range</h3>
            <p>{cruise.reason}</p>
          </div>
        )}
      </div>

      <div className="tables tables--even">
        <section className="card table-card" aria-labelledby="range-h">
          <h3 id="range-h">Range and endurance</h3>
          {result ? (
            <>
              <p className="card-sub">
                Breguet, at this weight and pressure altitude, burning all {mass(cruise.fuel, view.system)} of usable fuel
                aboard. No reserve, climb or descent.
              </p>
              <dl className="readout">
                <Row label="Best range" value={<strong>{num(result.range.value / (view.unit === 'kt' ? 1852 : 1000))} {distanceUnit(view)}</strong>} />
                <Row label={jet ? <>flown at V<sub>jr</sub>, max C<sub>L</sub><sup>0.5</sup>/C<sub>D</sub></> : <>flown at V<sub>md</sub>, max L/D</>} value={at(result.range)} />
                <Row label="Best endurance" value={<strong>{num(result.endurance.value / 3600, 1)} h</strong>} />
                <Row label={jet ? <>flown at V<sub>md</sub>, max L/D</> : <>flown at V<sub>mp</sub>, max C<sub>L</sub><sup>1.5</sup>/C<sub>D</sub></>} value={at(result.endurance)} />
                {cruise.beyondModel && (
                  <Row label="Caution" value={<span className="caution">The best-range speed is past Mach 0.7, where the polar no longer holds.</span>} />
                )}
              </dl>
            </>
          ) : (
            <p className="card-sub">{cruise.reason}</p>
          )}
        </section>

        <section className="card table-card" aria-labelledby="breguet-h">
          <h3 id="breguet-h">Which speed is best</h3>
          <p className="card-sub">Each case maximises a different aerodynamic ratio, so each flies a different speed.</p>
          <dl className="readout">
            <Row label="Propeller, range" value={<>V<sub>md</sub>, max L/D</>} />
            <Row label="Propeller, endurance" value={<>V<sub>mp</sub>, max C<sub>L</sub><sup>1.5</sup>/C<sub>D</sub></>} />
            <Row label="Jet, range" value={<>V<sub>jr</sub>, max C<sub>L</sub><sup>0.5</sup>/C<sub>D</sub></>} />
            <Row label="Jet, endurance" value={<>V<sub>md</sub>, max L/D</>} />
            <Row
              label="Assumed"
              value={jet ? 'thrust SFC constant' : `propeller efficiency ${CRUISE_PROPELLER_EFFICIENCY}, brake SFC constant`}
            />
          </dl>
        </section>
      </div>
    </>
  );
}

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
