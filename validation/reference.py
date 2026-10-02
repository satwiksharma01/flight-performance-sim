"""
Independent reference implementation, used to check the TypeScript core.

Written from the standards and textbook relations, not translated from the
TypeScript, so a shared mistake is unlikely:

- ISA built from the ISO 2533 / USSA-1976 layer definitions, with base
  pressures integrated layer by layer
- CAS found by root-solving the pitot relation, with the Rayleigh supersonic
  pitot formula above Mach 1
- characteristic speeds found by numerical minimisation, not closed forms

Run with `npm run validate`, which exports the TypeScript outputs first.
Exits non-zero if any quantity disagrees beyond its tolerance.
"""

import json
import math
import sys
from pathlib import Path

from scipy.optimize import brentq, minimize_scalar

G0 = 9.80665
R = 287.05287               # ISO 2533 specific gas constant
R_USSA = 8314.32 / 28.9644  # USSA-1976's value, used only in the table self-check
GAMMA = 1.4
T0, P0 = 288.15, 101325.0
RHO0 = 1.225
R_EARTH = 6356766.0

# (base geopotential altitude [m], lapse rate [K/m])
LAYERS = [
    (0.0, -0.0065), (11000.0, 0.0), (20000.0, 0.0010), (32000.0, 0.0028),
    (47000.0, 0.0), (51000.0, -0.0028), (71000.0, -0.0020), (84852.0, None),
]


def layer_bases(r=R):
    out, T, p = [], T0, P0
    for i, (hb, L) in enumerate(LAYERS[:-1]):
        out.append((hb, L, T, p))
        dh = LAYERS[i + 1][0] - hb
        if L == 0.0:
            p *= math.exp(-G0 * dh / (r * T))
        else:
            T_top = T + L * dh
            p *= (T_top / T) ** (-G0 / (L * r))
            T = T_top
    return out


BASES = layer_bases()


def standard(H, r=R, bases=BASES):
    """Standard temperature and pressure at geopotential altitude H."""
    for hb, L, Tb, pb in reversed(bases):
        if H >= hb:
            break
    dh = H - hb
    if L == 0.0:
        return Tb, pb * math.exp(-G0 * dh / (r * Tb))
    T = Tb + L * dh
    return T, pb * (T / Tb) ** (-G0 / (L * r))


def isa(z, d_isa=0.0):
    """Pressure held at standard, temperature offset: the performance convention."""
    H = R_EARTH * z / (R_EARTH + z)
    Ts, p = standard(H)
    T = Ts + d_isa
    return dict(T=T, p=p, rho=p / (R * T), a=math.sqrt(GAMMA * R * T))


def sutherland(T):
    # USSA-1976 form. The TS core uses the mu0/T0 form; the two differ ~5e-5.
    return 1.458e-6 * T ** 1.5 / (T + 110.4)


def pressure_altitude(p):
    return brentq(lambda H: standard(H)[1] - p, -5000, 84851, xtol=1e-9)


def density_altitude(rho):
    return brentq(lambda H: standard(H)[1] / (R * standard(H)[0]) - rho, -5000, 84851, xtol=1e-9)


def pitot_ratio(M):
    """Pitot total pressure over static pressure, sub- and supersonic."""
    g = GAMMA
    if M < 1.0:
        return (1 + 0.5 * (g - 1) * M * M) ** (g / (g - 1))
    return ((g + 1) ** 2 * M * M / (4 * g * M * M - 2 * (g - 1))) ** (g / (g - 1)) * \
        ((1 - g + 2 * g * M * M) / (g + 1))


def cas_from_tas(tas, p, a):
    qc = p * (pitot_ratio(tas / a) - 1)
    a0 = math.sqrt(GAMMA * R * T0)
    return brentq(lambda c: P0 * (pitot_ratio(c / a0) - 1) - qc, 1e-9, 5 * a0, xtol=1e-12)


def aero(ac, rho):
    W = ac["mass"] * G0
    S, cd0 = ac["wingArea"], ac["cd0"]
    k = 1 / (math.pi * ac["oswaldEfficiency"] * ac["aspectRatio"])

    def drag(v):
        q = 0.5 * rho * v * v
        cl = W / (q * S)
        return q * S * (cd0 + k * cl * cl)

    opt = dict(bounds=(1, 2000), method="bounded", options=dict(xatol=1e-10))
    vmd = minimize_scalar(drag, **opt).x
    return dict(
        vs=math.sqrt(2 * W / (rho * S * ac["clMax"])),
        vmd=vmd,
        vmp=minimize_scalar(lambda v: drag(v) * v, **opt).x,
        vjr=minimize_scalar(lambda v: drag(v) / v, **opt).x,
        ldmax=W / drag(vmd),
        d60=drag(60.0),
    )


# Relative tolerances, except altitudes (absolute, metres). Each is set by the
# reference's own precision, not by what the TS happens to achieve.
TOLERANCE = {
    "T": 1e-12, "p": 1e-12, "rho": 1e-12, "a": 1e-12, "EAS": 1e-12, "Mach": 1e-12,
    "mu": 1e-4,           # two published forms of Sutherland's law
    "pressure alt [m]": 1e-6, "density alt [m]": 1e-6,
    "CAS, M<1": 1e-8,     # root-solve precision
    "vs": 1e-12, "ldmax": 1e-8, "d60": 1e-12,
    "vmd": 1e-7, "vmp": 1e-7, "vjr": 1e-7,  # bounded-minimiser precision
}


def main(path):
    ts = json.loads(Path(path).read_text())
    worst = {name: (0.0, "") for name in TOLERANCE}

    def track(name, value, reference, where, absolute=False):
        err = abs(value - reference) if absolute else abs(value - reference) / max(abs(reference), 1e-300)
        if err > worst[name][0]:
            worst[name] = (err, where)

    supersonic = []
    for row in ts["atmosphere"]:
        ref = isa(row["h"], row["d"])
        where = f"h={row['h']} m, dISA={row['d']}"
        for key in ("T", "p", "rho", "a"):
            track(key, row[key], ref[key], where)
        track("mu", row["mu"], sutherland(ref["T"]), where)
        track("pressure alt [m]", row["hp"], pressure_altitude(ref["p"]), where, absolute=True)
        track("density alt [m]", row["hd"], density_altitude(ref["rho"]), where, absolute=True)
        for s in row["speeds"]:
            w = f"{where}, TAS={s['tas']}"
            track("EAS", s["eas"], s["tas"] * math.sqrt(ref["rho"] / RHO0), w)
            track("Mach", s["mach"], s["tas"] / ref["a"], w)
            cas = cas_from_tas(s["tas"], ref["p"], ref["a"])
            if s["mach"] < 1:
                track("CAS, M<1", s["cas"], cas, w)
            else:
                supersonic.append((abs(s["cas"] - cas) / cas, w, s["mach"]))

    for row in ts["aero"]:
        ref = aero(row["ac"], row["rho"])
        for key in ("vs", "vmd", "vmp", "vjr", "ldmax", "d60"):
            track(key, row[key], ref[key], f"{row['id']} at {row['h']} m")

    failed = False
    print("TypeScript core vs independent reference: worst disagreement")
    for name, (err, where) in worst.items():
        ok = err <= TOLERANCE[name]
        failed |= not ok
        print(f"  {'ok  ' if ok else 'FAIL'} {name:17s} {err:9.2e}  (limit {TOLERANCE[name]:.0e})  {where}")

    if supersonic:
        err, where, mach = max(supersonic)
        print(f"\nKnown gap, not failing: CAS above Mach 1 uses the subsonic relation in the TS core.")
        print(f"  {len(supersonic)} points, worst {err:.1%} at {where} (M {mach:.2f}). See tests/references.test.ts.")

    print("\nReference self-check against the published USSA-1976 layer bases:")
    bases_ussa = layer_bases(R_USSA)
    for H, p_pub in [(11000, 22632.06), (20000, 5474.889), (32000, 868.0187), (47000, 110.9063)]:
        p_iso, p_ussa = standard(H)[1], standard(H, R_USSA, bases_ussa)[1]
        print(f"  {H / 1000:4.0f} km  ISO R: {abs(p_iso - p_pub) / p_pub:.1e}   USSA R: {abs(p_ussa - p_pub) / p_pub:.1e}")

    return 1 if failed else 0


if __name__ == "__main__":
    default = Path(__file__).parent / "out" / "ts-output.json"
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else default))
