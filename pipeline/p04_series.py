"""Stage C2: movement history per hexagon, noise floor, stable-ground check, track agreement.
Output: data/work/series.npz, data/work/series_stats.json"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from common import WORK, TRACKS, load, save, write_json, STORM

U = load("units"); Nz = load("nisar")
stats_in = json.load(open(WORK / "nisar_stats.json"))
N = U["h3"].size
slope_u = U["is_slope"]
stable = (U["lc_built"] >= 0.2) | ((U["slope"] < 4) & (U["lc_crop"] < 0.3) & (U["lc_water"] < 0.1))
mad = lambda a: float(1.4826 * np.nanmedian(np.abs(a - np.nanmedian(a))))
HALF_CYCLE = 12.1
S = {"stable_units": int(stable.sum()), "tracks": {}}
out = {}
storm = STORM.replace("-", "")
for tr in TRACKS:
    inc = Nz[f"{tr}__inc"].copy()
    dates = stats_in[tr]["dates"]
    pre = [i for i in range(inc.shape[1]) if dates[i + 1] < storm]           # pairs that end before the storm
    post = [i for i in range(inc.shape[1]) if dates[i] > storm]              # pairs that start after it
    span = [i for i in range(inc.shape[1]) if i not in pre and i not in post]
    jump = np.abs(inc) > 0.5 * HALF_CYCLE                                    # suspected unwrapping error
    inc[jump] = np.nan
    sig_all = np.array([mad(inc[slope_u, p]) for p in range(inc.shape[1])])
    sig_stable = np.array([mad(inc[stable, p]) for p in range(inc.shape[1])])
    med_stable = np.array([float(np.nanmedian(inc[stable, p])) for p in range(inc.shape[1])])
    cum = np.concatenate([np.zeros((N, 1), "float32"), np.nancumsum(inc, 1)], 1)
    gaps = np.isnan(inc)
    ip = inc[:, post]
    n_post = (~np.isnan(ip)).sum(1)
    cum_post = np.nansum(ip, 1); cum_post[n_post < max(3, len(post) - 2)] = np.nan
    sig_post = np.sqrt(np.nansum(np.where(np.isnan(ip), 0, sig_all[post] ** 2), 1))
    z = cum_post / np.maximum(sig_post, 1e-3)
    measurable = (gaps.mean(1) <= 0.25) & (Nz[f"{tr}__badgeom"] < 0.5)
    out[tr] = dict(inc=inc, cum=cum, cum_post=cum_post.astype("float32"), sig_post=sig_post.astype("float32"),
                   z=z.astype("float32"), measurable=measurable, n_post=n_post,
                   pre_inc=np.nanmean(inc[:, pre], 1).astype("float32"),
                   pre_coh=np.nanmean(Nz[f"{tr}__coh20"][:, pre], 1).astype("float32"),
                   storm_coh=np.nanmean(Nz[f"{tr}__coh20"][:, span], 1).astype("float32"))
    covered = (~gaps).any(1)
    S["tracks"][tr] = {
        "dates": dates, "pre_pairs": pre, "storm_pairs": span, "post_pairs": post,
        "noise_cm_per_pair_slopes": sig_all.round(3).tolist(), "noise_cm_per_pair_stable": sig_stable.round(3).tolist(),
        "stable_median_cm_per_pair": med_stable.round(3).tolist(),
        "stable_cum_post_median_cm": float(np.nanmedian(cum_post[stable])), "stable_cum_post_mad_cm": mad(cum_post[stable]),
        "slopes_cum_post_mad_cm": mad(cum_post[slope_u]),
        "jumps_flagged": int(jump.sum()),
        "slope_units_covered": int((covered & slope_u).sum()), "slope_units_measurable": int((measurable & slope_u).sum()),
        "slope_units_badgeom": int(((Nz[f"{tr}__badgeom"] >= 0.5) & slope_u).sum())}
    t = S["tracks"][tr]
    print(tr, "noise/pair slopes", np.round(sig_all, 2), "stable", np.round(sig_stable, 2))
    print("   stable median/pair", np.round(med_stable, 2), "| post-storm cum: stable median", round(t["stable_cum_post_median_cm"], 3),
          "MAD", round(t["stable_cum_post_mad_cm"], 2), "slopes MAD", round(t["slopes_cum_post_mad_cm"], 2),
          "| measurable", t["slope_units_measurable"], "of", int(slope_u.sum()), "bad geometry", t["slope_units_badgeom"], "jumps", t["jumps_flagged"])

# ---- agreement between the two ascending tracks (same look side, 5 days apart) ----
a, b = out["125_A_020"], out["024_A_020"]
both = slope_u & np.isfinite(a["cum_post"]) & np.isfinite(b["cum_post"])
r_all = float(np.corrcoef(a["cum_post"][both], b["cum_post"][both])[0, 1])
mov = both & ((np.abs(a["z"]) >= 2.5) | (np.abs(b["z"]) >= 2.5))
r_mov = float(np.corrcoef(a["cum_post"][mov], b["cum_post"][mov])[0, 1])
same = float((np.sign(a["cum_post"][mov]) == np.sign(b["cum_post"][mov])).mean())
# null: shuffle one track among nearby-noise units
S["ascending_agreement"] = {"units": int(both.sum()), "r_all": r_all, "moving_units": int(mov.sum()), "r_moving": r_mov, "same_sign_moving": same}
print("ascending tracks 125 vs 024: r all", round(r_all, 3), "n", both.sum(), "| moving r", round(r_mov, 3), "same sign", round(same, 3), "n", mov.sum())
# per-pair agreement is not possible (dates differ by 5 days); also compare pre-storm increments
c = out["032_D_070"]
both3 = slope_u & np.isfinite(a["cum_post"]) & np.isfinite(c["cum_post"])
S["asc_desc_r"] = float(np.corrcoef(a["cum_post"][both3], c["cum_post"][both3])[0, 1])
print("asc 125 vs desc 032 r", round(S["asc_desc_r"], 3))

# ---- movement flag ----
Z = np.stack([out[t]["z"] for t in TRACKS], 1)
Zm = np.where(np.stack([out[t]["measurable"] for t in TRACKS], 1), Z, np.nan)
strong = (np.abs(Zm) >= 3.5).any(1)
asc_agree = (np.abs(Zm[:, 0]) >= 2.5) & (np.abs(Zm[:, 2]) >= 2.5) & (np.sign(Zm[:, 0]) == np.sign(Zm[:, 2]))
two = ((np.abs(Zm) >= 2.5).sum(1) >= 2) & (asc_agree | (np.abs(Zm[:, 1]) >= 2.5))
moving = strong | two
n_meas = np.isfinite(Zm).sum(1)
S["movement"] = {"rule": "one track |z|>=3.5, or two tracks |z|>=2.5 (the two ascending tracks must have the same sign)",
                 "slope_units_flagged": int((moving & slope_u).sum()), "share_of_measurable_slopes": float((moving & slope_u).sum() / max((slope_u & (n_meas > 0)).sum(), 1)),
                 "stable_units_flagged_share": float((moving & stable).sum() / max((stable & (n_meas > 0)).sum(), 1)),
                 "not_measurable_slopes": int((slope_u & (n_meas == 0)).sum())}
print("movement flagged:", S["movement"])
flat = {f"{tr}__{k}": v for tr, d in out.items() for k, v in d.items()}
save("series", moving=moving, n_meas=n_meas, zmax=np.nanmax(np.abs(np.where(np.isfinite(Zm), Zm, 0)), 1).astype("float32"), stable=stable, **flat)
write_json(WORK / "series_stats.json", S)
