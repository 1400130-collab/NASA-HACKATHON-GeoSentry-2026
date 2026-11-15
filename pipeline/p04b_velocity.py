"""Stage C3: time-series inversion. All 23 pairs of the three tracks -> one downslope movement model per hexagon.

Model (per hexagon, movement assumed along the slope line, positive = downslope):
    D(t) = v_pre * (time before the storm) + step * [t after the storm] + v_post * (time after the storm)
Every pair observes  s_track * (D(t_sec) - D(t_ref)) + noise, where s_track is the part of downslope movement that
the track's line of sight sees (p03 `sens`). The three unknowns are solved by generalised least squares over all
pairs of all usable tracks at once.

Noise model, measured from the data, not assumed:
  - per pair and per coherence class: robust spread (MAD) of the increments over slope hexagons
  - per track: the correlation between pairs. Neighbouring pairs share an image, so their errors are
    anti-correlated (about -0.2 to -0.5 here); treating pairs as independent overstates the noise of a sum.
The pairs of each track form one chain (no redundant pairs), so the per-date history is the running sum that p04
already makes; what this stage adds is the rate, the step at the storm and their error bars from the full covariance,
and the merge of ascending and descending tracks.

Checks written to the stats: error-bar calibration (spread of v/sigma over slopes), recovery of injected movement,
the downslope/upslope split of the detections, and the same split read in the across-slope direction (where the
sign has no meaning, so it should be even).
The sign convention is confirmed (analysis/sign_check.py), so only downslope rates count as movement; rates that
read as upslope are counted separately as radar changes that are not sliding.

Output: data/work/velocity.npz, data/work/velocity_stats.json"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from common import WORK, TRACKS, load, save, write_json, STORM

MONTH = 30.0                       # velocities are mm per 30 days
Z_DET = 4.0                        # |v| / sigma needed to call movement
U = load("units"); Sx = load("series"); Nz = load("nisar")
st = json.load(open(WORK / "series_stats.json"))
N = U["h3"].size
slope_u = U["is_slope"]; stable = Sx["stable"]
day = lambda s: (np.datetime64(f"{s[:4]}-{s[4:6]}-{s[6:]}") - np.datetime64("2026-01-01")).astype(int)
T_STORM = day(STORM.replace("-", ""))
mad = lambda a: float(1.4826 * np.nanmedian(np.abs(a - np.nanmedian(a))))
rng = np.random.default_rng(0)

# ---- per track: design, noise model, normal equations -------------------------------------------------------------
G0, SIG, R, D, USE, SENS, CROSS = {}, {}, {}, {}, {}, {}, {}
asp = np.radians(U["aspect"])
S = {"model": "downslope D(t) = v_pre*t (before storm) + step + v_post*t (after storm); GLS over all pairs and tracks",
     "unit": "mm per 30 days", "z_detect": Z_DET, "tracks": {}}
for tr in TRACKS:
    dates = st["tracks"][tr]["dates"]; t = np.array([day(d) for d in dates])
    ta, tb = t[:-1], t[1:]
    pre = np.clip(np.minimum(tb, T_STORM) - ta, 0, None); post = np.clip(tb - np.maximum(ta, T_STORM), 0, None)
    G0[tr] = np.stack([pre / MONTH, ((ta < T_STORM) & (tb >= T_STORM)).astype(float), post / MONTH], 1)   # pairs x 3
    d = Sx[f"{tr}__inc"] * 10.0                                          # cm -> mm, toward the satellite
    use = Sx[f"{tr}__measurable"]
    d = np.where(use[:, None], d, np.nan)
    coh = Nz[f"{tr}__coh20"]
    ref = slope_u & use
    sig = np.full(d.shape, np.nan, "float32"); curve = []
    for i in range(d.shape[1]):                                          # noise per pair as a function of coherence
        ok = ref & np.isfinite(d[:, i]) & np.isfinite(coh[:, i])
        edges = np.quantile(coh[ok, i], np.linspace(0, 1, 11)); mid = 0.5 * (edges[1:] + edges[:-1])
        b = np.clip(np.searchsorted(edges, coh[ok, i]) - 1, 0, 9)
        s_bin = np.array([mad(d[ok, i][b == k]) for k in range(10)])
        sig[:, i] = np.interp(np.nan_to_num(coh[:, i], nan=float(np.median(coh[ok, i]))), mid, s_bin)
        curve.append([round(float(s_bin[0]), 2), round(float(s_bin[-1]), 2)])
    zn = np.clip(d / sig, -3, 3)                                         # clipped, so outliers do not set the correlation
    k = d.shape[1]; Rm = np.eye(k)
    for i in range(k):
        for j in range(i + 1, k):
            ok = ref & np.isfinite(zn[:, i]) & np.isfinite(zn[:, j])
            Rm[i, j] = Rm[j, i] = np.corrcoef(zn[ok, i], zn[ok, j])[0, 1]
    w, V = np.linalg.eigh(Rm); Rm = (V * np.clip(w, 0.05, None)) @ V.T    # keep it safely positive definite
    G0[tr], SIG[tr], R[tr], D[tr], USE[tr] = G0[tr], sig, Rm, d, use
    SENS[tr] = np.nan_to_num(Nz[f"{tr}__sens"])
    CROSS[tr] = np.nan_to_num(Nz[f"{tr}__los_e"] * np.cos(asp) - Nz[f"{tr}__los_n"] * np.sin(asp))   # along the contour
    S["tracks"][tr] = {"pairs": int(k), "lag1_corr": [round(float(Rm[i, i + 1]), 2) for i in range(k - 1)],
                       "noise_mm_low_high_coherence": curve,
                       "design_days": {"pre": pre.tolist(), "post": post.tolist()}}
    print(tr, "pairs", k, "| lag-1 correlation", S["tracks"][tr]["lag1_corr"], flush=True)


def normal(tr, d):
    """Per hexagon: M = A' R^-1 A (3x3), b = A' R^-1 y (3), yy = y' R^-1 y, n = pairs used, for one track."""
    sig, Rm, g = SIG[tr], R[tr], G0[tr]
    have = np.isfinite(d)
    M = np.zeros((N, 3, 3)); b = np.zeros((N, 3)); yy = np.zeros(N)
    code = (have * (1 << np.arange(d.shape[1]))).sum(1)
    for c in np.unique(code):
        if c == 0:
            continue
        rows = np.where(code == c)[0]; sub = np.where(have[rows[0]])[0]
        Ri = np.linalg.inv(Rm[np.ix_(sub, sub)])
        A = g[sub][None] / sig[rows][:, sub, None]                      # n x k x 3
        y = d[rows][:, sub] / sig[rows][:, sub]
        M[rows] = np.einsum("nia,ij,njb->nab", A, Ri, A); b[rows] = np.einsum("nia,ij,nj->na", A, Ri, y)
        yy[rows] = np.einsum("ni,ij,nj->n", y, Ri, y)
    return M, b, yy, have.sum(1)


def solve(M, b, yy, n):
    """x = M^-1 b with 1-sigma errors; parameters the data do not constrain come back NaN."""
    scale = np.tile([1e-4, 1e-6, 1e-4], M.shape[1] // 3)                 # weak prior: +-100 mm/month, +-1000 mm step
    Mi = np.linalg.inv(M + np.diag(scale)[None])
    x = np.einsum("nab,nb->na", Mi, b)
    sd = np.sqrt(np.einsum("naa->na", Mi))
    chi2 = yy - 2 * np.einsum("na,na->n", x, b) + np.einsum("na,nab,nb->n", x, M, x)
    free = sd < 0.5 / np.sqrt(scale)[None]                               # the data, not the prior, set this parameter
    x = np.where(free, x, np.nan); sd = np.where(free, sd, np.nan)
    return x, sd, chi2, n - free.sum(1)


def joint(Ds, comps):
    """All tracks at once. comps[tr] is (N, q): how much of each spatial component the track sees.
    Parameters come back ordered component by component, each with (pre, step, post)."""
    q = comps[TRACKS[0]].shape[1]
    M = np.zeros((N, 3 * q, 3 * q)); b = np.zeros((N, 3 * q)); yy = np.zeros(N); n = np.zeros(N, int); nt = np.zeros(N, int)
    for tr in TRACKS:
        W = comps[tr]
        m, bb, y2, k = normal(tr, Ds[tr])
        M += np.einsum("np,nq,nab->npaqb", W, W, m).reshape(N, 3 * q, 3 * q); b += np.einsum("np,na->npa", W, bb).reshape(N, 3 * q)
        yy += y2; n += k; nt += k > 0
    return (*solve(M, b, yy, n), nt)


# ---- the inversion ------------------------------------------------------------------------------------------------
# Two things can change the line-of-sight distance of a hexagon: sliding along the slope, which each track sees through
# its own s, and a signal that looks the same from every side (vertical change, soil moisture, vegetation), which every
# track sees with weight 1. Both are solved for; only the first counts as movement. With one viewing direction the two
# cannot be told apart, so those hexagons get no downslope value.
one = np.ones(N)
x1, sd1, *_ = joint(D, {tr: SENS[tr][:, None] for tr in TRACKS})          # for comparison: everything read as sliding
x, sd, chi2, dof, ntr = joint(D, {tr: np.stack([SENS[tr], one], 1) for tr in TRACKS})
xc, sdc, *_ = joint(D, {tr: np.stack([CROSS[tr], one], 1) for tr in TRACKS})   # control: read as movement along the contour
# two viewing directions = the descending track plus at least one ascending track (the two ascending tracks look
# from almost the same place, so together they still count as one direction)
asc_ = np.any([USE[tr] for tr in TRACKS if "_A_" in tr], 0); desc_ = np.any([USE[tr] for tr in TRACKS if "_D_" in tr], 0)
two_dir = asc_ & desc_
x[~two_dir] = np.nan; sd[~two_dir] = np.nan; xc[~two_dir] = np.nan; sdc[~two_dir] = np.nan
los = {tr: solve(*normal(tr, D[tr])) for tr in TRACKS}                    # each track alone, line of sight

# error-bar calibration: v/sigma over slope hexagons should have unit spread if the error bars are right
cal = {nm: mad((x[:, j] / sd[:, j])[slope_u]) for j, nm in enumerate(["pre", "step", "post", "common_pre", "common_step", "common_post"])}
calc = mad((xc[:, 2] / sdc[:, 2])[slope_u])
print("spread of v/sigma over slopes before calibration (1 = error bars right):", {k: round(v, 2) for k, v in cal.items()}, "| across-slope", round(calc, 2))
sd = sd * np.array(list(cal.values()))[None]; sdc = sdc * calc
z_post = x[:, 2] / sd[:, 2]; z_pre = x[:, 0] / sd[:, 0]; z_step = x[:, 1] / sd[:, 1]; z_common = x[:, 5] / sd[:, 5]
z_cross = xc[:, 2] / sdc[:, 2]
z1 = x1[:, 2] / (sd1[:, 2] * mad((x1[:, 2] / sd1[:, 2])[slope_u]))

# stable ground on each track alone (line of sight): should sit at zero with the predicted spread
for tr in TRACKS:
    xl, sl_, *_ = los[tr]
    zz = (xl[:, 2] / sl_[:, 2])[stable]; zs = (xl[:, 2] / sl_[:, 2])[slope_u & USE[tr]]
    S["tracks"][tr].update(stable_los_post_median_mm=float(np.nanmedian(xl[stable, 2])), stable_los_post_z_spread=mad(zz),
                           slopes_los_post_median_mm=float(np.nanmedian(xl[slope_u & USE[tr], 2])),
                           los_post_sigma_median_mm=float(np.nanmedian(sl_[slope_u, 2])),
                           los_tail_toward=int((zs >= Z_DET).sum()), los_tail_away=int((zs <= -Z_DET).sum()))
    print(f"{tr} alone: stable ground median {S['tracks'][tr]['stable_los_post_median_mm']:+.2f} mm/month (v/sigma spread {mad(zz):.2f}), slopes median "
          f"{S['tracks'][tr]['slopes_los_post_median_mm']:+.2f} | typical LOS error +-{S['tracks'][tr]['los_post_sigma_median_mm']:.1f} | "
          f"beyond {Z_DET} sigma: {S['tracks'][tr]['los_tail_toward']} toward the satellite, {S['tracks'][tr]['los_tail_away']} away")

# Is the signal the tracks share sliding? Sliding flips sign between two tracks that see the slope from opposite
# sides (s of opposite sign). Compare ascending 125 with descending 032 where both see the slope well.
ta_, td_ = "125_A_020", "032_D_070"
za = los[ta_][0][:, 2] / los[ta_][1][:, 2]; zd = los[td_][0][:, 2] / los[td_][1][:, 2]
both = slope_u & USE[ta_] & USE[td_] & np.isfinite(za) & np.isfinite(zd) & (np.abs(SENS[ta_]) >= 0.3) & (np.abs(SENS[td_]) >= 0.3)
opp = np.sign(SENS[ta_]) != np.sign(SENS[td_])
r_same = float(np.corrcoef(za[both & ~opp], zd[both & ~opp])[0, 1]); r_opp = float(np.corrcoef(za[both & opp], zd[both & opp])[0, 1])
S["shared_signal"] = {"r_same_side": r_same, "n_same_side": int((both & ~opp).sum()), "r_opposite_sides": r_opp, "n_opposite_sides": int((both & opp).sum()),
                      "is_sliding": bool(r_opp < 0),
                      "note": "sliding would make r_opposite_sides negative; a positive value means the shared signal looks the same from both sides"}
print(f"ascending vs descending line-of-sight rate: r {r_same:+.2f} where both see the slope from the same side (n {S['shared_signal']['n_same_side']}), "
      f"{r_opp:+.2f} from opposite sides (n {S['shared_signal']['n_opposite_sides']}); sliding would give a negative value there")

# ---- recovery test: add known movement to real data and invert again -----------------------------------------------
ok = slope_u & np.isfinite(z_post)
pick = rng.choice(np.where(ok)[0], 4000, replace=False)
rec = {}
C2 = {tr: np.stack([SENS[tr], one], 1) for tr in TRACKS}
for v_in in (20.0, 50.0):
    Dj = {}
    for tr in TRACKS:
        add = np.zeros_like(D[tr]); add[pick] = v_in * SENS[tr][pick, None] * G0[tr][None, :, 2]
        Dj[tr] = D[tr] + add
    xj, sj, *_ = joint(Dj, C2)
    got = xj[pick, 2] - x[pick, 2]
    zj = xj[pick, 2] / (sj[pick, 2] * cal["post"])
    rec[str(int(v_in))] = {"recovered_median": float(np.nanmedian(got)), "detected_share": float((zj >= Z_DET).mean())}
    print(f"injected {v_in:.0f} mm/month downslope after the storm: recovered {np.nanmedian(got):.1f}, detected {np.mean(zj >= Z_DET):.0%}")
Dj = {}
for tr in TRACKS:                                                         # a 10 mm/month signal that is the same on every track
    add = np.zeros_like(D[tr]); add[pick] = 10.0 * G0[tr][None, :, 2]; Dj[tr] = D[tr] + add
xj, *_ = joint(Dj, C2)
rec["shared_10_leak_into_downslope"] = float(np.nanmedian(np.abs(xj[pick, 2] - x[pick, 2])))
print(f"injected 10 mm/month shared (non-sliding) signal: leaks {rec['shared_10_leak_into_downslope']:.3f} mm/month into the downslope rate")

# ---- detection ----------------------------------------------------------------------------------------------------
red = chi2 / np.maximum(dof, 1)
fit_ok = red < np.nanpercentile(red[ok], 99)                              # drop the worst-fitting 1% (jumps, bad unwrapping)
down, up = ok & fit_ok & (z_post >= Z_DET), ok & fit_ok & (z_post <= -Z_DET)
det = down                                                               # sliding only goes downhill
okc = slope_u & np.isfinite(z_cross) & fit_ok
from math import erfc, sqrt
chance = float(ok.sum() * erfc(Z_DET / sqrt(2)))
sg = sd[ok, 2]
ok1 = slope_u & np.isfinite(z1)
anyuse = slope_u & np.any([USE[tr] for tr in TRACKS], 0)
ub = np.abs(x[:, 2]) + 2 * sd[:, 2]                                      # sliding faster than this is ruled out (about 95%)
burned = ok & (U["burn_frac"] > 0.5)
S.update({
    "slopes_with_radar": int(anyuse.sum()), "slopes_solved": int(ok.sum()), "slopes_one_direction_only": int((anyuse & ~ok).sum()),
    "slopes_three_tracks": int((ok & (ntr >= 3)).sum()),
    "calibration_factor": cal, "calibration_factor_across_slope": calc,
    "sigma_post_mm_pct": {p: float(np.percentile(sg, p)) for p in (10, 25, 50, 75, 90)},
    "sigma_pre_mm_median": float(np.nanmedian(sd[ok, 0])), "sigma_step_mm_median": float(np.nanmedian(sd[ok, 1])),
    "sigma_common_post_mm_median": float(np.nanmedian(sd[ok, 5])), "common_post_median_mm": float(np.nanmedian(x[ok, 5])),
    "upper_bound_mm_median": float(np.median(ub[ok])), "upper_bound_under_20mm": int((ok & (ub < 20)).sum()),
    "detect_limit80_mm_median": float((Z_DET + 0.84) * np.median(sg)), "detect_limit80_mm_best10": float((Z_DET + 0.84) * np.percentile(sg, 10)),
    "detected": int(down.sum() + up.sum()), "detected_downslope": int(down.sum()), "detected_upslope": int(up.sum()),
    "observations": int(sum(np.isfinite(D[tr][ok]).sum() for tr in TRACKS)), "unknowns": int(6 * ok.sum()),
    "expected_by_chance": chance,
    "across_slope_split": [int((okc & (z_cross >= Z_DET)).sum()), int((okc & (z_cross <= -Z_DET)).sum())],
    "tail3": {"downslope": int((ok & fit_ok & (z_post >= 3)).sum()), "upslope": int((ok & fit_ok & (z_post <= -3)).sum()),
              "chance_each_side": float(ok.sum() * 0.5 * erfc(3 / sqrt(2)))},
    "burned_median_z": float(np.median(z_post[burned])), "burned_units": int(burned.sum()),
    "common_detected": int((ok & (np.abs(z_common) >= Z_DET)).sum()), "common_detected_toward": int((ok & (z_common >= Z_DET)).sum()),
    "step_detected": int((ok & fit_ok & (np.abs(z_step) >= Z_DET)).sum()),
    "sliding_only_model": {"detected": int((ok1 & (np.abs(z1) >= Z_DET)).sum()), "downslope": int((ok1 & (z1 >= Z_DET)).sum()),
                           "upslope": int((ok1 & (z1 <= -Z_DET)).sum()), "units": int(ok1.sum())},
    "old_rule_overlap": int((det & Sx["moving"]).sum()), "old_rule_units": int((Sx["moving"] & slope_u).sum()),
    "no_detectable_movement_share": float(1 - det.sum() / max(ok.sum(), 1)),
    "sign_note": "sign convention confirmed (analysis/sign_check.py). Only downslope rates count as movement; the upslope ones are "
                 "radar changes that are not sliding.",
    "recovery": rec,
})
print(f"slopes with radar {anyuse.sum()}: solved {ok.sum()} (seen from two directions), {S['slopes_one_direction_only']} seen from one direction only")
print(f"downslope error bar: median +-{np.median(sg):.1f} mm/month (best tenth +-{np.percentile(sg, 10):.1f}) | 80% detection at {S['detect_limit80_mm_median']:.0f} mm/month "
      f"(best tenth {S['detect_limit80_mm_best10']:.0f}) | sliding ruled out above {S['upper_bound_mm_median']:.0f} mm/month on the median slope")
print(f"beyond {Z_DET} sigma: {down.sum() + up.sum()} ({down.sum()} downslope = movement, {up.sum()} upslope = not sliding) | chance alone {chance:.1f} | across-slope split {S['across_slope_split']} | "
      f"at 3 sigma {S['tail3']} | burned slopes median v/sigma {S['burned_median_z']:+.2f} (n {burned.sum()})")
print(f"storm step {S['step_detected']} | shared signal {S['common_detected']} ({S['common_detected_toward']} toward the satellite) | "
      f"if everything is read as sliding: {S['sliding_only_model']} | old p04 rule {S['old_rule_units']}, overlap {S['old_rule_overlap']}")
# ---- a few real slopes for the site's animation: the passes of each track projected onto the slope line, and the fit ---
DAY0 = day("20260601")
def example(i):
    tracks = []
    for tr in TRACKS:
        s = SENS[tr][i]
        if not USE[tr][i] or abs(s) < 0.25:
            continue
        t = np.array([day(d) for d in st["tracks"][tr]["dates"]])
        vp, stp = np.nan_to_num(x[i, 0]), np.nan_to_num(x[i, 1])
        model = lambda tt: vp * (np.minimum(tt, T_STORM) - T_STORM) / MONTH + stp * (tt >= T_STORM) + x[i, 2] * np.maximum(tt - T_STORM, 0) / MONTH
        have = np.isfinite(D[tr][i])
        inc = np.where(have, (D[tr][i] - G0[tr] @ np.nan_to_num(x[i, 3:6])) / s, model(t[1:]) - model(t[:-1]))   # shared signal removed, projected downslope; a missing pass follows the fit and is not drawn
        cum = model(t[0]) + np.concatenate([[0], np.cumsum(inc)])
        tracks.append({"id": tr[:3], "days": (t - DAY0).tolist(), "mm": [round(float(c), 1) if j == 0 or have[j - 1] else None for j, c in enumerate(cum)]})
    return {"idx": int(i), "v": float(x[i, 2]), "s": float(sd[i, 2]), "z": float(z_post[i]), "v_pre": float(np.nan_to_num(x[i, 0])), "step": float(np.nan_to_num(x[i, 1])),
            "storm_day": int(T_STORM - DAY0), "slope": float(U["slope"][i]), "lat": float(U["lat"][i]), "lon": float(U["lon"][i]), "tracks": tracks}
full3 = ok & fit_ok & (ntr >= 3) & np.all([np.isfinite(D[tr]).all(1) for tr in TRACKS], 0) & np.isfinite(x[:, :3]).all(1)
movers = [int(i) for i in np.argsort(-np.where(det, z_post, -np.inf))[:20] if det[i]]
quiet = [int(i) for i in np.argsort(np.where(full3 & (np.abs(z_post) < 0.4), sd[:, 2], np.inf))[:400:80] if full3[i]]
ex = [e for e in (example(i) for i in movers) if len(e["tracks"]) >= 2][:3] + [e for e in (example(i) for i in quiet) if len(e["tracks"]) >= 2][:3]
write_json(WORK / "inversion_examples.json", ex)
print("example slopes for the site:", [(e["idx"], round(e["v"]), round(e["s"]), len(e["tracks"])) for e in ex])
f32 = lambda a: np.asarray(a, "float32")
save("velocity", v_post=f32(x[:, 2]), s_post=f32(sd[:, 2]), z_post=f32(z_post), v_pre=f32(x[:, 0]), s_pre=f32(sd[:, 0]), z_pre=f32(z_pre),
     step=f32(x[:, 1]), s_step=f32(sd[:, 1]), z_step=f32(z_step), ntracks=ntr.astype("uint8"), chi2=f32(chi2), dof=dof.astype("int16"),
     fit_ok=fit_ok, detected=det, solved=ok, upper=f32(ub), z_cross=f32(z_cross), common_pre=f32(x[:, 3]), common_step=f32(x[:, 4]), common_post=f32(x[:, 5]), s_common_post=f32(sd[:, 5]), z_common=f32(z_common),
     **{f"{tr}__los_post": f32(los[tr][0][:, 2]) for tr in TRACKS}, **{f"{tr}__los_post_s": f32(los[tr][1][:, 2]) for tr in TRACKS})
write_json(WORK / "velocity_stats.json", S)
