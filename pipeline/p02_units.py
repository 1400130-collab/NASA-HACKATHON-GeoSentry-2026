"""Stage A2 + B: hexagon slope units (H3 res 9) and their static features.
Output: data/work/units.npz (uid40 raster + per-unit table), data/work/s2_idx.npz (20 m index rasters)."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import h3.api.numpy_int as h3
import rasterio
from pyproj import Transformer
from rasterio import features
from rasterio.transform import from_origin
from rasterio.warp import transform_geom
from common import PUB, WORK, read, save, load, H20, W20, X0, Y1, CRS, BBOX

H40, W40 = H20 // 2, W20 // 2
T = load("terrain")

# ---- hexagons -------------------------------------------------------------
jj, ii = np.meshgrid(np.arange(W40), np.arange(H40))
x = X0 + 40 * jj + 20
y = Y1 - 40 * ii - 20
lon, lat = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True).transform(x.ravel(), y.ravel())
cells = np.fromiter((h3.latlng_to_cell(a, b, 9) for a, b in zip(lat, lon)), dtype=np.uint64, count=lat.size)
ucell, uid = np.unique(cells, return_inverse=True)
uid40 = uid.reshape(H40, W40).astype(np.int32)
uid20 = np.repeat(np.repeat(uid40, 2, 0), 2, 1)
N = ucell.size
npx = np.bincount(uid20.ravel(), minlength=N)
cen = np.array([h3.cell_to_latlng(c) for c in ucell])
print(f"{N} hexagons, median pixels per hex {np.median(npx):.0f}", flush=True)


def mean(a, w=None):
    a = a.ravel().astype("float64")
    ok = np.isfinite(a)
    s = np.bincount(uid20.ravel()[ok], a[ok], N)
    n = np.bincount(uid20.ravel()[ok], minlength=N)
    return (s / np.maximum(n, 1)).astype("float32"), n


# ---- Sentinel-2 indices ----------------------------------------------------
def s2(name, band):
    return read(PUB / "s2" / f"{name}_{band}.tif").astype("float32")


def refl(name, band):
    a = s2(name, band)
    off = 1000.0 if np.percentile(a[a > 0][::97], 0.5) >= 950 else 0.0   # baseline >= 04.00 adds 1000
    out = (a - off) / 10000.0
    out[a == 0] = np.nan
    return out, off


idx = {}
for name in ["prefire_20250314", "postfire_20250408", "prestorm_20260612", "poststorm_20260806", "poststorm_20261002"]:
    red, off = refl(name, "red"); nir, _ = refl(name, "nir"); sw, _ = refl(name, "swir22")
    scl = read(PUB / "s2" / f"{name}_scl.tif")
    clear = np.isin(scl, (4, 5, 7))
    ndvi = (nir - red) / (nir + red + 1e-6)
    nbr = (nir - sw) / (nir + sw + 1e-6)
    ndvi[~clear] = np.nan; nbr[~clear] = np.nan
    idx[name] = (ndvi, nbr)
    print(f"  {name}: offset {off:.0f}, clear {clear.mean():.2f}, ndvi median {np.nanmedian(ndvi[::7, ::7]):.2f}", flush=True)

dnbr = idx["prefire_20250314"][1] - idx["postfire_20250408"][1]
save("s2_idx", dnbr=dnbr.astype("float32"),
     ndvi_pre=idx["prestorm_20260612"][0], ndvi_post=idx["poststorm_20260806"][0],
     ndvi_oct=idx["poststorm_20261002"][0], ndvi_prefire=idx["prefire_20250314"][0],
     ndvi_postfire=idx["postfire_20250408"][0])

# ---- per-unit table ---------------------------------------------------------
tab = {}
for k in ["dem", "slope", "curv", "relief", "tpi", "twi", "dstream"]:
    tab[k], _ = mean(T[k])
asp = np.radians(T["aspect"])
w = np.tan(np.radians(T["slope"]))                      # weight aspect by steepness
se, _ = mean(np.sin(asp) * w); sn, _ = mean(np.cos(asp) * w)
tab["eastness"], tab["northness"] = se, sn
tab["aspect"] = (np.degrees(np.arctan2(se, sn)) % 360).astype("float32")
tab["steep30"], _ = mean((T["slope"] > 30).astype("float32"))
tab["dnbr"], nb = mean(dnbr)
tab["burn_frac"], _ = mean(np.where(np.isfinite(dnbr), dnbr > 0.27, np.nan))   # moderate+ severity (USGS classes)
tab["burn_high"], _ = mean(np.where(np.isfinite(dnbr), dnbr > 0.66, np.nan))
tab["ndvi_pre"], _ = mean(idx["prestorm_20260612"][0])
tab["ndvi_postfire"], _ = mean(idx["postfire_20250408"][0])
wc = read(PUB / "worldcover_2021.tif")
for code, nm in [(10, "tree"), (20, "shrub"), (30, "grass"), (40, "crop"), (50, "built"), (60, "bare"), (80, "water")]:
    tab[f"lc_{nm}"], _ = mean((wc == code).astype("float32"))
tc = read(PUB / "hansen_treecover2000.tif").astype("float32"); tc[tc == 255] = np.nan
tab["treecover"], _ = mean(tc)
ly = read(PUB / "hansen_lossyear.tif")
tab["loss2025"], _ = mean((ly == 25).astype("float32"))
tab["loss_pre"], _ = mean(((ly > 0) & (ly < 25)).astype("float32"))

# ---- rain (nearest 0.1 degree point) ---------------------------------------
import csv
from collections import defaultdict
series = defaultdict(dict)
for r in csv.DictReader(open(PUB / "rain_daily.csv")):
    series[(float(r["lat"]), float(r["lon"]))][r["date"]] = float(r["precip_mm"] or 0)
pts = np.array(sorted(series))
dates = sorted(next(iter(series.values())))
R = np.array([[series[tuple(p)][d] for d in dates] for p in pts])           # points x days
d = np.array(dates)
near = np.argmin((cen[:, 0, None] - pts[None, :, 0]) ** 2 + (cen[:, 1, None] - pts[None, :, 1]) ** 2, axis=1)
pre = d < "2026-07-18"
ante = (d >= "2026-06-18") & pre
roll3 = np.stack([R[:, max(0, i - 2): i + 1].sum(1) for i in range(R.shape[1])], 1)
tab["rain_ante30"] = R[:, ante].sum(1)[near].astype("float32")
tab["rain_max1_pre"] = R[:, pre].max(1)[near].astype("float32")
tab["rain_max3_pre"] = roll3[:, pre].max(1)[near].astype("float32")
tab["rain_storm"] = R[:, (d >= "2026-07-16") & (d <= "2026-07-20")].sum(1)[near].astype("float32")   # display only
np.savez_compressed(WORK / "rain.npz", pts=pts, dates=d, R=R.astype("float32"))

# ---- counties ---------------------------------------------------------------
gj = json.load(open(PUB / "kor_adm2.geojson"))
tr40 = from_origin(X0, Y1, 40, 40)
w_, s_, e_, n_ = BBOX
names, shapes = [], []
for f in gj["features"]:
    g = f["geometry"]
    coords = np.concatenate([np.array(r) for poly in (g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]) for r in poly])
    if coords[:, 0].max() < w_ or coords[:, 0].min() > e_ or coords[:, 1].max() < s_ or coords[:, 1].min() > n_:
        continue
    names.append(f["properties"]["shapeName"])
    shapes.append((transform_geom("EPSG:4326", CRS, g), len(names)))
county40 = features.rasterize(shapes, out_shape=(H40, W40), transform=tr40, fill=0, dtype="uint8")
ci = np.clip(((Y1 - Transformer.from_crs("EPSG:4326", CRS, always_xy=True).transform(cen[:, 1], cen[:, 0])[1]) / 40).astype(int), 0, H40 - 1)
cx = Transformer.from_crs("EPSG:4326", CRS, always_xy=True).transform(cen[:, 1], cen[:, 0])
cj = np.clip(((cx[0] - X0) / 40).astype(int), 0, W40 - 1)
ci = np.clip(((Y1 - cx[1]) / 40).astype(int), 0, H40 - 1)
county = county40[ci, cj]
print("counties:", {n: int((county == i + 1).sum()) for i, n in enumerate(names)}, "none:", int((county == 0).sum()))

is_slope = (tab["slope"] > 10) & (npx >= 40) & (tab["lc_water"] < 0.5) & (county > 0)
print(f"slope units (mean slope > 10 deg, inside the box, on land): {is_slope.sum()} of {N}")
print("burned units (>50% moderate+):", int(((tab['burn_frac'] > 0.5) & is_slope).sum()))
save("units", uid40=uid40, county40=county40, h3=ucell, lat=cen[:, 0], lon=cen[:, 1], ux=cx[0], uy=cx[1], npx=npx,
     county=county, is_slope=is_slope, **tab)
(WORK / "counties.json").write_text(json.dumps(names, ensure_ascii=False))
