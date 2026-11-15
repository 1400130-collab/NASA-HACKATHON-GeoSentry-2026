"""Shared grid, paths and helpers for the GeoSentry pipeline.

Everything lives on the DEM grid: EPSG:32652, 20 m pixels, 3892 x 5404.
NISAR 80 m layers are a sub-grid of it (offset 4 px in x, 0 in y).
Run stages with:  .venv/bin/python -I pipeline/pNN_name.py
"""
import json
from pathlib import Path

import numpy as np
import rasterio

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PUB = DATA / "public"
NISAR = DATA / "nisar" / "gunw"
WORK = DATA / "work"
SITE = ROOT / "site"
WORK.mkdir(parents=True, exist_ok=True)

BBOX = (128.30, 36.15, 129.50, 36.85)
CRS = "EPSG:32652"
X0, Y1 = 436960.0, 4078480.0          # top-left corner of the 20 m grid
H20, W20 = 3892, 5404
NX0, NY1 = 437040.0, 4078480.0        # top-left corner of the NISAR 80 m grid
H80, W80 = 972, 1349
TRACKS = ["125_A_020", "032_D_070", "024_A_020"]
STORM = "2026-07-18"                  # first day of the storm; nothing on/after this in the hindsight run


def read(path, band=1):
    with rasterio.open(path) as s:
        return s.read(band)


def save(name, **arrays):
    np.savez_compressed(WORK / f"{name}.npz", **arrays)


def load(name):
    return np.load(WORK / f"{name}.npz", allow_pickle=False)


def to80(a20, fn=np.nanmean):
    """Aggregate a 20 m array onto the NISAR 80 m grid."""
    sub = a20[: H80 * 4, 4: 4 + W80 * 4]
    return fn(sub.reshape(H80, 4, W80, 4), axis=(1, 3))


def up80(a80, fill=np.nan):
    """Nearest-neighbour an 80 m array back onto the 20 m grid."""
    out = np.full((H20, W20), fill, dtype=a80.dtype if a80.dtype.kind != "f" else "float32")
    out[: H80 * 4, 4: 4 + W80 * 4] = np.repeat(np.repeat(a80, 4, 0), 4, 1)
    return out


def write_json(path, obj):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


def pairs(track):
    """Sorted list of (ref, sec) date tags for a track."""
    fs = sorted((NISAR / track).glob("*_unwrapped_HH_unwrappedPhase.tif"))
    return [tuple(f.name.split("_")[:2]) for f in fs]


def hazard_units():
    """Slope units the ranking (top 5%) or the radar (moving) flags, before asking what is below them.
    Same rule as the first half of "check first" in p08."""
    U = load("units"); A = load("anomaly"); Su = load("suscept"); Vl = load("velocity")
    moving = Vl["detected"] & (np.nan_to_num(A["detector_pct"]) >= 0.95)
    return U["is_slope"] & (moving | (np.nan_to_num(Su["pct"]) >= 0.95))
