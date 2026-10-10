import { describe, expect, it } from 'vitest';
import { CESSNA_172S, PRESETS } from '../src/data/aircraft/presets.js';
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
    const state: Permalink = { ...DEFAULT_STATE, view: { axis: 'eas', unit: 'mps', system: 'si', tab: 'curves' } };
    expect(writePermalink(state)).toBe('ac=c172&x=eas&u=mps');
  });
});

describe('comparison aircraft', () => {
  it('writes a stock preset as one prefixed key', () => {
    const state: Permalink = {
      ...DEFAULT_STATE,
      compare: { aircraft: PRESETS['jet-trainer'], presetId: 'jet-trainer', basePresetId: 'jet-trainer' },
    };
    expect(writePermalink(state)).toBe('ac=c172&vs.ac=jet-trainer');
    expect(canonicalize(state)).toEqual(state);
  });

  it('delta-encodes an edited comparison against its preset, and reads it back', () => {
    const state: Permalink = {
      ...DEFAULT_STATE,
      compare: { aircraft: { ...PRESETS.c172, cd0: 0.03 }, presetId: null, basePresetId: 'c172' },
    };
    expect(writePermalink(state)).toBe('ac=c172&vs.ac=c172&vs.cd0=0.03');
    expect(canonicalize(state)).toEqual(state);
  });

  it('round-trips a custom comparison with no preset at all', () => {
    const { name: _n, ...rest } = PRESETS.sailplane;
    const state: Permalink = {
      ...DEFAULT_STATE,
      compare: {
        aircraft: { ...rest, name: 'Open class', aspectRatio: 30, structure: { ...rest.structure!, cruiseSpeed: 50, diveSpeed: 77 } },
        presetId: null,
        basePresetId: null,
      },
    };
    expect(canonicalize(state)).toEqual(state);
  });

  it('keeps the two aircraft apart, and labels the comparison’s problems', () => {
    const read = readPermalink('ac=c172&cd0=0.04&vs.ac=c172&vs.ar=999');
    expect(read.scenario.aircraft.cd0).toBe(0.04);
    expect(read.compare?.aircraft.cd0).toBe(PRESETS.c172.cd0);
    expect(read.problems).toHaveLength(1);
    expect(read.problems[0]).toMatch(/^Comparison aircraft:/);
  });

  it('has no comparison without vs. keys', () => {
    expect(readPermalink('ac=c172').compare).toBeUndefined();
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
    const { scenario, view, problems } = readPermalink('ac=sailplane&x=cas&u=kmh&tab=field');
    expect(problems).toEqual([]);
    expect(scenario.presetId).toBe('sailplane');
    expect(view).toEqual({ axis: 'cas', unit: 'kmh', system: 'si', tab: 'field' });
  });

  it('opens on the tab the link names, and reports an unknown one', () => {
    expect(readPermalink('tab=envelope').view.tab).toBe('envelope');
    const { view, problems } = readPermalink('tab=cockpit');
    expect(view.tab).toBe('curves');
    expect(problems).toHaveLength(1);
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
      view: { axis: 'eas', unit: 'kt', system: 'us', tab: 'envelope' },
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

describe('unit system in the link', () => {
  it('writes sys=us and reads it back', () => {
    const state: Permalink = { ...DEFAULT_STATE, view: { ...DEFAULT_VIEW, system: 'us' } };
    expect(writePermalink(state)).toBe('ac=c172&sys=us');
    expect(readPermalink('ac=c172&sys=us').view.system).toBe('us');
  });

  it('reports an unknown unit system and falls back to SI', () => {
    const { view, problems } = readPermalink('sys=cubits');
    expect(view.system).toBe('si');
    expect(problems[0]).toContain('cubits');
  });
});
