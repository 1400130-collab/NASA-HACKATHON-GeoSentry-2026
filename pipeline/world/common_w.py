"""Shared grid and paths for the real-world layers of the 3D map (buildings, trees, land cover, water, roads).

Everything is baked on the nationwide map's grid (EPSG:5179, origin X0 / Y1 of pipeline/korea/common_kr.py) and cut
into square tiles. The browser loads the tiles around the camera and lays them on the terrain it already has; the
regional map (UTM 52N) reads the same tiles through a polynomial fitted here (see w02_tiles.py).

  tile        4 km x 4 km, key "tx_tz" counted east and south from the grid origin
  coordinates int16, 0.25 m steps from the tile's north-west corner
  cell        50 m ground cells (80 x 80 per tile): land-cover class and canopy height

Run stages with:  .venv/bin/python -I pipeline/world/wNN_name.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "world" / "raw"
RASTER = ROOT / "data" / "world" / "raster"
SITE = ROOT / "site"
OUT = SITE / "data" / "world"
for p in (RAW, RASTER, OUT):
    p.mkdir(parents=True, exist_ok=True)

CRS = "EPSG:5179"
X0, X1, Y0, Y1 = 724320.0, 1414080.0, 1450800.0, 2082600.0      # the nationwide map's box
WM, HM = X1 - X0, Y1 - Y0                                        # 689,760 x 631,800 m
TILE = 4000.0
NTX, NTZ = int(-(-WM // TILE)), int(-(-HM // TILE))               # 173 x 158
CELL = 50.0
NC = int(TILE / CELL)                                            # 80 cells across a tile
GW, GH = NTX * NC, NTZ * NC                                      # the 50 m grid covers whole tiles
Q = 0.25                                                         # metres per integer step inside a tile

# The regional map: UTM 52N, 108.08 x 77.84 km (site/data/meta.json)
REGION = {"epsg": 32652, "x0": 436960.0, "y1": 4078480.0, "w": 108080.0, "h": 77840.0}

# Land cover classes (ESA WorldCover codes -> ours) and their colours on the dark map (sRGB).
LC_CODES = {10: 1, 20: 2, 30: 3, 40: 4, 50: 5, 60: 6, 70: 6, 80: 7, 90: 8, 95: 8, 100: 3}
LC_NAMES = ["none", "tree", "shrub", "grass", "crop", "built", "bare", "water", "wetland"]
PALETTE = json.loads((Path(__file__).parent / "palette.json").read_text())


def sk_mask():
    """South Korean land on the nationwide map's 180 m grid (alpha of unitid.bin: 255 inside, ~128 abroad, 0 sea)."""
    import gzip
    import numpy as np
    m = json.loads((SITE / "data/korea/meta.json").read_text())["grid"]
    h, w = m["h40"]
    a = np.frombuffer(gzip.decompress((SITE / "data/korea/unitid.bin.gz").read_bytes()), np.uint8).reshape(h, w, 4)[..., 3]
    return a, WM / w                                             # array, metres per pixel
