"""Stage K3: bring the North Gyeongsang results (20 m, H3 res 9, NISAR) into the nationwide units (H3 res 8).

NISAR was only processed for the North Gyeongsang burn area (3 tracks, June-October 2026), and the July 2026
failure labels only exist there. Both come from the regional build already in site/data/, so this stage needs
no NISAR download and no Earthdata login. Each res-8 unit takes the res-9 slope units inside it:
  label      1 if any child slope failed in July 2026 (automatic scar candidates, as in the regional map)
  observed   at least half of the child slopes were seen by the clear optical pair
  moving     any child flagged as moving (the regional p08 rule)
  cum / sig  mean over the measurable children; sig is the children's mean noise (kept conservative)
  series     mean cumulative movement over the measurable children, per date
Output: data/korea/work/region.npz, data/korea/work/radar_<track>.npy, data/korea/work/candidates.json"""
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import h3.api.numpy_int as h3
import numpy as np
from pyproj import Transformer
from rasterio.transform import from_origin
from rasterio.warp import reproject, Resampling

from common_kr import WORK, REGION_SITE, CRS, X0, Y1, H90, W90, H3RES, km, write_json

M = json.loads((REGION_SITE / "meta.json").read_text())
n9, cols, nd = M["units"]["n"], M["units"]["cols"], M["units"]["nd"]
raw = np.frombuffer(gzip.decompress((REGION_SITE / "units.bin.gz").read_bytes()), "<f4").reshape(len(cols), n9)
C9 = {c: raw[i] for i, c in enumerate(cols)}
ser9 = np.frombuffer(gzip.decompress((REGION_SITE / "series.bin.gz").read_bytes()), "<i2").reshape(n9, 3, nd)
coh9 = np.frombuffer(gzip.decompress((REGION_SITE / "coh.bin.gz").read_bytes()), "u1").reshape(n9, 3, nd - 1)
TR = ["125", "032", "024"]

U = np.load(WORK / "units.npz")
N = U["h3"].size
pos = {int(c): i for i, c in enumerate(U["h3"])}
c9 = np.array([h3.latlng_to_cell(float(a), float(b), 9) for a, b in zip(C9["lat"], C9["lon"])], np.uint64)
par = np.array([pos.get(int(h3.cell_to_parent(int(c), H3RES)), -1) for c in c9])
ok = par >= 0
print(f"{n9:,} regional slope units -> {np.unique(par[ok]).size:,} national units ({(~ok).sum()} outside)", flush=True)
p = par[ok]
nchild = np.bincount(p, minlength=N)
inreg = nchild > 0


def agg(v, how="mean", mask=None):
    v = np.asarray(v, "float64")[ok]
    m = np.isfinite(v) if mask is None else (np.isfinite(v) & mask[ok])
    if how == "max":
        out = np.full(N, -np.inf); np.maximum.at(out, p[m], v[m]); out[~np.isfinite(out)] = np.nan
        return out.astype("float32")
    s = np.bincount(p[m], v[m], N); n = np.bincount(p[m], minlength=N)
    out = np.where(n > 0, s / np.maximum(n, 1), np.nan)
    return out.astype("float32") if how == "mean" else n


R = {"inreg": inreg, "nchild": nchild}
seen = C9["seen"] > 0.5
R["seen_frac"] = agg(seen.astype("float32"))
R["observed"] = inreg & (np.nan_to_num(R["seen_frac"]) >= 0.5)
R["label"] = (agg((C9["label"] > 0.5) & seen, "max") > 0.5)
R["moving"] = agg(C9["moving"], "max") > 0.5
R["det"] = agg(C9["det"], "max"); R["zmax"] = agg(C9["zmax"], "max")
R["regional_pct_max"] = agg(C9["pct"], "max")
for t in TR:
    meas = C9[f"meas_{t}"] > 0.5
    R[f"meas_{t}"] = agg(meas.astype("float32"), "max") > 0.5
    for k in ("cum", "sig", "sens", "cohpre", "cohstorm"):
        R[f"{k}_{t}"] = agg(C9[f"{k}_{t}"], mask=meas)
R["n_meas"] = sum(R[f"meas_{t}"].astype(int) for t in TR)
# movement history: mean over the measurable children, per date
ser = np.full((N, 3, nd), np.nan, "float32"); coh = np.full((N, 3, nd - 1), np.nan, "float32")
for k, t in enumerate(TR):
    meas = (C9[f"meas_{t}"] > 0.5)[ok]
    for j in range(nd):
        v = ser9[ok, k, j].astype("float64"); m = meas & (v != -32768)
        s = np.bincount(p[m], v[m] / 100, N); n = np.bincount(p[m], minlength=N)
        ser[:, k, j] = np.where(n > 0, s / np.maximum(n, 1), np.nan)
    for j in range(nd - 1):
        v = coh9[ok, k, j].astype("float64"); m = meas
        s = np.bincount(p[m], v[m] / 255, N); n = np.bincount(p[m], minlength=N)
        coh[:, k, j] = np.where(n > 0, s / np.maximum(n, 1), np.nan)
R["series"] = ser; R["coh"] = coh
print(f"labels: {int(R['label'].sum())} failed units, {int(R['observed'].sum()):,} observed; moving: {int(R['moving'].sum())}; "
      f"measured on >=1 track: {int((R['n_meas'] > 0).sum()):,}", flush=True)
np.savez_compressed(WORK / "region.npz", **R)

# ---- interferograms of the storm pairs: regional 80 m UTM grid -> national 90 m grid -----------------
g = M["grid"]
H80, W80 = g["h80"]
src_tr = from_origin(g["x0"], g["y1"], 80, 80)
for t in TR:
    a = np.frombuffer(gzip.decompress((REGION_SITE / f"radar_{t}.bin.gz").read_bytes()), "u1").reshape(H80, W80, 4)
    out = np.zeros((4, H90, W90), "u1")
    for b in range(4):
        reproject(np.ascontiguousarray(a[:, :, b]), out[b], src_transform=src_tr, src_crs=f"EPSG:{g['epsg']}",
                  dst_transform=from_origin(X0, Y1, 90, 90), dst_crs=CRS, resampling=Resampling.nearest, src_nodata=None, dst_nodata=0)
    np.save(WORK / f"radar_{t}.npy", out)
    print(f"  radar {t}: {(out[3] > 0).sum():,} px on the national grid", flush=True)

# ---- July 2026 scar candidates ----------------------------------------------------------------------
cand = json.loads((REGION_SITE / "candidates.json").read_text())
tf = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
for c in cand:
    x, y = tf.transform(c["lon"], c["lat"])
    kx, kz = km(x, y)
    c["x"], c["z"] = round(float(kx), 3), round(float(kz), 3)
    c["u"] = pos.get(int(h3.latlng_to_cell(c["lat"], c["lon"], H3RES)), -1)
write_json(WORK / "candidates.json", cand)
print(f"  {len(cand)} scar candidates", flush=True)
