"""Independent radar check of the July 2026 storm scars.

The scar labels come only from Sentinel-2 optical images (pipeline/p05_labels.py). This script asks whether
NISAR saw the same places change: is radar coherence across the storm pair lower at the scars than
(a) at old forest clearings, which were already bare before the storm, and (b) at random places?

Coherence is compared with a ring of pixels 240 m around each point (local contrast), so a regional loss
of coherence from rain or vegetation does not count. Output: site/data/radar_check.json
Run: python3 analysis/radar_scar_check.py   (reads only files in site/data/)"""
import gzip, json
from pathlib import Path
import numpy as np

SITE = Path(__file__).resolve().parents[1] / "site" / "data"
meta = json.load(open(SITE / "meta.json"))
H, W = meta["grid"]["h80"]
cands = json.load(open(SITE / "candidates.json"))
PIX_KM = 0.08
rng = np.random.default_rng(0)


def local_contrast(coh, i, j, r=3):
    win = coh[i - r:i + r + 1, j - r:j + r + 1]
    ring = np.concatenate([win[[0, -1], :].ravel(), win[1:-1, [0, -1]].ravel()])
    return float(coh[i, j] - np.median(ring))


def mannwhitney_p(a, b, n_perm=20000):
    """One-sided permutation test: is a lower than b? Statistic: difference of medians."""
    a, b = np.asarray(a), np.asarray(b)
    obs = np.median(b) - np.median(a)
    pool = np.concatenate([a, b]); k = len(a); hits = 0
    for _ in range(n_perm):
        rng.shuffle(pool)
        hits += (np.median(pool[k:]) - np.median(pool[:k])) >= obs
    return (hits + 1) / (n_perm + 1)


out = {"method": __doc__.split("\n\n")[1].replace("\n", " "), "threshold": -0.1, "tracks": {}}
for t in ["125", "032", "024"]:
    tr = meta["tracks"][t]; s = tr["storm"][0]
    R = np.frombuffer(gzip.open(SITE / f"radar_{t}.bin.gz").read(), "u1").reshape(H, W, 4)
    coh = R[..., 1] / 255.0; cov = R[..., 3] > 0
    groups = {"failure": [], "clearing": []}; per_scar = []
    for c in cands:
        i, j = int(c["z"] / PIX_KM), int(c["x"] / PIX_KM)
        if not (3 <= i < H - 3 and 3 <= j < W - 3) or not cov[i, j]:
            continue
        d = local_contrast(coh, i, j)
        groups[c["auto"]].append(d)
        if c["auto"] == "failure":
            per_scar.append({"id": c["id"], "lat": c["lat"], "lon": c["lon"], "area_m2": c["area_m2"], "contrast": round(d, 3)})
    ii = rng.integers(3, H - 3, 20000); jj = rng.integers(3, W - 3, 20000); keep = cov[ii, jj]
    rand = [local_contrast(coh, i, j) for i, j in zip(ii[keep][:5000], jj[keep][:5000])]
    f, cl, rd = map(np.array, (groups["failure"], groups["clearing"], rand))
    out["tracks"][t] = {
        "pair": [tr["dates"][s], tr["dates"][s + 1]], "direction": tr["dir"],
        "n": {"failure": len(f), "clearing": len(cl), "random": len(rd)},
        "median_contrast": {"failure": round(float(np.median(f)), 3), "clearing": round(float(np.median(cl)), 3), "random": round(float(np.median(rd)), 3)},
        "share_below_threshold": {"failure": round(float((f < -0.1).mean()), 3), "clearing": round(float((cl < -0.1).mean()), 3), "random": round(float((rd < -0.1).mean()), 3)},
        "p_failure_lower_than_clearing": round(mannwhitney_p(f, cl), 4),
        "p_failure_lower_than_random": round(mannwhitney_p(f, rd[:2000]), 4),
        "strongest_scars": sorted(per_scar, key=lambda r: r["contrast"])[:5],
    }
    print(t, out["tracks"][t]["pair"], out["tracks"][t]["median_contrast"], out["tracks"][t]["share_below_threshold"],
          "p vs clearing", out["tracks"][t]["p_failure_lower_than_clearing"], "p vs random", out["tracks"][t]["p_failure_lower_than_random"])
json.dump(out, open(SITE / "radar_check.json", "w"), indent=1)
