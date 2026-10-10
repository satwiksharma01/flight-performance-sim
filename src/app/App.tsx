import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  atPressureAltitude,
  easToTas,
  loadFactorForBank,
  vMinDrag,
  type Aircraft,
  type Propulsion,
  type StructuralLimits,
  type SurfaceId,
} from '../physics/index.js';
import { PRESETS, type PresetId } from '../data/aircraft/presets.js';
import { headwindOf, surfaceOf } from '../state/url.js';
import {
  SYSTEM_UNITS,
  axisToTas,
  buildChartModel,
  fromUnit,
  toForce,
  toPower,
  type ChartModel,
  type Tab,
  type ViewSettings,
} from './model.js';
import { buildEnvelopeModel, loadFactorForTurnRate } from './envelope.js';
import { buildRunwayModel } from './runway.js';
import { buildCruiseModel } from './cruise.js';
import { canonicalize, readPermalink, writePermalink, type Permalink } from './permalink.js';
import { axisLabel, axisTick, num, tick } from './format.js';
import { Chart, type ChartBand, type ChartMarker } from './components/Chart.js';
import { AddComparison, AircraftPanel, ConditionPanel, RunwayPanel, ViewPanel, type AircraftKey } from './components/Controls.js';
import { ComparisonTable } from './components/Compare.js';
import { buildComparison, unionWindow } from './compare.js';
import { AtmospherePanel, ClimbPanel, GlidePanel, SelectedPanel, SpeedsTable, Tiles } from './components/Readouts.js';
import { EnvelopeTab } from './components/Envelope.js';
import { RunwayTab } from './components/Runway.js';
import { CruiseTab } from './components/Cruise.js';
import { SensitivityTab } from './components/Sensitivity.js';
import { buildSensitivity } from './sensitivity.js';

const TAB_NAMES: Record<Tab, string> = {
  curves: 'Performance curves',
  envelope: 'Envelope and manoeuvre',
  field: 'Takeoff and landing',
  range: 'Range',
  sensitivity: 'Sensitivity',
};

const REPO_URL = 'https://github.com/satwiksharma01/flight-performance-sim';

// --- Aircraft edits, shared by the first aircraft and the comparison ---------

type AircraftEdit = (aircraft: Aircraft) => Aircraft;

const OPTIONAL: readonly AircraftKey[] = ['clMaxFlaps', 'clMaxTakeoff', 'emptyMass', 'fuelCapacity'];

/** Set a parameter, or remove an optional one with null. */
const fieldEdit =
  (key: AircraftKey, value: number | null): AircraftEdit =>
  (aircraft) => {
    if (value !== null) return { ...aircraft, [key]: value };
    if (!OPTIONAL.includes(key)) return aircraft;
    const { [key]: _removed, ...without } = aircraft;
    return without as Aircraft;
  };

const engineEdit =
  (engine: Propulsion | undefined): AircraftEdit =>
  (aircraft) => {
    const { propulsion: _previous, ...glider } = aircraft;
    return engine ? { ...glider, propulsion: engine } : glider;
  };

const structureEdit =
  (structure: StructuralLimits | undefined): AircraftEdit =>
  (aircraft) => {
    const { structure: _previous, ...bare } = aircraft;
    return structure ? { ...bare, structure } : bare;
  };

/** Rebuild the charts with fresh colours when the OS colour scheme flips. */
function useColorScheme(): 'light' | 'dark' {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark ? 'dark' : 'light';
}

/** True airspeed is stored to the centimetre per second; finer is noise in a URL. */
function roundTas(tas: number): number {
  return Math.min(Math.max(Math.round(tas * 100) / 100, 1), 1000);
}

function markersFor(model: ChartModel): ChartMarker[] {
  return model.markers.map((m) => {
    const [symbol = m.label, subscript = ''] = m.label.split('_');
    return { x: m.x, symbol, subscript, attainable: m.attainable };
  });
}

/** V_max joins the polar's markers wherever full-power thrust is drawn. */
function markersWithMaxSpeed(model: ChartModel): ChartMarker[] {
  const markers = markersFor(model);
  const vmax = model.climb?.vmax;
  return vmax ? [...markers, { x: vmax.x, symbol: 'V', subscript: 'max', attainable: true }] : markers;
}

function climbMarkers(model: ChartModel): ChartMarker[] {
  if (!model.climb) {
    return [
      { x: model.glide.minSink.x, symbol: 'V', subscript: 'ms', attainable: true },
      { x: model.glide.best.x, symbol: 'V', subscript: 'bg', attainable: true },
    ];
  }
  const { vx, vy, vmax } = model.climb;
  const markers: ChartMarker[] = [
    { x: vx.x, symbol: 'V', subscript: 'x', attainable: true },
    { x: vy.x, symbol: 'V', subscript: 'y', attainable: true },
  ];
  return vmax ? [...markers, { x: vmax.x, symbol: 'V', subscript: 'max', attainable: true }] : markers;
}

function bandsFor(model: ChartModel): ChartBand[] {
  const bands: ChartBand[] = [{ from: 0, to: model.stallX, label: 'Below stall' }];
  if (model.compressibilityX !== null) {
    bands.push({ from: model.compressibilityX, to: model.window.xMax, label: 'Mach > 0.7, not modelled' });
  }
  return bands;
}

export function App() {
  const initial = useMemo(() => readPermalink(window.location.search), []);
  const [state, setState] = useState<Permalink>(() => canonicalize(initial));
  const [problems, setProblems] = useState(initial.problems);
  const [copied, setCopied] = useState(false);
  const theme = useColorScheme();

  // Every change goes through the permalink, so the screen always shows exactly
  // what the link reproduces.
  const update = useCallback((change: (s: Permalink) => Permalink) => {
    setState((s) => canonicalize(change(s)));
  }, []);

  const query = writePermalink(state);
  useEffect(() => {
    // Debounced: browsers throttle replaceState, and a slider drag fires it
    // at 60 Hz.
    const timer = window.setTimeout(() => {
      window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [query]);

  const { scenario, view } = state;
  const result = useMemo(() => {
    try {
      return { model: buildChartModel(scenario, view), error: null };
    } catch (error) {
      return { model: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [scenario, view]);

  const selectPreset = (id: PresetId) =>
    update((s) => {
      const aircraft = PRESETS[id];
      const atmosphere = atPressureAltitude(s.scenario.altitude, s.scenario.deltaISA);
      // Land the selected speed on best L/D, where the new aircraft is interesting.
      const tas = roundTas(vMinDrag(aircraft, atmosphere.density));
      // A new aircraft starts at its own max takeoff mass; the bank angle stays.
      const { mass: _previousMass, ...rest } = s.scenario;
      return { ...s, basePresetId: id, scenario: { ...rest, presetId: id, aircraft, tas } };
    });

  // An operating mass above a newly lowered max takeoff mass fails the
  // permalink's check, so canonicalisation returns it to the maximum.
  const editFirst = (edit: AircraftEdit) =>
    update((s) => ({ ...s, scenario: { ...s.scenario, presetId: null, aircraft: edit(s.scenario.aircraft) } }));

  const editSecond = (edit: AircraftEdit) =>
    update((s) => (s.compare ? { ...s, compare: { ...s.compare, presetId: null, aircraft: edit(s.compare.aircraft) } } : s));

  const setComparison = (id: PresetId | null) =>
    update((s) => {
      const { compare: _previous, ...rest } = s;
      return id === null ? rest : { ...rest, compare: { aircraft: PRESETS[id], presetId: id, basePresetId: id } };
    });

  const setSurface = (surface: SurfaceId) =>
    update((s) => {
      const { surface: _previous, ...rest } = s.scenario;
      return { ...s, scenario: surface === 'dry-paved' ? rest : { ...rest, surface } };
    });

  const setHeadwind = (headwind: number) =>
    update((s) => {
      const { headwind: _previous, ...rest } = s.scenario;
      return { ...s, scenario: Math.abs(headwind) < 1e-9 ? rest : { ...rest, headwind: Math.round(headwind * 1000) / 1000 } };
    });

  const setAltitudeFt = (ft: number) =>
    update((s) => ({ ...s, scenario: { ...s.scenario, altitude: Math.round(ft) * 0.3048 } }));

  /** A load factor from a chart: n >= 1 sets the bank of a level turn; below 1, wings level. */
  const withLoadFactor = <T extends { scenario: Permalink['scenario'] }>(s: T, n: number): T => {
    const { loadFactor: _previous, ...rest } = s.scenario;
    const rounded = Math.round(Math.min(n, 10) * 1000) / 1000;
    return { ...s, scenario: rounded > 1 ? { ...rest, loadFactor: rounded } : rest };
  };

  const pickVn = (easShown: number, n: number) =>
    update((s) => {
      const atmosphere = atPressureAltitude(s.scenario.altitude, s.scenario.deltaISA);
      const tas = roundTas(easToTas(fromUnit(easShown, s.view.unit), atmosphere.density));
      return withLoadFactor({ ...s, scenario: { ...s.scenario, tas } }, n);
    });

  const pickTurn = (x: number, rate: number) =>
    update((s) => {
      const atmosphere = atPressureAltitude(s.scenario.altitude, s.scenario.deltaISA);
      const tas = roundTas(axisToTas(x, atmosphere, s.view));
      return withLoadFactor({ ...s, scenario: { ...s.scenario, tas } }, loadFactorForTurnRate(tas, Math.max(rate, 0)));
    });

  const pickEnergy = (x: number, ft: number) =>
    update((s) => {
      const altitude = Math.round(ft) * 0.3048;
      const atmosphere = atPressureAltitude(altitude, s.scenario.deltaISA);
      return { ...s, scenario: { ...s.scenario, altitude, tas: roundTas(axisToTas(x, atmosphere, s.view)) } };
    });

  const setOperatingMass = (mass: number) =>
    update((s) => {
      const { mass: _previous, ...rest } = s.scenario;
      return { ...s, scenario: mass >= s.scenario.aircraft.mass ? rest : { ...rest, mass } };
    });

  const setBank = (degrees: number) =>
    update((s) => {
      const { loadFactor: _previous, ...rest } = s.scenario;
      if (degrees <= 0) return { ...s, scenario: rest };
      return { ...s, scenario: { ...rest, loadFactor: loadFactorForBank((degrees * Math.PI) / 180) } };
    });

  const pickSpeed = (x: number) =>
    update((s) => {
      const atmosphere = atPressureAltitude(s.scenario.altitude, s.scenario.deltaISA);
      return { ...s, scenario: { ...s.scenario, tas: roundTas(axisToTas(x, atmosphere, s.view)) } };
    });

  const setView = (next: ViewSettings) => update((s) => ({ ...s, view: next }));

  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ''}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt('Copy this link', url);
    }
  };

  const model = result.model;

  // The comparison aircraft, flown at the same condition. The curves tab's
  // axes widen to hold both.
  const comparison = useMemo(
    () => (model && state.compare ? buildComparison(scenario, model, state.compare, view) : null),
    [model, scenario, state.compare, view],
  );
  const second = comparison && !('error' in comparison) ? comparison : null;
  const win = model ? (second ? unionWindow(model.window, second.model.window) : model.window) : null;
  const secondName = state.compare?.aircraft.name ?? '';
  const overlay = (x: readonly number[], values: readonly (number | null)[] | null | undefined, label: string) =>
    second && values ? { x, series: [{ label: `${label}, ${secondName}`, values, colorVar: '--compare', dash: [8, 4] }] } : undefined;

  // Only the visible tab's extra model is built: the P_s grid alone is a few
  // thousand evaluations.
  const envelope = useMemo(() => {
    if (view.tab !== 'envelope') return null;
    try {
      return buildEnvelopeModel(scenario, view);
    } catch {
      return null;
    }
  }, [scenario, view]);
  const cruise = useMemo(() => (view.tab === 'range' ? buildCruiseModel(scenario, view) : null), [scenario, view]);
  const sensitivity = useMemo(() => {
    if (view.tab !== 'sensitivity') return null;
    try {
      return buildSensitivity(scenario);
    } catch {
      return null;
    }
  }, [scenario, view.tab]);
  const runway = useMemo(() => {
    if (view.tab !== 'field') return null;
    try {
      return buildRunwayModel(scenario, view);
    } catch {
      return null;
    }
  }, [scenario, view]);

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Flight Performance Simulator</h1>
          <p className="tagline">
            Drag, power, climb and glide; the flight envelope and turns; takeoff and landing. From a physics core tested
            against an independent implementation and published data. Every scenario is a link.
          </p>
        </div>
        <div className="top-actions">
          <button type="button" className="button" onClick={copyLink}>
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          <a className="button button--quiet" href="./validation.html">
            Validation
          </a>
          <a className="button button--quiet" href={REPO_URL} target="_blank" rel="noreferrer">
            Source
          </a>
        </div>
      </header>

      {problems.length > 0 && (
        <div className="banner" role="status">
          <div>
            <strong>Part of this link couldn't be used.</strong>
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
          <button type="button" className="link-button" onClick={() => setProblems([])}>
            Dismiss
          </button>
        </div>
      )}

      <div className="layout">
        <aside className="card controls" aria-label="Controls">
          <AircraftPanel
            aircraft={scenario.aircraft}
            presetId={scenario.presetId}
            basePresetId={state.basePresetId}
            onPreset={selectPreset}
            onEdit={(key, value) => editFirst(fieldEdit(key, value))}
            onEngine={(engine) => editFirst(engineEdit(engine))}
            onStructure={(structure) => editFirst(structureEdit(structure))}
            system={view.system}
          />
          {state.compare ? (
            <AircraftPanel
              title="Compared with"
              aircraft={state.compare.aircraft}
              presetId={state.compare.presetId}
              basePresetId={state.compare.basePresetId}
              onPreset={setComparison}
              onEdit={(key, value) => editSecond(fieldEdit(key, value))}
              onEngine={(engine) => editSecond(engineEdit(engine))}
              onStructure={(structure) => editSecond(structureEdit(structure))}
              onRemove={() => setComparison(null)}
              system={view.system}
            />
          ) : (
            <AddComparison onAdd={setComparison} />
          )}
          {model && (
            <ConditionPanel
              altitude={scenario.altitude}
              deltaISA={scenario.deltaISA}
              model={model}
              view={view}
              onAltitude={(altitude) => update((s) => ({ ...s, scenario: { ...s.scenario, altitude } }))}
              onDeltaISA={(deltaISA) => update((s) => ({ ...s, scenario: { ...s.scenario, deltaISA } }))}
              onSpeed={pickSpeed}
              maxMass={scenario.aircraft.mass}
              onMass={setOperatingMass}
              onBank={setBank}
            />
          )}
          {view.tab === 'field' && (
            <RunwayPanel
              surface={surfaceOf(scenario)}
              headwind={headwindOf(scenario)}
              unit={view.unit}
              onSurface={setSurface}
              onHeadwind={setHeadwind}
            />
          )}
          <ViewPanel view={view} onChange={setView} />
        </aside>

        <main className="main">
          {!model ? (
            <div className="card banner banner--error" role="alert">
              <strong>This scenario can't be computed.</strong> {result.error}
            </div>
          ) : (
            <>
              <Tiles model={model} view={view} />
              <nav className="tabs" aria-label="Views">
                {(Object.keys(TAB_NAMES) as Tab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={tab === view.tab ? 'tab tab--active' : 'tab'}
                    aria-current={tab === view.tab ? 'page' : undefined}
                    onClick={() => setView({ ...view, tab })}
                  >
                    {TAB_NAMES[tab]}
                  </button>
                ))}
              </nav>
              {view.tab === 'envelope' && envelope && (
                <EnvelopeTab
                  envelope={envelope}
                  model={model}
                  view={view}
                  theme={theme}
                  onVnPick={pickVn}
                  onTurnPick={pickTurn}
                  onEnergyPick={pickEnergy}
                />
              )}
              {view.tab === 'range' && cruise && <CruiseTab cruise={cruise} view={view} theme={theme} />}
              {view.tab === 'sensitivity' && sensitivity && (
                <SensitivityTab model={sensitivity} comparing={state.compare !== undefined} />
              )}
              {view.tab === 'field' && runway && (
                <RunwayTab runway={runway} view={view} theme={theme} onAltitude={setAltitudeFt} />
              )}
              {view.tab === 'curves' && (
              <>
              <div className="charts">
                <Chart
                  wide
                  title="Drag"
                  description={
                    model.available
                      ? 'Thrust required for level flight equals drag. Parasite drag grows with speed and induced drag falls; the total is lowest where they cross. Full-power thrust meets drag at the maximum level speed.'
                      : 'Thrust required for level flight equals drag. Parasite drag grows with speed, induced drag falls, and the total is lowest where they cross.'
                  }
                  x={model.x}
                  series={[
                    { label: 'Total drag', values: model.drag, colorVar: '--series-1', directLabel: 'Total' },
                    {
                      label: 'Parasite',
                      values: model.parasiteDrag,
                      colorVar: '--series-2',
                      dash: [6, 4],
                      directLabel: 'Parasite',
                    },
                    {
                      label: 'Induced',
                      values: model.inducedDrag,
                      colorVar: '--series-3',
                      dash: [2, 3],
                      directLabel: 'Induced',
                    },
                    ...(model.available
                      ? [{ label: 'Thrust available', values: model.available.thrust, colorVar: '--ink', directLabel: 'Thrust available' }]
                      : []),
                  ]}
                  overlay={overlay(second?.model.x ?? [], second?.model.drag, 'Total drag')}
                  xMax={win!.xMax}
                  yMax={win!.dragMax}
                  xLabel={axisLabel(view)}
                  yLabel={`Drag (${SYSTEM_UNITS[view.system].force})`}
                  formatX={(v) => axisTick(v, view)}
                  formatY={tick}
                  markers={markersWithMaxSpeed(model)}
                  bands={bandsFor(model)}
                  selectedX={model.selected.x}
                  selectedY={[
                    toForce(model.selected.point.drag, view.system),
                    toForce(model.selected.point.parasiteDrag, view.system),
                    toForce(model.selected.point.inducedDrag, view.system),
                    ...(model.climb ? [toForce(model.climb.selected.thrust, view.system)] : []),
                  ]}
                  emptyReason={model.emptyReason}
                  height={320}
                  theme={theme}
                  onPick={pickSpeed}
                />
                <Chart
                  title="Power required"
                  description={
                    model.available
                      ? 'Drag times true airspeed. Its minimum is the best endurance for a propeller aircraft. The gap up to power available, divided by weight, is the rate of climb.'
                      : 'Drag times true airspeed. Its minimum, at a slower speed than minimum drag, is the best endurance for a propeller aircraft.'
                  }
                  x={model.x}
                  series={[
                    { label: 'Power required', values: model.power, colorVar: '--series-1', ...(model.available ? { directLabel: 'Required' } : {}) },
                    ...(model.available
                      ? [{ label: 'Power available', values: model.available.power, colorVar: '--ink', directLabel: 'Available' }]
                      : []),
                  ]}
                  overlay={overlay(second?.model.x ?? [], second?.model.power, 'Power required')}
                  xMax={win!.xMax}
                  yMax={win!.powerMax}
                  xLabel={axisLabel(view)}
                  yLabel={`Power (${SYSTEM_UNITS[view.system].power})`}
                  formatX={(v) => axisTick(v, view)}
                  formatY={tick}
                  markers={markersWithMaxSpeed(model)}
                  bands={bandsFor(model)}
                  selectedX={model.selected.x}
                  selectedY={[
                    toPower(model.selected.point.powerRequired / 1000, view.system),
                    ...(model.climb ? [toPower(model.climb.selected.powerAvailable, view.system)] : []),
                  ]}
                  emptyReason={model.emptyReason}
                  height={240}
                  theme={theme}
                  onPick={pickSpeed}
                />
                <Chart
                  title="Lift-to-drag ratio"
                  description="Peaks at minimum drag. Its height depends only on the polar; altitude and weight only move it sideways."
                  x={model.x}
                  series={[{ label: 'L/D', values: model.liftToDrag, colorVar: '--series-1' }]}
                  overlay={overlay(second?.model.x ?? [], second?.model.liftToDrag, 'L/D')}
                  xMax={win!.xMax}
                  yMax={win!.liftToDragMax}
                  xLabel={axisLabel(view)}
                  yLabel="L/D"
                  formatX={(v) => axisTick(v, view)}
                  formatY={tick}
                  markers={markersFor(model)}
                  bands={bandsFor(model)}
                  selectedX={model.selected.x}
                  selectedY={[model.selected.point.liftToDrag]}
                  emptyReason={model.emptyReason}
                  height={240}
                  theme={theme}
                  onPick={pickSpeed}
                />
                <Chart
                  wide={!model.climb}
                  title={model.climb ? 'Rate of climb' : 'Sink rate'}
                  description={
                    model.climb
                      ? 'Full power, wings level. The exact steady climb, the small-angle (P_A − P_R)/W, and the power-off sink polar below zero. V_y is the peak; V_x is the steepest climb.'
                      : 'The glider polar: sink rate against speed. Minimum sink is its peak; best glide is where a line from the origin just touches it.'
                  }
                  x={model.rateOfClimb.x}
                  series={[
                    ...(model.rateOfClimb.exact && model.rateOfClimb.smallAngle
                      ? [
                          { label: 'Full power', values: model.rateOfClimb.exact, colorVar: '--series-1', directLabel: 'Full power' },
                          { label: 'Small-angle', values: model.rateOfClimb.smallAngle, colorVar: '--series-2', dash: [6, 4] },
                        ]
                      : []),
                    { label: 'Power off', values: model.rateOfClimb.powerOff, colorVar: '--series-3', dash: [2, 3], directLabel: 'Power off' },
                  ]}
                  overlay={overlay(
                    second?.model.rateOfClimb.x ?? [],
                    second?.model.rateOfClimb.exact ?? second?.model.rateOfClimb.powerOff,
                    second?.model.rateOfClimb.exact ? 'Full power' : 'Power off',
                  )}
                  xMax={win!.xMax}
                  yMin={win!.rocMin}
                  yMax={win!.rocMax}
                  xLabel={axisLabel(view)}
                  yLabel="Rate of climb (ft/min)"
                  formatX={(v) => axisTick(v, view)}
                  formatY={tick}
                  markers={climbMarkers(model)}
                  bands={[
                    { from: 0, to: model.rateOfClimb.stallX, label: 'Below stall' },
                    ...bandsFor(model).slice(1),
                  ]}
                  selectedX={model.selected.x}
                  selectedY={[
                    ...(model.climb ? [model.rateOfClimb.selected.exact, model.rateOfClimb.selected.smallAngle] : []),
                    model.rateOfClimb.selected.powerOff,
                  ]}
                  emptyReason={model.rateOfClimb.x.length === 0 ? 'Here the whole curve lies beyond the right edge of the chart.' : null}
                  height={260}
                  theme={theme}
                  onPick={pickSpeed}
                />
                {model.climb && (
                  <Chart
                    title="Climb against altitude"
                    description="Best rate of climb at each pressure altitude, at this weight and ISA day: 100 ft/min at the service ceiling, zero at the absolute ceiling. Click to set the altitude."
                    x={model.climb.profile.altitudesFt}
                    series={[{ label: 'Best rate of climb', values: model.climb.profile.rocFpm, colorVar: '--series-1' }]}
                    overlay={overlay(second?.model.climb?.profile.altitudesFt ?? [], second?.model.climb?.profile.rocFpm, 'Best rate of climb')}
                    xMax={win!.altitudeMaxFt}
                    yMax={win!.rocMax}
                    xLabel="Pressure altitude (ft)"
                    yLabel="Best rate of climb (ft/min)"
                    formatX={(v) => num(v)}
                    formatY={tick}
                    markers={[
                      ...(model.climb.serviceCeilingFt === null
                        ? []
                        : [{ x: model.climb.serviceCeilingFt, symbol: 'Service', subscript: '', attainable: true }]),
                      ...(model.climb.absoluteCeilingFt === null
                        ? []
                        : [{ x: model.climb.absoluteCeilingFt, symbol: 'Absolute', subscript: '', attainable: true }]),
                    ]}
                    bands={[]}
                    selectedX={scenario.altitude / 0.3048}
                    selectedY={[model.climb.vy.rocFpm]}
                    emptyReason={model.climb.profile.rocFpm[0] === null ? 'At this weight it cannot climb even at sea level.' : null}
                    height={260}
                    theme={theme}
                    onPick={(ft) => setAltitudeFt(ft)}
                  />
                )}
              </div>
              <div className="tables">
                {second && (
                  <ComparisonTable
                    rows={second.rows}
                    first={`${scenario.aircraft.name}${scenario.presetId === null ? ', edited' : ''}`}
                    second={`${secondName}${state.compare?.presetId === null ? ', edited' : ''}`}
                  />
                )}
                {comparison && 'error' in comparison && (
                  <div className="card banner banner--error" role="alert">
                    <strong>The comparison aircraft can't be computed.</strong> {comparison.error}
                  </div>
                )}
                <SpeedsTable model={model} view={view} />
                {scenario.aircraft.propulsion && (
                  <ClimbPanel model={model} view={view} engine={scenario.aircraft.propulsion} />
                )}
                <GlidePanel model={model} view={view} />
                <SelectedPanel model={model} view={view} />
                <AtmospherePanel model={model} view={view} />
              </div>
              </>
              )}
            </>
          )}
        </main>
      </div>

      <footer className="footer">
        <p>
          <strong>Model.</strong> Parabolic drag polar, C<sub>D</sub> = C<sub>D0</sub> + kC<sub>L</sub>², in steady
          flight at the chosen load factor. Layered ISA atmosphere, entered as pressure altitude and ISA deviation or OAT, the way POH
          charts and flight-test cards state a condition. No compressibility: shaded from
          Mach 0.7, not drawn past Mach 0.9. The chart axes are fitted once per aircraft at sea level, so the sliders
          move the curves rather than the axes.
        </p>
        <p>
          Aircraft figures are simplified and representative, for education, not certification data. References: ISO
          2533 / US Standard Atmosphere 1976; Anderson, <em>Aircraft Performance and Design</em>; Hull,{' '}
          <em>Fundamentals of Airplane Flight Mechanics</em>; Raymer, <em>Aircraft Design</em>; Gudmundsson,{' '}
          <em>General Aviation Aircraft Design</em>; 14 CFR Part 23 before Amendment 23-64.
        </p>
      </footer>
    </div>
  );
}
