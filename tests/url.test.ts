import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCENARIO,
  decodeScenario,
  encodeScenario,
  type Scenario,
} from '../src/state/url.js';
import { CESSNA_172S, GENERIC_SAILPLANE } from '../src/data/aircraft/presets.js';
import type { PistonEngine } from '../src/physics/propulsion.js';

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
  it('rejects aircraft values that are positive but not physical', () => {
    // A 1e-320 m^2 wing is greater than zero, and sends the stall speed to infinity.
    const { scenario, problems } = decodeScenario('ac=c172&s=1e-320&m=1e308');
    expect(scenario.aircraft.wingArea).toBe(CESSNA_172S.wingArea);
    expect(scenario.aircraft.mass).toBe(CESSNA_172S.mass);
    expect(problems).toHaveLength(2);
    expect(problems.some((p) => p.startsWith('Wing area') && p.includes('supported minimum'))).toBe(true);
    expect(problems.some((p) => p.startsWith('Mass') && p.includes('supported maximum'))).toBe(true);
  });

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

describe('operating weight and load factor', () => {
  it('round-trips both, and leaves them out at their defaults', () => {
    const scenario = { ...DEFAULT_SCENARIO, mass: 950, loadFactor: 1.5 };
    const query = encodeScenario(scenario);
    expect(query).toBe('ac=c172&w=950&n=1.5');
    expect(decodeScenario(query).scenario).toEqual(scenario);
    expect(encodeScenario({ ...DEFAULT_SCENARIO, mass: CESSNA_172S.mass, loadFactor: 1 })).toBe('ac=c172');
  });

  it('drops values equal to the defaults, so one state has one link', () => {
    const { scenario } = decodeScenario(`ac=c172&w=${CESSNA_172S.mass}&n=1`);
    expect(scenario.mass).toBeUndefined();
    expect(scenario.loadFactor).toBeUndefined();
  });

  it('refuses an operating weight above max takeoff mass', () => {
    const { scenario, problems } = decodeScenario('ac=c172&w=2000');
    expect(scenario.mass).toBeUndefined();
    expect(problems[0]).toContain('Operating mass');
  });

  it('bounds the operating weight by an edited max takeoff mass', () => {
    expect(decodeScenario('ac=c172&m=1500&w=1400').scenario.mass).toBe(1400);
  });

  it('refuses a load factor outside 1 to 10', () => {
    expect(decodeScenario('n=0.5').problems).toHaveLength(1);
    expect(decodeScenario('n=11').problems).toHaveLength(1);
  });
});

describe('structural limits, takeoff flap and runway', () => {
  const custom: Scenario = {
    ...DEFAULT_SCENARIO,
    presetId: null,
    aircraft: {
      ...CESSNA_172S,
      name: 'Utility 172',
      // Utility category at 2,200 lb: V_C 126 kt and V_D 178 kt, to the URL's eight figures.
      structure: { nPositive: 4.4, nNegative: -1.76, cruiseSpeed: 64.82, diveSpeed: 91.45679, clMin: -1 },
    },
  };

  it('writes structural limits whole when any differs, and reads them back', () => {
    const query = encodeScenario({ ...custom, presetId: 'c172' });
    for (const key of ['nmax', 'nmin', 'vc', 'vd', 'clneg']) expect(query).toContain(`${key}=`);
    const { scenario, problems } = decodeScenario(query);
    expect(problems).toEqual([]);
    expect(scenario.aircraft.structure).toEqual(custom.aircraft.structure);
  });

  it('keeps the certification category, and reports an unknown one', () => {
    const { scenario, problems } = decodeScenario('ac=jet-trainer');
    expect(problems).toEqual([]);
    expect(scenario.aircraft.structure?.category).toBe('aerobatic');
    const normal = decodeScenario('ac=jet-trainer&nmax=7&nmin=-3.5&vc=154.33333&vd=192.91667&clneg=-0.9&cat=normal');
    expect(normal.scenario.aircraft.structure?.category).toBeUndefined();
    expect(normal.scenario.presetId).toBeNull();
    expect(decodeScenario('ac=jet-trainer&cat=fighter').problems).toHaveLength(1);
    const back = decodeScenario(encodeScenario(normal.scenario.presetId === null ? { ...normal.scenario, presetId: 'jet-trainer' } : normal.scenario));
    expect(back.scenario.aircraft.structure?.category).toBeUndefined();
  });

  it('removes a preset’s limits with str=none, and its takeoff flap with clto=none', () => {
    const { scenario, problems } = decodeScenario('ac=c172&str=none&clto=none');
    expect(problems).toEqual([]);
    expect(scenario.aircraft.structure).toBeUndefined();
    expect(scenario.aircraft.clMaxTakeoff).toBeUndefined();
    expect(scenario.presetId).toBeNull();
  });

  it('round-trips a custom aircraft without limits or takeoff flap', () => {
    const { structure: _s, clMaxTakeoff: _t, clMaxFlaps: _f, ...bare } = CESSNA_172S;
    const scenario: Scenario = {
      ...DEFAULT_SCENARIO,
      presetId: null,
      aircraft: { ...bare, name: 'Bare', mass: 1150, wingArea: 16.2, propulsion: { kind: 'turbofan', thrust: 3000, lapseExponent: 0.8, sfc: 2e-5 } },
    };
    const decoded = decodeScenario(encodeScenario(scenario));
    expect(decoded.problems).toEqual([]);
    expect(decoded.scenario).toEqual(scenario);
  });

  it('refuses partial limits for an aircraft that has none, and a dive speed below cruise', () => {
    expect(decodeScenario('ac=jet-trainer&str=none&nmax=4').problems).toHaveLength(1);
    expect(decodeScenario('ac=sailplane&vd=20').problems).toHaveLength(1);
    expect(decodeScenario('ac=sailplane&vd=20').scenario.aircraft.structure).toEqual(GENERIC_SAILPLANE.structure);
  });

  it('round-trips fuel data and SFC, and removes fuel with fuel=none', () => {
    const scenario: Scenario = {
      ...DEFAULT_SCENARIO,
      presetId: null,
      aircraft: { ...CESSNA_172S, name: 'Long range', fuelCapacity: 200, emptyMass: 700, propulsion: { ...(CESSNA_172S.propulsion as PistonEngine), power: 134000, sfc: 8e-8 } },
    };
    const decoded = decodeScenario(encodeScenario({ ...scenario, presetId: 'c172' }));
    expect(decoded.problems).toEqual([]);
    expect(decoded.scenario.aircraft).toEqual(scenario.aircraft);
    expect(decodeScenario('ac=c172&fuel=none').scenario.aircraft.fuelCapacity).toBeUndefined();
    expect(decodeScenario('ac=c172&oew=2000').problems).toHaveLength(1); // not below MTOW
    expect(decodeScenario('ac=c172&sfc=1').problems).toHaveLength(1); // out of range
  });

  it('keeps the runway surface and wind, and drops the defaults', () => {
    const scenario: Scenario = { ...DEFAULT_SCENARIO, surface: 'soft-turf', headwind: -2.5 };
    expect(encodeScenario(scenario)).toBe('ac=c172&rw=soft-turf&hw=-2.5');
    expect(decodeScenario('ac=c172&rw=soft-turf&hw=-2.5').scenario).toEqual(scenario);
    expect(encodeScenario({ ...DEFAULT_SCENARIO, surface: 'dry-paved', headwind: 0 })).toBe('ac=c172');
    expect(decodeScenario('rw=lava').problems).toHaveLength(1);
    expect(decodeScenario('hw=99').problems).toHaveLength(1);
  });
});
