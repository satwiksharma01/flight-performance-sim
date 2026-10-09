import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  AIRCRAFT_LIMITS,
  DEFAULT_ENGINES,
  ENGINE_KINDS,
  G0,
  PROPULSION_LIMITS,
  BSFC_LB_PER_HP_H,
  TSFC_LB_PER_LBF_H,
  bankForLoadFactor,
  RUNWAY_SURFACES,
  STRUCTURE_LIMITS,
  SURFACE_IDS,
  weight,
  type Aircraft,
  CATEGORIES,
  type Category,
  type NumericLimit,
  type StructuralLimits,
  type SurfaceId,
  type EngineKind,
  type Propulsion,
} from '../../physics/index.js';
import { PRESETS, PRESET_IDS, type PresetId } from '../../data/aircraft/presets.js';
import {
  SYSTEM_UNITS,
  fromArea,
  fromMass,
  toArea,
  toMass,
  type ChartModel,
  type SpeedAxis,
  type SpeedUnit,
  type UnitSystem,
  type ViewSettings,
} from '../model.js';
import { AXIS_NAME, UNIT_NAME, axisSpeed, feet, mass, num, signed } from '../format.js';

const FT_PER_M = 1 / 0.3048;

// --- Aircraft ---------------------------------------------------------------

/**
 * One editable number. Stored in SI, shown in the chosen units, and held to the
 * same range a permalink is, so the editor can't make a link that won't load.
 */
interface FieldDef {
  readonly id: string;
  readonly label: string;
  readonly unit?: string;
  readonly hint: string;
  /** May be left blank: the aircraft simply doesn't have it */
  readonly optional?: boolean;
  /** Supported range, SI */
  readonly min: number;
  readonly max: number;
  readonly toDisplay: (si: number) => number;
  readonly fromDisplay: (shown: number) => number;
}

export type AircraftKey = Exclude<keyof Aircraft, 'name' | 'propulsion' | 'structure'>;

const identity = { toDisplay: (v: number) => v, fromDisplay: (v: number) => v };
const N_PER_LBF = 0.45359237 * 9.80665;
const W_PER_HP = 745.699872;
const MPS_PER_KT = 1852 / 3600;

function aircraftFields(system: UnitSystem): readonly (FieldDef & { readonly key: AircraftKey })[] {
  const L = AIRCRAFT_LIMITS;
  const range = (key: AircraftKey) => ({ min: L[key].min, max: L[key].max });
  return [
    {
      key: 'mass',
      id: 'mass',
      label: 'Max takeoff mass',
      unit: SYSTEM_UNITS[system].mass,
      hint: 'The weight slider flies anything up to this.',
      ...range('mass'),
      toDisplay: (v) => toMass(v, system),
      fromDisplay: (v) => fromMass(v, system),
    },
    {
      key: 'wingArea',
      id: 'wing-area',
      label: 'Wing area',
      unit: SYSTEM_UNITS[system].area,
      hint: 'Reference area S.',
      ...range('wingArea'),
      toDisplay: (v) => toArea(v, system),
      fromDisplay: (v) => fromArea(v, system),
    },
    { key: 'aspectRatio', id: 'ar', label: 'Aspect ratio', hint: 'b²/S. Higher means less induced drag.', ...range('aspectRatio'), ...identity },
    { key: 'oswaldEfficiency', id: 'e', label: 'Oswald efficiency', hint: 'Span efficiency e.', ...range('oswaldEfficiency'), ...identity },
    { key: 'cd0', id: 'cd0', label: 'CD₀', hint: 'Zero-lift drag coefficient.', ...range('cd0'), ...identity },
    { key: 'clMax', id: 'clmax', label: 'CL max', hint: 'Clean maximum lift coefficient.', ...range('clMax'), ...identity },
    {
      key: 'clMaxFlaps',
      id: 'clf',
      label: 'CL max, flaps',
      hint: 'Landing-flap maximum lift coefficient. Leave blank for none.',
      optional: true,
      ...range('clMaxFlaps'),
      ...identity,
    },
    {
      key: 'clMaxTakeoff',
      id: 'clto',
      label: 'CL max, takeoff flap',
      hint: 'Maximum lift coefficient at the takeoff flap setting. Leave blank to take off clean.',
      optional: true,
      ...range('clMaxTakeoff'),
      ...identity,
    },
    {
      key: 'emptyMass',
      id: 'oew',
      label: 'Empty mass',
      unit: SYSTEM_UNITS[system].mass,
      hint: 'Without fuel or payload. Blank: no range or payload-range.',
      optional: true,
      ...range('emptyMass'),
      toDisplay: (v) => toMass(v, system),
      fromDisplay: (v) => fromMass(v, system),
    },
    {
      key: 'fuelCapacity',
      id: 'fuel',
      label: 'Usable fuel',
      unit: SYSTEM_UNITS[system].mass,
      hint: 'Fuel mass the tanks hold. Blank: no range or payload-range.',
      optional: true,
      ...range('fuelCapacity'),
      toDisplay: (v) => toMass(v, system),
      fromDisplay: (v) => fromMass(v, system),
    },
  ];
}

/** Structural limits, speeds in knots EAS. */
function structureFields(): readonly (FieldDef & { readonly key: NumericLimit })[] {
  const L = STRUCTURE_LIMITS;
  const kt = { unit: 'KEAS', toDisplay: (v: number) => v / MPS_PER_KT, fromDisplay: (v: number) => v * MPS_PER_KT };
  return [
    { key: 'nPositive', id: 'nmax', label: 'Limit load factor, +', hint: '3.8 normal, 4.4 utility, 6 aerobatic category.', min: L.nPositive.min, max: L.nPositive.max, ...identity },
    { key: 'nNegative', id: 'nmin', label: 'Limit load factor, −', hint: '0.4 of the positive limit for normal and utility, 0.5 for aerobatic.', min: L.nNegative.min, max: L.nNegative.max, ...identity },
    { key: 'cruiseSpeed', id: 'vc', label: 'Design cruise, V_C', hint: 'Usually V_NO.', min: L.cruiseSpeed.min, max: L.cruiseSpeed.max, ...kt },
    { key: 'diveSpeed', id: 'vd', label: 'Design dive, V_D', hint: 'V_NE is 0.9 V_D.', min: L.diveSpeed.min, max: L.diveSpeed.max, ...kt },
    { key: 'clMin', id: 'clneg', label: 'CL at negative stall', hint: 'Rarely published; about −1 for a cambered light-aircraft wing.', min: L.clMin.min, max: L.clMin.max, ...identity },
  ];
}

/**
 * Starting limits for an aircraft that has none: normal category, with V_C at
 * the former 14 CFR 23.335 minimum, 33 sqrt(W/S) knots (W/S in lb/ft²), and V_D at
 * 1.4 V_C. For the 172S that gives V_C = 126 kt, its published V_NO.
 */
export function defaultStructure(aircraft: Aircraft): StructuralLimits {
  const psf = (weight(aircraft.mass) / aircraft.wingArea) / 47.880258980;
  const vc = Math.min(Math.max(33 * Math.sqrt(psf) * MPS_PER_KT, STRUCTURE_LIMITS.cruiseSpeed.min), STRUCTURE_LIMITS.cruiseSpeed.max / 1.4);
  return { nPositive: 3.8, nNegative: -1.52, cruiseSpeed: vc, diveSpeed: 1.4 * vc, clMin: Math.max(-0.65 * aircraft.clMax, STRUCTURE_LIMITS.clMin.min) };
}

/** The fields an engine of this kind has, each with a way to set it. */
function engineFields(
  engine: Propulsion,
  system: UnitSystem,
): readonly { readonly def: FieldDef; readonly value: number | undefined; readonly set: (v: number | null) => Propulsion }[] {
  const L = PROPULSION_LIMITS;
  const us = system === 'us';
  const force = {
    unit: us ? 'lbf' : 'N',
    toDisplay: (n: number) => (us ? n / N_PER_LBF : n),
    fromDisplay: (v: number) => (us ? v * N_PER_LBF : v),
  };
  const power = {
    unit: us ? 'hp' : 'kW',
    toDisplay: (w: number) => w / (us ? W_PER_HP : 1000),
    fromDisplay: (v: number) => v * (us ? W_PER_HP : 1000),
  };
  const lapse = (value: number, set: (v: number) => Propulsion) => ({
    def: {
      id: 'lx',
      label: 'Lapse exponent',
      hint: 'm in sigma^m: about 0.7 for a high-bypass fan, up to 1.',
      min: L.lapseExponent.min,
      max: L.lapseExponent.max,
      ...identity,
    },
    value,
    set: (v: number | null) => set(v ?? value),
  });
  const jet = engine.kind === 'turbofan';
  // Shown in the units engineers quote: lb/(hp h) or g/(kW h); lb/(lbf h) or g/(kN s).
  const sfcUnit = jet ? (us ? TSFC_LB_PER_LBF_H : 1e-6) : us ? BSFC_LB_PER_HP_H : 1e-3 / 3.6e6;
  const sfcField = {
    def: {
      id: 'sfc',
      label: 'Fuel consumption',
      unit: jet ? (us ? 'lb/(lbf h)' : 'g/(kN s)') : us ? 'lb/(hp h)' : 'g/(kW h)',
      hint: jet ? 'Thrust specific fuel consumption, in cruise.' : 'Brake specific fuel consumption, in cruise.',
      min: (jet ? L.tsfc : L.bsfc).min,
      max: (jet ? L.tsfc : L.bsfc).max,
      toDisplay: (v: number) => v / sfcUnit,
      fromDisplay: (v: number) => v * sfcUnit,
    },
    value: engine.sfc,
    set: (v: number | null) => ({ ...engine, sfc: v ?? engine.sfc }) as Propulsion,
  };

  if (engine.kind === 'turbofan') {
    return [
      {
        def: { id: 'ft', label: 'Static thrust', hint: 'Sea-level static thrust.', min: L.thrust.min, max: L.thrust.max, ...force },
        value: engine.thrust,
        set: (v) => ({ ...engine, thrust: v ?? engine.thrust }),
      },
      lapse(engine.lapseExponent, (v) => ({ ...engine, lapseExponent: v })),
      sfcField,
    ];
  }

  const propeller = engine.propeller;
  const propFields = [
    {
      def: {
        id: 'ts',
        label: 'Static thrust',
        hint: 'Propeller thrust at zero airspeed, full power, sea level.',
        min: L.staticThrust.min,
        max: L.staticThrust.max,
        ...force,
      },
      value: propeller.staticThrust,
      set: (v: number | null) => ({ ...engine, propeller: { ...propeller, staticThrust: v ?? propeller.staticThrust } }),
    },
    {
      def: {
        id: 'v0',
        label: 'Zero-thrust speed',
        unit: 'kt',
        hint: 'True airspeed where the straight thrust line would reach zero.',
        min: L.zeroThrustSpeed.min,
        max: L.zeroThrustSpeed.max,
        toDisplay: (v: number) => v / MPS_PER_KT,
        fromDisplay: (v: number) => v * MPS_PER_KT,
      },
      value: propeller.zeroThrustSpeed,
      set: (v: number | null) => ({ ...engine, propeller: { ...propeller, zeroThrustSpeed: v ?? propeller.zeroThrustSpeed } }),
    },
  ];
  const powerField = {
    def: { id: 'pw', label: 'Rated power', hint: 'Sea-level shaft power.', min: L.power.min, max: L.power.max, ...power },
    value: engine.power,
    set: (v: number | null) => ({ ...engine, power: v ?? engine.power }),
  };

  if (engine.kind === 'turboprop') {
    return [powerField, lapse(engine.lapseExponent, (v) => ({ ...engine, lapseExponent: v })), ...propFields, sfcField];
  }
  const { criticalAltitude: _critical, ...aspirated } = engine;
  return [
    powerField,
    {
      def: {
        id: 'hc',
        label: 'Critical altitude',
        unit: 'ft',
        hint: 'Turbocharged: full power up to this pressure altitude. Blank: normally aspirated.',
        optional: true,
        min: L.criticalAltitude.min,
        max: L.criticalAltitude.max,
        toDisplay: (m: number) => m * FT_PER_M,
        fromDisplay: (ft: number) => ft / FT_PER_M,
      },
      value: engine.criticalAltitude,
      set: (v) => (v === null ? aspirated : { ...engine, criticalAltitude: v }),
    },
    ...propFields,
    sfcField,
  ];
}

/** Seven significant figures: 2550 lb shows as 2550, not 2550.0000000001. */
function show(value: number): string {
  return String(Number(value.toPrecision(7)));
}

/** Checked in the displayed unit, then converted back to SI. */
function validate(def: FieldDef, raw: string): { value: number | null } | { error: string } {
  if (raw.trim() === '') return def.optional ? { value: null } : { error: 'Enter a number.' };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { error: 'Enter a number.' };
  const [min, max] = [def.toDisplay(def.min), def.toDisplay(def.max)].sort((a, b) => a - b) as [number, number];
  if (value < min * (1 - 1e-9) || value > max * (1 + 1e-9)) {
    const fmt = (v: number) => Number(v.toPrecision(4)).toLocaleString('en-US', { maximumFractionDigits: 6 });
    return { error: `Between ${fmt(min)} and ${fmt(max)}.` };
  }
  return { value: def.fromDisplay(value) };
}

function NumberField({
  def,
  value,
  onCommit,
}: {
  def: FieldDef;
  value: number | undefined;
  onCommit: (value: number | null) => void;
}) {
  const id = useId();
  const shown = value === undefined ? '' : show(def.toDisplay(value));
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState<string | null>(null);

  // Follow outside changes (a preset switch, a reset, a unit switch) unless the
  // draft already means the same number: typing "0.0" mustn't become "0".
  useEffect(() => {
    const same = value === undefined ? draft.trim() === '' : draft.trim() !== '' && show(Number(draft)) === shown;
    if (!same) {
      setDraft(shown);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  return (
    <div className="field">
      <label htmlFor={id} title={def.hint}>
        {def.label}
        {def.unit && <span className="unit"> {def.unit}</span>}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        placeholder={def.optional ? 'none' : undefined}
        value={draft}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          const result = validate(def, e.target.value);
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

const ENGINE_NAME: Record<EngineKind | 'none', string> = {
  none: 'None: a glider',
  piston: 'Piston',
  turboprop: 'Turboprop',
  turbofan: 'Turbofan',
};

function EngineEditor({
  engine,
  system,
  onChange,
}: {
  engine: Propulsion | undefined;
  system: UnitSystem;
  onChange: (engine: Propulsion | undefined) => void;
}) {
  const id = useId();
  return (
    <div className="engine-editor">
      <div className="field">
        <label htmlFor={id}>Engine</label>
        <select
          id={id}
          value={engine?.kind ?? 'none'}
          onChange={(e) => {
            const kind = e.target.value as EngineKind | 'none';
            onChange(kind === 'none' ? undefined : engine?.kind === kind ? engine : DEFAULT_ENGINES[kind]);
          }}
        >
          {(['none', ...ENGINE_KINDS] as const).map((kind) => (
            <option key={kind} value={kind}>
              {ENGINE_NAME[kind]}
            </option>
          ))}
        </select>
      </div>
      {engine && (
        <div className="fields">
          {engineFields(engine, system).map((f) => (
            <NumberField key={`${engine.kind}-${f.def.id}`} def={f.def} value={f.value} onCommit={(v) => onChange(f.set(v))} />
          ))}
        </div>
      )}
    </div>
  );
}

function StructureEditor({
  aircraft,
  onChange,
}: {
  aircraft: Aircraft;
  onChange: (structure: StructuralLimits | undefined) => void;
}) {
  const id = useId();
  const structure = aircraft.structure;
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="engine-editor">
      <div className="field">
        <label htmlFor={id}>Structural limits</label>
        <select
          id={id}
          value={structure ? 'set' : 'none'}
          onChange={(e) => {
            setProblem(null);
            onChange(e.target.value === 'none' ? undefined : defaultStructure(aircraft));
          }}
        >
          <option value="none">None: no V-n diagram</option>
          <option value="set">Set</option>
        </select>
      </div>
      {structure && (
        <div className="field">
          <label htmlFor={`${id}-cat`} title="Sets the negative limit at V_D: 0 for normal, −1.0 for utility and aerobatic.">
            Category
          </label>
          <select
            id={`${id}-cat`}
            value={structure.category ?? 'normal'}
            onChange={(e) => {
              const { category: _previous, ...rest } = structure;
              const category = e.target.value as Category;
              onChange(category === 'normal' ? rest : { ...rest, category });
            }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c[0]!.toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </div>
      )}
      {structure && (
        <div className="fields">
          {structureFields().map((def) => (
            <NumberField
              key={def.id}
              def={def}
              value={structure[def.key]}
              onCommit={(v) => {
                if (v === null) return;
                const next = { ...structure, [def.key]: v };
                if (next.diveSpeed <= next.cruiseSpeed) {
                  setProblem('V_D must be faster than V_C.');
                  return;
                }
                setProblem(null);
                onChange(next);
              }}
            />
          ))}
          {problem && <span className="field-error">{problem}</span>}
        </div>
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
  onEngine,
  onStructure,
  system,
}: {
  aircraft: Aircraft;
  presetId: string | null;
  basePresetId: string | null;
  system: UnitSystem;
  onPreset: (id: PresetId) => void;
  onEdit: (key: AircraftKey, value: number | null) => void;
  onEngine: (engine: Propulsion | undefined) => void;
  onStructure: (structure: StructuralLimits | undefined) => void;
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
          {aircraftFields(system).map((def) => (
            <NumberField key={def.key} def={def} value={aircraft[def.key]} onCommit={(v) => onEdit(def.key, v)} />
          ))}
        </div>
        <EngineEditor engine={aircraft.propulsion} system={system} onChange={onEngine} />
        <StructureEditor aircraft={aircraft} onChange={onStructure} />
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

/** The runway: surface and wind, for the takeoff and landing tab. */
export function RunwayPanel({
  surface,
  headwind,
  unit,
  onSurface,
  onHeadwind,
}: {
  surface: SurfaceId;
  headwind: number;
  unit: SpeedUnit;
  onSurface: (surface: SurfaceId) => void;
  onHeadwind: (metresPerSecond: number) => void;
}) {
  const id = useId();
  const perUnit = unit === 'kt' ? MPS_PER_KT : unit === 'kmh' ? 1 / 3.6 : 1;
  const shown = headwind / perUnit;
  const range = unit === 'kt' ? [-10, 30, 1] : unit === 'kmh' ? [-20, 55, 1] : [-5, 15, 0.5];
  const name = UNIT_NAME[unit];
  return (
    <section className="panel-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Runway</h2>
      <div className="field">
        <label htmlFor={id}>Surface</label>
        <select id={id} value={surface} onChange={(e) => onSurface(e.target.value as SurfaceId)}>
          {SURFACE_IDS.map((sid) => (
            <option key={sid} value={sid}>
              {RUNWAY_SURFACES[sid].label}
            </option>
          ))}
        </select>
      </div>
      <Slider
        label="Wind along the runway"
        value={shown}
        min={range[0]!}
        max={range[1]!}
        step={range[2]!}
        readout={
          shown === 0 ? 'calm' : shown > 0 ? `${num(shown, unit === 'mps' ? 1 : 0)} ${name} head` : `${num(-shown, unit === 'mps' ? 1 : 0)} ${name} tail`
        }
        onChange={(v) => onHeadwind(v * perUnit)}
      />
    </section>
  );
}

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
            {mass(model.weight / G0, view.system)}{' '}
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
const SYSTEMS: readonly UnitSystem[] = ['si', 'us'];
const SYSTEM_NAME: Record<UnitSystem, string> = { si: 'SI: N, kW, kg', us: 'US: lbf, hp, lb' };

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
        label="Speed unit"
        options={UNITS}
        value={view.unit}
        names={UNIT_NAME}
        disabled={view.axis === 'mach'}
        onChange={(unit) => onChange({ ...view, unit })}
      />
      <Segmented
        label="Force, power, weight"
        options={SYSTEMS}
        value={view.system}
        names={SYSTEM_NAME}
        onChange={(system) => onChange({ ...view, system })}
      />
      <p className="hint">{HINTS[view.axis]}</p>
    </section>
  );
}
