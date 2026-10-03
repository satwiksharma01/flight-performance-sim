import type { ReactNode } from 'react';
import { G0, turnRadius, turnRate, type AirspeedSet, type Propulsion } from '../../physics/index.js';
import { toForce, toUnit, type ChartModel, type MarkerView, type ViewSettings } from '../model.js';
import { UNIT_NAME, axisSpeed, feet, force, length, mach, mass, num, otherPower, power, signed, speed } from '../format.js';

/** kg/m³ to slug/ft³: (1/14.5939029 slug per kg) × 0.3048³ m³ per ft³ */
const SLUG_FT3_PER_KG_M3 = (0.3048 * 0.3048 * 0.3048) / 14.5939029372;

const USE: Record<MarkerView['kind'], string> = {
  stall: 'Slowest level flight',
  'min-power': 'Prop endurance · minimum sink',
  'min-drag': 'Best glide · prop best range',
  'jet-range': 'Jet best range',
};

function Sub({ symbol, sub }: { symbol: string; sub: string }) {
  return (
    <>
      {symbol}
      <sub>{sub}</sub>
    </>
  );
}

function markerSymbol(label: string) {
  const [symbol = label, sub = ''] = label.split('_');
  return <Sub symbol={symbol} sub={sub} />;
}

// --- Headline tiles ---------------------------------------------------------

const fpm = (value: number) => `${num(value)} ft/min`;
const ftValue = (value: number) => `${num(value)} ft`;
const nm = (metres: number) => `${num(metres / 1852, metres < 18520 ? 1 : 0)} NM`;

function Tile({ label, value, sub }: { label: ReactNode; value: ReactNode; sub: ReactNode }) {
  return (
    <div className="card tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      <span className="tile-sub">{sub}</span>
    </div>
  );
}

export function Tiles({ model, view }: { model: ChartModel; view: ViewSettings }) {
  const stall = model.markers.find((m) => m.kind === 'stall');
  const { atmosphere, climb, glide } = model;

  return (
    <div className="tiles">
      <Tile
        label="Density altitude"
        value={feet(atmosphere.densityAltitude)}
        sub={`PA ${feet(atmosphere.pressureAltitude)} · OAT ${num(atmosphere.temperature - 273.15)} °C`}
      />
      {stall && (
        <Tile
          label={
            <>
              Stall speed, <Sub symbol="V" sub="s" />
            </>
          }
          value={axisSpeed(stall.speeds, view)}
          sub={otherSpeeds(stall.speeds, view)}
        />
      )}
      {climb ? (
        <>
          <Tile
            label={
              <>
                Best rate of climb, <Sub symbol="V" sub="y" />
              </>
            }
            value={fpm(climb.vy.rocFpm)}
            sub={
              <>
                at {axisSpeed(climb.vy.speeds, view)} · <Sub symbol="V" sub="x" /> {axisSpeed(climb.vx.speeds, view)}
              </>
            }
          />
          <Tile
            label="Service ceiling"
            value={climb.serviceCeilingFt === null ? 'out of reach' : ftValue(climb.serviceCeilingFt)}
            sub={climb.absoluteCeilingFt === null ? 'at this weight and ISA day' : `absolute ${ftValue(climb.absoluteCeilingFt)}, at this weight`}
          />
        </>
      ) : (
        <>
          <Tile label="Minimum sink" value={fpm(glide.minSink.sinkFpm)} sub={`at ${axisSpeed(glide.minSink.speeds, view)}`} />
          <Tile label="Glide from here" value={nm(glide.distanceToSeaLevel)} sub="to sea level, still air, at best glide" />
        </>
      )}
      <Tile
        label="Best glide"
        value={`${num(glide.best.ratio, 1)} : 1`}
        sub={`at ${axisSpeed(glide.best.speeds, view)}, sinking ${fpm(glide.best.sinkFpm)}`}
      />
      {climb && (
        <Tile
          label={
            <>
              Maximum level speed, <Sub symbol="V" sub="max" />
            </>
          }
          value={climb.vmax ? axisSpeed(climb.vmax.speeds, view) : 'none'}
          sub={
            !climb.vmax
              ? "full power can't hold altitude here"
              : climb.vmax.beyondModel
                ? 'past Mach 0.7: no wave drag, so optimistic'
                : 'full power, where thrust meets drag'
          }
        />
      )}
    </div>
  );
}

/** The airspeeds the axis isn't showing, for a tile's second line. */
function otherSpeeds(speeds: AirspeedSet, view: ViewSettings): string {
  const unit = view.axis === 'mach' ? 'kt' : view.unit;
  const parts: string[] = [];
  if (view.axis !== 'tas') parts.push(`${speed(speeds.tas, unit)} TAS`);
  if (view.axis !== 'eas') parts.push(`${speed(speeds.eas, unit)} EAS`);
  if (view.axis !== 'mach') parts.push(mach(speeds.mach));
  return parts.join(' · ');
}

// --- Characteristic speeds --------------------------------------------------

export function SpeedsTable({ model, view }: { model: ChartModel; view: ViewSettings }) {
  const unit = view.axis === 'mach' ? 'kt' : view.unit;
  return (
    <section className="card table-card" aria-labelledby="speeds-h">
      <h3 id="speeds-h">Characteristic speeds</h3>
      <p className="card-sub">Closed-form solutions of the drag polar, not read off the curves.</p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Speed</th>
              <th scope="col">Used for</th>
              <th scope="col" className="n">TAS</th>
              <th scope="col" className="n">EAS</th>
              <th scope="col" className="n">CAS</th>
              <th scope="col" className="n">Mach</th>
              <th scope="col" className="n">Drag</th>
              <th scope="col" className="n">Power</th>
              <th scope="col" className="n">L/D</th>
            </tr>
          </thead>
          <tbody>
            {model.markers.map((m) => (
              <tr key={m.kind} className={m.attainable ? undefined : 'is-dim'} title={m.significance}>
                <th scope="row">{markerSymbol(m.label)}</th>
                <td>
                  {USE[m.kind]}
                  {!m.attainable && <span className="tag">below stall</span>}
                </td>
                <td className="n">{num(toUnit(m.speeds.tas, unit), unit === 'mps' ? 1 : 0)}</td>
                <td className="n">{num(toUnit(m.speeds.eas, unit), unit === 'mps' ? 1 : 0)}</td>
                <td className="n">{num(toUnit(m.speeds.cas, unit), unit === 'mps' ? 1 : 0)}</td>
                <td className="n">{num(m.speeds.mach, 3)}</td>
                <td className="n">{force(m.point.drag, view.system)}</td>
                <td className="n">{power(m.point.powerRequired / 1000, view.system)}</td>
                <td className="n">{num(m.point.liftToDrag, 1)}</td>
              </tr>
            ))}
            {model.flapStall && (
              <tr title="Stall with landing flap. The drag polar here is the clean one, so flap drag, power and L/D are not shown.">
                <th scope="row">
                  <Sub symbol="V" sub="s0" />
                </th>
                <td>
                  Stall, landing flap <span className="tag">speeds only</span>
                </td>
                <td className="n">{num(toUnit(model.flapStall.speeds.tas, unit), unit === 'mps' ? 1 : 0)}</td>
                <td className="n">{num(toUnit(model.flapStall.speeds.eas, unit), unit === 'mps' ? 1 : 0)}</td>
                <td className="n">{num(toUnit(model.flapStall.speeds.cas, unit), unit === 'mps' ? 1 : 0)}</td>
                <td className="n">{num(model.flapStall.speeds.mach, 3)}</td>
                <td className="n dim">–</td>
                <td className="n dim">–</td>
                <td className="n dim">–</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="card-foot">
        Speeds in {UNIT_NAME[unit]}, at {mass(model.weight / G0, view.system)}
        {model.loadFactor === 1 ? '' : ` and ${num(model.loadFactor, 2)} g`}. The charts show the clean configuration.
      </p>
    </section>
  );
}

// --- Selected point ---------------------------------------------------------

export function SelectedPanel({ model, view }: { model: ChartModel; view: ViewSettings }) {
  const { point, attainable, beyondModel } = model.selected;
  const unit = view.axis === 'mach' ? 'kt' : view.unit;
  const s = point.speeds;

  return (
    <section className="card table-card" aria-labelledby="selected-h">
      <h3 id="selected-h">At the selected speed</h3>
      {!attainable && (
        <p className="status status--critical">
          <span aria-hidden="true">▲</span> Below stall. The wing cannot hold level flight here; these numbers
          describe a condition the aircraft cannot sustain.
        </p>
      )}
      {beyondModel && (
        <p className="status status--warning">
          <span aria-hidden="true">▲</span> Above Mach 0.9. The drag polar has no wave drag, so these numbers are
          outside the model.
        </p>
      )}
      <dl className="readout">
        <dt>TAS</dt>
        <dd>{speed(s.tas, unit)}</dd>
        <dt>EAS</dt>
        <dd>{speed(s.eas, unit)}</dd>
        <dt>CAS</dt>
        <dd>{speed(s.cas, unit)}</dd>
        <dt>Mach</dt>
        <dd>{num(s.mach, 3)}</dd>
        <dt>Lift coefficient</dt>
        <dd>{num(point.cl, 3)}</dd>
        <dt>Drag coefficient</dt>
        <dd>{num(point.cd, 4)}</dd>
        <dt>Total drag</dt>
        <dd>{force(point.drag, view.system)}</dd>
        <dt>Parasite / induced</dt>
        <dd>
          {num(toForce(point.parasiteDrag, view.system))} / {force(point.inducedDrag, view.system)}
        </dd>
        <dt>Power required</dt>
        <dd>
          {power(point.powerRequired / 1000, view.system)}{' '}
          <span className="dim">{otherPower(point.powerRequired / 1000, view.system)}</span>
        </dd>
        <dt>L/D</dt>
        <dd>{num(point.liftToDrag, 2)}</dd>
        <dt title="Weight over pressure ratio. Jet performance collapses onto W/δ and Mach.">W/δ</dt>
        <dd>{force(model.weight / model.atmosphere.pressureRatio, view.system)}</dd>
        {model.loadFactor > 1 && (
          <>
            <dt>Turn radius</dt>
            <dd>
              {length(turnRadius(s.tas, model.loadFactor), view.system)}{' '}
              <span className="dim">{num(turnRadius(s.tas, model.loadFactor) / 1852, 2)} NM</span>
            </dd>
            <dt>Turn rate</dt>
            <dd>
              {num((turnRate(s.tas, model.loadFactor) * 180) / Math.PI, 1)} °/s{' '}
              <span className="dim">{num(360 / ((turnRate(s.tas, model.loadFactor) * 180) / Math.PI))} s per 360°</span>
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}

// --- Climb -----------------------------------------------------------------

function engineSummary(engine: Propulsion, system: ViewSettings['system']): string {
  switch (engine.kind) {
    case 'piston':
      return `Piston${engine.criticalAltitude === undefined ? '' : ', turbocharged'}, ${power(engine.power / 1000, system)}`;
    case 'turboprop':
      return `Turboprop, ${power(engine.power / 1000, system)}`;
    case 'turbofan':
      return `Turbofan, ${force(engine.thrust, system)}`;
  }
}

export function ClimbPanel({ model, view, engine }: { model: ChartModel; view: ViewSettings; engine: Propulsion }) {
  const climb = model.climb;
  if (!climb) return null;
  const { vy, vx, vmax } = climb;
  const delta = (vy.rocFpm - vy.rocSmallAngleFpm) / Math.abs(vy.rocSmallAngleFpm);
  const deg = (rad: number) => (rad * 180) / Math.PI;

  return (
    <section className="card table-card" aria-labelledby="climb-h">
      <h3 id="climb-h">Climb</h3>
      <p className="card-sub">Full power, wings level, at {mass(model.weight / G0, view.system)}.</p>
      <dl className="readout">
        <dt>Engine</dt>
        <dd>
          {engineSummary(engine, view.system)}
          {engine.kind !== 'turbofan' && <span className="dim"> {otherPower(engine.power / 1000, view.system)}</span>}
        </dd>
        <dt>Available here</dt>
        <dd>
          {num(climb.lapse * 100)} % <span className="dim">of sea-level {engine.kind === 'turbofan' ? 'thrust' : 'power'}</span>
        </dd>
        <dt>
          Best rate, <Sub symbol="V" sub="y" />
        </dt>
        <dd>
          {fpm(vy.rocFpm)} <span className="dim">at {axisSpeed(vy.speeds, view)}</span>
        </dd>
        <dt title="ROC = (P_A − P_R)/W assumes the wing still carries the whole weight. In a climb it carries W cos γ, so induced drag falls a little.">
          Small-angle (P<sub>A</sub> − P<sub>R</sub>)/W
        </dt>
        <dd>
          {fpm(vy.rocSmallAngleFpm)}{' '}
          <span className="dim">exact is {signed(delta * 100, Math.abs(delta) < 0.1 ? 2 : 1)} %</span>
        </dd>
        <dt>
          Best angle, <Sub symbol="V" sub="x" />
        </dt>
        <dd>
          {num(deg(vx.gamma), 1)}° <span className="dim">{num(Math.tan(vx.gamma) * 100, 1)} % gradient, at {axisSpeed(vx.speeds, view)}</span>
        </dd>
        <dt>
          Maximum level speed, <Sub symbol="V" sub="max" />
        </dt>
        <dd>
          {vmax ? axisSpeed(vmax.speeds, view) : 'none here'}
          {vmax?.beyondModel && <span className="tag">past M 0.7</span>}
        </dd>
        <dt>Service ceiling</dt>
        <dd>
          {climb.serviceCeilingFt === null ? 'out of reach' : ftValue(climb.serviceCeilingFt)}{' '}
          <span className="dim">100 ft/min</span>
        </dd>
        <dt>Absolute ceiling</dt>
        <dd>{climb.absoluteCeilingFt === null ? 'out of reach' : ftValue(climb.absoluteCeilingFt)}</dd>
        {climb.serviceCeilingMach !== null && climb.serviceCeilingMach >= 0.7 && (
          <>
            <dt>Caution</dt>
            <dd className="caution">
              V<sub>y</sub> at the service ceiling is M {num(climb.serviceCeilingMach, 2)}, past where the polar holds: the
              ceilings are optimistic.
            </dd>
          </>
        )}
        {(vy.beyondModel || vx.beyondModel) && (
          <>
            <dt>Caution</dt>
            <dd className="caution">Climb speeds past Mach 0.7 here: the polar has no wave drag.</dd>
          </>
        )}
        {climb.propEfficiencyAtVy !== null && (
          <>
            <dt title="Thrust power over shaft power at V_y, implied by the propeller model">Propeller efficiency at V_y</dt>
            <dd>{num(climb.propEfficiencyAtVy, 2)}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

// --- Glide -----------------------------------------------------------------

export function GlidePanel({ model, view }: { model: ChartModel; view: ViewSettings }) {
  const { best, minSink, distanceToSeaLevel } = model.glide;
  const deg = (rad: number) => (rad * 180) / Math.PI;
  return (
    <section className="card table-card" aria-labelledby="glide-h">
      <h3 id="glide-h">Glide</h3>
      <p className="card-sub">Power off, still air, at {mass(model.weight / G0, view.system)}.</p>
      <dl className="readout">
        <dt>Best glide ratio</dt>
        <dd>
          {num(best.ratio, 1)} : 1 <span className="dim">{num(deg(best.gamma), 1)}° below the horizon</span>
        </dd>
        <dt>Best glide speed</dt>
        <dd>
          {axisSpeed(best.speeds, view)} <span className="dim">sinking {fpm(best.sinkFpm)}</span>
        </dd>
        <dt>Minimum sink</dt>
        <dd>
          {fpm(minSink.sinkFpm)} <span className="dim">at {axisSpeed(minSink.speeds, view)}</span>
          {minSink.limitedByStall && <span className="tag">at the stall</span>}
        </dd>
        <dt>From this altitude</dt>
        <dd>
          {nm(distanceToSeaLevel)} <span className="dim">to sea level</span>
        </dd>
      </dl>
    </section>
  );
}

// --- Atmosphere -------------------------------------------------------------

export function AtmospherePanel({ model, view }: { model: ChartModel; view: ViewSettings }) {
  const a = model.atmosphere;
  return (
    <section className="card table-card" aria-labelledby="atmosphere-h">
      <h3 id="atmosphere-h">Atmosphere</h3>
      <dl className="readout">
        <dt>Pressure altitude</dt>
        <dd>
          {feet(a.pressureAltitude)} <span className="dim">{num(a.pressureAltitude)} m</span>
        </dd>
        <dt title="The real height of this pressure level, if sea-level pressure is 1013.25 hPa and the ISA deviation holds all the way up. Warm air stretches the column.">
          True altitude <span className="dim">at 1013.25 hPa</span>
        </dt>
        <dd>
          {feet(a.geometricAltitude)} <span className="dim">{num(a.geometricAltitude)} m</span>
        </dd>
        <dt>OAT</dt>
        <dd>
          {num(a.temperature - 273.15, 1)} °C{' '}
          <span className="dim">ISA {a.deltaISA === 0 ? '±0' : signed(a.deltaISA, Number.isInteger(a.deltaISA) ? 0 : 1)}</span>
        </dd>
        <dt>Pressure</dt>
        <dd>
          {num(a.pressure / 100, 1)} hPa <span className="dim">{num(a.pressure / 3386.389, 2)} inHg</span>
        </dd>
        <dt>Density</dt>
        <dd>
          {view.system === 'us' ? `${num(a.density * SLUG_FT3_PER_KG_M3, 6)} slug/ft³` : `${num(a.density, 4)} kg/m³`}{' '}
          <span className="dim">σ {num(a.densityRatio, 3)}</span>
        </dd>
        <dt>Speed of sound</dt>
        <dd>{speed(a.speedOfSound, 'kt')}</dd>
        <dt>Density altitude</dt>
        <dd>{feet(a.densityAltitude)}</dd>
      </dl>
    </section>
  );
}

