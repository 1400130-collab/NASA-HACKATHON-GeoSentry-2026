"""Stage E: model 2, susceptibility (LightGBM), hindsight test with whole counties held out.

Inputs are pre-storm only (nothing on or after 18 July 2026). Labels are the scar candidates from p05
(automatic unless a human review file exists).
Output: data/work/suscept.npz, data/work/suscept_stats.json"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import lightgbm as lgb
from sklearn.metrics import average_precision_score, roc_auc_score
from common import WORK, TRACKS, load, save, write_json

U = load("units"); L = load("labels"); Sx = load("series"); Vl = load("velocity")
names = json.load(open(WORK / "counties.json"))
TERRAIN = ["slope", "steep30", "relief", "curv", "tpi", "twi", "dstream", "dem", "northness", "eastness"]
BURN = ["dnbr", "burn_frac", "burn_high", "loss2025", "loss_pre", "ndvi_pre", "ndvi_postfire", "treecover",
        "lc_tree", "lc_shrub", "lc_grass", "lc_crop", "lc_bare"]
RAIN = ["rain_ante30", "rain_max1_pre", "rain_max3_pre"]
feats = {k: U[k].astype("float32") for k in TERRAIN + BURN + RAIN}
NIS = []
for tr in TRACKS:
    t = tr[:3]
    feats[f"coh_pre_{t}"] = Sx[f"{tr}__pre_coh"]; feats[f"move_pre_{t}"] = np.abs(Sx[f"{tr}__pre_inc"])
    NIS += [f"coh_pre_{t}", f"move_pre_{t}"]
# pre-storm downslope rate from the time-series inversion (p04b), in units of its own error bar
feats["slide_pre_z"] = Vl["z_pre"]; feats["slide_pre_abs"] = np.abs(Vl["z_pre"])
NIS += ["slide_pre_z", "slide_pre_abs"]
ALL = TERRAIN + BURN + RAIN + NIS
X = np.stack([feats[k] for k in ALL], 1)
y = L["label"].astype(int)
pop = U["is_slope"] & L["observed"]
county = U["county"]
print(f"population {pop.sum()} slope units seen by the optical pair, {y[pop].sum()} failed", flush=True)

# folds: whole counties, balanced by number of failures
cs = sorted(set(county[pop]), key=lambda c: -int(y[pop & (county == c)].sum()))
K = 5
fold_of, load_ = {}, [0] * K
for c in cs:
    k = int(np.argmin(load_)); fold_of[c] = k
    load_[k] += int(y[pop & (county == c)].sum()) + 1e-3 * int((pop & (county == c)).sum())
fold = np.array([fold_of.get(c, -1) for c in county])
print("folds:", {k: [names[c - 1] for c in cs if fold_of[c] == k] for k in range(K)})

PARAMS = dict(objective="binary", n_estimators=150, learning_rate=0.03, num_leaves=6, min_child_samples=15,
              subsample=0.8, subsample_freq=1, colsample_bytree=0.7, reg_lambda=5.0, verbose=-1, n_jobs=4)


def oof(cols, seeds=(0, 1, 2, 3, 4), want_models=False):
    ci = [ALL.index(c) for c in cols]
    score = np.zeros(len(y)); contrib = np.zeros((len(y), len(ci) + 1)); models = []
    for k in range(K):
        tr = pop & (fold != k); te = fold == k
        ms = []
        for s in seeds:
            pos = y[tr].sum()
            m = lgb.LGBMClassifier(**PARAMS, random_state=s, scale_pos_weight=min(200.0, (tr.sum() - pos) / max(pos, 1)))
            m.fit(X[tr][:, ci], y[tr]); ms.append(m)
        raw = np.mean([m.predict(X[te][:, ci], raw_score=True) for m in ms], 0)
        score[te] = raw
        if want_models:
            contrib[te] = np.mean([m.predict(X[te][:, ci], pred_contrib=True) for m in ms], 0)
        models.append(ms)
    rest = fold < 0                                           # outside any county: average all fold models
    if rest.any():
        score[rest] = np.mean([m.predict(X[rest][:, ci], raw_score=True) for ms in models for m in ms], 0)
        if want_models:
            contrib[rest] = np.mean([m.predict(X[rest][:, ci], pred_contrib=True) for ms in models for m in ms], 0)
    return (score, contrib) if want_models else score


def within_fold_rank(score):
    """Percentile of each unit inside its own held-out fold (1 = most suspicious)."""
    r = np.full(len(score), np.nan)
    for k in range(K):
        m = pop & (fold == k)
        o = np.argsort(np.argsort(score[m]))
        r[m] = (o + 1) / m.sum()
    return r


def capture(rank, top):
    return float((rank[pop & (y == 1)] >= 1 - top).mean())


rng = np.random.default_rng(0)
def summarise(name, score):
    r = within_fold_rank(score)
    pos = np.where(pop & (y == 1))[0]
    boot = [float((r[rng.choice(pos, pos.size)] >= 0.9).mean()) for _ in range(2000)]
    curve = [capture(r, t) for t in np.linspace(0, 1, 101)]
    res = {"capture_top5": capture(r, .05), "capture_top10": capture(r, .10), "capture_top20": capture(r, .20),
           "capture_top10_ci90": [float(np.percentile(boot, 5)), float(np.percentile(boot, 95))],
           "avg_precision": float(average_precision_score(y[pop], r[pop])), "roc_auc": float(roc_auc_score(y[pop], r[pop])),
           "curve": [round(c, 4) for c in curve]}
    print(f"{name:28s} top5 {res['capture_top5']:.2f}  top10 {res['capture_top10']:.2f} (90% CI {res['capture_top10_ci90'][0]:.2f}-{res['capture_top10_ci90'][1]:.2f})"
          f"  top20 {res['capture_top20']:.2f}  AUC {res['roc_auc']:.3f}", flush=True)
    return res, r


z = lambda a: (a - np.nanmean(a[pop])) / (np.nanstd(a[pop]) + 1e-9)
R = {}
R["steepness_only"], _ = summarise("steepness only", feats["slope"])
R["steep_and_burned"], _ = summarise("steepness + burn rule", z(feats["slope"]) + z(np.nan_to_num(feats["burn_frac"])))
s_no, _c = oof(TERRAIN + BURN + RAIN, want_models=True)
R["model_without_nisar"], rank_no = summarise("model without NISAR", s_no)
s_full, contrib = oof(ALL, want_models=True)
R["model_full"], rank_cv = summarise("model with NISAR", s_full)
s_nis = oof(NIS)
R["model_nisar_only"], _ = summarise("model, NISAR inputs only", s_nis)

# Ship the simpler model unless the NISAR inputs measurably help the held-out capture rate. "Measurably" = the gain in
# failed slopes caught in the top 10% stays above zero in at least 90% of paired resamples of the failed slopes
# (with about 30 failures, one or two slopes swing the plain comparison either way).
pos = np.where(pop & (y == 1))[0]
hit_full, hit_no = rank_cv[pos] >= 0.9, rank_no[pos] >= 0.9
bs = rng.integers(0, pos.size, (4000, pos.size))
diff = hit_full[bs].mean(1) - hit_no[bs].mean(1)
p_gain = float((diff > 0).mean())
use_nisar = p_gain >= 0.9
print(f"NISAR inputs: {int(hit_full.sum())} vs {int(hit_no.sum())} of {pos.size} failed slopes in the top 10%; gain > 0 in {p_gain:.0%} of resamples "
      f"(90% range {np.percentile(diff, 5):+.2f} to {np.percentile(diff, 95):+.2f})")
imp_full = np.abs(contrib[U["is_slope"]][:, :-1]).mean(0)
print("NISAR inputs by mean |SHAP| in the full model:", {c: round(float(imp_full[ALL.index(c)]), 3) for c in NIS})
if not use_nisar:
    s_full, contrib, ALLX = s_no, _c, TERRAIN + BURN + RAIN
else:
    ALLX = ALL
print("shipped model:", "with NISAR inputs" if use_nisar else "without NISAR inputs (their gain is not clear of noise)")
allr = np.full(len(y), np.nan, "float32")
m = U["is_slope"]
allr[m] = (np.argsort(np.argsort(s_full[m])) + 1) / m.sum()
imp = np.abs(contrib[m][:, :-1]).mean(0)
order = np.argsort(-imp)
print("top features by mean |SHAP|:", [(ALLX[i], round(float(imp[i]), 3)) for i in order[:10]])
stats = {"n_units": int(pop.sum()), "n_failed": int(y[pop].sum()), "labels_human_checked": bool(json.load(open(WORK / "label_stats.json"))["human_reviewed"]),
         "folds": {str(k): [names[c - 1] for c in cs if fold_of[c] == k] for k in range(K)},
         "failed_per_fold": [int(y[pop & (fold == k)].sum()) for k in range(K)],
         "results": R, "features": ALLX, "shipped_uses_nisar": bool(use_nisar), "importance": {ALLX[i]: float(imp[i]) for i in order},
         "nisar_adds_top10": R["model_full"]["capture_top10"] - R["model_without_nisar"]["capture_top10"],
         "nisar_adds_top10_ci90": [float(np.percentile(diff, 5)), float(np.percentile(diff, 95))], "nisar_gain_confidence": p_gain,
         "nisar_caught": [int(hit_full.sum()), int(hit_no.sum())], "nisar_features": NIS,
         "nisar_importance_share": float(sum(imp_full[ALL.index(c)] for c in NIS) / imp_full.sum())}
save("suscept", score=s_full.astype("float32"), pct=allr, contrib=contrib.astype("float32"), X=X[:, [ALL.index(c) for c in ALLX]], fold=fold)
write_json(WORK / "suscept_stats.json", stats)
