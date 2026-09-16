import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCENARIO,
  decodeScenario,
  encodeScenario,
  type Scenario,
} from '../src/state/url.js';
import { CESSNA_172S, GENERIC_SAILPLANE } from '../src/data/aircraft/presets.js';

describe('encoding', () => {
  it('reduces an unmodified preset to a single parameter', () => {
    // The whole point of delta encoding: the common case has to be short
    // enough to paste into a message.
    expect(encodeScenario(DEFAULT_SCENARIO)).toBe('ac=c172');
  });

  it('writes only the parameters that differ from the preset', () => {
    const scenario: Scenario = {
      ...DEFAULT_SCENARIO,
      aircraft: { ...CESSNA_172S, mass: 900 },
    };
    const encoded = encodeScenario(scenario);

    expect(encoded).toContain('ac=c172');
    expect(encoded).toContain('m=900');
    expect(encoded).not.toContain('ar=');
    expect(encoded).not.toContain('cd0=');
  });

  it('writes the flight condition only when it differs from the default', () => {
    expect(encodeScenario(DEFAULT_SCENARIO)).not.toContain('h=');

    const encoded = encodeScenario({ ...DEFAULT_SCENARIO, altitude: 3000, deltaISA: 15 });
    expect(encoded).toContain('h=3000');
    expect(encoded).toContain('disa=15');
  });

  it('writes out every parameter for a custom aircraft', () => {
    const scenario: Scenario = {
      presetId: null,
      aircraft: {
        name: 'Test article',
        mass: 800,
        wingArea: 12,
        aspectRatio: 9,
        oswaldEfficiency: 0.82,
        cd0: 0.028,
        clMax: 1.45,
      },
      altitude: 1500,
      deltaISA: 0,
      tas: 48,
    };
    const encoded = encodeScenario(scenario);

    for (const key of ['nm=', 'm=', 's=', 'ar=', 'e=', 'cd0=', 'clmax=']) {
      expect(encoded).toContain(key);
    }
    expect(encoded).not.toContain('ac=');
  });

  it('trims floating-point noise', () => {
    const scenario: Scenario = {
      ...DEFAULT_SCENARIO,
      aircraft: { ...CESSNA_172S, cd0: 0.1 + 0.2 },
    };
    expect(encodeScenario(scenario)).toContain('cd0=0.3');
  });
});

describe('decoding', () => {
  it('returns the default scenario for an empty query', () => {
    const { scenario, problems } = decodeScenario('');
    expect(problems).toEqual([]);
    expect(scenario).toEqual(DEFAULT_SCENARIO);
  });

  it('accepts a query string with or without a leading question mark', () => {
    expect(decodeScenario('?ac=sailplane').scenario.aircraft).toEqual(GENERIC_SAILPLANE);
    expect(decodeScenario('ac=sailplane').scenario.aircraft).toEqual(GENERIC_SAILPLANE);
  });

  it('resolves a preset by id', () => {
    const { scenario, problems } = decodeScenario('ac=sailplane&v=30');
    expect(problems).toEqual([]);
    expect(scenario.presetId).toBe('sailplane');
    expect(scenario.aircraft).toEqual(GENERIC_SAILPLANE);
    expect(scenario.tas).toBe(30);
  });

  it('drops the preset id once a parameter is overridden', () => {
    // Keeping it would make the link claim to be a stock aircraft that it is
    // not, and re-encoding would then discard the user's edit.
    const { scenario } = decodeScenario('ac=c172&m=900');
    expect(scenario.presetId).toBeNull();
    expect(scenario.aircraft.mass).toBe(900);
    expect(scenario.aircraft.cd0).toBe(CESSNA_172S.cd0);
  });

  it('keeps the preset id when an override merely restates the preset value', () => {
    const { scenario } = decodeScenario(`ac=c172&m=${CESSNA_172S.mass}`);
    expect(scenario.presetId).toBe('c172');
  });
});

describe('malformed input', () => {
  it('reports an unknown preset and falls back to the default aircraft', () => {
    const { scenario, problems } = decodeScenario('ac=spaceship');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('spaceship');
    expect(problems[0]).toContain('c172');
    expect(scenario.aircraft).toEqual(CESSNA_172S);
  });

  it('reports a non-numeric value and keeps the default', () => {
    const { scenario, problems } = decodeScenario('m=heavy');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Mass');
    expect(scenario.aircraft.mass).toBe(CESSNA_172S.mass);
  });

  it('rejects values outside their physical range', () => {
    expect(decodeScenario('m=-500').problems[0]).toContain('Mass');
    expect(decodeScenario('s=0').problems[0]).toContain('Wing area');
    expect(decodeScenario('e=1.4').problems[0]).toContain('Oswald');
    expect(decodeScenario('h=999999').problems[0]).toContain('Altitude');
    expect(decodeScenario('disa=500').problems[0]).toContain('ISA deviation');
    expect(decodeScenario('v=0').problems[0]).toContain('True airspeed');
  });

  it('keeps the remaining parameters when one is bad', () => {
    // One malformed field must not discard the rest of the link.
    const { scenario, problems } = decodeScenario('m=oops&v=70&h=2000');
    expect(problems).toHaveLength(1);
    expect(scenario.tas).toBe(70);
    expect(scenario.altitude).toBe(2000);
  });

  it('survives arbitrary junk', () => {
    expect(() => decodeScenario('%%%&=&&a==b&v=')).not.toThrow();
    expect(() => decodeScenario('ac=&m=&h=')).not.toThrow();
  });

  it('ignores an empty name rather than blanking the aircraft', () => {
    expect(decodeScenario('nm=').scenario.aircraft.name).toBe(CESSNA_172S.name);
  });
});

describe('round trips', () => {
  const scenarios: Scenario[] = [
    DEFAULT_SCENARIO,
    { ...DEFAULT_SCENARIO, altitude: 3500, deltaISA: -12, tas: 63.5 },
    {
      presetId: 'sailplane',
      aircraft: GENERIC_SAILPLANE,
      altitude: 1200,
      deltaISA: 0,
      tas: 28,
    },
    {
      presetId: null,
      aircraft: {
        name: 'Custom rig',
        mass: 1783.25,
        wingArea: 20.4,
        aspectRatio: 8.15,
        oswaldEfficiency: 0.79,
        cd0: 0.0245,
        clMax: 1.62,
        clMaxFlaps: 2.05,
      },
      altitude: 6000,
      deltaISA: 20,
      tas: 88.125,
    },
  ];

  for (const [index, scenario] of scenarios.entries()) {
    it(`preserves scenario ${index} through encode and decode`, () => {
      const { scenario: decoded, problems } = decodeScenario(encodeScenario(scenario));
      expect(problems).toEqual([]);
      expect(decoded).toEqual(scenario);
    });

    it(`re-encodes scenario ${index} identically`, () => {
      // Guards against slow drift: a value that reformats on each pass would
      // make every link subtly different from the last.
      const once = encodeScenario(scenario);
      const twice = encodeScenario(decodeScenario(once).scenario);
      expect(twice).toBe(once);
    });
  }
});
