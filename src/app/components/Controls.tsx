import { useEffect, useId, useState, type ReactNode } from 'react';
import { AIRCRAFT_LIMITS, type Aircraft } from '../../physics/index.js';
import { PRESETS, PRESET_IDS, type PresetId } from '../../data/aircraft/presets.js';
import type { ChartModel, SpeedAxis, SpeedUnit, ViewSettings } from '../model.js';
import { AXIS_NAME, UNIT_NAME, axisSpeed, feet, num, signed } from '../format.js';

const FT_PER_M = 1 / 0.3048;

// --- Aircraft ---------------------------------------------------------------

interface FieldSpec {
  readonly key: keyof Omit<Aircraft, 'name' | 'clMaxFlaps'>;
  readonly label: string;
  readonly unit?: string;
  readonly hint: string;
}

const FIELDS: readonly FieldSpec[] = [
  { key: 'mass', label: 'Mass', unit: 'kg', hint: 'Weight sets the lift the wing must make.' },
  { key: 'wingArea', label: 'Wing area', unit: 'm²', hint: 'Reference area S.' },
  { key: 'aspectRatio', label: 'Aspect ratio', hint: 'b²/S. Higher means less induced drag.' },
  { key: 'oswaldEfficiency', label: 'Oswald efficiency', hint: 'Span efficiency e.' },
  { key: 'cd0', label: 'CD₀', hint: 'Zero-lift drag coefficient.' },
  { key: 'clMax', label: 'CL max', hint: 'Clean maximum lift coefficient.' },
];

/** The same ranges a permalink is held to, so the editor can't make a link that won't load. */
function validate(spec: FieldSpec, raw: string): { value: number } | { error: string } {
  if (raw.trim() === '') return { error: 'Enter a number.' };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { error: 'Enter a number.' };
  const { min, max } = AIRCRAFT_LIMITS[spec.key];
  if (value < min || value > max) {
    return { error: `Between ${min.toLocaleString('en-US')} and ${max.toLocaleString('en-US')}.` };
  }
  return { value };
}

function NumberField({
  spec,
  value,
  onCommit,
}: {
  spec: FieldSpec;
  value: number;
  onCommit: (value: number) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);

  // Follow outside changes (a preset switch, a reset) unless the draft already
  // means the same number — otherwise typing "0.0" would be rewritten to "0".
  useEffect(() => {
    if (Number(draft) !== value) {
      setDraft(String(value));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="field">
      <label htmlFor={id} title={spec.hint}>
        {spec.label}
        {spec.unit && <span className="unit"> {spec.unit}</span>}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          const result = validate(spec, e.target.value);
          if ('error' in result) {
            setError(result.error);
          } else {
            setError(null);
            onCommit(result.value);
          }
        }}
      />
      {error && (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

export function AircraftPanel({
  aircraft,
  presetId,
  basePresetId,
  onPreset,
  onEdit,
}: {
  aircraft: Aircraft;
  presetId: string | null;
  basePresetId: string | null;
  onPreset: (id: PresetId) => void;
  onEdit: (key: FieldSpec['key'], value: number) => void;
}) {
  const id = useId();
  const modified = presetId === null;

  return (
    <section className="panel-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Aircraft</h2>
      <div className="select-row">
        <select
          aria-label="Aircraft preset"
          value={basePresetId ?? ''}
          onChange={(e) => onPreset(e.target.value as PresetId)}
        >
          {basePresetId === null && (
            <option value="" disabled>
              {aircraft.name} (custom)
            </option>
          )}
          {PRESET_IDS.map((pid) => (
            <option key={pid} value={pid}>
              {PRESETS[pid].name}
            </option>
          ))}
        </select>
        {modified && basePresetId !== null && (
          <button type="button" className="link-button" onClick={() => onPreset(basePresetId as PresetId)}>
            Reset
          </button>
        )}
      </div>
      {modified && <p className="note">{basePresetId ? 'Modified from the preset.' : 'Custom aircraft from the link.'}</p>}

      <details className="editor">
        <summary>Edit parameters</summary>
        <div className="fields">
          {FIELDS.map((spec) => (
            <NumberField
              key={spec.key}
              spec={spec}
              value={aircraft[spec.key]}
              onCommit={(v) => onEdit(spec.key, v)}
            />
          ))}
        </div>
      </details>
    </section>
  );
}

// --- Flight condition -------------------------------------------------------

function Slider({
  label,
  value,
  min,
  max,
  step,
  readout,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  readout: ReactNode;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="slider">
      <div className="slider-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{readout}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(Math.max(value, min), max)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export const ALTITUDE_MAX_FT = 45_000;

export function ConditionPanel({
  altitude,
  deltaISA,
  model,
  view,
  onAltitude,
  onDeltaISA,
  onSpeed,
}: {
  altitude: number;
  deltaISA: number;
  model: ChartModel;
  view: ViewSettings;
  onAltitude: (metres: number) => void;
  onDeltaISA: (kelvin: number) => void;
  onSpeed: (axisValue: number) => void;
}) {
  const id = useId();
  const altitudeFt = Math.round(altitude * FT_PER_M);
  const oat = model.atmosphere.temperature - 273.15;
  const xMax = model.window.xMax;

  return (
    <section className="panel-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Flight condition</h2>
      <Slider
        label="Altitude"
        value={altitudeFt}
        min={0}
        max={ALTITUDE_MAX_FT}
        step={100}
        readout={
          <>
            {num(altitudeFt)} ft <span className="dim">{num(altitude)} m</span>
          </>
        }
        onChange={(ft) => onAltitude(Math.round(ft * 0.3048 * 100) / 100)}
      />
      <Slider
        label="Temperature, ISA"
        value={deltaISA}
        min={-40}
        max={40}
        step={1}
        readout={
          <>
            {deltaISA === 0 ? 'standard' : `${signed(deltaISA)} °C`} <span className="dim">OAT {num(oat, 1)} °C</span>
          </>
        }
        onChange={onDeltaISA}
      />
      <Slider
        label="Selected speed"
        value={model.selected.x}
        min={xMax / 1000}
        max={xMax}
        step={xMax / 1000}
        readout={axisSpeed(model.selected.point.speeds, view)}
        onChange={onSpeed}
      />
      <p className="note">Or click and drag on any chart.</p>
      {model.atmosphere.densityAltitude > altitude + 1 && (
        <p className="note">
          Density altitude is {feet(model.atmosphere.densityAltitude)}: the wing feels thinner air than the altimeter
          shows.
        </p>
      )}
    </section>
  );
}

// --- View -------------------------------------------------------------------

function Segmented<T extends string>({
  label,
  options,
  value,
  names,
  disabled,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  names: Record<T, string>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="segmented" disabled={disabled}>
      <legend>{label}</legend>
      <div className="segments">
        {options.map((option) => (
          <label key={option} className={option === value ? 'segment is-active' : 'segment'}>
            <input
              type="radio"
              name={name}
              value={option}
              checked={option === value}
              onChange={() => onChange(option)}
            />
            {names[option]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const AXES: readonly SpeedAxis[] = ['tas', 'eas', 'cas', 'mach'];
const UNITS: readonly SpeedUnit[] = ['kt', 'mps', 'kmh'];

const HINTS: Record<SpeedAxis, string> = {
  tas:
    'Drag the altitude slider. Against true airspeed the whole curve slides right as the air thins. Then switch to EAS.',
  eas:
    'Against EAS the drag curve does not move with altitude at all: drag depends only on dynamic pressure, and EAS fixes it. Power required still rises, because power is drag × true airspeed.',
  cas:
    'CAS is what a perfect airspeed indicator reads. It equals EAS at sea level and drifts above it with altitude and speed, as compressibility grows.',
  mach:
    'Against Mach the curve moves right faster than against TAS: the speed of sound falls with temperature as you climb.',
};

export function ViewPanel({ view, onChange }: { view: ViewSettings; onChange: (view: ViewSettings) => void }) {
  const id = useId();
  return (
    <section className="panel-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Speed axis</h2>
      <Segmented
        label="Airspeed"
        options={AXES}
        value={view.axis}
        names={AXIS_NAME}
        onChange={(axis) => onChange({ ...view, axis })}
      />
      <Segmented
        label="Unit"
        options={UNITS}
        value={view.unit}
        names={UNIT_NAME}
        disabled={view.axis === 'mach'}
        onChange={(unit) => onChange({ ...view, unit })}
      />
      <p className="hint">{HINTS[view.axis]}</p>
    </section>
  );
}
