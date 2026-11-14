"""Stage K2: H3 resolution-8 slope units for all of South Korea and their static features.

North Korea, Japan (Tsushima) and the sea are outside every unit: units only cover pixels inside one of the
250 South Korean municipalities (KOSTAT 2018 boundaries).
Output: data/korea/work/units.npz, counties.json, provinces.json, rain.npz"""
import csv
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import h3.api.numpy_int as h3
import numpy as np
from pyproj import Transformer
from rasterio import features
from rasterio.warp import transform_geom

from common_kr import PUB, WORK, CRS, H90, W90, H180, W180, X0, Y1, H3RES, STORM, S2_PERIODS, read, transform90, load, write_json

T = np.load(WORK / "terrain.npz")
dem = T["dem"]

# ---- municipalities and provinces --------------------------------------------------------------
gj = json.load(open(PUB / "skorea_municipalities_2018.json"))
feats = sorted(gj["features"], key=lambda f: f["properties"]["code"])
pj = {f["properties"]["code"]: f["properties"] for f in json.load(open(PUB / "skorea_provinces_2018.json"))["features"]}
PROV_EN = {"11": "Seoul", "21": "Busan", "22": "Daegu", "23": "Incheon", "24": "Gwangju", "25": "Daejeon", "26": "Ulsan",
           "29": "Sejong", "31": "Gyeonggi", "32": "Gangwon", "33": "North Chungcheong", "34": "South Chungcheong",
           "35": "North Jeolla", "36": "South Jeolla", "37": "North Gyeongsang", "38": "South Gyeongsang", "39": "Jeju"}
pcodes = sorted(pj)
provinces = [{"id": i + 1, "code": c, "ko": pj[c]["name"], "en": PROV_EN.get(c, pj[c]["name_eng"])} for i, c in enumerate(pcodes)]
pid = {p["code"]: p["id"] for p in provinces}
counties = []
for i, f in enumerate(feats):
    p = f["properties"]
    counties.append({"id": i + 1, "code": p["code"], "ko": p["name"], "en": p["name_eng"], "prov": pid[p["code"][:2]]})
shapes = [(transform_geom("EPSG:4326", CRS, f["geometry"]), i + 1) for i, f in enumerate(feats)]
county90 = features.rasterize(shapes, out_shape=(H90, W90), transform=transform90(), fill=0, dtype="uint16")
wc = read(PUB / "worldcover_2021_90m.tif")
land = (county90 > 0) & (wc != 80)
print(f"South Korean land pixels: {land.sum():,} ({land.sum() * 0.0081:,.0f} km2)", flush=True)

# ---- hexagons on the 180 m grid ----------------------------------------------------------------
land180 = land[: H180 * 2, : W180 * 2].reshape(H180, 2, W180, 2).any(axis=(1, 3))
ii, jj = np.nonzero(land180)
x = X0 + 180 * jj + 90
y = Y1 - 180 * ii - 90
to_ll = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
lon, lat = to_ll.transform(x, y)
cells = np.fromiter((h3.latlng_to_cell(a, b, H3RES) for a, b in zip(lat, lon)), dtype=np.uint64, count=lat.size)
ucell, inv = np.unique(cells, return_inverse=True)
N = ucell.size
uid180 = np.zeros((H180, W180), np.int32)              # 0 = no unit, else index + 1
uid180[ii, jj] = inv + 1
uid90 = np.repeat(np.repeat(uid180, 2, 0), 2, 1)
uid90 = np.pad(uid90, ((0, H90 - uid90.shape[0]), (0, W90 - uid90.shape[1])))
uid90[~land] = 0
g = uid90.ravel()
sel = g > 0
gi = g[sel] - 1
npx = np.bincount(gi, minlength=N)
cen = np.array([h3.cell_to_latlng(c) for c in ucell])
to_xy = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
ux, uy = to_xy.transform(cen[:, 1], cen[:, 0])
print(f"{N:,} hexagons, median land pixels per hexagon {np.median(npx):.0f}", flush=True)


def mean(a):
    a = np.asarray(a).ravel()[sel].astype("float64")
    ok = np.isfinite(a)
    s = np.bincount(gi[ok], a[ok], N)
    n = np.bincount(gi[ok], minlength=N)
    out = (s / np.maximum(n, 1)).astype("float32")
    out[n == 0] = np.nan
    return out


tab = {}
for k in ["dem", "slope", "slope90", "steep", "curv", "relief", "tpi", "twi", "dstream"]:
    tab[k] = mean(T[k])
tab["steep30"] = tab.pop("steep")
asp = np.radians(T["aspect"]); wgt = np.tan(np.radians(T["slope90"]))
se, sn = mean(np.sin(asp) * wgt), mean(np.cos(asp) * wgt)
tab["eastness"], tab["northness"] = se, sn
tab["aspect"] = (np.degrees(np.arctan2(se, sn)) % 360).astype("float32")
print("terrain features done", flush=True)

# ---- Sentinel-2 composites (Planetary Computer) --------------------------------------------------
def refl(key, band):
    a = read(PUB / "s2" / f"{key}_{band}.tif").astype("float32")
    off = 1000.0 if np.percentile(a[a > 0][::97], 0.5) >= 950 else 0.0    # processing baseline >= 04.00 adds 1000
    out = (a - off) / 10000.0
    out[a == 0] = np.nan
    return out


idx = {}
for key in S2_PERIODS:
    if not (PUB / "s2" / f"{key}_red.tif").exists():
        print(f"  {key}: missing", flush=True); continue
    red, nir, sw = refl(key, "red"), refl(key, "nir"), refl(key, "swir22")
    ndvi = (nir - red) / (nir + red + 1e-6); nbr = (nir - sw) / (nir + sw + 1e-6)
    idx[key] = (ndvi, nbr)
    print(f"  {key}: ndvi median on land {np.nanmedian(ndvi[land][::31]):.2f}, coverage {np.isfinite(ndvi[land]).mean():.3f}", flush=True)
# Snow in the Feb-Mar 2025 composite looks like a high NBR and would read as "burned" (Gangwon highlands).
# Snow = bright in visible light, dark in SWIR. Burned ground also has to be dark (low NBR) after the fires.
import rasterio
with rasterio.open(PUB / "s2" / "prefire_2025_vis.tif") as s_:
    vbright = s_.read().astype("float32").mean(0)
snow = (vbright > 110) & (refl("prefire_2025", "swir22") < 0.15)
print(f"  snow masked in the pre-fire composite: {snow[land].mean():.3f} of land", flush=True)
dnbr = idx["prefire_2025"][1] - idx["postfire_2025"][1]
dnbr[snow | (idx["postfire_2025"][1] > 0.25)] = np.where(snow, np.nan, np.minimum(dnbr, 0.1))[snow | (idx["postfire_2025"][1] > 0.25)]
del vbright, snow
tab["dnbr"] = mean(dnbr)
tab["burn_frac"] = mean(np.where(np.isfinite(dnbr), dnbr > 0.27, np.nan))
tab["burn_high"] = mean(np.where(np.isfinite(dnbr), dnbr > 0.66, np.nan))
tab["ndvi_pre"] = mean(idx["prestorm_2026"][0])
tab["ndvi_postfire"] = mean(idx["postfire_2025"][0])
if "poststorm_2026" in idx:
    tab["ndvi_post"] = mean(idx["poststorm_2026"][0])
if "latest_2026" in idx:
    tab["ndvi_latest"] = mean(idx["latest_2026"][0])
del idx
for code, nm in [(10, "tree"), (20, "shrub"), (30, "grass"), (40, "crop"), (50, "built"), (60, "bare"), (80, "water")]:
    tab[f"lc_{nm}"] = mean((wc == code).astype("float32"))
ly = read(PUB / "hansen_lossyear_90m.tif")
tab["loss2025"] = mean(np.where(ly == 255, np.nan, ly == 25))
tab["loss_pre"] = mean(np.where(ly == 255, np.nan, (ly > 0) & (ly < 25)))

# ---- rain (nearest 0.2 degree point) -------------------------------------------------------------
series = defaultdict(dict)
for r in csv.DictReader(open(PUB / "rain_daily.csv")):
    series[(float(r["lat"]), float(r["lon"]))][r["date"]] = float(r["precip_mm"] or 0)
pts = np.array(sorted(series))
dates = sorted(next(iter(series.values())))
R = np.array([[series[tuple(p)].get(d, 0.0) for d in dates] for p in pts])
d = np.array(dates)
near = np.argmin((cen[:, 0, None] - pts[None, :, 0]) ** 2 + ((cen[:, 1, None] - pts[None, :, 1]) * np.cos(np.radians(36))) ** 2, axis=1)
pre = d < STORM
ante = (d >= "2026-06-18") & pre
roll3 = np.stack([R[:, max(0, i - 2): i + 1].sum(1) for i in range(R.shape[1])], 1)
tab["rain_ante30"] = R[:, ante].sum(1)[near].astype("float32")
tab["rain_max1_pre"] = R[:, pre].max(1)[near].astype("float32")
tab["rain_max3_pre"] = roll3[:, pre].max(1)[near].astype("float32")
tab["rain_storm"] = R[:, (d >= "2026-07-16") & (d <= "2026-07-20")].sum(1)[near].astype("float32")
season = (d >= "2026-06-01") & (d <= "2026-10-31")
tab["rain_season"] = R[:, season].sum(1)[near].astype("float32")
tab["rain_max3_season"] = roll3[:, season].max(1)[near].astype("float32")
np.savez_compressed(WORK / "rain.npz", pts=pts, dates=d, R=R.astype("float32"))

# ---- county per unit (where most of its land is) -------------------------------------------------
cg = county90.ravel()[sel].astype(np.int64)
pair = gi.astype(np.int64) * 1000 + cg
up, cnt = np.unique(pair, return_counts=True)
u_of, c_of = up // 1000, up % 1000
order = np.lexsort((-cnt, u_of))
first = np.r_[True, u_of[order][1:] != u_of[order][:-1]]
county = np.zeros(N, np.int32)
county[u_of[order][first]] = c_of[order][first]
prov = np.array([0] + [c["prov"] for c in counties], np.int32)[county]

is_slope = (tab["slope"] > 10) & (npx >= 30) & (np.nan_to_num(tab["lc_water"]) < 0.5) & (county > 0)
print(f"slope units (mean slope > 10 deg): {is_slope.sum():,} of {N:,}", flush=True)
print("by province:", {p["en"]: int((is_slope & (prov == p["id"])).sum()) for p in provinces}, flush=True)
print("burned slope units (>50% moderate+):", int(((tab["burn_frac"] > 0.5) & is_slope).sum()), flush=True)
np.savez_compressed(WORK / "units.npz", uid180=uid180, h3=ucell, lat=cen[:, 0], lon=cen[:, 1], ux=ux, uy=uy, npx=npx,
                    county=county, prov=prov, is_slope=is_slope, **tab)
np.save(WORK / "county90.npy", county90)
write_json(WORK / "counties.json", counties)
write_json(WORK / "provinces.json", provinces)
