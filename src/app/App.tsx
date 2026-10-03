import { useCallback, useEffect, useMemo, useState } from 'react';
import { atPressureAltitude, vMinDrag, type Aircraft } from '../physics/index.js';
import { PRESETS, type PresetId } from '../data/aircraft/presets.js';
import { axisToTas, buildChartModel, type ChartModel, type ViewSettings } from './model.js';
import { canonicalize, readPermalink, writePermalink, type Permalink } from './permalink.js';
import { axisLabel, axisTick, tick } from './format.js';
import { Chart, type ChartBand, type ChartMarker } from './components/Chart.js';
import { AircraftPanel, ConditionPanel, ViewPanel } from './components/Controls.js';
import { AtmospherePanel, SelectedPanel, SpeedsTable, Tiles } from './components/Readouts.js';

const REPO_URL = 'https://github.com/satwiksharma01/Aerospace-Flight-Performance-Simulator';

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
      return { ...s, basePresetId: id, scenario: { ...s.scenario, presetId: id, aircraft, tas } };
    });

  const editAircraft = (key: keyof Aircraft, value: number) =>
    update((s) => ({
      ...s,
      scenario: { ...s.scenario, presetId: null, aircraft: { ...s.scenario.aircraft, [key]: value } },
    }));

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

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Flight Performance Simulator</h1>
          <p className="tagline">
            Drag, power and lift-to-drag for steady level flight, from a closed-form physics core. Every scenario is a
            link.
          </p>
        </div>
        <div className="top-actions">
          <button type="button" className="button" onClick={copyLink}>
            {copied ? 'Link copied' : 'Copy link'}
          </button>
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
            onEdit={editAircraft}
          />
          {model && (
            <ConditionPanel
              altitude={scenario.altitude}
              deltaISA={scenario.deltaISA}
              model={model}
              view={view}
              onAltitude={(altitude) => update((s) => ({ ...s, scenario: { ...s.scenario, altitude } }))}
              onDeltaISA={(deltaISA) => update((s) => ({ ...s, scenario: { ...s.scenario, deltaISA } }))}
              onSpeed={pickSpeed}
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
              <div className="charts">
                <Chart
                  wide
                  title="Drag"
                  description="Thrust required for level flight equals drag. Parasite drag grows with speed, induced drag falls, and the total is lowest where they cross."
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
                  ]}
                  xMax={model.window.xMax}
                  yMax={model.window.dragMax}
                  xLabel={axisLabel(view)}
                  yLabel="Drag (N)"
                  formatX={(v) => axisTick(v, view)}
                  formatY={tick}
                  markers={markersFor(model)}
                  bands={bandsFor(model)}
                  selectedX={model.selected.x}
                  selectedY={[
                    model.selected.point.drag,
                    model.selected.point.parasiteDrag,
                    model.selected.point.inducedDrag,
                  ]}
                  emptyReason={model.emptyReason}
                  height={320}
                  theme={theme}
                  onPick={pickSpeed}
                />
                <Chart
                  title="Power required"
                  description="Drag times true airspeed. Its minimum, at a slower speed than minimum drag, is the best endurance for a propeller aircraft."
                  x={model.x}
                  series={[{ label: 'Power', values: model.power, colorVar: '--series-1' }]}
                  xMax={model.window.xMax}
                  yMax={model.window.powerMax}
                  xLabel={axisLabel(view)}
                  yLabel="Power (kW)"
                  formatX={(v) => axisTick(v, view)}
                  formatY={tick}
                  markers={markersFor(model)}
                  bands={bandsFor(model)}
                  selectedX={model.selected.x}
                  selectedY={[model.selected.point.powerRequired / 1000]}
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
                  xMax={model.window.xMax}
                  yMax={model.window.liftToDragMax}
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
              </div>
              <div className="tables">
                <SpeedsTable model={model} view={view} />
                <SelectedPanel model={model} view={view} />
                <AtmospherePanel model={model} />
              </div>
            </>
          )}
        </main>
      </div>

      <footer className="footer">
        <p>
          <strong>Model.</strong> Parabolic drag polar, C<sub>D</sub> = C<sub>D0</sub> + kC<sub>L</sub>², in steady
          level flight at n = 1. Layered ISA atmosphere, entered as pressure altitude and ISA deviation or OAT, the way POH
          charts and flight-test cards state a condition. No compressibility: shaded from
          Mach 0.7, not drawn past Mach 0.9. The chart axes are fitted once per aircraft at sea level, so the sliders
          move the curves rather than the axes.
        </p>
        <p>
          Aircraft figures are simplified and representative, for education, not certification data. References: ISO
          2533 / US Standard Atmosphere 1976; Anderson, <em>Aircraft Performance and Design</em>; Hull,{' '}
          <em>Fundamentals of Airplane Flight Mechanics</em>.
        </p>
      </footer>
    </div>
  );
}
