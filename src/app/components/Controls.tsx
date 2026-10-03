import { useEffect, useId, useState, type ReactNode } from 'react';
import { AIRCRAFT_LIMITS, G0, bankForLoadFactor, type Aircraft } from '../../physics/index.js';
import { PRESETS, PRESET_IDS, type PresetId } from '../../data/aircraft/presets.js';
import type { ChartModel, SpeedAxis, SpeedUnit, ViewSettings } from '../model.js';
import { AXIS_NAME, UNIT_NAME, axisSpeed, feet, num, signed } from '../format.js';

const FT_PER_M = 1 / 0.3048;

// --- Aircraft ---------------------------------------------------------------

interface FieldSpec {
  readonly key: Exclude<keyof Aircraft, 'name'>;
  readonly label: string;
  readonly unit?: string;
  readonly hint: string;
  /** May be left blank: the aircraft simply doesn't have it */
  readonly optional?: boolean;
}

const FIELDS: readonly FieldSpec[] = [
  { key: 'mass', label: 'Max takeoff mass', unit: 'kg', hint: 'The weight slider flies anything up to this.' },
  { key: 'wingArea', label: 'Wing area', unit: 'm²', hint: 'Reference area S.' },
  { key: 'aspectRatio', label: 'Aspect ratio', hint: 'b²/S. Higher means less induced drag.' },
  { key: 'oswaldEfficiency', label: 'Oswald efficiency', hint: 'Span efficiency e.' },
  { key: 'cd0', label: 'CD₀', hint: 'Zero-lift drag coefficient.' },
  { key: 'clMax', label: 'CL max', hint: 'Clean maximum lift coefficient.' },
  {
    key: 'clMaxFlaps',
    label: 'CL max, flaps',
    hint: 'Landing-flap maximum lift coefficient. Leave blank for none.',
    optional: true,
  },
];

/** The same ranges a permalink is held to, so the editor can't make a link that won't load. */
function validate(spec: FieldSpec, raw: string): { value: number | null } | { error: string } {
  if (raw.trim() === '') return spec.optional ? { value: null } : { error: 'Enter a number.' };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { error: 'Enter a number.' };
  const { min, max } = AIRCRAFT_LIMITS[spec.key];
  if (value < min || value > max) {
    const show = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 6 });
    return { error: `Between ${show(min)} and ${show(max)}.` };
  }
  return { value };
}

function NumberField({
  spec,
  value,
  onCommit,
}: {
  spec: FieldSpec;
  value: number | undefined;
  onCommit: (value: number | null) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  const [error, setError] = useState<string | null>(null);

  // Follow outside changes (a preset switch, a reset) unless the draft already
  // means the same number — otherwise typing "0.0" would be rewritten to "0".
  useEffect(() => {
    const same = value === undefined ? draft.trim() === '' : Number(draft) === value;
    if (!same) {
      setDraft(value === undefined ? '' : String(value));
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
        placeholder={spec.optional ? 'none' : undefined}
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
  onEdit: (key: FieldSpec['key'], value: number | null) => void;
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

/** FL350 for 35,000 ft: a flight level is pressure altitude in hundreds of feet. */
function flightLevel(feet: number): string {
  return `FL${String(Math.round(feet / 100)).padStart(3, '0')}`;
}

/**
 * OAT, the way a POH chart or a flight-test card states temperature. Typing one
 * sets the ISA deviation, so this field and the slider above always agree.
 */
function OatField({
  oat,
  standard,
  onCommit,
}: {
  oat: number;
  standard: number;
  onCommit: (oat: number) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(oat.toFixed(1));
  const [error, setError] = useState<string | null>(null);

  // Follow the slider, but leave the draft alone while it already says the
  // same temperature: typing "30" must not be rewritten to "30.0" mid-edit.
  useEffect(() => {
    if (!(Math.abs(Number(draft) - oat) < 0.05)) {
      setDraft(oat.toFixed(1));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oat]);

  return (
    <div className="inline-field">
      <label htmlFor={id}>OAT</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={draft}
        aria-invalid={error !== null}
        aria-describedby={`${id}-std`}
        onBlur={() => {
          // Leaving the field abandons an entry that was never applied.
          if (error) {
            setDraft(oat.toFixed(1));
            setError(null);
          }
        }}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const value = Number(raw);
          if (raw.trim() === '' || !Number.isFinite(value)) {
            setError('Enter a temperature.');
          } else if (Math.abs(value - standard) > 60) {
            setError(`That is ISA ${signed(value - standard)} °C; the model takes up to ±60.`);
          } else {
            setError(null);
            onCommit(value);
          }
        }}
      />
      <span className="unit">°C</span>
      <span className="dim" id={`${id}-std`}>
        standard {num(standard, 1)} °C
      </span>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

export function ConditionPanel({
  altitude,
  deltaISA,
  model,
  view,
  onAltitude,
  onDeltaISA,
  onSpeed,
  maxMass,
  onMass,
  onBank,
}: {
  altitude: number;
  deltaISA: number;
  model: ChartModel;
  view: ViewSettings;
  onAltitude: (metres: number) => void;
  onDeltaISA: (kelvin: number) => void;
  onSpeed: (axisValue: number) => void;
  /** Max takeoff mass [kg], the top of the weight slider */
  maxMass: number;
  onMass: (kg: number) => void;
  onBank: (degrees: number) => void;
}) {
  const id = useId();
  const altitudeFt = Math.round(altitude * FT_PER_M);
  const standardC = model.atmosphere.standardTemperature - 273.15;
  const bankDegrees = (bankForLoadFactor(model.loadFactor) * 180) / Math.PI;
  const xMax = model.window.xMax;

  return (
    <section className="panel-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Flight condition</h2>
      <Slider
        label="Pressure altitude"
        value={altitudeFt}
        min={0}
        max={ALTITUDE_MAX_FT}
        step={100}
        readout={
          <>
            {altitudeFt >= 18_000 ? flightLevel(altitudeFt) : `${num(altitudeFt)} ft`}{' '}
            <span className="dim">{altitudeFt >= 18_000 ? `${num(altitudeFt)} ft` : `${num(altitude)} m`}</span>
          </>
        }
        onChange={(ft) => onAltitude(Math.round(ft * 0.3048 * 100) / 100)}
      />
      <Slider
        label="ISA deviation"
        value={deltaISA}
        min={-40}
        max={40}
        step={1}
        readout={deltaISA === 0 ? 'standard day' : `ISA ${signed(deltaISA, Number.isInteger(deltaISA) ? 0 : 1)} °C`}
        onChange={onDeltaISA}
      />
      <OatField
        oat={standardC + deltaISA}
        standard={standardC}
        onCommit={(oat) => onDeltaISA(Math.round((oat - standardC) * 100) / 100)}
      />
      <Slider
        label="Weight"
        value={model.weight / G0}
        min={0.4 * maxMass}
        max={maxMass}
        step={maxMass / 600}
        readout={
          <>
            {num(model.weight / G0)} kg{' '}
            <span className="dim">{num((100 * model.weight) / G0 / maxMass)} % MTOW</span>
          </>
        }
        onChange={(kg) => onMass(Math.round(kg * 10) / 10)}
      />
      <Slider
        label="Bank angle"
        value={bankDegrees}
        min={0}
        max={60}
        step={1}
        readout={
          model.loadFactor === 1 ? (
            'wings level'
          ) : (
            <>
              {num(bankDegrees)}° <span className="dim">n {num(model.loadFactor, 2)}</span>
            </>
          )
        }
        onChange={onBank}
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
