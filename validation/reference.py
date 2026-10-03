"""
Independent reference implementation, used to check the TypeScript core.

Written from the standards and textbook relations, not translated from the
TypeScript, so a shared mistake is unlikely:

- ISA built from the ISO 2533 / USSA-1976 layer definitions, with base
  pressures integrated layer by layer
- CAS found by root-solving the pitot relation, with the Rayleigh supersonic
  pitot formula above Mach 1
- characteristic speeds found by numerical minimisation, not closed forms
- the exact steady climb as a root of its force balance (the TS iterates a
  fixed point), V_y and V_x by Brent's bounded minimiser (the TS uses golden
  section), ceilings by brentq, and glides directly from their definitions

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


# --- Propulsion, climb and glide -------------------------------------------

def isa_hp(hp, d_isa=0.0):
    """State at a pressure altitude: standard pressure, offset temperature."""
    Ts, p = standard(hp)
    T = Ts + d_isa
    return dict(T=T, p=p, rho=p / (R * T), sigma=p / (R * T) / RHO0)


def lapse(engine, hp, sigma):
    gf = lambda s: max(0.0, 1.132 * s - 0.132)
    if engine["kind"] == "piston":
        hc = engine.get("criticalAltitude")
        if hc is None:
            return gf(sigma)
        if hp <= hc:
            return 1.0
        Tc, pc = standard(hc)
        return gf(sigma / (pc / (R * Tc) / RHO0))
    return sigma ** engine["lapseExponent"]


def thrust(engine, v, lap):
    if engine["kind"] == "turbofan":
        return engine["thrust"] * lap
    prop = engine["propeller"]
    line = prop["staticThrust"] * (1 - v / prop["zeroThrustSpeed"])
    return max(0.0, min(line, engine["power"] / v)) * lap


def polar(ac):
    k = 1 / (math.pi * ac["oswaldEfficiency"] * ac["aspectRatio"])
    return ac["cd0"], k


def drag_for_lift(ac, v, rho, lift):
    cd0, k = polar(ac)
    q = 0.5 * rho * v * v
    cl = lift / (q * ac["wingArea"])
    return q * ac["wingArea"] * (cd0 + k * cl * cl)


def climb_exact(ac, v, rho, lap):
    """Root of T - D(W cos g) - W sin g = 0 on (-pi/2, pi/2)."""
    W = ac["mass"] * G0
    T = thrust(ac["propulsion"], v, lap)
    f = lambda g: T - drag_for_lift(ac, v, rho, W * math.cos(g)) - W * math.sin(g)
    hi = math.pi / 2 - 1e-12
    if f(hi) > 0:
        return hi    # thrust beats weight plus drag: vertical
    if f(-hi) < 0:
        return -hi   # drag beats thrust plus weight: no steady path, even straight down
    return brentq(f, -hi, hi, xtol=1e-15)


def climb_speeds(ac, hp, d):
    st = isa_hp(hp, d)
    rho, lap = st["rho"], lapse(ac["propulsion"], hp, st["sigma"])
    W = ac["mass"] * G0
    cd0, k = polar(ac)
    vs = math.sqrt(2 * W / (rho * ac["wingArea"] * ac["clMax"]))
    vmd = math.sqrt(2 * W / (rho * ac["wingArea"])) * (k / cd0) ** 0.25
    top = 8 * max(vmd, vs)
    opt = dict(bounds=(vs, top), method="bounded", options=dict(xatol=1e-11 * top))
    roc = lambda v: v * math.sin(climb_exact(ac, v, rho, lap))
    vy = minimize_scalar(lambda v: -roc(v), **opt).x
    vx = minimize_scalar(lambda v: -climb_exact(ac, v, rho, lap), **opt).x
    excess = lambda v: thrust(ac["propulsion"], v, lap) - drag_for_lift(ac, v, rho, W)
    vme = minimize_scalar(lambda v: -excess(v), **opt).x
    vmax = None if excess(vme) < 0 else brentq(excess, vme, top, xtol=1e-12)
    return dict(vy=vy, roc=roc(vy), vx=vx, gamma=climb_exact(ac, vx, rho, lap), vmax=vmax, lapse=lap, rho=rho)


def ceiling(ac, d, rate):
    f = lambda h: climb_speeds(ac, h, d)["roc"] - rate
    if f(-1000) <= 0 or f(30000) > 0:
        return None
    return brentq(f, -1000, 30000, xtol=1e-6)


def glide_at(ac, rho, cl):
    cd0, k = polar(ac)
    cd = cd0 + k * cl * cl
    g = math.atan(cd / cl)
    v = math.sqrt(2 * ac["mass"] * G0 * math.cos(g) / (rho * ac["wingArea"] * cl))
    return dict(cl=cl, tas=v, gamma=g, ratio=cl / cd, sink=v * math.sin(g))


def glides(ac, rho):
    cd0, k = polar(ac)
    best = glide_at(ac, rho, min(math.sqrt(cd0 / k), ac["clMax"]))
    b = dict(bounds=(1e-3, ac["clMax"]), method="bounded", options=dict(xatol=1e-12))
    sink = glide_at(ac, rho, minimize_scalar(lambda c: glide_at(ac, rho, c)["sink"], **b).x)
    ground = lambda c: (glide_at(ac, rho, c)["tas"] * math.cos(glide_at(ac, rho, c)["gamma"]) - 10) / glide_at(ac, rho, c)["sink"]
    wind = glide_at(ac, rho, minimize_scalar(lambda c: -ground(c), **b).x)
    return best, sink, wind


# Relative tolerances, except altitudes (absolute, metres). Each is set by the
# reference's own precision, not by what the TS happens to achieve.
TOLERANCE = {
    "T": 1e-12, "p": 1e-12, "rho": 1e-12, "a": 1e-12, "EAS": 1e-12, "Mach": 1e-12,
    "mu": 1e-4,           # two published forms of Sutherland's law
    "pressure alt [m]": 1e-6, "density alt [m]": 1e-6,
    "CAS, M<1": 1e-8,     # root-solve precision
    "CAS, M>=1": 1e-8,    # Rayleigh pitot branch, same precision
    "vs": 1e-12, "ldmax": 1e-8, "d60": 1e-12,
    "vmd": 1e-7, "vmp": 1e-7, "vjr": 1e-7,  # bounded-minimiser precision
    "engine lapse": 1e-12, "thrust": 1e-12,
    "climb angle": 1e-9,          # TS fixed point vs brentq root
    "V_y": 1e-5, "V_x": 1e-5,     # flat optima: speed is the hard part
    "ROC at V_y": 1e-9, "V_max": 1e-8,
    "ceilings [m]": 0.05,         # both bisect to a centimetre or better
    "best glide": 1e-12, "min-sink speed": 1e-5, "glide into wind": 1e-5,
    "min sink": 1e-8,     # where the optimum is the CLmax bound, the slope there lets solver precision show
}


def main(path):
    ts = json.loads(Path(path).read_text())
    worst = {name: (0.0, "") for name in TOLERANCE}

    def track(name, value, reference, where, absolute=False):
        err = abs(value - reference) if absolute else abs(value - reference) / max(abs(reference), 1e-300)
        if err > worst[name][0]:
            worst[name] = (err, where)

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
            branch = "CAS, M<1" if s["mach"] < 1 else "CAS, M>=1"
            track(branch, s["cas"], cas_from_tas(s["tas"], ref["p"], ref["a"]), f"{w}, M {s['mach']:.2f}")

    for row in ts["aero"]:
        ref = aero(row["ac"], row["rho"])
        for key in ("vs", "vmd", "vmp", "vjr", "ldmax", "d60"):
            track(key, row[key], ref[key], f"{row['id']} at {row['h']} m")

    for row in ts["performance"]:
        ac, rho, where = row["ac"], row["rho"], f"{row['id']} at Hp {row['hp']} m, dISA {row['d']}"
        best, sink, wind = glides(ac, rho)
        track("best glide", row["glide"]["best"]["glideRatio"], best["ratio"], where)
        track("best glide", row["glide"]["best"]["tas"], best["tas"], where)
        track("min-sink speed", row["glide"]["sink"]["tas"], sink["tas"], where)
        track("min sink", row["glide"]["sink"]["sinkRate"], sink["sink"], where)
        if row["glide"]["headwind"] is not None:
            track("glide into wind", row["glide"]["headwind"]["tas"], wind["tas"], where)
        if row["climb"] is None:
            continue
        ref = climb_speeds(ac, row["hp"], row["d"])
        c = row["climb"]
        track("engine lapse", c["lapse"], ref["lapse"], where)
        for t in c["thrustAt"]:
            track("thrust", t["t"], thrust(ac["propulsion"], t["v"], ref["lapse"]), f"{where}, V {t['v']}")
        for point in c["at"]:
            g = climb_exact(ac, point["tas"], rho, ref["lapse"])
            err = abs(point["gamma"] - g)  # absolute: angles pass through zero
            if err > worst["climb angle"][0]:
                worst["climb angle"] = (err, f"{where}, V {point['tas']}")
        track("V_y", c["vy"]["tas"], ref["vy"], where)
        track("ROC at V_y", c["vy"]["rateOfClimb"], ref["roc"], where)
        track("V_x", c["vx"]["tas"], ref["vx"], where)
        if ref["vmax"] is not None and c["maxLevelSpeed"] is not None:
            track("V_max", c["maxLevelSpeed"], ref["vmax"], where)

    for row in ts["ceilings"]:
        for key, rate in (("absolute", 0.0), ("service", 100 * 0.3048 / 60)):
            ref = ceiling(row["ac"], row["d"], rate)
            if ref is not None and row[key] is not None:
                track("ceilings [m]", row[key], ref, f"{row['id']} {key}, dISA {row['d']}", absolute=True)

    failed = False
    print("TypeScript core vs independent reference: worst disagreement")
    for name, (err, where) in worst.items():
        ok = err <= TOLERANCE[name]
        failed |= not ok
        print(f"  {'ok  ' if ok else 'FAIL'} {name:17s} {err:9.2e}  (limit {TOLERANCE[name]:.0e})  {where}")

    print("\nReference self-check against the published USSA-1976 layer bases:")
    bases_ussa = layer_bases(R_USSA)
    for H, p_pub in [(11000, 22632.06), (20000, 5474.889), (32000, 868.0187), (47000, 110.9063)]:
        p_iso, p_ussa = standard(H)[1], standard(H, R_USSA, bases_ussa)[1]
        print(f"  {H / 1000:4.0f} km  ISO R: {abs(p_iso - p_pub) / p_pub:.1e}   USSA R: {abs(p_ussa - p_pub) / p_pub:.1e}")

    return 1 if failed else 0


if __name__ == "__main__":
    default = Path(__file__).parent / "out" / "ts-output.json"
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else default))
