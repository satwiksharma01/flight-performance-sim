import { useState, type ReactNode } from 'react';
import { CRUISE_PROPELLER_EFFICIENCY, tasToCas, type CruiseCase } from '../../physics/index.js';
import type { CruiseModel } from '../cruise.js';
import { SYSTEM_UNITS, toMass, type ViewSettings } from '../model.js';
import { toDistance } from '../cruise.js';
import { mass, num, speed, tick } from '../format.js';
import { Chart } from './Chart.js';
import { ShowWorking, WorkingCard } from './Working.js';
import { rangeWorking, type RangeWorkingId } from '../working-tabs.js';
import type { Scenario } from '../../state/url.js';

interface Props {
  readonly cruise: CruiseModel;
  readonly scenario: Scenario;
  readonly view: ViewSettings;
  readonly theme: string;
}

const WORKING_ID = 'range-working';

const distanceUnit = (view: ViewSettings) => (view.unit === 'kt' ? 'NM' : 'km');

export function CruiseTab({ cruise, scenario, view, theme }: Props) {
  const { result, chart, atmosphere } = cruise;
  const [open, setOpen] = useState<RangeWorkingId | null>(null);
  const working = open ? rangeWorking(open, scenario, cruise, view) : null;
  const show = (id: RangeWorkingId) => (
    <ShowWorking open={open === id} onToggle={() => setOpen(open === id ? null : id)} controls={WORKING_ID} />
  );
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
                <Row
                  label="Best range"
                  value={
                    <>
                      <strong>{num(result.range.value / (view.unit === 'kt' ? 1852 : 1000))} {distanceUnit(view)}</strong> {show('range')}
                    </>
                  }
                />
                <Row label={cruise.fuelLine ? 'flown at' : jet ? <>flown at V<sub>jr</sub>, max C<sub>L</sub><sup>0.5</sup>/C<sub>D</sub></> : <>flown at V<sub>md</sub>, max L/D</>} value={at(result.range)} />
                <Row
                  label="Best endurance"
                  value={
                    <>
                      <strong>{num(result.endurance.value / 3600, 1)} h</strong> {show('endurance')}
                    </>
                  }
                />
                <Row label={cruise.fuelLine ? 'flown at' : jet ? <>flown at V<sub>md</sub>, max L/D</> : <>flown at V<sub>mp</sub>, max C<sub>L</sub><sup>1.5</sup>/C<sub>D</sub></>} value={at(result.endurance)} />
                {cruise.beyondModel && (
                  <Row label="Caution" value={<span className="caution">The best-range speed is past Mach 0.7, where the polar no longer holds.</span>} />
                )}
              </dl>
            </>
          ) : (
            <p className="card-sub">{cruise.reason}</p>
          )}
        </section>

        {cruise.setPower && <SetPowerCard cruise={cruise} view={view} show={show('set-power')} />}

        <section className="card table-card" aria-labelledby="breguet-h">
          <h3 id="breguet-h">Which speed is best</h3>
          <p className="card-sub">
            With constant SFC, each case maximises a different aerodynamic ratio, so each flies a different speed.
            {cruise.fuelLine &&
              ' This engine’s fuel flow has a base flow, burned every hour aloft, so its best cruise is a little faster: found numerically.'}
          </p>
          <dl className="readout">
            <Row label="Propeller, range" value={<>V<sub>md</sub>, max L/D</>} />
            <Row label="Propeller, endurance" value={<>V<sub>mp</sub>, max C<sub>L</sub><sup>1.5</sup>/C<sub>D</sub></>} />
            <Row label="Jet, range" value={<>V<sub>jr</sub>, max C<sub>L</sub><sup>0.5</sup>/C<sub>D</sub></>} />
            <Row label="Jet, endurance" value={<>V<sub>md</sub>, max L/D</>} />
            <Row
              label="Assumed"
              value={`${jet ? '' : `propeller efficiency ${CRUISE_PROPELLER_EFFICIENCY}, `}${cruise.fuelLine ? 'fuel flow a straight line in output' : `${jet ? 'thrust' : 'brake'} SFC constant`}`}
            />
          </dl>
        </section>
      </div>
      {working && <WorkingCard id={WORKING_ID} working={working} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Cruise at the sidebar's power setting, the way a POH tabulates it. */
function SetPowerCard({ cruise, view, show }: { cruise: CruiseModel; view: ViewSettings; show: ReactNode }) {
  const p = cruise.setPower!;
  const { atmosphere } = cruise;
  const pct = (f: number) => `${num(f * 100)} %`;
  const unit = SYSTEM_UNITS[view.system].mass;
  return (
    <section className="card table-card" aria-labelledby="set-power-h">
      <h3 id="set-power-h">Cruise at a set power</h3>
      <p className="card-sub">
        Level flight at {pct(p.setting)} of the engine’s rating, set in the sidebar, at this weight and altitude. On the
        fuel aboard, keeping 45 minutes in reserve; no climb or descent.
      </p>
      <dl className="readout">
        <Row label="Full throttle here" value={<>{pct(p.available)} of the rating</>} />
        {p.setting > p.available + 0.005 && (
          <Row label="Caution" value={<span className="caution">More than full throttle gives at this altitude and temperature.</span>} />
        )}
        {p.tas === null ? (
          <Row label="Speed" value={<span className="caution">This setting can’t hold level flight here.</span>} />
        ) : (
          <Row
            label="Speed"
            value={
              <>
                <strong>{speed(tasToCas(p.tas, atmosphere.pressure, atmosphere.speedOfSound), view.unit)} CAS</strong>{' '}
                <span className="dim">{speed(p.tas, view.unit)} TAS</span>
              </>
            }
          />
        )}
        {p.fuelFlow !== null && (
          <Row
            label="Fuel flow"
            value={
              <>
                {num(toMass(p.fuelFlow * 3600, view.system), 1)} {unit}/h
                {cruise.result?.kind === 'propeller' && (
                  <span className="dim"> {num((p.fuelFlow * 3600) / (6 * 0.45359237), 1)} GPH of avgas</span>
                )}
              </>
            }
          />
        )}
        {p.range !== null && p.endurance !== null && (
          <Row
            label="Range"
            value={
              <>
                <strong>
                  {num(toDistance(p.range, view))} {distanceUnit(view)}
                </strong>{' '}
                <span className="dim">in {num(p.endurance / 3600, 1)} h</span>
              </>
            }
          />
        )}
      </dl>
      {p.tas !== null && <p className="card-foot">{show}</p>}
    </section>
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
