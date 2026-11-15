"""Stage F3: a slope-stability model whose soil numbers are learned from the July 2026 failures (physics + ML).

Physics, per 20 m pixel (infinite-slope model with a wet layer on top of bedrock):
    FS = c / (gamma z sin b cos b) + (1 - m gamma_w / gamma) tan(phi) / tan(b)        a pixel is unstable when FS < 1
    m  = clamp( W / S * (a / a0)^alpha , 0, 1 )            share of the soil column that is saturated
    W(t) = W(t-1) exp(-k) + rain(t)                        wetness index: rain soaks in, drains with rate k per day
b slope, a upslope area per metre of contour, c cohesion (soil + roots), phi friction angle, S the rain-equivalent (mm)
that saturates the column, z = 1.5 m and gamma = 18 kN/m3 fixed (only c / (gamma z) is identifiable).
Cohesion is mixed between an unburned and a burned value by the 2025 burn severity of the pixel.

Learning: P(pixel unstable) = sigmoid((1 - FS) / 0.05);  P(a scar is seen in a hexagon) = 1 - exp(-A * sum of the pixel
probabilities).  Seven numbers (phi, c_unburned, c_burned, k, S, alpha, A) are fitted by gradient descent on the
hexagon labels, with one physical side condition: a slope that is standing must be stable when dry (FS >= 1.1).
Only pixels steeper than 15 degrees take part, because the scar labels cannot exist on flatter ground.
The rain is the real daily rain up to and including the storm, so this is not a forecast test: it asks
"given the rain, which slopes fail", which is what a rain threshold is.

Output: data/work/stability.npz (r48: mm of rain in 48 h, on top of the wetness of 15 July 2026, at which two pixels
of the slope, the size of the smallest scar, reach FS < 1), data/work/stability_stats.json
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import torch
from sklearn.metrics import roc_auc_score
from common import WORK, load, save, write_json, H20, W20
from runout_solver import device

DEV = device()
torch.manual_seed(0)
GAMMA, GAMMA_W, Z = 18.0, 9.81, 1.5
A0 = 100.0                 # m, reference upslope area per metre of contour
K_PIX = 2                  # pixels: the smallest scar the labels count is 2 pixels (800 m2)
S_FS = 0.05                # width of the FS < 1 step used for learning
FS_DRY = 1.1               # a standing slope must be at least this stable when dry

T = load("terrain"); U = load("units"); L = load("labels"); Su = load("suscept"); I = load("s2_idx"); R = np.load(WORK / "rain.npz")
N = U["h3"].size
uid20 = np.repeat(np.repeat(U["uid40"], 2, 0), 2, 1).ravel()
keep = U["is_slope"][uid20] & (T["slope"].ravel() > 15)
pu = uid20[keep]
beta = np.radians(np.clip(T["slope"].ravel()[keep], 1.0, 70.0)).astype("float32")
area = (T["acc"].ravel()[keep] * 20.0).astype("float32")
burn = np.clip((np.nan_to_num(I["dnbr"].ravel()[keep]) - 0.1) / 0.56, 0, 1).astype("float32")
print(f"{keep.sum() / 1e6:.1f} M pixels in {int(U['is_slope'].sum())} slope units ({DEV})", flush=True)

# rain: nearest 0.1 degree point, daily, 60 days up to the last storm day
dates = R["dates"]; pts = R["pts"]
near = np.argmin((U["lat"][:, None] - pts[None, :, 0]) ** 2 + (U["lon"][:, None] - pts[None, :, 1]) ** 2, axis=1)
d_end = int(np.where(dates == "2026-07-20")[0][0]); d_storm = int(np.where(dates == "2026-07-16")[0][0])
P = torch.tensor(R["R"][:, d_end - 59: d_end + 1], device=DEV)                 # points x 60 days
n_pre = d_storm - (d_end - 59)                                                 # days before the storm window

t_pu = torch.tensor(pu, device=DEV, dtype=torch.long); t_beta = torch.tensor(beta, device=DEV)
t_la = torch.log(torch.tensor(area, device=DEV) / A0); t_burn = torch.tensor(burn, device=DEV)
t_near = torch.tensor(near, device=DEV, dtype=torch.long)
sinb, cosb, tanb = torch.sin(t_beta), torch.cos(t_beta), torch.tan(t_beta)
y = torch.tensor(L["label"].astype("float32"), device=DEV)
pop = U["is_slope"] & L["observed"]

BOUNDS = {"phi": (25.0, 45.0), "c_unburned": (0.0, 25.0), "c_burned": (0.0, 25.0), "k": (0.01, 1.5), "S": (30.0, 1500.0),
          "alpha": (0.0, 1.0), "logA": (-14.0, 0.0)}
INIT = {"phi": 34.0, "c_unburned": 8.0, "c_burned": 6.0, "k": 0.15, "S": 300.0, "alpha": 0.3, "logA": -5.0}
NAMES = list(BOUNDS)
lo = torch.tensor([BOUNDS[k][0] for k in NAMES], device=DEV); hi = torch.tensor([BOUNDS[k][1] for k in NAMES], device=DEV)


def raw_of(vals):
    v = torch.tensor([vals[k] for k in NAMES], device=DEV)
    f = ((v - lo) / (hi - lo)).clamp(1e-4, 1 - 1e-4)
    return torch.log(f / (1 - f))


def params(raw):
    return dict(zip(NAMES, lo + (hi - lo) * torch.sigmoid(raw)))


def wetness(p, rain48=None):
    """Peak wetness index per rain point. Real storm if rain48 is None, else rain48 mm spread over two days on top of
    the wetness of 15 July 2026."""
    decay = torch.exp(-p["k"])
    W = torch.zeros(P.shape[0], device=DEV)
    for t in range(n_pre):
        W = W * decay + P[:, t]
    if rain48 is not None:
        return W * decay * decay + rain48 / 2 * (1 + decay)
    peak = W
    for t in range(n_pre, P.shape[1]):
        W = W * decay + P[:, t]; peak = torch.maximum(peak, W)
    return peak


def fs_parts(p):
    """FS = dry - m * wet. Returns (dry, wet) per pixel."""
    c = p["c_unburned"] * (1 - t_burn) + p["c_burned"] * t_burn
    fr = torch.tan(torch.deg2rad(p["phi"])) / tanb
    return c / (GAMMA * Z * sinb * cosb) + fr, fr * GAMMA_W / GAMMA


def unstable(p, W_unit, hard=False):
    """Number of unstable pixels per unit (soft count for learning, hard count for reporting), and the dry-stability penalty."""
    dry, wet = fs_parts(p)
    m = (W_unit[t_pu] / p["S"] * torch.exp(p["alpha"] * t_la)).clamp(0, 1)
    fs = dry - m * wet
    pix = (fs < 1).float() if hard else torch.sigmoid((1 - fs) / S_FS)
    return torch.zeros(N, device=DEV).index_add_(0, t_pu, pix), torch.relu(FS_DRY - dry).mean()


def prob(p, E):
    return 1 - torch.exp(-torch.exp(p["logA"]) * E)


def fit(train, init=INIT, steps=300, lr=0.06):
    raw = raw_of(init).clone().requires_grad_(True)
    opt = torch.optim.Adam([raw], lr=lr)
    tr = torch.tensor(train, device=DEV)
    for i in range(steps):
        p = params(raw)
        E, pen = unstable(p, wetness(p)[t_near])
        q = prob(p, E)[tr].clamp(1e-7, 1 - 1e-7)
        loss = -(y[tr] * torch.log(q) + (1 - y[tr]) * torch.log(1 - q)).sum() + 5000 * pen
        opt.zero_grad(); loss.backward(); opt.step()
    p = params(raw.detach())
    return {k: float(v) for k, v in p.items()}, float(loss.detach())


def tens(vals):
    return {k: torch.tensor(v, device=DEV) for k, v in vals.items()}


# ---- held-out test: whole counties, same folds as the ranking model -----------------------------
fold = Su["fold"]; K = int(fold.max()) + 1
yn = L["label"].astype(int)
score = np.zeros(N); fold_params = []
t0 = time.time()
for k in range(K):
    pk, _ = fit(pop & (fold != k))
    fold_params.append(pk)
    with torch.no_grad():
        p = tens(pk); score[fold == k] = prob(p, unstable(p, wetness(p)[t_near])[0]).cpu().numpy()[fold == k]
    print(f"  fold {k}: " + ", ".join(f"{a} {b:.3g}" for a, b in pk.items()), flush=True)


def within_fold_rank(s):
    r = np.full(N, np.nan)
    for k in range(K):
        m = pop & (fold == k); r[m] = (np.argsort(np.argsort(s[m])) + 1) / m.sum()
    return r


rk = within_fold_rank(score); pos = np.where(pop & (yn == 1))[0]
rng = np.random.default_rng(0)
boot = [float((rk[rng.choice(pos, pos.size)] >= 0.9).mean()) for _ in range(2000)]
ref = json.load(open(WORK / "suscept_stats.json"))["results"]
test = {"capture_top5": float((rk[pos] >= 0.95).mean()), "capture_top10": float((rk[pos] >= 0.90).mean()), "capture_top20": float((rk[pos] >= 0.80).mean()),
        "capture_top10_ci90": [float(np.percentile(boot, 5)), float(np.percentile(boot, 95))], "roc_auc": float(roc_auc_score(yn[pop], rk[pop])),
        "n_failed": int(pos.size), "n_units": int(pop.sum()),
        "ranking_model_top10": ref["model_without_nisar"]["capture_top10"], "steepness_only_top10": ref["steepness_only"]["capture_top10"]}
print(f"held out: top 10% holds {test['capture_top10']:.0%} of failed slopes (90% range {test['capture_top10_ci90'][0]:.0%}-{test['capture_top10_ci90'][1]:.0%}), "
      f"AUC {test['roc_auc']:.2f}; ranking model {test['ranking_model_top10']:.0%}, steepness only {test['steepness_only_top10']:.0%}  [{time.time() - t0:.0f} s]", flush=True)

# ---- final fit on everything, from three starting points ----------------------------------------
starts = [INIT, {**INIT, "phi": 28.0, "c_unburned": 14.0, "c_burned": 14.0, "S": 600.0, "k": 0.5},
          {**INIT, "phi": 40.0, "c_unburned": 3.0, "c_burned": 3.0, "S": 150.0, "alpha": 0.6, "k": 0.05}]
fits = [fit(pop, init=s) for s in starts]
for f in fits: print("  start ->", ", ".join(f"{a} {b:.3g}" for a, b in f[0].items()), f"| loss {f[1]:.2f}", flush=True)
best, loss = min(fits, key=lambda f: f[1])
p = tens(best)
at_bound = [k for k in NAMES if min(best[k] - BOUNDS[k][0], BOUNDS[k][1] - best[k]) < 0.02 * (BOUNDS[k][1] - BOUNDS[k][0])]
spread = {k: [float(min(f[k] for f in fold_params)), float(max(f[k] for f in fold_params))] for k in NAMES}

# ---- rain thresholds ----------------------------------------------------------------------------
# Per pixel, FS = 1 at a saturated share m_crit = (dry - 1) / wet, i.e. at a wetness index W_crit = m_crit * S / (a/a0)^alpha.
# A slope's threshold is the wetness at which its K_PIX weakest pixels have all crossed.
with torch.no_grad():
    dry, wet = fs_parts(p)
    mc = (dry - 1) / wet
    wc = torch.where(mc > 1, torch.tensor(float("inf"), device=DEV), mc.clamp(min=0) * p["S"] / torch.exp(p["alpha"] * t_la)).cpu().numpy()
    dry_unstable = float((dry < 1).float().mean()); dry_margin = float((dry < FS_DRY).float().mean())
    W_storm = wetness(p).cpu().numpy()[near]; W0 = wetness(p, torch.tensor(0.0, device=DEV)).cpu().numpy()[near]
    E_soft, _ = unstable(p, wetness(p)[t_near]); P_storm = prob(p, E_soft).cpu().numpy()
order = np.lexsort((wc, pu)); pus = pu[order]; wcs = wc[order]
start = np.searchsorted(pus, np.arange(N)); cnt = np.bincount(pu, minlength=N)
Wcrit = np.full(N, np.inf)
okk = cnt >= K_PIX
Wcrit[okk] = wcs[start[okk] + K_PIX - 1]
decay = np.exp(-best["k"])
r48 = np.maximum(0.0, 2 * (Wcrit - W0 * decay * decay) / (1 + decay)).astype("float32")      # inf: never, by this mechanism
sl = U["is_slope"]
has = sl & np.isfinite(r48)
# what the storm itself brought, as mm over its wettest two days
dd = R["R"][:, d_storm: d_end + 1]; storm48 = np.max(dd[:, 1:] + dd[:, :-1], 1)[near].astype("float32")

# ---- does rain separate the failed slopes at all? ------------------------------------------------
# The labels are scars that appeared between the 12 June and 6 August 2026 photos. If rain amount drove them, failed
# slopes should have had more rain in that window than the rest, or more than they had stood through since the fire.
ix = lambda s_: int(np.where(dates == s_)[0][0])
r2 = np.concatenate([R["R"][:, :1], R["R"][:, 1:] + R["R"][:, :-1]], 1)             # 48 h totals, points x days
fa, fb, fe = ix("2025-04-08"), ix("2026-06-12"), ix("2026-08-06")
win = r2[:, fb: fe + 1].max(1); prev = r2[:, fa: fb].max(1)
rec = (win > prev)[near]
rain_test = {"auc_rain48_in_window": float(roc_auc_score(yn[pop], win[near][pop])), "auc_ratio_to_record": float(roc_auc_score(yn[pop], (win / prev)[near][pop])),
             "window_rain48_median_mm": float(np.median(win)), "earlier_record_median_mm": float(np.median(prev)),
             "share_points_window_is_record": float((win > prev).mean()),
             "failed_per_10k_where_record": float(yn[pop & rec].mean() * 1e4), "failed_per_10k_elsewhere": float(yn[pop & ~rec].mean() * 1e4),
             "failed_where_record": int(yn[pop & rec].sum()), "failed_elsewhere": int(yn[pop & ~rec].sum())}
# A rain threshold per slope is only worth showing if rain separates the failures and the model beats chance on held-out counties.
usable = bool(rain_test["auc_rain48_in_window"] > 0.6 and test["capture_top10_ci90"][0] > 0.10)
print("rain test:", rain_test, "\nthresholds usable:", usable, flush=True)
# what every slope has already stood through since the fire: the largest 48 h rain, and when
all48 = r2[:, fa:]; rec48 = all48.max(1)[near].astype("float32"); rec_day = (fa + all48.argmax(1))[near]
flag_storm = sl & (W_storm >= Wcrit)
fl = pop & (yn == 1)
RAINS = [50, 100, 150, 200, 250, 300, 400, 500]
curve = [{"mm": r, "over": int((has & (r48 <= r)).sum())} for r in RAINS]
q = lambda a: [float(v) for v in np.percentile(a, [10, 50, 90])] if len(a) else None
stats = {"params": best, "loss": loss, "param_range_across_folds": spread, "at_bound": at_bound, "starts": [f[0] for f in fits],
         "fixed": {"soil_depth_m": Z, "unit_weight_kn_m3": GAMMA, "a0_m": A0, "pixels_for_threshold": K_PIX, "fs_step": S_FS, "fs_dry_min": FS_DRY,
                   "min_slope_deg": 15},
         "test": test, "rain_test": rain_test, "thresholds_usable": usable, "device": str(DEV), "pixels": int(keep.sum()),
         "dry": {"share_pixels_unstable_dry": dry_unstable, "share_pixels_below_margin": dry_margin},
         "thresholds": {"with_threshold": int(has.sum()), "never": int((sl & ~has).sum()), "already_unstable_at_ref": int((has & (r48 == 0)).sum()),
                        "mm_p10_p50_p90": q(r48[has]), "burned_mm_p10_p50_p90": q(r48[has & (U["burn_frac"] > 0.5)]),
                        "unburned_mm_p10_p50_p90": q(r48[has & (U["burn_frac"] < 0.05)]),
                        "burned_with_threshold": int((has & (U["burn_frac"] > 0.5)).sum()), "burned_units": int((sl & (U["burn_frac"] > 0.5)).sum())},
         "storm": {"rain48_p10_p50_p90": q(storm48[sl]), "over_threshold": int(flag_storm.sum()), "over_threshold_observed": int((flag_storm & pop).sum()),
                   "failed_over_threshold": int((flag_storm & fl).sum()), "failed": int(fl.sum()),
                   "expected_scars": float(P_storm[pop].sum()), "share_of_observed_flagged": float((flag_storm & pop).sum() / pop.sum()),
                   "failed_rain48": [float(v) for v in np.sort(storm48[fl])]},
         "curve": curve}
print({k: stats[k] for k in ("params", "at_bound", "dry", "thresholds", "storm", "curve")})
save("stability", rec48=rec48, rec_date=dates[rec_day], r48=r48, flag_storm=flag_storm, P_storm=P_storm.astype("float32"), storm48=storm48, W0=W0.astype("float32"), score_cv=score.astype("float32"))
write_json(WORK / "stability_stats.json", stats)
