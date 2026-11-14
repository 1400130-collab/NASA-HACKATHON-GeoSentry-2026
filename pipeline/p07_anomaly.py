"""Stage F: model 1, movement anomaly on the post-storm series, with an injection test.

Four scorers are compared on held-out hexagons at a fixed 1% false-alarm rate:
  zmax      largest |cumulative movement| / noise over the tracks (no geometry, no learning)
  matched   matched filter for movement along the slope line (either direction) using each track's viewing geometry (no learning)
  autoenc   GRU sequence autoencoder, reconstruction error (unsupervised)
  detector  GRU classifier trained on real noise + injected along-slope movement of either sign (simulation-trained)
Injection: D cm of steady downslope movement over the 5 post-storm 12-day steps, projected onto each
track's line of sight. Output: data/work/anomaly.npz, data/work/anomaly_stats.json"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import torch, torch.nn as nn
import h3.api.numpy_int as h3
from common import WORK, TRACKS, load, save, write_json

torch.manual_seed(0); np.random.seed(0)
U = load("units"); Sx = load("series"); Nz = load("nisar")
st = json.load(open(WORK / "series_stats.json"))
N = U["h3"].size
SL = 5
inc = np.zeros((N, SL, 3), "float32"); coh = np.zeros((N, SL, 3), "float32"); mask = np.zeros((N, SL, 3), "float32")
sig = np.zeros((SL, 3), "float32"); sens = np.zeros((N, 3), "float32")
for t, tr in enumerate(TRACKS):
    post = st["tracks"][tr]["post_pairs"][-SL:]
    a = Sx[f"{tr}__inc"][:, post]
    sig[:, t] = np.array(st["tracks"][tr]["noise_cm_per_pair_slopes"])[post]
    ok = np.isfinite(a) & Sx[f"{tr}__measurable"][:, None]
    inc[:, :, t] = np.where(ok, a / sig[:, t], 0); mask[:, :, t] = ok
    coh[:, :, t] = np.nan_to_num(Nz[f"{tr}__coh20"][:, post])
    sens[:, t] = np.nan_to_num(Nz[f"{tr}__sens"])
use = U["is_slope"] & ((mask.sum(1) >= 4).any(1))
idx = np.where(use)[0]
parent = np.array([h3.cell_to_parent(c, 6) for c in U["h3"][idx]])
grp = (np.unique(parent, return_inverse=True)[1] * 2654435761 % 3).astype(int)       # 3 spatial folds (~36 km2 blocks)
print(f"{idx.size} slope units with a usable post-storm series; folds {np.bincount(grp)}", flush=True)
X = torch.tensor(np.concatenate([inc[idx], coh[idx], mask[idx]], 2)); M = torch.tensor(mask[idx]); Sn = torch.tensor(sens[idx])
SIG = torch.tensor(sig)


def inject(x, m, sn, D):
    """Add D cm (tensor, per row) of downslope movement, spread evenly over the steps, in noise units."""
    add = (D[:, None, None] / SL) * sn[:, None, :] / SIG[None]
    y = x.clone(); y[:, :, :3] = x[:, :, :3] + add * m
    return y


class AE(nn.Module):
    def __init__(s):
        super().__init__(); s.enc = nn.GRU(9, 24, batch_first=True); s.z = nn.Linear(24, 4); s.up = nn.Linear(4, 24)
        s.dec = nn.GRU(6, 24, batch_first=True); s.out = nn.Linear(24, 3)
    def forward(s, x):
        _, h = s.enc(x); z = s.z(h[0])
        o, _ = s.dec(x[:, :, 3:], s.up(z)[None]); return s.out(o)       # decoder sees coherence + mask, not movement


class Det(nn.Module):
    def __init__(s):
        super().__init__(); s.g = nn.GRU(12, 32, batch_first=True); s.o = nn.Sequential(nn.Linear(32 + 3, 32), nn.ReLU(), nn.Linear(32, 1))
    def forward(s, x, sn):
        o, h = s.g(torch.cat([x, sn[:, None, :].expand(-1, x.shape[1], -1)], 2)); return s.o(torch.cat([h[0], sn], 1))[:, 0]


def ae_err(model, x, m):
    with torch.no_grad():
        return (((model(x) - x[:, :, :3]) ** 2 * m).sum((1, 2)) / m.sum((1, 2)).clamp(min=1)).numpy()


def zmax(x, m):
    s = (x[:, :, :3] * m).sum(1); n = m.sum(1).clamp(min=1)
    return (s.abs() / n.sqrt()).max(1).values.numpy()


def matched(x, m, sn):
    s = (x[:, :, :3] * m).sum(1); n = m.sum(1)
    w = sn / SIG.mean(0)[None]                                           # expected signal per track, noise units
    return ((s * w).sum(1) / ((w ** 2 * n).sum(1).clamp(min=1e-6)).sqrt()).abs().numpy()   # two-sided: the phase sign is not confirmed


DS = [1, 2, 3, 5, 8]
FAR = 0.01
scores = {k: np.full(idx.size, np.nan, "float32") for k in ["zmax", "matched", "autoenc", "detector"]}
hits = {k: {d: [] for d in DS} for k in scores}; well = []
for f in range(3):
    tr_ = torch.tensor(grp != f); te_ = torch.tensor(grp == f)
    xt, mt, st_ = X[tr_], M[tr_], Sn[tr_]
    ae, det = AE(), Det()
    oa = torch.optim.Adam(ae.parameters(), 2e-3); od = torch.optim.Adam(det.parameters(), 2e-3)
    for ep in range(30):
        perm = torch.randperm(xt.shape[0])
        for i in range(0, perm.numel(), 512):
            b = perm[i:i + 512]; x, m, sn = xt[b], mt[b], st_[b]
            loss = (((ae(x) - x[:, :, :3]) ** 2) * m).sum() / m.sum(); oa.zero_grad(); loss.backward(); oa.step()
            D = (torch.rand(b.numel()) * 7.5 + 0.5) * (torch.randint(0, 2, (b.numel(),)) * 2 - 1)   # either direction along the slope
            xx = torch.cat([x, inject(x, m, sn, D)]); yy = torch.cat([torch.zeros(b.numel()), torch.ones(b.numel())])
            l2 = nn.functional.binary_cross_entropy_with_logits(det(xx, torch.cat([sn, sn])), yy); od.zero_grad(); l2.backward(); od.step()
    ae.eval(); det.eval()
    x, m, sn = X[te_], M[te_], Sn[te_]
    te_np = te_.numpy()
    with torch.no_grad():
        clean = {"zmax": zmax(x, m), "matched": matched(x, m, sn), "autoenc": ae_err(ae, x, m), "detector": det(x, sn).numpy()}
    for k in scores:
        scores[k][te_np] = clean[k]
    thr = {k: np.quantile(v, 1 - FAR) for k, v in clean.items()}
    well.append((sn.abs() * (m.sum(1) >= 4)).max(1).values.numpy() >= 0.3)
    for d in DS:
        xi = inject(x, m, sn, torch.full((x.shape[0],), float(d)))
        with torch.no_grad():
            inj = {"zmax": zmax(xi, m), "matched": matched(xi, m, sn), "autoenc": ae_err(ae, xi, m), "detector": det(xi, sn).numpy()}
        for k in scores:
            hits[k][d].append(inj[k] > thr[k])
    print(f"fold {f}: AE loss {loss.item():.3f}, detector loss {l2.item():.3f}", flush=True)

well = np.concatenate(well)
res = {}
for k in scores:
    res[k] = {"all": {d: float(np.concatenate(hits[k][d]).mean()) for d in DS},
              "well_oriented": {d: float(np.concatenate(hits[k][d])[well].mean()) for d in DS}}
    print(f"{k:9s} detection at {FAR:.0%} false alarms | all slopes:", {d: round(v, 2) for d, v in res[k]["all"].items()},
          "| well-oriented:", {d: round(v, 2) for d, v in res[k]["well_oriented"].items()})


def d_at(rate, curve):
    ds, v = np.array(DS, float), np.array([curve[d] for d in DS])
    return float(np.interp(rate, v, ds)) if v.max() >= rate else None


best = max(scores, key=lambda k: res[k]["well_oriented"][3])
stats = {"units": int(idx.size), "false_alarm_rate": FAR, "injection_cm_downslope": DS, "results": res, "best": best,
         "well_oriented_share": float(well.mean()),
         "detect50_cm_well_oriented": d_at(0.5, res[best]["well_oriented"]), "detect80_cm_well_oriented": d_at(0.8, res[best]["well_oriented"]),
         "detect50_cm_all": d_at(0.5, res[best]["all"]),
         "ml_beats_baseline": bool(max(res["autoenc"]["well_oriented"][3], res["detector"]["well_oriented"][3]) > max(res["zmax"]["well_oriented"][3], res["matched"]["well_oriented"][3]) + 0.01),
         "los_noise_cum_cm": {tr: st["tracks"][tr]["slopes_cum_post_mad_cm"] for tr in TRACKS}}
print("best:", best, "| 50% detection at", stats["detect50_cm_well_oriented"], "cm, 80% at", stats["detect80_cm_well_oriented"], "cm (well-oriented slopes,",
      round(stats["well_oriented_share"], 2), "of slopes) | ML beats baseline:", stats["ml_beats_baseline"])
full = {k: np.full(N, np.nan, "float32") for k in scores}
for k in scores:
    full[k][idx] = scores[k]
    r = np.full(N, np.nan, "float32"); r[idx] = (np.argsort(np.argsort(scores[k])) + 1) / idx.size; full[k + "_pct"] = r
save("anomaly", **full)
write_json(WORK / "anomaly_stats.json", stats)
