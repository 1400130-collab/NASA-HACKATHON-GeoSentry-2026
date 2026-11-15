"""Rasters for the real-world layers, on the 50 m grid of common_w.py.

  land cover     ESA WorldCover 2021 v200 (10 m, read at its 40 m overview), most common class per 50 m cell
  canopy height  GLAD GLCLUC 2020 forest height (30 m), made from NASA GEDI lidar and Landsat (Potapov et al. 2022)
  building height  JRC GHSL GHS-BUILT-H 2018 (100 m, mean net building height), for footprints that carry no height

Writes   data/world/raster/lc50.npy, canopy50.npy (uint8), anbh100.npz
         site/data/world/land_korea.png, land_region.png   the ground colour of each map, far from the camera

Run:  .venv/bin/python -I pipeline/world/w01_rasters.py [lc canopy anbh png]
"""
import math
import os
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common_w import CRS, X0, Y1, CELL, GW, GH, WM, HM, RASTER, OUT, REGION, LC_CODES, PALETTE, sk_mask

os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "4")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
T50 = from_origin(X0, Y1, CELL, CELL)
WC = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{}_Map.tif"
WC_TILES = ("N33E123", "N33E126", "N33E129", "N36E123", "N36E126", "N36E129", "N30E126")


def window_for(bounds, pad=2):
    l, b, r, t = bounds
    c0 = max(0, int(math.floor((l - X0) / CELL)) - pad); c1 = min(GW, int(math.ceil((r - X0) / CELL)) + pad)
    r0 = max(0, int(math.floor((Y1 - t) / CELL)) - pad); r1 = min(GH, int(math.ceil((Y1 - b) / CELL)) + pad)
    return None if c1 <= c0 or r1 <= r0 else Window(c0, r0, c1 - c0, r1 - r0)


def warp(path, resampling, nodata, overview=None):
    """One source file onto the 50 m grid: (window, array), or (None, None) if it misses the grid."""
    kw = {"overview_level": overview} if overview is not None else {}
    with rasterio.open(path, **kw) as src:
        win = window_for(transform_bounds(src.crs, CRS, *src.bounds))
        if win is None:
            return None, None
        with WarpedVRT(src, crs=CRS, transform=T50, width=GW, height=GH, resampling=resampling, src_nodata=nodata, nodata=nodata) as vrt:
            # read in bands of rows so a 10-degree tile never sits in memory twice
            out = np.zeros((win.height, win.width), "uint8")
            for r0 in range(0, win.height, 1024):
                h = min(1024, win.height - r0)
                out[r0:r0 + h] = vrt.read(1, window=Window(win.col_off, win.row_off + r0, win.width, h))
            return win, out


def mosaic(paths, resampling, nodata=0, overview=None, threads=4):
    out = np.zeros((GH, GW), "uint8")
    with ThreadPoolExecutor(threads) as ex:
        for p, (win, a) in zip(paths, ex.map(lambda p: warp(p, resampling, nodata, overview), paths)):
            if win is None:
                continue
            o = out[win.row_off:win.row_off + win.height, win.col_off:win.col_off + win.width]
            f = (o == 0) & (a != nodata); o[f] = a[f]
            print(f"  {os.path.basename(p)}: {int(f.sum()):,} cells", flush=True)
    return out


def lc():
    a = mosaic([WC.format(t) for t in WC_TILES], Resampling.mode, 0, overview=1)
    lut = np.zeros(256, "uint8")
    for k, v in LC_CODES.items():
        lut[k] = v
    a = lut[a]
    np.save(RASTER / "lc50.npy", a)
    print("land cover classes:", np.bincount(a.ravel(), minlength=9).tolist(), flush=True)


def canopy():
    # values are metres (0 = no forest); anything above 60 is a flag, not a height
    paths = [str(RASTER / f"gedi_2020_40N_{e}.tif") for e in ("120E", "130E")]
    a = mosaic(paths, Resampling.average, 0, threads=2)
    a[a > 60] = 0
    np.save(RASTER / "canopy50.npy", a)
    f = a > 0
    print(f"canopy: {f.mean() * 100:.1f}% of cells, mean height {a[f].mean():.1f} m, max {a.max()} m", flush=True)


def anbh():
    """GHSL mean net building height (metres, 100 m Mollweide cells) for the two tiles that cover South Korea."""
    out = {}
    for rc in ("R5_C30", "R6_C30"):
        z = RASTER / f"ghsl_anbh_{rc}.zip"
        with zipfile.ZipFile(z) as zf:
            name = next(n for n in zf.namelist() if n.endswith(".tif"))
            zf.extract(name, RASTER)
        with rasterio.open(RASTER / name) as s:
            a = s.read(1); t = s.transform
        a = np.where(np.isfinite(a) & (a > 0) & (a < 500), a, 0).astype("float32")
        out[rc] = a; out[rc + "_t"] = np.array([t.c, t.f, t.a], "float64")       # x of the left edge, y of the top edge, cell size
        print(f"  {rc}: {a.shape}, {int((a > 0).sum()):,} built cells, mean {a[a > 0].mean():.1f} m", flush=True)
        (RASTER / name).unlink()
    np.savez_compressed(RASTER / "anbh100.npz", **out)


def hex_rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], "float32")


def colour(cls, can):
    """Class and canopy rasters -> the ground colour the map shows. Forest gets darker where the trees are taller."""
    pal = np.stack([hex_rgb(h) for h in PALETTE["land"]])
    rgb = pal[cls]
    tall = hex_rgb(PALETTE["tree_tall"])
    f = np.clip((can.astype("float32") - 6) / 16, 0, 1)[..., None] * (cls == 1)[..., None]
    rgb = rgb * (1 - f) + tall * f
    a = np.where(cls == 0, 0, 255).astype("uint8")
    return np.dstack([np.round(rgb).astype("uint8"), a])


def block_mode(a, k):
    """Most common class in each k x k block (classes 0..8)."""
    h, w = a.shape[0] // k, a.shape[1] // k
    b = a[:h * k, :w * k].reshape(h, k, w, k)
    best = np.zeros((h, w), "uint8"); cnt = np.zeros((h, w), "int16")
    for c in range(1, 9):
        n = (b == c).sum(axis=(1, 3)).astype("int16")
        f = n > cnt; best[f] = c; cnt[f] = n[f]
    return best


def png():
    cls = np.load(RASTER / "lc50.npy"); can = np.load(RASTER / "canopy50.npy")
    # nationwide: the map's 180 m unit grid (3832 x 3510). 3.6 cells of 50 m per pixel, so go through 150 m blocks.
    mask, mpp = sk_mask()
    h, w = mask.shape
    c3 = block_mode(cls, 3); k3 = can[:c3.shape[0] * 3, :c3.shape[1] * 3].reshape(c3.shape[0], 3, c3.shape[1], 3).mean(axis=(1, 3))
    yy = np.minimum(((np.arange(h) + 0.5) * mpp / 150).astype(int), c3.shape[0] - 1)
    xx = np.minimum(((np.arange(w) + 0.5) * mpp / 150).astype(int), c3.shape[1] - 1)
    ck, kk = c3[yy][:, xx], k3[yy][:, xx]
    ck = np.where(mask > 200, ck, 0)                               # nothing outside South Korea: the map shows no data there
    Image.fromarray(colour(ck, kk), "RGBA").save(OUT / "land_korea.png", optimize=True)
    print(f"  land_korea.png {w}x{h}  {(OUT / 'land_korea.png').stat().st_size / 1e6:.1f} MB", flush=True)

    # regional: 40 m pixels on the UTM grid of the regional map, warped from the 50 m rasters
    R = REGION
    rw, rh = int(R["w"] / 40), int(R["h"] / 40)
    dst_t = from_origin(R["x0"], R["y1"], 40, 40)
    rc = np.zeros((rh, rw), "uint8"); rk = np.zeros((rh, rw), "uint8")
    reproject(cls, rc, src_transform=T50, src_crs=CRS, dst_transform=dst_t, dst_crs=f"EPSG:{R['epsg']}", resampling=Resampling.nearest)
    reproject(can, rk, src_transform=T50, src_crs=CRS, dst_transform=dst_t, dst_crs=f"EPSG:{R['epsg']}", resampling=Resampling.bilinear)
    Image.fromarray(colour(rc, rk), "RGBA").save(OUT / "land_region.png", optimize=True)
    print(f"  land_region.png {rw}x{rh}  {(OUT / 'land_region.png').stat().st_size / 1e6:.1f} MB", flush=True)


if __name__ == "__main__":
    steps = {"lc": lc, "canopy": canopy, "anbh": anbh, "png": png}
    for s in (sys.argv[1:] or list(steps)):
        print(f"== {s}", flush=True); steps[s]()
