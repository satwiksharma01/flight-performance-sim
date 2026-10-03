import { G0, turnRadius, turnRate, type AirspeedSet } from '../../physics/index.js';
import { toUnit, type ChartModel, type MarkerView, type ViewSettings } from '../model.js';
import { UNIT_NAME, axisSpeed, feet, horsepower, mach, num, signed, speed } from '../format.js';

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

export function Tiles({ model, view }: { model: ChartModel; view: ViewSettings }) {
  const stall = model.markers.find((m) => m.kind === 'stall');
  const minDrag = model.markers.find((m) => m.kind === 'min-drag');
  const { atmosphere } = model;

  return (
    <div className="tiles">
      <div className="card tile">
        <span className="tile-label">Density altitude</span>
        <span className="tile-value">{feet(atmosphere.densityAltitude)}</span>
        <span className="tile-sub">
          PA {feet(atmosphere.pressureAltitude)} · OAT {num(atmosphere.temperature - 273.15)} °C
        </span>
      </div>
      {stall && (
        <div className="card tile">
          <span className="tile-label">
            Stall speed, <Sub symbol="V" sub="s" />
          </span>
          <span className="tile-value">{axisSpeed(stall.speeds, view)}</span>
          <span className="tile-sub">{otherSpeeds(stall.speeds, view)}</span>
        </div>
      )}
      {minDrag && (
        <div className="card tile">
          <span className="tile-label">
            Best glide, <Sub symbol="V" sub="md" />
          </span>
          <span className="tile-value">{axisSpeed(minDrag.speeds, view)}</span>
          <span className="tile-sub">{otherSpeeds(minDrag.speeds, view)}</span>
        </div>
      )}
      <div className="card tile">
        <span className="tile-label">Best lift-to-drag</span>
        <span className="tile-value">{num(model.maxLiftToDrag, 1)}</span>
        <span className="tile-sub">Glide {num(model.maxLiftToDrag, 1)} : 1, fixed by the polar</span>
      </div>
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
                <td className="n">{num(m.point.drag)} N</td>
                <td className="n">{num(m.point.powerRequired / 1000, 1)} kW</td>
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
        Speeds in {UNIT_NAME[unit]}, at {num(model.weight / G0)} kg
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
        <dd>{num(point.drag)} N</dd>
        <dt>Parasite / induced</dt>
        <dd>
          {num(point.parasiteDrag)} / {num(point.inducedDrag)} N
        </dd>
        <dt>Power required</dt>
        <dd>
          {num(point.powerRequired / 1000, 1)} kW <span className="dim">{horsepower(point.powerRequired / 1000)}</span>
        </dd>
        <dt>L/D</dt>
        <dd>{num(point.liftToDrag, 2)}</dd>
        <dt title="Weight over pressure ratio. Jet performance collapses onto W/δ and Mach.">W/δ</dt>
        <dd>{num(model.weight / model.atmosphere.pressureRatio)} N</dd>
        {model.loadFactor > 1 && (
          <>
            <dt>Turn radius</dt>
            <dd>
              {num(turnRadius(s.tas, model.loadFactor))} m{' '}
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

// --- Atmosphere -------------------------------------------------------------

export function AtmospherePanel({ model }: { model: ChartModel }) {
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
          {num(a.density, 4)} kg/m³ <span className="dim">σ {num(a.densityRatio, 3)}</span>
        </dd>
        <dt>Speed of sound</dt>
        <dd>{speed(a.speedOfSound, 'kt')}</dd>
        <dt>Density altitude</dt>
        <dd>{feet(a.densityAltitude)}</dd>
      </dl>
    </section>
  );
}

