"""Stage C: NISAR interferograms -> line-of-sight movement per pair, per hexagon, per track.

For every pair: phase -> cm, minus ionosphere, troposphere and solid-earth tide screens, coherence mask,
plane + height trend removed, ~1 km spatial high-pass, then the median per hexagon.
Sign convention ASSUMED (ISCE): positive phase = range increase, so d_los = -lambda/(4 pi) * phase and
positive d_los = toward the satellite. Not yet confirmed on a known moving feature.

Output: data/work/nisar.npz, data/work/nisar_rasters.npz, data/work/qa_nisar_*.png, data/work/nisar_stats.json
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from scipy import ndimage as ndi
from scipy.interpolate import RegularGridInterpolator
from common import NISAR, WORK, TRACKS, read, load, save, to80, pairs, write_json, H80, W80, NX0, NY1, H20, W20

COH_MIN = 0.3
SIGMA_PX = 12                      # high-pass scale: 12 px x 80 m ~ 1 km
GEOID = 27.0                       # geoid height here, m (DEM is orthometric, the cubes use ellipsoid height)
meta = json.load(open(WORK / "radar_meta.json"))
T = load("terrain"); U = load("units")
N = U["h3"].size
dem80 = to80(T["dem"]) + GEOID
u80 = U["uid40"][1::2, 3::2][:H80, :W80]
n80 = np.bincount(u80.ravel(), minlength=N)
uid20 = np.repeat(np.repeat(U["uid40"], 2, 0), 2, 1)
n20 = np.bincount(uid20.ravel(), minlength=N)
x80 = NX0 + 80 * np.arange(W80) + 40
y80 = NY1 - 80 * np.arange(H80) - 40
XX, YY = np.meshgrid(x80, y80)


def group_median(g, v, n):
    o = np.lexsort((v, g)); g, v = g[o], v[o]
    cnt = np.bincount(g, minlength=n)
    start = np.concatenate([[0], np.cumsum(cnt)[:-1]])
    out = np.full(n, np.nan, "float32")
    has = cnt > 0
    out[has] = v[(start + cnt // 2)[has]]
    return out, cnt


def cube_at_ground(z, key):
    y, c = z["y"], z[key]
    if y[0] > y[-1]:
        y, c = y[::-1], c[:, ::-1]
    f = RegularGridInterpolator((z["heights"], y, z["x"]), c, bounds_error=False, fill_value=None)
    return f(np.stack([dem80.ravel(), YY.ravel(), XX.ravel()], 1)).reshape(H80, W80).astype("float32")


def detrend(d, ok, extra=()):
    """Remove a plane, a linear height term and any extra regressors, fitted on valid pixels."""
    cols = [np.ones_like(dem80), XX / 1e5, YY / 1e5, dem80 / 1e3, *extra]
    s = slice(None, None, 7)
    A = np.stack([c[ok][s] for c in cols], 1)
    coef, *_ = np.linalg.lstsq(A, d[ok][s], rcond=None)
    return d - sum(c * k for c, k in zip(cols, coef)), coef


gx80, gy80 = to80(T["dzdx"]), to80(T["dzdy"])


def highpass(d, ok):
    w = ndi.gaussian_filter(ok.astype("float32"), SIGMA_PX)
    low = ndi.gaussian_filter(np.where(ok, d, 0).astype("float32"), SIGMA_PX) / np.maximum(w, 1e-3)
    out = np.where(ok, d - low, 0).astype("float32")
    # local height-dependent term (stratified troposphere inside the window): windowed regression on height
    hl = np.where(ok, dem80 - ndi.gaussian_filter(np.where(ok, dem80, 0).astype("float32"), SIGMA_PX) / np.maximum(w, 1e-3), 0).astype("float32")
    S = SIGMA_PX * 3
    beta = ndi.gaussian_filter(out * hl, S) / np.maximum(ndi.gaussian_filter(hl * hl, S), 1e-3)
    out = out - beta * hl
    out[~ok | (w < 0.15)] = np.nan
    return out


stats, out, rasters = {}, {}, {}
for tr in TRACKS:
    lam = meta[tr]["wavelength_m"]
    k = -lam / (4 * np.pi) * 100.0                   # radians -> cm toward the satellite
    P = pairs(tr)
    inc = np.full((N, len(P)), np.nan, "float32"); vfrac = np.zeros((N, len(P)), "float32")
    coh20u = np.full((N, len(P)), np.nan, "float32")
    disp = np.full((len(P), H80, W80), np.nan, "float16")
    stats[tr] = {"pairs": []}
    # Range-direction slope (rise per metre toward the sensor). The phase has a small component that depends on
    # whether a slope faces the radar or not (seen on all three tracks, so not ground movement); it is fitted
    # per pair across the whole scene and removed, which leaves local outliers intact.
    z0 = np.load(NISAR / tr / f"{P[0][0]}_{P[0][1]}_radargrid.npz")
    los = {c: cube_at_ground(z0, f"losUnitVector{c}") for c in "XY"}
    hn0 = np.hypot(los["X"], los["Y"]) + 1e-9
    fs = (gx80 * los["X"] + gy80 * los["Y"]) / hn0
    geo = (fs, fs * np.abs(fs), np.hypot(gx80, gy80))
    for pi, (a, b) in enumerate(P):
        base = NISAR / tr / f"{a}_{b}"
        g = lambda lay: read(f"{base}_unwrapped_HH_{lay}.tif")
        phi, coh, cc, iono = g("unwrappedPhase"), g("coherenceMagnitude"), g("connectedComponents"), g("ionospherePhaseScreen")
        z = np.load(f"{base}_radargrid.npz")
        tropo = cube_at_ground(z, "hydrostaticTroposphericPhaseScreen") + cube_at_ground(z, "wetTroposphericPhaseScreen")
        tide = cube_at_ground(z, "slantRangeSolidEarthTidesPhase")
        covered = np.isfinite(phi) & np.isfinite(iono) & (phi != 0)
        main = np.bincount(cc[covered & (cc > 0)]).argmax() if (covered & (cc > 0)).any() else 1
        ok = covered & (coh >= COH_MIN) & (cc == main)
        sd = lambda v: float(np.nanstd(detrend(v, ok)[0][ok]))
        raw_sd = sd(phi)
        corr = phi - iono - tropo - tide
        st = {"pair": f"{a}_{b}", "days": int((np.datetime64(f"{b[:4]}-{b[4:6]}-{b[6:]}") - np.datetime64(f"{a[:4]}-{a[4:6]}-{a[6:]}")).astype(int)),
              "covered": float(covered.mean()), "pass_frac": float(ok.sum() / max(covered.sum(), 1)),
              "coh_median": float(np.nanmedian(coh[covered])),
              "sd_rad_raw": raw_sd, "sd_rad_minus_iono": sd(phi - iono), "sd_rad_plus_iono": sd(phi + iono),
              "sd_rad_minus_tropo": sd(phi - tropo), "sd_rad_plus_tropo": sd(phi + tropo), "sd_rad_corrected": sd(corr),
              "iono_range_rad": [float(np.nanpercentile(iono[covered], 1)), float(np.nanpercentile(iono[covered], 99))]}
        d0, _ = detrend(corr * k, ok)
        d, coef = detrend(corr * k, ok, geo)
        st["geometry_term_sd_cm"] = float(np.nanstd((d0 - d)[ok]))
        hp = highpass(d, ok)
        disp[pi] = hp
        v = np.isfinite(hp)
        med, cnt = group_median(u80[v], hp[v], N)
        good = cnt >= np.maximum(4, 0.4 * n80)
        inc[good, pi] = med[good]
        vfrac[:, pi] = cnt / np.maximum(n80, 1)
        st["sd_cm_highpass_px"] = float(np.nanstd(hp)); st["units_measured"] = int(good.sum())
        # 20 m coherence per hexagon
        c20 = read(f"{base}_wrapped_HH_coherenceMagnitude.tif")
        full = np.full((H20, W20), np.nan, "float32"); full[1:1 + c20.shape[0], 3:3 + c20.shape[1]] = c20
        f = np.isfinite(full)
        coh20u[:, pi] = np.bincount(uid20[f], full[f], N) / np.maximum(np.bincount(uid20[f], minlength=N), 1)
        coh20u[np.bincount(uid20[f], minlength=N) < 0.5 * n20, pi] = np.nan
        if pi == 0:
            np.save(WORK / f"qa_{tr}.npy", np.stack([phi, corr, hp.astype("float32"), coh]))
        if a < "20260718" <= b:                       # the pair that spans the storm: kept as rasters for the site
            np.save(WORK / f"storm_{tr}.npy", np.stack([phi, coh, hp.astype("float32"), covered.astype("float32")]))
        stats[tr]["pairs"].append(st)
        print(tr, st["pair"], f"cover {st['covered']:.2f} pass {st['pass_frac']:.2f} coh {st['coh_median']:.2f} | sd rad raw {raw_sd:.2f} "
              f"-iono {st['sd_rad_minus_iono']:.2f} +iono {st['sd_rad_plus_iono']:.2f} -tropo {st['sd_rad_minus_tropo']:.2f} "
              f"+tropo {st['sd_rad_plus_tropo']:.2f} all {st['sd_rad_corrected']:.2f} | hp sd {st['sd_cm_highpass_px']:.2f} cm | units {good.sum()}", flush=True)

    # viewing geometry per hexagon (20 m slope against the look vector)
    e, n = np.nan_to_num(los["X"]), np.nan_to_num(los["Y"]); u = np.sqrt(np.clip(1 - e**2 - n**2, 0, 1))
    from common import up80
    e20, n20_, u20 = up80(e), up80(n), up80(u)
    hn = np.hypot(e20, n20_) + 1e-9
    s_h = T["dzdx"] * e20 / hn + T["dzdy"] * n20_ / hn           # rise per metre walking toward the sensor
    alpha = np.degrees(np.arctan(-s_h))                           # > 0: slope faces the sensor
    theta = np.degrees(np.arccos(np.clip(u20, 0, 1)))
    bad = (alpha >= theta - 3) | (-alpha >= 90 - theta - 3)       # layover / heavy foreshortening, or shadow
    slope_r = np.radians(T["slope"]); asp = np.radians(T["aspect"])
    sx, sy, sz = np.sin(asp) * np.cos(slope_r), np.cos(asp) * np.cos(slope_r), -np.sin(slope_r)   # downslope unit vector
    sens = e20 * sx + n20_ * sy + u20 * sz
    fin = np.isfinite(e20) & np.isfinite(sens)
    m = lambda a: (np.bincount(uid20[fin], a[fin].astype("float64"), N) / np.maximum(np.bincount(uid20[fin], minlength=N), 1)).astype("float32")
    out[tr] = dict(inc=inc, vfrac=vfrac, coh20=coh20u, badgeom=m(bad.astype("float32")), sens=m(sens),
                   los_e=m(e20), los_n=m(n20_), los_u=m(u20))
    rasters[tr] = disp
    stats[tr]["dates"] = [P[0][0]] + [b for _, b in P]

flat = {f"{tr}__{k}": v for tr, d in out.items() for k, v in d.items()}
save("nisar", **flat)
save("nisar_rasters", **{tr: r for tr, r in rasters.items()})
write_json(WORK / "nisar_stats.json", stats)
