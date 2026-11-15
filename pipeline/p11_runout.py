"""Stage F2: debris-flow runout. Where does the debris go if a slope lets go?

1. Calibrate the two Voellmy friction numbers (mu, xi) on the July 2026 scars: release the upper half of each scar
   and compare the simulated runout length with the length of the scar that Sentinel-2 saw.
2. Release one design slide (40 m x 40 m, 1.5 m deep) at the steepest point of every slope the ranking or the radar
   flags, and record which buildings and roads the flow reaches. p08 uses that instead of "a building within 300 m".

Runs between p07 and p08. The terrain is the 20 m DEM, computed on a 10 m grid to limit numerical smearing.
Output: data/work/runout.npz, data/work/runout_stats.json, data/work/qa_runout.png
Results are reused: the calibration while the scars are unchanged, and each slope's simulation while it stays flagged.
`--all` recomputes everything (about 25 minutes).
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import torch
import torch.nn.functional as Fn
from scipy import ndimage as ndi
from pyproj import Transformer
from rasterio import features
from rasterio.transform import from_origin
from common import PUB, WORK, load, write_json, hazard_units, X0, Y1, CRS, H20, W20
from runout_solver import simulate, selftest, device

DEV = device()
DEPTH = 1.5            # m, release depth (assumed: typical shallow slide in weathered soil)
H_HIT = 0.10           # m, mean depth over a 20 m pixel that counts as "debris reaches here"
SEENS = [0.1, 0.25, 0.5, 0.8]   # m, candidate depths from which the satellite shows a pixel as scar
T_END = 120.0
MUS = [0.06, 0.10, 0.14, 0.18, 0.22, 0.27, 0.33, 0.40, 0.50, 0.62]
XIS = [100.0, 200.0, 400.0, 800.0, 1600.0]

T = load("terrain"); U = load("units"); L = load("labels")
zs = ndi.gaussian_filter(T["dem"].astype("float64"), 1.0).astype("float32")     # same smoothing as the slope layer
slope = T["slope"]
visible = np.unpackbits(L["visible"])[: H20 * W20].reshape(H20, W20).astype(bool)
uid20 = np.repeat(np.repeat(U["uid40"], 2, 0), 2, 1)
N = U["h3"].size


def windows(centres, half):
    """Crop 20 m windows of (2*half)^2 pixels around (row, col) centres. Returns origins and the bed on the 10 m grid."""
    n = len(centres); S = 2 * half
    org = np.zeros((n, 2), np.int64); z = np.zeros((n, S, S), "float32")
    for k, (r, c) in enumerate(centres):
        i0 = int(np.clip(round(r) - half, 0, H20 - S)); j0 = int(np.clip(round(c) - half, 0, W20 - S))
        org[k] = i0, j0; z[k] = zs[i0:i0 + S, j0:j0 + S]
    return org, z


def up2(a):
    """20 m -> 10 m, bilinear."""
    return Fn.interpolate(a[:, None], scale_factor=2, mode="bilinear", align_corners=False)[:, 0]


def run(z20, rel20, mu, xi, chunk=384):
    """Simulate a batch of windows. z20, rel20: [n, S, S] numpy at 20 m. Returns hmax, tarr at 10 m plus per-window numbers."""
    out = {k: [] for k in ("hmax", "tarr", "vmax", "lost", "mass_err")}
    for a in range(0, len(z20), chunk):
        sl = slice(a, a + chunk)
        z = up2(torch.from_numpy(z20[sl]).to(DEV))
        h0 = torch.from_numpy(np.repeat(np.repeat(rel20[sl], 2, 1), 2, 2)).to(DEV) * DEPTH
        r = simulate(z, h0, torch.as_tensor(mu[sl], device=DEV), torch.as_tensor(xi[sl], device=DEV), dx=10.0, t_end=T_END)
        out["hmax"].append(r["hmax"].cpu().numpy()); out["tarr"].append(r["tarr"].cpu().numpy()); out["vmax"].append(r["vmax"].amax((1, 2)).cpu().numpy())
        out["lost"].append(r["lost"].cpu().numpy()); out["mass_err"].append(r["mass_err"].cpu().numpy())
        print(f"    windows {a}..{min(a + chunk, len(z20))} of {len(z20)}: {r['steps']} steps, {r['time']:.0f} s simulated", flush=True)
    return {k: np.concatenate(v) for k, v in out.items()}


def pool20(a10, fn=np.mean):
    n, S, _ = a10.shape
    return fn(a10.reshape(n, S // 2, 2, S // 2, 2), axis=(2, 4))


got, want, merr, _ = selftest(DEV)
print(f"solver check on a plane: centre of the deposit stops at {got:.0f} m, a rigid sliding block at {want:.0f} m, mass error {merr:+.4f} ({DEV})", flush=True)

# ---- 1. calibration on the scars ----------------------------------------------------------------
def calibrate():
    lab, n_sc = ndi.label(L["scar_class"] == 1, np.ones((3, 3)))
    HALF_C = 32                                                        # 1.28 km windows
    scars = []
    for i, sl_ in enumerate(ndi.find_objects(lab)):
        m = lab[sl_] == i + 1
        rr, cc = np.nonzero(m); rr = rr + sl_[0].start; cc = cc + sl_[1].start
        order = np.argsort(-zs[rr, cc])
        k = max(1, len(rr) // 2)                                       # upper half of the scar is the source
        src = order[:k]
        r0, c0 = rr[src].mean(), cc[src].mean()
        L_obs = float(np.hypot(rr - r0, cc - c0).max() * 20 + 10)
        low = order[-1]
        # the scar ends where the satellite could no longer see one (flatter than 15 degrees, farmland, cloud)?
        nb = visible[max(rr[low] - 1, 0): rr[low] + 2, max(cc[low] - 1, 0): cc[low] + 2]
        scars.append({"rr": rr, "cc": cc, "src": src, "r0": r0, "c0": c0, "L_obs": L_obs, "n": len(rr),
                      "drop": float(zs[rr, cc].max() - zs[rr, cc].min()), "cut": bool((~nb).any()),
                      "county": int(U["county"][np.bincount(uid20[rr, cc]).argmax()])})
    nS = len(scars)
    print(f"{nS} scars; observed runout length (m) median {np.median([s['L_obs'] for s in scars]):.0f}, "
          f"range {min(s['L_obs'] for s in scars):.0f}-{max(s['L_obs'] for s in scars):.0f}; {sum(s['cut'] for s in scars)} end at the edge of what the satellite can see", flush=True)
    org, z20 = windows([(s["r0"], s["c0"]) for s in scars], HALF_C)
    rel = np.zeros_like(z20); vis = np.zeros(z20.shape, bool); dist = np.zeros_like(z20)
    ii, jj = np.mgrid[0:2 * HALF_C, 0:2 * HALF_C]
    for k, s in enumerate(scars):
        i0, j0 = org[k]
        rel[k, s["rr"][s["src"]] - i0, s["cc"][s["src"]] - j0] = 1
        vis[k] = visible[i0:i0 + 2 * HALF_C, j0:j0 + 2 * HALF_C]
        dist[k] = np.hypot(ii + i0 - s["r0"], jj + j0 - s["c0"]) * 20 + 10
    combos = [(m, x) for m in MUS for x in XIS]
    nC = len(combos)
    t0 = time.time()
    r = run(np.tile(z20, (nC, 1, 1)), np.tile(rel, (nC, 1, 1)), np.repeat([c[0] for c in combos], nS).astype("float32"),
            np.repeat([c[1] for c in combos], nS).astype("float32"), chunk=660)
    print(f"  calibration: {nC * nS} runs in {time.time() - t0:.0f} s", flush=True)
    hm20 = pool20(r["hmax"]).reshape(nC, nS, 2 * HALF_C, 2 * HALF_C)
    L_obs = np.array([s["L_obs"] for s in scars])
    scar_m = np.zeros((nS, 2 * HALF_C, 2 * HALF_C), bool)
    for k, s in enumerate(scars):
        scar_m[k, s["rr"] - org[k, 0], s["cc"] - org[k, 1]] = True
    # The satellite only shows a pixel as scar when enough of it is stripped. How deep that is, is a third unknown, so it
    # is picked together with the friction pair (and counted as a fitted number in the held-out test).
    full = [(m, x, hs) for hs in SEENS for (m, x) in combos]
    L_sim = np.concatenate([np.where((hm20 >= hs) & vis[None], dist[None], 10.0).max((2, 3)) for hs in SEENS])   # same blind spots as the satellite
    err = np.abs(np.log(L_sim / L_obs[None]))                                   # [combo x seen-depth, scar]
    loss = err.mean(1)
    best = int(np.argmin(loss))
    MU, XI, H_SEEN = full[best]
    seen = hm20[best % nC] >= H_SEEN
    cover = float(((ndi.binary_dilation(seen, np.ones((1, 3, 3))) & scar_m).sum((1, 2)) / scar_m.sum((1, 2))).mean())
    hit = float(((seen & ndi.binary_dilation(scar_m, np.ones((1, 3, 3)))).sum((1, 2)) / np.maximum((seen & vis).sum((1, 2)), 1)).mean())
    factor = lambda e: float(np.exp(np.median(e)))
    # held out: pick the numbers on the other counties' scars, score on this group's scars
    cty = np.array([s["county"] for s in scars]); groups = np.array_split(np.array(sorted(set(cty))), 5)
    held = np.zeros(nS); held_pick = []
    base = np.zeros(nS)                                                           # the simplest rival: every slide runs the median length
    for g in groups:
        te = np.isin(cty, g)
        if not te.any(): continue
        b = int(np.argmin(err[:, ~te].mean(1))); held[te] = err[b, te]; held_pick.append(list(full[b]))
        base[te] = np.abs(np.log(np.median(L_obs[~te]) / L_obs[te]))
    # How well do the scars pin the friction down? Resample the scars: which pairs can they not tell from the best one?
    rng = np.random.default_rng(0)
    bs = rng.integers(0, nS, (2000, nS))
    sub = slice((best // nC) * nC, (best // nC + 1) * nC)                         # all friction pairs at the chosen seen-depth
    diff = err[sub] - err[best][None]                                             # [pair, scar]
    p_worse = (diff[:, bs].mean(2) > 0).mean(1)                                   # share of resamples where the pair is worse than the best
    okay = [combos[i] for i in range(nC) if p_worse[i] < 0.95]
    MU_F, XI_F = min(okay, key=lambda c: (c[0], -c[1]))                           # the most mobile pair the scars cannot rule out
    i_far = (best // nC) * nC + combos.index((MU_F, XI_F))
    lmat = loss[sub].reshape(len(MUS), len(XIS))
    by_mu = {str(m): round(float(lmat[i].min()), 3) for i, m in enumerate(MUS)}
    print(f"  best mu {MU}, xi {XI:.0f}, scar visible from {H_SEEN} m: typical error factor {factor(err[best]):.2f} in-sample, {factor(held):.2f} held out "
          f"(same-length-for-all: {factor(base):.2f}); within a factor of 2 held out: {float((held < np.log(2)).mean()):.0%} (rival {float((base < np.log(2)).mean()):.0%})", flush=True)
    print("  mean |log error| by mu:", by_mu, flush=True)
    print(f"  friction pairs the scars cannot rule out: {len(okay)} of {nC}; mu from {min(c[0] for c in okay)} to {max(c[0] for c in okay)}. Far-reaching case: mu {MU_F}, xi {XI_F:.0f}", flush=True)
    calib = {"n_scars": nS, "mu": MU, "xi": XI, "seen_depth_m": H_SEEN, "mu_far": MU_F, "xi_far": XI_F, "release_depth_m": DEPTH,
             "grid_mu": MUS, "grid_xi": XIS, "grid_seen": SEENS, "loss": np.round(lmat, 3).tolist(), "loss_by_mu": by_mu,
             "pairs_not_ruled_out": len(okay), "pairs_tried": nC, "mu_range_not_ruled_out": [min(c[0] for c in okay), max(c[0] for c in okay)],
             "L_obs_median_m": float(np.median(L_obs)), "L_obs_range_m": [float(L_obs.min()), float(L_obs.max())],
             "L_sim_median_m": float(np.median(L_sim[best])), "L_sim_far_median_m": float(np.median(L_sim[i_far])),
             "scars_cut_by_visibility": int(sum(s["cut"] for s in scars)),
             "err_factor_insample": factor(err[best]), "err_factor_heldout": factor(held), "err_factor_baseline": factor(base),
             "within2x_heldout": float((held < np.log(2)).mean()), "within2x_baseline": float((base < np.log(2)).mean()),
             "beats_baseline": bool(np.median(held) < np.median(base)),
             "median_abs_err_m": float(np.median(np.abs(L_sim[best] - L_obs))), "heldout_picks": held_pick,
             "scar_px_reached": cover, "path_on_scar": hit,
             "selftest": {"centre_m": got, "point_mass_m": want, "mass_err": merr},
             "scars": [{"L_obs": float(L_obs[k]), "L_sim": float(L_sim[best, k]), "px": s["n"], "cut": s["cut"]} for k, s in enumerate(scars)]}

    # ---- QA picture: the nine longest scars, simulated path against the scar -------------------------
    try:
        import matplotlib; matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        pick = np.argsort(-L_obs)[:9]
        fig, ax = plt.subplots(3, 3, figsize=(10, 10), facecolor="#0b1014")
        for a, k in zip(ax.ravel(), pick):
            c = slice(HALF_C - 14, HALF_C + 14)
            a.imshow(z20[k][c, c], cmap="gray"); a.contour(z20[k][c, c], 12, colors="#ffffff", linewidths=0.3, alpha=0.4)
            a.imshow(np.ma.masked_less(hm20[best % nC, k][c, c], H_SEEN), cmap="autumn", alpha=0.75, vmin=0, vmax=1.5)
            a.contour(scar_m[k][c, c].astype(float), [0.5], colors="#39d0ff", linewidths=1.6)
            a.set_title(f"scar {L_obs[k]:.0f} m, simulated {L_sim[best, k]:.0f} m", color="w", fontsize=9); a.axis("off")
        fig.suptitle(f"Simulated flow (orange) against the Sentinel-2 scar (blue outline). mu {MU}, xi {XI:.0f}", color="w")
        fig.tight_layout(); fig.savefig(WORK / "qa_runout.png", dpi=110); plt.close(fig)
    except Exception as e:                                                       # the picture is optional
        print("  no QA picture:", e)
        return calib


import hashlib
scar_hash = hashlib.sha1(np.packbits(L["scar_class"] == 1).tobytes()).hexdigest()[:16]
calib = None
if (WORK / "runout_stats.json").exists() and "--all" not in sys.argv:
    c0 = json.load(open(WORK / "runout_stats.json"))["calibration"]
    if c0.get("scar_hash") == scar_hash:
        calib = c0; print(f"calibration reused (same scars): mu {calib['mu']}, xi {calib['xi']:.0f}; far case mu {calib['mu_far']}, xi {calib['xi_far']:.0f}", flush=True)
if calib is None:
    calib = calibrate(); calib["scar_hash"] = scar_hash
MU, XI, MU_F, XI_F = calib["mu"], calib["xi"], calib["mu_far"], calib["xi_far"]

# ---- 2. one design slide per flagged slope ------------------------------------------------------
hazard = hazard_units()
# Slopes already simulated with the same friction pairs keep their result; only new ones are run (a full run is ~20 min).
prev = None
if (WORK / "runout.npz").exists() and (WORK / "runout_stats.json").exists() and "--all" not in sys.argv:
    pc = json.load(open(WORK / "runout_stats.json"))["calibration"]
    if [pc["mu"], pc["xi"], pc["mu_far"], pc["xi_far"]] == [MU, XI, MU_F, XI_F]:
        prev = dict(np.load(WORK / "runout.npz"))
haz = np.where(hazard & ~prev["sim"])[0] if prev else np.where(hazard)[0]
print(f"{int(hazard.sum())} flagged slopes, {len(haz)} to simulate", flush=True)
HALF = 40                                                            # 1.6 km windows
# release: 2 x 2 pixels (40 m x 40 m) at the steepest spot of the hexagon
sm = ndi.uniform_filter(slope, 2)
order = np.argsort(uid20.ravel(), kind="stable"); bounds = np.searchsorted(uid20.ravel()[order], np.arange(N + 1))
cen = np.zeros((len(haz), 2))
for k, u in enumerate(haz):
    px = order[bounds[u]:bounds[u + 1]]
    b = px[np.argmax(sm.ravel()[px])]
    cen[k] = np.clip(b // W20, 1, H20 - 2), np.clip(b % W20, 1, W20 - 2)
org, z20 = windows(cen, HALF)
rel = np.zeros_like(z20)
for k in range(len(haz)):
    i, j = int(cen[k, 0] - org[k, 0]), int(cen[k, 1] - org[k, 1])
    rel[k, i - 1:i + 1, j - 1:j + 1] = 1
# buildings and main roads on the 20 m grid
tf = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
els = json.load(open(PUB / "osm_buildings_roads.json"))
b = np.array([(e["center"]["lon"], e["center"]["lat"]) for e in els if "building" in e.get("tags", {})])
bx, by = tf.transform(b[:, 0], b[:, 1])
bi, bj = ((Y1 - by) // 20).astype(int), ((bx - X0) // 20).astype(int)
ok = (bi >= 0) & (bi < H20) & (bj >= 0) & (bj < W20)
bcount = np.bincount(bi[ok] * W20 + bj[ok], minlength=H20 * W20).reshape(H20, W20).astype("float32")
shapes = []
for rd in json.load(open(PUB / "osm_roads_geom.json")):
    xs, ys = tf.transform([p[0] for p in rd["line"]], [p[1] for p in rd["line"]])
    if len(xs) >= 2: shapes.append(({"type": "LineString", "coordinates": list(zip(xs, ys))}, 1))
road20 = features.rasterize(shapes, out_shape=(H20, W20), transform=from_origin(X0, Y1, 20, 20), fill=0, dtype="uint8").astype(bool)
S = 2 * HALF
ii, jj = np.mgrid[0:S, 0:S]


def scenario(mu, xi, tag):
    """Run the slopes in `haz` with one friction pair; per-slope reach numbers, prefixed with tag."""
    print(f"{len(haz)} slopes, {tag}: mu {mu}, xi {xi:.0f}", flush=True)
    t0 = time.time()
    r = run(z20, rel, np.full(len(haz), mu, "float32"), np.full(len(haz), xi, "float32")) if len(haz) else \
        {"hmax": np.zeros((0, S, S), "float32"), "tarr": np.zeros((0, S, S), "float32"), "vmax": np.zeros(0), "lost": np.zeros(0), "mass_err": np.zeros(1)}
    foot = pool20(r["hmax"]) >= H_HIT
    ta20 = pool20(np.where(np.isfinite(r["tarr"]), r["tarr"], 1e9), np.min)
    near = ndi.binary_dilation(foot, np.ones((1, 3, 3)))             # a building counts if the flow passes within 20 m of it
    o = {k: np.full(N, np.nan, "float32") for k in ("len", "drop", "bld", "tbld", "vmax", "area", "dir")}
    road = np.zeros(N, bool); left = np.zeros(N, bool)
    for k, u in enumerate(haz):
        i0, j0 = org[k]; f = foot[k]
        d = np.hypot(ii + i0 - cen[k, 0] + 0.5, jj + j0 - cen[k, 1] + 0.5) * 20
        far = np.argmax(np.where(f, d, -1)); fi, fj = far // S, far % S
        bw = bcount[i0:i0 + S, j0:j0 + S]
        hitb = near[k] & (bw > 0)
        left[u] = r["lost"][k] > 0.02
        o["len"][u] = d[fi, fj]; o["drop"][u] = z20[k][rel[k] > 0].mean() - z20[k][fi, fj]
        o["dir"][u] = np.degrees(np.arctan2(fj + j0 + 0.5 - cen[k, 1], -(fi + i0 + 0.5 - cen[k, 0]))) % 360      # compass bearing of the run
        o["bld"][u] = bw[hitb].sum(); o["vmax"][u] = r["vmax"][k]; o["area"][u] = f.sum() * 400
        if hitb.any(): o["tbld"][u] = ndi.grey_erosion(ta20[k], size=(3, 3))[hitb].min()
        road[u] = (f & road20[i0:i0 + S, j0:j0 + S]).any()
    out = {f"{tag}_{k}": v for k, v in o.items()}; out[f"{tag}_road"] = road; out[f"{tag}_left"] = left
    if prev:                                                          # keep earlier results for slopes that are still flagged
        for k in out:
            out[k] = np.where(prev["sim"] & hazard, prev[k], out[k])
    hz = np.where(hazard)[0]; ln = out[f"{tag}_len"][hz]; nb = np.nan_to_num(out[f"{tag}_bld"][hz]); rd = out[f"{tag}_road"][hz]
    st = {"mu": mu, "xi": xi, "runout_m": {"median": float(np.nanmedian(ln)), "p90": float(np.nanpercentile(ln, 90)), "max": float(np.nanmax(ln))},
          "reach_building": int((nb > 0).sum()), "reach_road": int(rd.sum()), "reach_either": int(((nb > 0) | rd).sum()),
          "buildings_reached_total": int(nb.sum()), "left_window": int(out[f"{tag}_left"][hz].sum()), "seconds_this_run": round(time.time() - t0, 1),
          "worst_mass_err": float(np.abs(r["mass_err"]).max())}
    print("  ", st, flush=True)
    return out, st, r


out_l, st_l, r_l = scenario(MU, XI, "ro")                # best fit to the scars
hm_l = r_l["hmax"] >= H_HIT; del r_l
out_f, st_f, r = scenario(MU_F, XI_F, "rf")              # the most mobile pair the scars cannot rule out
# animation of the far-reaching case: every 10 m cell the flow covered, its arrival time and deepest depth, and
# whether the best-fit case gets there too
anim = {}
if prev:
    po = np.concatenate([[0], np.cumsum(prev["an_n"])])
    for i, u in enumerate(prev["an_unit"]):
        if hazard[u]: anim[int(u)] = tuple(prev[k][po[i]:po[i + 1]] for k in ("an_r", "an_c", "an_t", "an_d", "an_k"))
for k, u in enumerate(haz):
    i0, j0 = org[k]
    a = r["hmax"][k] >= H_HIT
    ar, ac = np.nonzero(a)
    anim[int(u)] = ((ar + 2 * i0).astype("uint16"), (ac + 2 * j0).astype("uint16"),
                    np.clip(np.where(np.isfinite(r["tarr"][k][a]), r["tarr"][k][a], T_END) * 2, 0, 255).astype("uint8"),
                    np.clip(r["hmax"][k][a] * 50, 1, 255).astype("uint8"), hm_l[k][a].astype("uint8"))
units = np.array(sorted(anim))
an_n = [len(anim[u][0]) for u in units]
cat = lambda j, dt: np.concatenate([anim[u][j] for u in units]) if len(units) else np.zeros(0, dt)
stats = {"calibration": calib, "device": str(DEV), "simulated_slopes": int(hazard.sum()), "release": {"size_m": 40, "depth_m": DEPTH, "volume_m3": 1600 * DEPTH},
         "hit_depth_m": H_HIT, "best_fit": st_l, "far": st_f, "animation_cells": int(sum(an_n))}
np.savez_compressed(WORK / "runout.npz", sim=hazard, **out_l, **out_f, an_unit=units, an_n=np.array(an_n), an_r=cat(0, "uint16"),
                    an_c=cat(1, "uint16"), an_t=cat(2, "uint8"), an_d=cat(3, "uint8"), an_k=cat(4, "uint8"))
write_json(WORK / "runout_stats.json", stats)
