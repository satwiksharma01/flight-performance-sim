import { describe, expect, it } from 'vitest';
import { CESSNA_172S } from '../src/data/aircraft/presets.js';
import { DEFAULT_SCENARIO } from '../src/state/url.js';
import { DEFAULT_VIEW } from '../src/app/model.js';
import {
  canonicalize,
  readPermalink,
  writePermalink,
  type Permalink,
} from '../src/app/permalink.js';

const DEFAULT_STATE: Permalink = {
  scenario: DEFAULT_SCENARIO,
  basePresetId: 'c172',
  view: DEFAULT_VIEW,
};

describe('writePermalink', () => {
  it('writes only the preset for the default state', () => {
    expect(writePermalink(DEFAULT_STATE)).toBe('ac=c172');
  });

  it('encodes an edited preset as a delta against it', () => {
    const edited: Permalink = {
      ...DEFAULT_STATE,
      scenario: { ...DEFAULT_SCENARIO, presetId: null, aircraft: { ...CESSNA_172S, mass: 900 } },
    };
    expect(writePermalink(edited)).toBe('ac=c172&m=900');
  });

  it('adds view settings only when they differ from the defaults', () => {
    const state: Permalink = { ...DEFAULT_STATE, view: { axis: 'eas', unit: 'mps' } };
    expect(writePermalink(state)).toBe('ac=c172&x=eas&u=mps');
  });
});

describe('readPermalink', () => {
  it('keeps the base preset of an edited aircraft', () => {
    const { scenario, basePresetId, problems } = readPermalink('?ac=c172&m=900');
    expect(problems).toEqual([]);
    expect(scenario.presetId).toBeNull();
    expect(scenario.aircraft.mass).toBe(900);
    expect(basePresetId).toBe('c172');
  });

  it('reads view settings without disturbing the scenario', () => {
    const { scenario, view, problems } = readPermalink('ac=sailplane&x=cas&u=kmh');
    expect(problems).toEqual([]);
    expect(scenario.presetId).toBe('sailplane');
    expect(view).toEqual({ axis: 'cas', unit: 'kmh' });
  });

  it('reports unknown view settings and falls back to the defaults', () => {
    const { view, problems } = readPermalink('x=furlongs&u=parsecs');
    expect(view).toEqual(DEFAULT_VIEW);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('furlongs');
    expect(problems[1]).toContain('parsecs');
  });

  it('has no base preset for a fully custom aircraft', () => {
    const { basePresetId } = readPermalink('nm=Rig&m=800&s=12&ar=9&e=0.8&cd0=0.03&clmax=1.4');
    expect(basePresetId).toBeNull();
  });
});

describe('canonicalize', () => {
  it('round-trips a state through its own link', () => {
    const state: Permalink = {
      scenario: {
        ...DEFAULT_SCENARIO,
        presetId: null,
        aircraft: { ...CESSNA_172S, cd0: 0.04 },
        altitude: 2438.4,
        deltaISA: 15,
        tas: 61.5,
      },
      basePresetId: 'c172',
      view: { axis: 'eas', unit: 'kt' },
    };
    expect(canonicalize(state)).toEqual(state);
  });

  it('makes an aircraft the preset again once every edit is undone', () => {
    const reverted: Permalink = {
      ...DEFAULT_STATE,
      scenario: { ...DEFAULT_SCENARIO, presetId: null, aircraft: { ...CESSNA_172S } },
    };
    expect(canonicalize(reverted).scenario.presetId).toBe('c172');
  });
});
