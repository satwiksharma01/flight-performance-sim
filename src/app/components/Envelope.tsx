import type { ReactNode } from 'react';
import { G0 } from '../../physics/index.js';
import { bankForLoadFactor } from '../../physics/performance/turn.js';
import type { EnvelopeModel } from '../envelope.js';
import { SYSTEM_UNITS, toUnit, type ChartModel, type ViewSettings } from '../model.js';
import { axisLabel, axisTick, length, num, tick } from '../format.js';
import { Chart, type ChartPath } from './Chart.js';

const FT = 0.3048;
const unitLabel = (view: ViewSettings) => (view.unit === 'mps' ? 'm/s' : view.unit === 'kmh' ? 'km/h' : 'kt');

function V({ sub }: { sub: string }) {
  return (
    <>
      V<sub>{sub}</sub>
    </>
  );
}

interface Props {
  readonly envelope: EnvelopeModel;
  readonly model: ChartModel;
  readonly view: ViewSettings;
  readonly theme: string;
  /** EAS in the view's unit, and a load factor */
  readonly onVnPick: (eas: number, n: number) => void;
  /** Speed on the x-axis, and a turn rate [deg/s] */
  readonly onTurnPick: (x: number, rate: number) => void;
  /** Speed on the x-axis, and a pressure altitude [ft] */
  readonly onEnergyPick: (x: number, altitudeFt: number) => void;
}

export function EnvelopeTab({ envelope, model, view, theme, onVnPick, onTurnPick, onEnergyPick }: Props) {
  const { vn, turn, energy } = envelope;
  const n = model.loadFactor;
  const lengthUnit = SYSTEM_UNITS[view.system].length;

  const energyPaths: ChartPath[] = energy
    ? [
        ...energy.energyHeights.map((c) => ({
          lines: c.lines,
          colorVar: '--muted',
          width: 1,
          dash: [2, 4],
          label: `hₑ ${num(c.level / 1000)}k ft`,
        })),
        ...energy.contours.map((c) => ({
          lines: c.lines,
          colorVar: c.level === 0 ? '--ink' : '--series-1',
          width: c.level === 0 ? 2.25 : 1.25,
          label: c.level === 0 ? 'Pₛ = 0' : num(c.level),
        })),
        { lines: [energy.stallLine], colorVar: '--ink-2', width: 1.25, dash: [5, 4], label: 'Stall' },
        { lines: [energy.bestClimb], colorVar: '--series-2', width: 1.5, dash: [6, 3], label: 'Best climb' },
      ]
    : [];

  return (
    <>
      <div className="charts">
        {vn ? (
          <Chart
            wide
            title="V-n diagram"
            description={`Manoeuvre envelope and design gusts at ${num(n === 1 ? 0 : (bankForLoadFactor(n) * 180) / Math.PI)}° of bank, this weight and altitude. The stall curves bound it at low speed and the limit load factors above V_A; the shaded region is the design envelope. Click to set the speed and load factor.`}
            x={vn.x}
            series={[
              { label: 'Manoeuvre', values: vn.maneuverUpper, colorVar: '--series-1', directLabel: 'Manoeuvre' },
              { label: 'Manoeuvre, negative', values: vn.maneuverLower, colorVar: '--series-1' },
              { label: 'Gust', values: vn.gustUpper, colorVar: '--series-2', dash: [6, 4], directLabel: 'Gust' },
              { label: 'Gust, negative', values: vn.gustLower, colorVar: '--series-2', dash: [6, 4] },
            ]}
            fill={{ upper: vn.designUpper, lower: vn.designLower, colorVar: '--envelope' }}
            xMax={vn.xMax}
            yMin={vn.yMin}
            yMax={vn.yMax}
            xLabel={`Equivalent airspeed (${unitLabel(view)})`}
            yLabel="Load factor n"
            formatX={(v) => num(v)}
            formatY={tick}
            markers={[
              { x: vn.speeds.stall, symbol: 'V', subscript: 'S', attainable: true },
              { x: vn.speeds.maneuvering, symbol: 'V', subscript: 'A', attainable: true },
              { x: vn.speeds.cruise, symbol: 'V', subscript: 'C', attainable: true },
              { x: vn.speeds.neverExceed, symbol: 'V', subscript: 'NE', attainable: true },
              { x: vn.speeds.dive, symbol: 'V', subscript: 'D', attainable: true },
            ]}
            bands={[{ from: vn.speeds.dive, to: vn.xMax, label: 'Past the dive speed' }]}
            selectedX={vn.selected.x}
            selectedY={[vn.selected.n]}
            selectedLabel={`n ${num(vn.selected.n, 2)}${vn.selected.inside ? '' : ', outside'}`}
            emptyReason={null}
            height={300}
            theme={theme}
            onPick={onVnPick}
            syncKey="vn"
          />
        ) : (
          <div className="card chart chart--wide chart-note">
            <h3>V-n diagram</h3>
            <p>This aircraft has no structural limits. Add them in the aircraft editor to draw its V-n diagram.</p>
          </div>
        )}

        <Chart
          wide={!energy}
          title="Turn performance"
          description={
            turn.sustained
              ? 'Turn rate against speed, level. Instantaneous: the most the wing and structure allow, peaking at the corner speed. Sustained: what full power can hold without slowing. Faint lines are constant radius. Click to set speed and bank.'
              : 'Turn rate against speed, level: the most the wing and structure allow, peaking at the corner speed. Faint lines are constant radius. Click to set speed and bank.'
          }
          x={turn.x}
          series={[
            { label: 'Instantaneous', values: turn.instantaneous, colorVar: '--series-1', directLabel: 'Instantaneous' },
            ...(turn.sustained
              ? [{ label: 'Sustained', values: turn.sustained, colorVar: '--series-2', directLabel: 'Sustained' }]
              : []),
            ...turn.radii.map((r) => ({
              label: `R ${num(r.radius)} ${lengthUnit}`,
              values: r.rate,
              colorVar: '--muted',
              dash: [3, 3],
              faint: true,
              directLabel: `R ${num(r.radius)} ${lengthUnit}`,
            })),
          ]}
          xMax={model.window.xMax}
          yMax={turn.yMax}
          xLabel={axisLabel(view)}
          yLabel="Turn rate (°/s)"
          formatX={(v) => axisTick(v, view)}
          formatY={tick}
          markers={[
            ...(turn.corner ? [{ x: turn.corner.x, symbol: 'Corner', subscript: '', attainable: true }] : []),
            ...(turn.bestSustained ? [{ x: turn.bestSustained.x, symbol: 'Best sustained', subscript: '', attainable: true }] : []),
          ]}
          bands={[{ from: 0, to: turn.stallX, label: 'Below stall' }]}
          selectedX={model.selected.x}
          selectedY={[turn.selected.rate]}
          selectedLabel={turn.selected.radius === null ? 'wings level' : `${num(turn.selected.rate, 1)} °/s`}
          emptyReason={null}
          height={280}
          theme={theme}
          onPick={onTurnPick}
        />

        {energy && (
          <Chart
            title="Specific excess power"
            description={`Pₛ = V(T − D)/W at full power and n = ${num(n, 2)}, in ft/min: the rate the aircraft can climb, or accelerate, from each point. Pₛ = 0 is the edge of the steady envelope; outside it is shaded. Click to set altitude and speed.`}
            x={[0, energy.xMax]}
            series={[]}
            paths={energyPaths}
            regions={energy.outside}
            xMax={energy.xMax}
            yMax={energy.yMax}
            xLabel={axisLabel(view)}
            yLabel="Pressure altitude (ft)"
            formatX={(v) => axisTick(v, view)}
            formatY={(v) => num(v)}
            markers={[]}
            bands={[]}
            selectedX={model.selected.x}
            selectedY={[envelope.atmosphere.pressureAltitude / FT]}
            selectedLabel={energy.selected === null ? 'outside the model' : `Pₛ ${num(energy.selected)} ft/min`}
            emptyReason={null}
            height={280}
            theme={theme}
            onPick={onEnergyPick}
            syncKey="energy"
          />
        )}
      </div>

      <div className="tables tables--even">
        {vn && (
          <section className="card table-card" aria-labelledby="vn-h">
            <h3 id="vn-h">Structural limits</h3>
            <p className="card-sub">Equivalent airspeed, at this weight. Gusts at this altitude.</p>
            <dl className="readout">
              <Row label={<>Stall, <V sub="S" /></>} value={`${num(vn.speeds.stall)} ${unitLabel(view)}`} />
              <Row label={<>Manoeuvring, <V sub="A" /></>} value={`${num(vn.speeds.maneuvering)} ${unitLabel(view)}`} dim={`at n = ${num(vn.diagram.limits.nPositive, 1)}`} />
              <Row label={<>Design cruise, <V sub="C" /></>} value={`${num(vn.speeds.cruise)} ${unitLabel(view)}`} />
              <Row label={<>Never exceed, <V sub="NE" /></>} value={`${num(vn.speeds.neverExceed)} ${unitLabel(view)}`} dim={<>0.9 <V sub="D" /></>} />
              <Row label={<>Design dive, <V sub="D" /></>} value={`${num(vn.speeds.dive)} ${unitLabel(view)}`} />
              <Row label="Limit load factors" value={`+${num(vn.diagram.limits.nPositive, 2)} / ${num(vn.diagram.limits.nNegative, 2)}`} />
              <Row
                label="Design gusts"
                value={`${num(vn.diagram.gusts.cruise / FT)} / ${num(vn.diagram.gusts.dive / FT)} ft/s`}
                dim={<>at <V sub="C" /> / <V sub="D" /></>}
              />
              <Row
                label="Gust alleviation"
                value={<>K<sub>g</sub> {num(vn.diagram.alleviation.factor, 3)}</>}
                dim={`μ ${num(vn.diagram.alleviation.massRatio, 1)}, a ${num(vn.diagram.alleviation.liftSlope, 2)}/rad`}
              />
              <Row
                label="This point"
                value={`n ${num(vn.selected.n, 2)} at ${num(vn.selected.x)} ${unitLabel(view)} EAS`}
                dim={vn.selected.inside ? 'inside the envelope' : 'outside the envelope'}
                caution={!vn.selected.inside}
              />
            </dl>
          </section>
        )}

        <section className="card table-card" aria-labelledby="turn-h">
          <h3 id="turn-h">Turn</h3>
          <p className="card-sub">Level turns at this weight and altitude.</p>
          <dl className="readout">
            {turn.corner && (
              <Row
                label="Corner speed"
                value={axisTick(turn.corner.x, view) + (view.axis === 'mach' ? '' : ` ${unitLabel(view)}`)}
                dim={`${num(turn.corner.rate, 1)} °/s, R ${length(turn.corner.radius, view.system)}`}
              />
            )}
            {turn.nStructure === null && <Row label="Structural limit" value="none set" dim="the wing alone bounds the turn" />}
            {turn.bestSustained ? (
              <Row
                label="Best sustained"
                value={`${num(turn.bestSustained.rate, 1)} °/s`}
                dim={`n ${num(turn.bestSustained.n, 2)}, ${num((bankForLoadFactor(turn.bestSustained.n) * 180) / Math.PI)}° bank, R ${length(turn.bestSustained.radius, view.system)}`}
              />
            ) : (
              turn.sustained && <Row label="Best sustained" value="none" dim="can’t hold a level turn here" />
            )}
            <Row
              label="This turn"
              value={turn.selected.radius === null ? 'wings level' : `${num(turn.selected.rate, 1)} °/s`}
              dim={turn.selected.radius === null ? '' : `n ${num(n, 2)}, R ${length(turn.selected.radius, view.system)}`}
            />
          </dl>
        </section>

        {energy && (
          <section className="card table-card" aria-labelledby="ps-h">
            <h3 id="ps-h">Energy</h3>
            <p className="card-sub">Full power, at n = {num(n, 2)}.</p>
            <dl className="readout">
              <Row
                label="Pₛ here"
                value={energy.selected === null ? 'outside the model' : `${num(energy.selected)} ft/min`}
                caution={energy.selected !== null && energy.selected < 0}
              />
              {energy.selected !== null && (
                <Row
                  label="Level acceleration"
                  value={`${num(toUnit((G0 * energy.selected * FT) / 60 / model.selected.tas, view.unit), 2)} ${unitLabel(view)}/s`}
                  dim="g Pₛ / V"
                />
              )}
              <Row label="Contour interval" value={`${num(energy.step)} ft/min`} />
              <Row label="Envelope edge" value="Pₛ = 0" dim={<>the absolute ceiling at the top, <V sub="max" /> at the right</>} />
            </dl>
          </section>
        )}
      </div>
    </>
  );
}

function Row({ label, value, dim, caution }: { label: ReactNode; value: ReactNode; dim?: ReactNode; caution?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={caution ? 'caution' : undefined}>
        {value} {dim && <span className="dim">{dim}</span>}
      </dd>
    </>
  );
}

