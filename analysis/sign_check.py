"""Which way is positive? Three checks of the radar phase sign on all 23 pairs, none of which needs a known moving slope.

1. Troposphere layers against the weather. The hydrostatic and wet phase layers in each file are compared with what
   ERA5 surface pressure and column water vapour (Open-Meteo, no login) say the delay change was. More air or water
   vapour on the second date = longer path. If the layer is positive then, positive phase means range increase.
2. The unwrapped phase against those layers. In mountains the delay changes with height, so the height gradient of the
   phase must match the height gradient of the layer if both use the same sign.
3. The solid-earth-tide layer against a tide computed here from the positions of the Sun and Moon (degree-2 body tide,
   low-precision almanac ephemerides). This one comes out with the OPPOSITE sign to the other layers, so p03 adds it
   instead of subtracting it.

Result on the 2026 data: positive unwrapped phase = range increase from the reference to the secondary date, as p03
assumed. Run by hand (needs the network): .venv/bin/python -I analysis/sign_check.py
Output: data/work/sign_check.json (p09 copies it into meta.json)"""
import csv, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import numpy as np, requests
from pyproj import Transformer
from scipy.interpolate import RegularGridInterpolator
from common import *

# ---------------------------------------------------------------- 3. solid-earth tide
d2r = np.pi / 180
RE, AU = 6378137.0, 149597870700.0
H2, L2 = 0.6078, 0.0847

def jd(t):                                   # numpy datetime64 -> Julian date
    return (t - np.datetime64("2000-01-01T12:00:00")) / np.timedelta64(1, "D") + 2451545.0

def bodies(t):
    n = jd(t) - 2451545.0; T = n / 36525
    s = lambda a: np.sin(a * d2r); c = lambda a: np.cos(a * d2r)
    # Sun (Astronomical Almanac low precision)
    L = 280.460 + 0.9856474 * n; g = 357.528 + 0.9856003 * n
    lam = L + 1.915 * s(g) + 0.020 * s(2 * g); eps = 23.439 - 4e-7 * n
    R = (1.00014 - 0.01671 * c(g) - 0.00014 * c(2 * g)) * AU
    sun = np.array([c(lam), c(eps) * s(lam), s(eps) * s(lam)])
    # Moon
    lm = 218.32 + 481267.881 * T + 6.29 * s(135.0 + 477198.87 * T) - 1.27 * s(259.3 - 413335.36 * T) + 0.66 * s(235.7 + 890534.22 * T) \
        + 0.21 * s(269.9 + 954397.74 * T) - 0.19 * s(357.5 + 35999.05 * T) - 0.11 * s(186.5 + 966404.03 * T)
    bm = 5.13 * s(93.3 + 483202.02 * T) + 0.28 * s(228.2 + 960400.89 * T) - 0.28 * s(318.3 + 6003.15 * T) - 0.17 * s(217.6 - 407332.21 * T)
    par = 0.9508 + 0.0518 * c(135.0 + 477198.87 * T) + 0.0095 * c(259.3 - 413335.36 * T) + 0.0078 * c(235.7 + 890534.22 * T) + 0.0028 * c(269.9 + 954397.74 * T)
    dm = RE / s(par)
    moon = np.array([c(bm) * c(lm), c(eps) * c(bm) * s(lm) - s(eps) * s(bm), s(eps) * c(bm) * s(lm) + c(eps) * s(bm)])
    gmst = (280.46061837 + 360.98564736629 * n) * d2r
    rot = np.array([[np.cos(gmst), np.sin(gmst), 0], [-np.sin(gmst), np.cos(gmst), 0], [0, 0, 1]])   # inertial -> Earth-fixed
    return [(rot @ sun, R, 332946.0487), (rot @ moon, dm, 0.0123000371)]

def tide_enu(t, lat, lon):
    la, lo = lat * d2r, lon * d2r
    r = np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])
    e = np.array([-np.sin(lo), np.cos(lo), 0]); nn = np.array([-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)])
    d = np.zeros(3)
    for b, dist, mr in bodies(t):
        k = mr * RE ** 4 / dist ** 3; cz = b @ r
        d += k * (H2 * r * (1.5 * cz ** 2 - 0.5) + 3 * L2 * cz * (b - cz * r))
    return np.array([d @ e, d @ nn, d @ r])

rows = [r for r in csv.DictReader(open(ROOT / "data/nisar/catalog.csv")) if r["product"] == "GUNW"]
meta = json.load(open(WORK / "radar_meta.json"))
tf = None
pred, obs, lab = [], [], []
for tr in TRACKS:
    lam = float(meta[tr]["wavelength_m"])
    for r in rows:
        if r["stack"] != tr: continue
        tag = f"{r['ref_date']}_{r['sec_date']}".replace("-", "")
        f = NISAR / tr / f"{tag}_radargrid.npz"
        if not f.exists(): continue
        z = np.load(f)
        parts = r["granule"].split("_")
        ts = [p for p in parts if len(p) == 15 and p[8] == "T"]
        t_ref = np.datetime64(f"{ts[0][:4]}-{ts[0][4:6]}-{ts[0][6:8]}T{ts[0][9:11]}:{ts[0][11:13]}:{ts[0][13:]}") + np.timedelta64(17, "s")
        t_sec = np.datetime64(f"{ts[2][:4]}-{ts[2][4:6]}-{ts[2][6:8]}T{ts[2][9:11]}:{ts[2][11:13]}:{ts[2][13:]}") + np.timedelta64(17, "s")
        tf = tf or Transformer.from_crs(f"EPSG:{int(z['epsg'])}", "EPSG:4326", always_xy=True)
        lon, lat = tf.transform(float(z["x"].mean()), float(z["y"].mean()))
        k = 2                                                     # 500 m above the ellipsoid
        le, ln = float(np.nanmean(z["losUnitVectorX"][k])), float(np.nanmean(z["losUnitVectorY"][k])); lu = np.sqrt(1 - le**2 - ln**2)
        dlos = (tide_enu(t_sec, lat, lon) - tide_enu(t_ref, lat, lon)) @ np.array([le, ln, lu])     # m toward the sensor, secondary minus reference
        pred.append(-4 * np.pi / lam * dlos)                      # phase if positive phase = range increase (the assumed convention)
        obs.append(float(np.nanmean(z["slantRangeSolidEarthTidesPhase"][k]))); lab.append(f"{tr} {tag}")
        print(f"{lab[-1]}  ref {t_ref} sec {t_sec}  tide up ref/sec {tide_enu(t_ref, lat, lon)[2]*100:+.1f}/{tide_enu(t_sec, lat, lon)[2]*100:+.1f} cm  predicted {pred[-1]:+.2f} rad  NISAR layer {obs[-1]:+.2f} rad")
pred, obs = np.array(pred), np.array(obs)
slope = float((pred @ obs) / (pred @ pred))
print(f"\n{len(pred)} pairs: correlation {np.corrcoef(pred, obs)[0,1]:+.3f}, slope (NISAR / predicted) {slope:+.2f}, same sign in {int((np.sign(pred)==np.sign(obs)).sum())} of {len(pred)}")

# ---------------------------------------------------------------- 1 and 2. troposphere and phase
T = load("terrain"); dem80 = to80(T["dem"]) + 27.0
x80 = NX0 + 80 * np.arange(W80) + 40; y80 = NY1 - 80 * np.arange(H80) - 40
XX, YY = np.meshgrid(x80, y80)
meta = json.load(open(WORK / "radar_meta.json"))
rq = requests.get("https://archive-api.open-meteo.com/v1/archive", timeout=120, headers={"User-Agent": "research-script"}, params={
    "latitude": 36.5, "longitude": 128.9, "start_date": "2026-06-20", "end_date": "2026-10-21",
    "hourly": "surface_pressure,total_column_integrated_water_vapour", "timezone": "UTC"})
rq.raise_for_status(); H = rq.json()["hourly"]
tt = np.array(H["time"], dtype="datetime64[m]"); P = np.array(H["surface_pressure"], float); W = np.array(H["total_column_integrated_water_vapour"], float)
HOUR = {"125_A_020": "T20:39", "032_D_070": "T10:18", "024_A_020": "T20:30"}
at = lambda a, d, tr: float(np.interp((np.datetime64(f"{d[:4]}-{d[4:6]}-{d[6:]}{HOUR[tr]}") - tt[0]).astype(float), (tt - tt[0]).astype(float), a))

def at_ground(z, key):
    y, c = z["y"], z[key]
    if y[0] > y[-1]: y, c = y[::-1], c[:, ::-1]
    f = RegularGridInterpolator((z["heights"], y, z["x"]), c, bounds_error=False, fill_value=None)
    return f(np.stack([dem80.ravel(), YY.ravel(), XX.ravel()], 1)).reshape(H80, W80)

def hgrad(v, ok):
    s = slice(None, None, 11)
    A = np.stack([np.ones(ok.sum())[s], (XX[ok] / 1e5)[s], (YY[ok] / 1e5)[s], (dem80[ok] / 1e3)[s]], 1)
    return float(np.linalg.lstsq(A, v[ok][s], rcond=None)[0][3])        # rad per km of height

rows2 = []
for tr in TRACKS:
    lam = float(meta[tr]["wavelength_m"])
    for a, b in pairs(tr):
        z = np.load(NISAR / tr / f"{a}_{b}_radargrid.npz")
        k = 1                                                            # 0 m
        inc = np.radians(float(np.nanmean(z["incidenceAngle"][k])))
        hyd, wet = float(np.nanmean(z["hydrostaticTroposphericPhaseScreen"][k])), float(np.nanmean(z["wetTroposphericPhaseScreen"][k]))
        dP, dW = at(P, b, tr) - at(P, a, tr), at(W, b, tr) - at(W, a, tr)
        # expected slant delay change (m), secondary minus reference: 2.28 mm per hPa, about 6.4 mm per kg/m2 of water vapour
        e_h = 4 * np.pi / lam * (2.28e-3 * dP) / np.cos(inc); e_w = 4 * np.pi / lam * (6.4e-3 * dW) / np.cos(inc)
        g = lambda lay: read(NISAR / tr / f"{a}_{b}_unwrapped_HH_{lay}.tif")
        phi, coh, cc, iono = g("unwrappedPhase"), g("coherenceMagnitude"), g("connectedComponents"), g("ionospherePhaseScreen")
        cov = np.isfinite(phi) & np.isfinite(iono) & (phi != 0)
        ok = cov & (coh >= 0.3) & (cc == np.bincount(cc[cov & (cc > 0)]).argmax())
        tro = at_ground(z, "hydrostaticTroposphericPhaseScreen") + at_ground(z, "wetTroposphericPhaseScreen")
        ok &= np.isfinite(tro)
        rows2.append((tr, a, b, hyd, e_h, wet, e_w, hgrad(phi - iono, ok), hgrad(tro, ok)))
        print(f"{tr} {a}_{b} | hydrostatic layer {hyd:+.2f}, range-increase prediction {e_h:+.2f} | wet layer {wet:+6.2f}, prediction {e_w:+6.2f} | "
              f"height gradient rad/km: phase {rows2[-1][7]:+.2f}, layer {rows2[-1][8]:+.2f}", flush=True)
R = np.array([r[3:] for r in rows2], float)
c = lambda i, j: float(np.corrcoef(R[:, i], R[:, j])[0, 1])
sl = lambda i, j: float((R[:, j] @ R[:, i]) / (R[:, j] @ R[:, j]))
print(f"\nhydrostatic layer vs pressure prediction (positive = range increase): r {c(0,1):+.2f}, slope {sl(0,1):+.2f}")
print(f"wet layer vs water-vapour prediction (positive = range increase):   r {c(2,3):+.2f}, slope {sl(2,3):+.2f}")
print(f"phase height gradient vs layer height gradient:                     r {c(4,5):+.2f}, slope {sl(4,5):+.2f}, same sign {int((np.sign(R[:,4])==np.sign(R[:,5])).sum())}/{len(R)}")

tide_r, tide_slope = float(np.corrcoef(pred, obs)[0, 1]), slope
out = {"pairs": int(len(R)), "hydro_r": c(0, 1), "hydro_slope": sl(0, 1), "wet_r": c(2, 3), "wet_slope": sl(2, 3),
       "phase_layer_r": c(4, 5), "phase_layer_slope": sl(4, 5), "phase_layer_same_sign": int((np.sign(R[:, 4]) == np.sign(R[:, 5])).sum()),
       "tide_r": tide_r, "tide_slope": tide_slope, "tide_match_pairs": int((np.abs(np.abs(obs) - np.abs(pred)) < 0.25).sum()),
       "tide_layer_opposite": bool(tide_slope < 0),
       "confirmed": bool(sl(0, 1) > 0.5 and sl(2, 3) > 0.5 and c(4, 5) > 0.5),
       "convention": "positive unwrapped phase = range increase (away from the satellite), secondary minus reference"}
write_json(WORK / "sign_check.json", out)
print(out)
