"""Stage K4b: ML model 3, the debris-reach emulator. Learns the GPU debris-flow simulation so every slope gets its own reach.

The physics (pipeline/p11_runout.py: 2-D shallow-water equations with Voellmy friction, PyTorch on the GPU) was run for
the flagged slopes of the North Gyeongsang build. Each run gives a reach: how far the debris travels before it stops.
This stage trains gradient-boosted trees to predict that simulated reach from terrain alone, tests them on counties
they never saw, and predicts a reach for every slope unit in the country. k05 then looks that far downhill for
buildings and roads, instead of the same 360 m everywhere.

  target    log of the simulated reach (median over the simulated 20 m slopes inside a national unit), cautious friction
  inputs    terrain of the national unit (90 m): slope, relief, curvature, position on the hill, wetness index, distance to a stream ...
  test      5 folds of whole counties; error is against the simulator, not against real debris flows
Units that contain simulated slopes keep the simulated value; everywhere else the reach is the model's prediction.
Needs the regional work files (data/work/units.npz, runout.npz). Without them it writes nothing and k05 keeps 360 m.
Output: data/korea/work/reach.npz, reach_stats.json
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import h3.api.numpy_int as h3
import lightgbm as lgb
import numpy as np

from common_kr import ROOT, WORK, H3RES, write_json

REG = ROOT / "data" / "work"
if not ((REG / "runout.npz").exists() and (REG / "units.npz").exists()):
    print("no regional simulation (data/work/runout.npz): skipping, k05 keeps the fixed 360 m", flush=True)
    for f in ("reach.npz", "reach_stats.json"):
        if (WORK / f).exists(): (WORK / f).unlink()
    sys.exit(0)

U = np.load(WORK / "units.npz"); U9 = np.load(REG / "units.npz"); Ro = np.load(REG / "runout.npz")
RS = json.load(open(REG / "runout_stats.json"))
N = U["h3"].size
ids = np.where(Ro["sim"])[0]
pos = {int(c): i for i, c in enumerate(U["h3"])}
par = np.array([pos.get(int(h3.cell_to_parent(int(c), H3RES)), -1) for c in U9["h3"][ids]])
ids, par = ids[par >= 0], par[par >= 0]
up = np.unique(par)
print(f"{len(ids):,} simulated slopes in {up.size:,} national units", flush=True)

FEATS = ["slope", "slope90", "steep30", "relief", "curv", "tpi", "twi", "dstream", "dem", "eastness", "northness"]
X = np.stack([U[k] for k in FEATS], 1).astype("float32")
PARAMS = dict(n_estimators=300, learning_rate=0.03, num_leaves=8, min_child_samples=20, subsample=0.8, subsample_freq=1,
              colsample_bytree=0.8, reg_lambda=5.0, verbose=-1, n_jobs=4, random_state=0)
county = U["county"][up]
cs = np.unique(county); rng = np.random.default_rng(0); rng.shuffle(cs)
fold = np.array([{c: i % 5 for i, c in enumerate(cs)}[c] for c in county])


def learn(key):
    """Train on the simulated reach `key`; return predictions for every unit and the held-out test numbers."""
    med = np.array([np.median(Ro[key][ids][par == p]) for p in up])
    y = np.log(med)
    oof = np.zeros(len(y)); base = np.zeros(len(y))
    for k in range(5):
        tr = fold != k
        oof[~tr] = lgb.LGBMRegressor(**PARAMS).fit(X[up][tr], y[tr]).predict(X[up][~tr]); base[~tr] = np.median(y[tr])
    m = lgb.LGBMRegressor(**PARAMS).fit(X[up], y)
    pred = np.exp(np.clip(m.predict(X), np.percentile(y, 1), np.percentile(y, 99)))        # never outside what the simulator showed
    out = pred.astype("float32"); out[up] = med
    imp = m.booster_.feature_importance("gain"); imp = imp / imp.sum()
    st = {"n_train": int(len(y)), "r2_heldout": float(1 - ((y - oof) ** 2).sum() / ((y - y.mean()) ** 2).sum()),
          "corr_heldout": float(np.corrcoef(y, oof)[0, 1]), "err_factor_heldout": float(np.exp(np.median(np.abs(y - oof)))),
          "err_factor_constant": float(np.exp(np.median(np.abs(y - base)))), "mae_m_heldout": float(np.median(np.abs(np.exp(y) - np.exp(oof)))),
          "sim_reach_m_p10_p50_p90": [float(v) for v in np.percentile(med, [10, 50, 90])],
          "importance": {FEATS[i]: round(float(imp[i]), 3) for i in np.argsort(-imp)}}
    print(f"  {key}: held-out R2 {st['r2_heldout']:.2f}, typical error x{st['err_factor_heldout']:.2f} (a constant: x{st['err_factor_constant']:.2f}), "
          f"top inputs {list(st['importance'])[:3]}", flush=True)
    return out, st


far, st_far = learn("rf_len"); fit, st_fit = learn("ro_len")
s = U["is_slope"]
src = np.zeros(N, np.uint8); src[s] = 1; src[up] = 2                              # 1 predicted by the model, 2 simulated
stats = {"model": "gradient-boosted trees (LightGBM), log reach", "features": FEATS, "folds": 5, "simulated_slopes": int(len(ids)),
         "simulator": {"mu": RS["calibration"]["mu_far"], "xi": RS["calibration"]["xi_far"], "release_m3": RS["release"]["volume_m3"]},
         "far": st_far, "best_fit": st_fit, "units_predicted": int((src[s] == 1).sum()), "units_simulated": int((src[s] == 2).sum()),
         "reach_m_p10_p50_p90": [float(v) for v in np.percentile(far[s], [10, 50, 90])]}
print({k: stats[k] for k in ("units_predicted", "units_simulated", "reach_m_p10_p50_p90")}, flush=True)
np.savez_compressed(WORK / "reach.npz", reach=far, reach_fit=fit, src=src)
write_json(WORK / "reach_stats.json", stats)
