"""Shared grid, paths and helpers for the nationwide (South Korea) SLOPEWATCH build.

The North Gyeongsang pipeline (pipeline/pNN_*.py) runs on a 20 m UTM grid of one 108 x 78 km box.
This one covers all of South Korea (North Korea and Japan masked out) on a coarser grid so the whole
country fits in a browser:

  analysis grid   EPSG:5179 (Korea 2000 unified), 90 m pixels, 7664 x 7020
  unit-id grid    180 m (2 x 2 analysis pixels)    -> what the map colours per slope unit
  height grid     360 m (4 x 4 analysis pixels)    -> the 3D mesh
  slope units     H3 resolution 8 hexagons (~0.74 km2), against resolution 9 (~0.1 km2) in the regional map

Run stages with:  .venv/bin/python -I pipeline/korea/kNN_name.py
"""
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "korea"
PUB = DATA / "public"
WORK = DATA / "work"
SITE = ROOT / "site"
OUT = SITE / "data" / "korea"
REGION_SITE = SITE / "data"                 # the North Gyeongsang build (NISAR, labels) that this one reuses
for p in (PUB, WORK):
    p.mkdir(parents=True, exist_ok=True)

CRS = "EPSG:5179"
RES = 90
X0, X1, Y0, Y1 = 724320.0, 1414080.0, 1450800.0, 2082600.0
W90, H90 = int((X1 - X0) / RES), int((Y1 - Y0) / RES)          # 7664 x 7020
W180, H180 = W90 // 2, H90 // 2
W360, H360 = W90 // 4, H90 // 4
BBOX_LL = (124.55, 33.05, 131.93, 38.66)                         # lon/lat search box
H3RES = 8
STORM = "2026-07-18"

# Sentinel-2 L2A composites from Microsoft Planetary Computer. "First clear pixel, least cloudy scene first"
# (the same rule as the Planetary Computer explorer's "Most recent (low cloud)" mosaic), one per window.
S2_PERIODS = {
    "prefire_2025":   ("2025-02-15", "2025-03-20", "Feb–Mar 2025", "2025년 2–3월", "before the March 2025 wildfires"),
    "postfire_2025":  ("2025-03-29", "2025-05-05", "Apr 2025", "2025년 4월", "after the March 2025 wildfires"),
    "prestorm_2026":  ("2026-05-10", "2026-07-15", "May–Jul 2026", "2026년 5–7월", "before the July 2026 storm"),
    "poststorm_2026": ("2026-07-21", "2026-09-05", "Aug 2026", "2026년 8월", "after the July 2026 storm"),
    "latest_2026":    ("2026-10-16", "2026-11-14", "Latest (Nov 2026)", "최신 (2026년 11월)", "most recent low-cloud"),
}


def transform90():
    from rasterio.transform import from_origin
    return from_origin(X0, Y1, RES, RES)


def read(path, band=1):
    import rasterio
    with rasterio.open(path) as s:
        return s.read(band)


def write_tif(path, arr, nodata=None):
    import rasterio
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    h, w = arr.shape[-2:]
    res = RES * W90 // w
    from rasterio.transform import from_origin
    with rasterio.open(path, "w", driver="GTiff", height=h, width=w, count=1 if arr.ndim == 2 else arr.shape[0],
                       dtype=arr.dtype, crs=CRS, transform=from_origin(X0, Y1, res, res), nodata=nodata,
                       compress="deflate", predictor=2 if arr.dtype.kind in "iu" else 3, tiled=True, BIGTIFF="IF_SAFER") as d:
        d.write(arr if arr.ndim == 3 else arr[None])
    print(f"  wrote {path.relative_to(ROOT)}  {path.stat().st_size / 1e6:.1f} MB", flush=True)


def save(name, **arrays):
    np.savez_compressed(WORK / f"{name}.npz", **arrays)


def load(name):
    return np.load(WORK / f"{name}.npz", allow_pickle=False)


def write_json(path, obj):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


def block(a, k, fn=np.nanmean):
    """Aggregate a 2-D array by k x k blocks (trailing rows/cols dropped)."""
    h, w = a.shape[0] // k, a.shape[1] // k
    return fn(a[: h * k, : w * k].reshape(h, k, w, k), axis=(1, 3))


def km(x, y):
    """Projected metres -> map km from the top-left corner (x east, z south)."""
    return (np.asarray(x) - X0) / 1000, (Y1 - np.asarray(y)) / 1000
