"""Stage K4: nationwide susceptibility (LightGBM), trained where failures are known, applied to every slope unit.

The only failure labels are the July 2026 storm scars in North Gyeongsang (regional build). The model learns
from those slopes with whole counties held out (the same hindsight test as the regional map), then ranks
every slope unit in South Korea. Inputs exist everywhere: terrain, the March 2025 fire (Sentinel-2 dNBR from
Planetary Computer, so the Sancheong, Ulju and other 2025 fires count too), vegetation and land cover.
Storm-specific rainfall is tested but left out of the shipped model: it describes the July 2026 storm in one
region, not a slope, and would not transfer to the rest of the country.

Joint training with the regional build. 20 failed hexagons is very little to learn from, and the regional
pipeline already ranked ~86,000 individual slopes at 20 m. So the nationwide model also gets a "student":
a regressor that learns, from the nationwide inputs only, to reproduce the 20 m regional model's ranking of
the slopes inside each hexagon (the "teacher"). The shipped score averages the ranks of the label classifier
and the student. The hindsight test stays honest: for each held-out fold of counties the teacher is retrained
without those counties, and its targets for the training counties are themselves out-of-fold. This needs the
regional work files (data/work/, git-ignored); without them the stage ships the classifier alone, as before.
Output: data/korea/work/suscept.npz, suscept_stats.json"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lightgbm as lgb
import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score

import h3.api.numpy_int as h3

from common_kr import ROOT, WORK, REGION_SITE, H3RES, load, write_json

U = np.load(WORK / "units.npz"); Rg = np.load(WORK / "region.npz")
counties = json.load(open(WORK / "counties.json"))
cname = {c["id"]: c["en"] for c in counties}
TERRAIN = ["slope", "steep30", "relief", "curv", "tpi", "twi", "dstream", "dem", "northness", "eastness"]
BURN = ["dnbr", "burn_frac", "burn_high", "loss2025", "loss_pre", "ndvi_pre", "ndvi_postfire",
        "lc_tree", "lc_shrub", "lc_grass", "lc_crop", "lc_bare"]
RAIN = ["rain_ante30", "rain_max1_pre", "rain_max3_pre"]
ALL = TERRAIN + BURN + RAIN
X = np.stack([U[k].astype("float32") for k in ALL], 1)
y = Rg["label"].astype(int)
pop = U["is_slope"] & Rg["observed"]
county = U["county"]
print(f"population {pop.sum():,} slope units seen by the optical pair, {y[pop].sum()} failed", flush=True)

cs = sorted(set(county[pop]), key=lambda c: -int(y[pop & (county == c)].sum()))
K = 5
fold_of, load_ = {}, [0] * K
for c in cs:
    k = int(np.argmin(load_)); fold_of[c] = k
    load_[k] += int(y[pop & (county == c)].sum()) + 1e-3 * int((pop & (county == c)).sum())
fold = np.array([fold_of.get(c, -1) if p else -1 for c, p in zip(county, pop)])
print("folds:", {k: [cname[c] for c in cs if fold_of[c] == k] for k in range(K)}, flush=True)

PARAMS = dict(objective="binary", n_estimators=150, learning_rate=0.03, num_leaves=6, min_child_samples=10,
              subsample=0.8, subsample_freq=1, colsample_bytree=0.7, reg_lambda=5.0, verbose=-1, n_jobs=4)


def oof(cols, seeds=(0, 1, 2, 3, 4), want=False):
    ci = [ALL.index(c) for c in cols]
    score = np.zeros(len(y)); contrib = np.zeros((len(y), len(ci) + 1), "float32") if want else None; models = []
    for k in range(K):
        tr = pop & (fold != k) & (fold >= 0); te = fold == k
        ms = []
        for s in seeds:
            pos = y[tr].sum()
            m = lgb.LGBMClassifier(**PARAMS, random_state=s, scale_pos_weight=min(200.0, (tr.sum() - pos) / max(pos, 1)))
            m.fit(X[tr][:, ci], y[tr]); ms.append(m)
        score[te] = np.mean([m.predict(X[te][:, ci], raw_score=True) for m in ms], 0)
        if want:
            contrib[te] = np.mean([m.predict(X[te][:, ci], pred_contrib=True) for m in ms], 0)
        models.append(ms)
    rest = fold < 0                     # everywhere else in South Korea: average all fold models
    flat = [m for ms in models for m in ms]
    for a in range(0, int(rest.sum()), 50000):
        idx = np.where(rest)[0][a:a + 50000]
        score[idx] = np.mean([m.predict(X[idx][:, ci], raw_score=True) for m in flat], 0)
        if want:
            contrib[idx] = np.mean([m.predict(X[idx][:, ci], pred_contrib=True) for m in flat], 0)
    return (score, contrib) if want else score


def within_fold_rank(score):
    r = np.full(len(score), np.nan)
    for k in range(K):
        m = pop & (fold == k)
        r[m] = (np.argsort(np.argsort(score[m])) + 1) / m.sum()
    return r


def capture(rank, top):
    return float((rank[pop & (y == 1)] >= 1 - top).mean())


rng = np.random.default_rng(0)


def summarise(name, score):
    r = within_fold_rank(score)
    pos = np.where(pop & (y == 1))[0]
    boot = [float((r[rng.choice(pos, pos.size)] >= 0.9).mean()) for _ in range(2000)]
    res = {"capture_top5": capture(r, .05), "capture_top10": capture(r, .10), "capture_top20": capture(r, .20),
           "capture_top10_ci90": [float(np.percentile(boot, 5)), float(np.percentile(boot, 95))],
           "avg_precision": float(average_precision_score(y[pop], r[pop])), "roc_auc": float(roc_auc_score(y[pop], r[pop])),
           "curve": [round(capture(r, t), 4) for t in np.linspace(0, 1, 101)]}
    print(f"{name:30s} top5 {res['capture_top5']:.2f}  top10 {res['capture_top10']:.2f} "
          f"(90% CI {res['capture_top10_ci90'][0]:.2f}-{res['capture_top10_ci90'][1]:.2f})  top20 {res['capture_top20']:.2f}  AUC {res['roc_auc']:.3f}", flush=True)
    return res


z = lambda a: (a - np.nanmean(a[pop])) / (np.nanstd(a[pop]) + 1e-9)
Res = {}
Res["steepness_only"] = summarise("steepness only", np.nan_to_num(U["slope"]))
Res["steep_and_burned"] = summarise("steepness + burn rule", z(np.nan_to_num(U["slope"])) + z(np.nan_to_num(U["burn_frac"])))
Res["model_with_rain"] = summarise("model + storm rainfall", oof(ALL))
# April 2025 greenness stood for "burned" inside the training region, but elsewhere it mostly measures how far spring
# has come (it put south-coast islands at the top of the country). The shipped model keeps the direct burn measures
# (dNBR, burned share, 2025 tree loss) and drops it.
SHIP = TERRAIN + [f for f in BURN if f != "ndvi_postfire"]
Res["model_with_april_ndvi"] = summarise("model + April 2025 NDVI", oof(TERRAIN + BURN))
s_base, contrib = oof(SHIP, want=True)
Res["model_base"] = summarise("label classifier (no rainfall)", s_base)

# ---- joint training with the 20 m regional model (teacher -> student) --------------------------------------
m = U["is_slope"]
ci = [ALL.index(c) for c in SHIP]
rank01 = lambda v: (np.argsort(np.argsort(v)) + 1) / len(v)
RW = ROOT / "data" / "work"
joint = {"available": all((RW / f).exists() for f in ("units.npz", "labels.npz")), "shipped": False}
s_ship = s_base
if joint["available"]:
    U9 = np.load(RW / "units.npz"); L9 = np.load(RW / "labels.npz")
    T_FEATS = TERRAIN + ["dnbr", "burn_frac", "burn_high", "loss2025", "loss_pre", "ndvi_pre", "ndvi_postfire", "treecover",
                         "lc_tree", "lc_shrub", "lc_grass", "lc_crop", "lc_bare"]            # the regional model's inputs, minus storm rainfall
    X9 = np.stack([U9[k].astype("float32") for k in T_FEATS], 1)
    slope9 = U9["is_slope"]; y9 = (L9["label"] > 0) & L9["observed"]; pop9 = slope9 & L9["observed"]
    pos8 = {int(c): i for i, c in enumerate(U["h3"])}
    par9 = np.array([pos8.get(int(h3.cell_to_parent(int(c), H3RES)), -1) for c in U9["h3"]])
    cfold8 = np.array([fold_of.get(c, -1) for c in county])                 # fold of every hexagon's county (also the unobserved ones)
    cfold9 = np.where(par9 >= 0, cfold8[np.maximum(par9, 0)], -1)
    print(f"teacher: {int(pop9.sum()):,} regional slopes with labels ({int(y9[pop9].sum())} failed), "
          f"{int((slope9 & (cfold9 >= 0)).sum()):,} slopes to score", flush=True)
    T_PARAMS = dict(PARAMS, min_child_samples=15)
    S_PARAMS = dict(objective="regression", n_estimators=300, learning_rate=0.03, num_leaves=15, min_child_samples=20,
                    subsample=0.8, subsample_freq=1, colsample_bytree=0.7, reg_lambda=5.0, verbose=-1, n_jobs=4)
    SEEDS = (0, 1, 2)
    _tcache = {}

    def teacher(excl):
        """Regional 20 m classifier trained without the counties of the folds in excl."""
        key = tuple(sorted(excl))
        if key not in _tcache:
            tr = pop9 & (cfold9 >= 0) & ~np.isin(cfold9, key)
            pos = y9[tr].sum()
            _tcache[key] = [lgb.LGBMClassifier(**T_PARAMS, random_state=sd, scale_pos_weight=min(200.0, (tr.sum() - pos) / max(pos, 1))).fit(X9[tr], y9[tr])
                            for sd in SEEDS]
        return _tcache[key]

    def targets(k):
        """Per hexagon: the highest teacher rank among its slopes. Each slope is ranked by a teacher that saw neither its own
        fold nor fold k (k = -1: nothing extra held out). Hexagons of fold k get no target."""
        t9 = np.full(len(y9), np.nan)
        for j in range(K):
            if j == k:
                continue
            te = slope9 & (cfold9 == j)
            t9[te] = rank01(np.mean([mm.predict(X9[te], raw_score=True) for mm in teacher({j, k} - {-1})], 0))
        ok = np.isfinite(t9)
        out = np.full(len(y), -np.inf); np.maximum.at(out, par9[ok], t9[ok])
        out[~np.isfinite(out) | ~m] = np.nan
        return out

    def student(tgt):
        tr = np.isfinite(tgt)
        return [lgb.LGBMRegressor(**S_PARAMS, random_state=sd).fit(X[tr][:, ci], tgt[tr]) for sd in SEEDS], int(tr.sum())

    s_stu = np.full(len(y), np.nan); c_stu = np.zeros_like(contrib)
    for k in range(K):                                                      # held-out student scores for the hexagons of fold k
        ms, n_tr = student(targets(k))
        te = cfold8 == k
        s_stu[te] = np.mean([mm.predict(X[te][:, ci]) for mm in ms], 0)
        c_stu[te] = np.mean([mm.predict(X[te][:, ci], pred_contrib=True) for mm in ms], 0)
        print(f"  student fold {k}: trained on {n_tr:,} hexagons, scored {int(te.sum()):,}", flush=True)
    ms, n_stu = student(targets(-1))                                        # everywhere else: the student trained on the whole region
    rest = np.where(cfold8 < 0)[0]
    for a in range(0, rest.size, 50000):
        idx = rest[a:a + 50000]
        s_stu[idx] = np.mean([mm.predict(X[idx][:, ci]) for mm in ms], 0)
        c_stu[idx] = np.mean([mm.predict(X[idx][:, ci], pred_contrib=True) for mm in ms], 0)
    Res["model_student"] = summarise("student of the 20 m model", s_stu)

    def blend(a, b):                                                        # mean of the two ranks, inside each held-out fold and across the rest
        out = np.zeros(len(y))
        for sel in [fold == k for k in range(K)] + [fold < 0]:
            out[sel] = (rank01(a[sel]) + rank01(b[sel])) / 2
        return out

    s_joint = blend(s_base, s_stu)
    Res["model_joint"] = summarise("joint (classifier + student)", s_joint)
    # Rule fixed before looking: ship the joint model unless it ranks the known failures worse than the classifier alone.
    b, j = Res["model_base"], Res["model_joint"]
    joint["shipped"] = bool(j["capture_top10"] >= b["capture_top10"] and j["roc_auc"] >= b["roc_auc"])
    joint.update({"teacher_slopes": int(pop9.sum()), "teacher_failed": int(y9[pop9].sum()), "student_hexagons": n_stu, "leak_free": True,
                  "rule": "ship if held-out top-10% capture and AUC are both at least the classifier's",
                  "adds_top10": j["capture_top10"] - b["capture_top10"], "adds_auc": j["roc_auc"] - b["roc_auc"]})
    if joint["shipped"]:
        # one nationwide ranking: mean of the two ranks over all slope units; reasons = both models' contributions on one scale
        s_ship = np.zeros(len(y)); s_ship[m] = (rank01(s_base[m]) + rank01(s_stu[m])) / 2
        contrib = ((contrib + c_stu * (s_base[m].std() / (s_stu[m].std() + 1e-9))) / 2).astype("float32")
    print(f"shipped: {'joint model' if joint['shipped'] else 'classifier alone (the joint model did not rank the known failures better)'}", flush=True)
else:
    print("regional work files (data/work/) not found: shipping the label classifier alone", flush=True)
Res["model_national"] = Res["model_joint"] if joint["shipped"] else Res["model_base"]

reg = json.loads((REGION_SITE / "meta.json").read_text())["suscept"]
regship = reg["results"]["model_full"] if reg["shipped_uses_nisar"] else reg["results"]["model_without_nisar"]
# keys the map's evidence panel reads: model_without_nisar = what ships here, model_full = the regional model with NISAR
Res["model_without_nisar"] = Res["model_national"]
Res["model_full"] = reg["results"]["model_full"]
Res["model_regional_20m"] = regship

pct = np.full(len(y), np.nan, "float32")
pct[m] = (np.argsort(np.argsort(s_ship[m])) + 1) / m.sum()
imp = np.abs(contrib[m][:, :-1]).mean(0)
order = np.argsort(-imp)
print("top features by mean |SHAP|:", [(SHIP[i], round(float(imp[i]), 3)) for i in order[:10]], flush=True)
stats = {"n_units": int(pop.sum()), "n_failed": int(y[pop].sum()), "labels_human_checked": False,
         "training_region": "North Gyeongsang 2025 burn area (July 2026 storm)",
         "folds": {str(k): [cname[c] for c in cs if fold_of[c] == k] for k in range(K)},
         "failed_per_fold": [int(y[pop & (fold == k)].sum()) for k in range(K)],
         "results": Res, "features": SHIP, "joint": joint, "shipped_uses_nisar": False, "shipped_uses_rain": False,
         "importance": {SHIP[i]: float(imp[i]) for i in order},
         "nisar_adds_top10": reg["nisar_adds_top10"],
         "rain_adds_top10": Res["model_with_rain"]["capture_top10"] - Res["model_national"]["capture_top10"],
         "regional_capture_top10": regship["capture_top10"], "n_slope_units": int(m.sum())}
np.savez_compressed(WORK / "suscept.npz", score=s_ship.astype("float32"), pct=pct, contrib=contrib, X=X[:, ci], fold=fold)
write_json(WORK / "suscept_stats.json", stats)
