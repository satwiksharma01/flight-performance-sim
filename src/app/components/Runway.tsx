import type { ReactNode } from 'react';
import { tasToCas, type AtmosphereState } from '../../physics/index.js';
import { RUNWAY_SURFACES, type LandingDistances, type TakeoffDistances } from '../../physics/performance/field.js';
import type { DistanceChart, RunwayModel } from '../runway.js';
import { SYSTEM_UNITS, toLength, type ViewSettings } from '../model.js';
import { feet, length, num, speed, tick } from '../format.js';
import { Chart } from './Chart.js';

const FT = 0.3048;

interface Props {
  readonly runway: RunwayModel;
  readonly view: ViewSettings;
  readonly theme: string;
  readonly onAltitude: (altitudeFt: number) => void;
}

function cas(tas: number, atmosphere: AtmosphereState, view: ViewSettings): string {
  return `${speed(tasToCas(tas, atmosphere.pressure, atmosphere.speedOfSound), view.unit)} CAS`;
}

export function RunwayTab({ runway, view, theme, onAltitude }: Props) {
  const { atmosphere, takeoff, landing, takeoffChart, landingChart, pohApplies } = runway;
  const unit = SYSTEM_UNITS[view.system].length;
  const surface = RUNWAY_SURFACES[runway.surface];
  const altitudeFt = atmosphere.pressureAltitude / FT;

  const distanceChart = (title: string, description: string, chart: DistanceChart, current: { total: number; groundRoll: number } | null) => (
    <Chart
      title={title}
      description={description}
      x={chart.x}
      series={[
        { label: 'Over 50 ft', values: chart.total, colorVar: '--series-1', directLabel: 'Over 50 ft' },
        { label: 'Ground roll', values: chart.groundRoll, colorVar: '--series-1', dash: [6, 4], directLabel: 'Ground roll' },
        ...(chart.pohTotal && chart.pohGroundRoll
          ? [
              { label: 'POH, over 50 ft', values: chart.pohTotal, colorVar: '--series-2', pointsOnly: true },
              { label: 'POH, ground roll', values: chart.pohGroundRoll, colorVar: '--series-2', pointsOnly: true },
            ]
          : []),
      ]}
      xMax={10000}
      yMax={chart.yMax}
      xLabel="Pressure altitude (ft)"
      yLabel={`Distance (${unit})`}
      formatX={(v) => num(v)}
      formatY={tick}
      markers={[]}
      bands={[]}
      selectedX={altitudeFt}
      selectedY={current ? [toLength(current.total, view.system), toLength(current.groundRoll, view.system)] : []}
      emptyReason={null}
      height={260}
      theme={theme}
      onPick={(ft) => onAltitude(ft)}
      syncKey="field"
    />
  );

  const day = atmosphere.deltaISA === 0 ? 'a standard day' : `ISA ${atmosphere.deltaISA > 0 ? '+' : '−'}${num(Math.abs(atmosphere.deltaISA))} °C`;

  return (
    <>
      <p className="tab-intro">
        Short-field technique over a 50 ft obstacle, on {surface.label.toLowerCase()}
        {runway.headwind === 0 ? ', calm' : runway.headwind > 0 ? `, ${speed(runway.headwind, view.unit)} headwind` : `, ${speed(-runway.headwind, view.unit)} tailwind`}
        , on {day}. Density altitude here: {feet(atmosphere.densityAltitude)}.
        {pohApplies && (
          <>
            {' '}
            Dots are the 172S POH’s tables, interpolated to this day; the model runs 13–22 % short of them, for reasons set out on the{' '}
            <a href="./validation.html#c172-field">validation page</a>.
          </>
        )}
      </p>

      <div className="charts">
        {takeoffChart
          ? distanceChart(
              'Takeoff distance',
              'Full power from brake release to 50 ft, against pressure altitude on this ISA day. Click to set the altitude.',
              takeoffChart,
              takeoff.ok ? takeoff : null,
            )
          : (
            <div className="card chart chart-note">
              <h3>Takeoff distance</h3>
              <p>No engine: a glider is launched by aerotow or winch.</p>
            </div>
          )}
        {distanceChart(
          'Landing distance',
          'From 50 ft on a 3° approach to a stop, engine idle, maximum braking, against pressure altitude on this ISA day. Click to set the altitude.',
          landingChart,
          landing.ok ? landing : null,
        )}
      </div>

      <div className="tables tables--even">
        <section className="card table-card" aria-labelledby="to-h">
          <h3 id="to-h">Takeoff</h3>
          {takeoff.ok ? (
            <>
              <SegmentBar
                segments={[
                  { label: 'Ground run', metres: takeoff.groundRun, tone: 1 },
                  { label: 'Rotation', metres: takeoff.rotation, tone: 2 },
                  { label: 'Transition', metres: takeoff.transition, tone: 3 },
                  { label: 'Climb', metres: takeoff.climb, tone: 4 },
                ]}
                view={view}
              />
              <TakeoffReadout r={takeoff} atmosphere={atmosphere} view={view} />
            </>
          ) : (
            <p className="caution">{takeoff.reason}</p>
          )}
        </section>

        <section className="card table-card" aria-labelledby="ld-h">
          <h3 id="ld-h">Landing</h3>
          {landing.ok ? (
            <>
              <SegmentBar
                segments={[
                  { label: 'Approach', metres: landing.approach, tone: 4 },
                  { label: 'Flare', metres: landing.flare, tone: 3 },
                  { label: 'Free roll', metres: landing.freeRoll, tone: 2 },
                  { label: 'Braking', metres: landing.braking, tone: 1 },
                ]}
                view={view}
              />
              <LandingReadout r={landing} atmosphere={atmosphere} view={view} />
            </>
          ) : (
            <p className="caution">{landing.reason}</p>
          )}
        </section>

        <section className="card table-card" aria-labelledby="method-h">
          <h3 id="method-h">Method</h3>
          <dl className="readout">
            <Row label="Runway" value={surface.label} dim={`μ ${num(surface.rolling, 2)} rolling, ${num(surface.braking, 3)} braking`} />
            <Row label="Ground run" value="integrated exactly" dim="m dV/dt = T − D − μ(W − L)" />
            <Row
              label="Speeds"
              value="Raymer"
              dim={<>lift-off 1.1 V<sub>s</sub>, 50 ft 1.15 V<sub>s</sub>; approach 1.3 V<sub>s0</sub>, touchdown 1.15 V<sub>s0</sub></>}
            />
            <Row label="Not modelled" value="flap drag, ground effect, slope" dim="see the validation page for what that costs" />
          </dl>
        </section>
      </div>
    </>
  );
}

interface Segment {
  readonly label: string;
  readonly metres: number;
  readonly tone: 1 | 2 | 3 | 4;
}

/** The distance split into its phases, to scale. */
function SegmentBar({ segments, view }: { segments: readonly Segment[]; view: ViewSettings }) {
  const total = segments.reduce((a, s) => a + s.metres, 0);
  const shown = segments.filter((s) => s.metres > 0);
  return (
    <div className="segments" role="img" aria-label={shown.map((s) => `${s.label} ${length(s.metres, view.system)}`).join(', ')}>
      <div className="segments-bar">
        {shown.map((s) => (
          <span key={s.label} className={`segment segment--${s.tone}`} style={{ flexGrow: s.metres / total }} />
        ))}
      </div>
      <ul className="segments-key">
        {shown.map((s) => (
          <li key={s.label}>
            <span className={`swatch segment--${s.tone}`} />
            {s.label} <span className="dim">{length(s.metres, view.system)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TakeoffReadout({ r, atmosphere, view }: { r: TakeoffDistances; atmosphere: AtmosphereState; view: ViewSettings }) {
  return (
    <dl className="readout">
      <Row label="Ground roll" value={length(r.groundRoll, view.system)} dim="run and rotation" strong />
      <Row label="Over 50 ft" value={length(r.total, view.system)} strong />
      <Row label="Stall, takeoff flap" value={cas(r.stallSpeed, atmosphere, view)} dim={`${speed(r.stallSpeed, view.unit)} TAS`} />
      <Row label="Lift-off" value={cas(r.liftOffSpeed, atmosphere, view)} dim={`${speed(r.liftOffSpeed, view.unit)} TAS`} />
      <Row label="At 50 ft" value={cas(r.obstacleSpeed, atmosphere, view)} dim={`${speed(r.obstacleSpeed, view.unit)} TAS`} />
      <Row label="Climb gradient" value={`${num(Math.tan(r.climbAngle) * 100, 1)} %`} dim={`${num((r.climbAngle * 180) / Math.PI, 1)}°`} />
      <Row label="Ground-run CL" value={num(r.groundCl, 2)} dim="least rolling resistance" />
    </dl>
  );
}

function LandingReadout({ r, atmosphere, view }: { r: LandingDistances; atmosphere: AtmosphereState; view: ViewSettings }) {
  return (
    <dl className="readout">
      <Row label="Ground roll" value={length(r.groundRoll, view.system)} dim="free roll and braking" strong />
      <Row label="From 50 ft" value={length(r.total, view.system)} strong />
      <Row label="Stall, landing flap" value={cas(r.stallSpeed, atmosphere, view)} dim={`${speed(r.stallSpeed, view.unit)} TAS`} />
      <Row label="Approach" value={cas(r.approachSpeed, atmosphere, view)} dim={`${num((r.approachAngle * 180) / Math.PI, 0)}° path`} />
      <Row label="Touchdown" value={cas(r.touchdownSpeed, atmosphere, view)} dim={`${speed(r.touchdownSpeed, view.unit)} TAS`} />
    </dl>
  );
}

function Row({ label, value, dim, strong }: { label: ReactNode; value: ReactNode; dim?: ReactNode; strong?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {strong ? <strong>{value}</strong> : value} {dim && <span className="dim">{dim}</span>}
      </dd>
    </>
  );
}
