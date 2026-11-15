"""Stage K6: write what the nationwide map needs into site/data/korea/ (same file formats as the regional map).
Everything outside South Korea (North Korea, Japan, the sea) is flat and empty."""
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from pyproj import Transformer
from shapely.geometry import shape, mapping
from shapely.ops import transform as shp_transform

from common_kr import (PUB, WORK, OUT, REGION_SITE, CRS, X0, Y1, H90, W90, H180, W180, H360, W360, S2_PERIODS, STORM,
                       block, read, km, write_json)

OUT.mkdir(parents=True, exist_ok=True)
U = np.load(WORK / "units.npz"); Rg = np.load(WORK / "region.npz"); Su = np.load(WORK / "suscept.npz"); Lv = np.load(WORK / "levels.npz")
T = np.load(WORK / "terrain.npz", mmap_mode="r")
counties = json.load(open(WORK / "counties.json")); provinces = json.load(open(WORK / "provinces.json"))
RM = json.loads((REGION_SITE / "meta.json").read_text())
county90 = np.load(WORK / "county90.npy")
land = county90 > 0
tf = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
HS = 20                                                    # height scale: uint16 = metres * 20 (Hallasan 1,947 m fits)


def gz(name, arr):
    (OUT / name).write_bytes(gzip.compress(np.ascontiguousarray(arr).tobytes(), 6))
    print(f"  {name}: {(OUT / name).stat().st_size / 1e6:.2f} MB", flush=True)


# ---- terrain ---------------------------------------------------------------------------------------
dem = np.where(land, np.asarray(T["dem"]), np.nan)
h360 = np.nan_to_num(block(dem, 4))
gz("height.bin.gz", np.clip(h360 * HS, 0, 65535).astype("<u2"))
land180 = block(land.astype("float32"), 2, np.mean) > 0
nx, ny = block(-np.asarray(T["dzdx"]), 2, np.mean), block(-np.asarray(T["dzdy"]), 2, np.mean)
cv = block(np.asarray(T["curv"]), 2, np.mean)
nx[~land180] = 0; ny[~land180] = 0; cv[~land180] = 0
enc = lambda v: np.clip(v * 0.5 / 1.2 + 0.5, 0, 1)
Image.fromarray((np.stack([enc(nx), enc(ny), np.clip(cv / 6 + 0.5, 0, 1)], -1) * 255).astype("uint8")).save(OUT / "normal.jpg", quality=90)
print("  normal.jpg", flush=True)

# ---- units -------------------------------------------------------------------------------------------
sl = np.where(U["is_slope"])[0]
n = sl.size
remap = np.zeros(U["h3"].size + 1, np.int64); remap[sl + 1] = np.arange(1, n + 1)
ids = remap[U["uid180"]]
abroad180 = block(((np.asarray(T["dem"]) > 1) & ~land).astype("float32"), 2, np.mean) > 0.5       # North Korea, Japan
alpha = np.where(land180, 255, np.where(abroad180, 128, 0))                                       # shader: map / another country / sea
gz("unitid.bin.gz", np.stack([ids & 255, (ids >> 8) & 255, (ids >> 16) & 255, alpha], -1).astype("u1"))
ux, uz = km(U["ux"][sl], U["uy"][sl])
SHIP = ["relief450" if f == "relief" else f for f in json.load(open(WORK / "suscept_stats.json"))["features"]]   # relief is over 450 m here
contrib = Su["contrib"][sl][:, :-1]; Xv = Su["X"][sl]
top = np.argsort(-contrib, 1)[:, :3]
rows = np.arange(n)[:, None]
tc = contrib[rows, top]
top = np.where(tc > 0.05, top, -1)
nan = np.full(n, np.nan, "float32")
cols = {
    "x": ux, "z": uz, "lat": U["lat"][sl], "lon": U["lon"][sl], "elev": U["dem"][sl], "slope": U["slope"][sl], "aspect": U["aspect"][sl],
    "county": U["county"][sl], "level": Lv["level"][sl], "moving": Lv["moving"][sl], "pct": Su["pct"][sl], "prio": Lv["prio"][sl],
    "bld": Lv["bld_below"][sl], "road": Lv["road_below"][sl], "dnbr": U["dnbr"][sl], "burn": U["burn_frac"][sl], "ndvi": U["ndvi_pre"][sl],
    "rain_storm": U["rain_storm"][sl], "rain_ante": U["rain_ante30"][sl], "det": Rg["det"][sl], "zmax": Rg["zmax"][sl],
    "label": Rg["label"][sl], "seen": Rg["observed"][sl],
    "r1": top[:, 0], "r2": top[:, 1], "r3": top[:, 2], "v1": Xv[rows[:, 0], np.maximum(top[:, 0], 0)], "v2": Xv[rows[:, 0], np.maximum(top[:, 1], 0)],
    "v3": Xv[rows[:, 0], np.maximum(top[:, 2], 0)],
}
TR = ["125", "032", "024"]
for t in TR:
    cols[f"cum_{t}"] = Rg[f"cum_{t}"][sl]; cols[f"sig_{t}"] = Rg[f"sig_{t}"][sl]
    cols[f"meas_{t}"] = Rg[f"meas_{t}"][sl]; cols[f"sens_{t}"] = Rg[f"sens_{t}"][sl]
    cols[f"cohpre_{t}"] = Rg[f"cohpre_{t}"][sl]; cols[f"cohstorm_{t}"] = Rg[f"cohstorm_{t}"][sl]
for k_ in ("vd", "vds", "vpre", "vstep"): cols[k_] = Rg[k_][sl]
cols["prov"] = U["prov"][sl]; cols["rcov"] = Rg["inreg"][sl]; cols["rain_season"] = U["rain_season"][sl]
# debris reach per slope (k04b): cautious friction, best-fit friction, and where it came from (1 ML model 3, 2 GPU simulation)
REACH = json.load(open(WORK / "reach_stats.json")) if (WORK / "reach_stats.json").exists() else None
if REACH:
    Rc = np.load(WORK / "reach.npz"); cols["reach"] = Rc["reach"][sl]; cols["reach_fit"] = Rc["reach_fit"][sl]; cols["reach_src"] = Rc["src"][sl]
cols["ndvi_latest"] = U["ndvi_latest"][sl] if "ndvi_latest" in U.files else nan
gz("units.bin.gz", np.stack([np.asarray(v, "float32") for v in cols.values()], 0).astype("<f4"))

nd = RM["units"]["nd"]
ser = Rg["series"][sl]; coh = Rg["coh"][sl]
q = np.clip(np.round(np.nan_to_num(ser, nan=0) * 100), -32000, 32000).astype("<i2"); q[~np.isfinite(ser)] = -32768
gz("series.bin.gz", q); gz("coh.bin.gz", np.clip(np.nan_to_num(coh) * 255, 0, 255).astype("u1"))

# ---- imagery: Planetary Computer Sentinel-2, natural colour and SWIR/NIR/red, 180 m -----------------------
images = []
land180f = land180[..., None]
for key, (d0, d1, en, ko, what) in S2_PERIODS.items():
    if not (PUB / "s2" / f"{key}_vis.tif").exists():
        continue
    import rasterio
    with rasterio.open(PUB / "s2" / f"{key}_vis.tif") as s:
        vis = s.read().astype("float32")
    vis[vis == 0] = np.nan
    if key != "latest_2026" and (PUB / "s2" / "latest_2026_vis.tif").exists():      # cloud holes: show the latest scene there instead of black
        with rasterio.open(PUB / "s2" / "latest_2026_vis.tif") as s:
            fb = s.read().astype("float32")
        hole = np.isnan(vis).any(0) & (fb.max(0) > 0)
        vis[:, hole] = fb[:, hole]
    rgb = np.stack([block(vis[b], 2) for b in range(3)], -1) / 255
    rgb = np.clip(np.nan_to_num(rgb) * 1.15, 0, 1) ** 0.9
    rgb = np.where(land180f, rgb, 0.0)
    Image.fromarray((rgb * 255).astype("uint8")).save(OUT / f"s2_{key}_tc.jpg", quality=82)
    b = []
    for nm in ("swir22", "nir", "red"):
        a = read(PUB / "s2" / f"{key}_{nm}.tif").astype("float32"); a[a == 0] = np.nan
        b.append(block((a - 1000) / 10000, 2))
    fc = np.clip(np.stack([b[0] / 0.34, b[1] / 0.52, b[2] / 0.20], -1), 0, 1) ** 0.85
    fc = np.where(land180f, np.nan_to_num(fc), 0.0)
    Image.fromarray((fc * 255).astype("uint8")).save(OUT / f"s2_{key}.jpg", quality=82)
    day = read(PUB / "s2" / f"{key}_day.tif"); dd = day[land & (day >= 0)]
    med = str(np.datetime64(d0) + int(np.median(dd))) if dd.size else d0
    images.append({"key": key, "from": d0, "to": d1, "en": en, "ko": ko, "what": what, "median_date": med})
    print(f"  imagery {key}: median pixel date {med}", flush=True)

# ---- radar rasters of the storm pairs (North Gyeongsang only) ------------------------------------------
for t in TR:
    r = np.load(WORK / f"radar_{t}.npy")[:, 2::4, 2::4][:, :H360, :W360]
    gz(f"radar_{t}.bin.gz", np.ascontiguousarray(r.transpose(1, 2, 0)))

# ---- vectors --------------------------------------------------------------------------------------------
def to_km(geom, tol):
    g = shp_transform(lambda x, y, z=None: tf.transform(x, y), shape(geom))
    g = g.simplify(tol)
    lines = []
    polys = [g] if g.geom_type == "Polygon" else list(g.geoms)
    for poly in polys:
        for ring in [poly.exterior, *poly.interiors]:
            a = np.asarray(ring.coords)
            if len(a) < 3 or poly.area < 2e5:
                continue
            x, z = km(a[:, 0], a[:, 1])
            lines.append(np.round(np.stack([x, z], 1), 2).tolist())
    return lines


gj = sorted(json.load(open(PUB / "skorea_municipalities_2018.json"))["features"], key=lambda f: f["properties"]["code"])
cnty = []
for c, f in zip(counties, gj):
    m = cols["county"] == c["id"]
    cnty.append({"id": c["id"], "en": c["en"].replace("-gun", "").replace("-si", "").replace("-gu", "-gu"), "full": c["en"], "ko": c["ko"],
                 "prov": c["prov"], "lines": to_km(f["geometry"], 150),
                 "cx": float(ux[m].mean()) if m.any() else None, "cz": float(uz[m].mean()) if m.any() else None, "units": int(m.sum())})
pj = sorted(json.load(open(PUB / "skorea_provinces_2018.json"))["features"], key=lambda f: f["properties"]["code"])
prv = []
for p, f in zip(provinces, pj):
    m = cols["prov"] == p["id"]
    g = shp_transform(lambda x, y, z=None: tf.transform(x, y), shape(f["geometry"]))
    big = max([g] if g.geom_type == "Polygon" else list(g.geoms), key=lambda q: q.area)
    lp = big.representative_point()
    lx, lz = km(lp.x, lp.y)
    prv.append({"id": p["id"], "en": p["en"], "ko": p["ko"], "lines": to_km(f["geometry"], 250), "lx": float(lx), "lz": float(lz),
                "cx": float(ux[m].mean()) if m.any() else float(lx), "cz": float(uz[m].mean()) if m.any() else float(lz), "units": int(m.sum())})
rank = {"motorway": 0, "trunk": 1, "primary": 2}                # nationwide: no secondary roads (130k ways is too much to drape)
roads = []
for r in json.load(open(PUB / "osm_roads_geom.json")):
    k = rank.get(r["highway"].replace("_link", ""))
    if k is None or len(r["line"]) < 2 or r["highway"].endswith("_link"):
        continue
    a = np.array(r["line"]); x, y = tf.transform(a[:, 0], a[:, 1]); x, z = km(x, y)
    pts = np.round(np.stack([x, z], 1), 2)
    keep = [0]
    for i in range(1, len(pts)):
        if np.hypot(*(pts[i] - pts[keep[-1]])) > (0.4 if k <= 1 else 0.6) or i == len(pts) - 1:
            keep.append(i)
    if len(keep) > 1:
        roads.append({"k": k, "p": pts[keep].tolist()})
# buildings: nationwide there are millions, so the map shows the ones below a Watch or Check-first slope
bc = np.load(WORK / "bcount90.npy")
flag = np.zeros(U["h3"].size + 1, bool); flag[sl[cols["level"] >= 2] + 1] = True
uid90 = np.repeat(np.repeat(U["uid180"], 2, 0), 2, 1); uid90 = np.pad(uid90, ((0, H90 - uid90.shape[0]), (0, W90 - uid90.shape[1])))
from scipy import ndimage as ndi
near = ndi.binary_dilation(flag[uid90], iterations=4)
bi, bj = np.nonzero((bc > 0) & near)
bx, bz = (bj * 90 + 45) / 1000, (bi * 90 + 45) / 1000
print(f"  building cells shown: {bi.size:,}", flush=True)
places = json.load(open(PUB / "osm_places.json"))
towns = []
for p in places:
    if p["place"] != "city" or not p["ko"]:
        continue
    x, y = tf.transform(p["lon"], p["lat"]); kx, kz = km(x, y)
    if 0 <= kx <= W90 * 0.09 and 0 <= kz <= H90 * 0.09:
        towns.append({"en": p["en"] or p["name"], "ko": p["ko"], "x": round(float(kx), 2), "z": round(float(kz), 2), "pop": p["pop"]})
write_json(OUT / "vectors.json", {"counties": cnty, "provinces": prv, "roads": roads,
                                  "buildings": np.round(np.stack([bx, bz], 1), 2).tolist(), "towns": towns})
print(f"  vectors.json: {(OUT / 'vectors.json').stat().st_size / 1e6:.2f} MB ({len(towns)} towns, {len(roads)} roads)", flush=True)

# ---- rain -------------------------------------------------------------------------------------------------
R = np.load(WORK / "rain.npz")
d = R["dates"]; m = (d >= "2026-06-01") & (d <= "2026-10-31")
pts = R["pts"]
lats, lons = np.unique(pts[:, 0]), np.unique(pts[:, 1])
grid = np.zeros((m.sum(), len(lats), len(lons)), "float32")
li = np.searchsorted(lats, pts[:, 0]); lj = np.searchsorted(lons, pts[:, 1])
grid[:, li, lj] = R["R"][:, m].T
grid = grid[:, ::-1]                                           # north row first
x0, z1 = km(*tf.transform(lons.min(), lats.min())); x1, z0 = km(*tf.transform(lons.max(), lats.max()))
write_json(OUT / "rain.json", {"dates": d[m].tolist(), "mean": np.round(R["R"][:, m].mean(0), 2).tolist(),
                               "max": np.round(R["R"][:, m].max(0), 1).tolist(), "rows": len(lats), "cols": len(lons),
                               "x0": float(x0), "x1": float(x1), "z0": float(z0), "z1": float(z1),
                               "grid": np.round(grid.reshape(int(m.sum()), -1), 1).tolist()})

# ---- scar candidates ---------------------------------------------------------------------------------------
cand = json.load(open(WORK / "candidates.json"))
for c in cand:
    c["u"] = int(remap[c["u"] + 1]) - 1 if c["u"] >= 0 else -1
write_json(OUT / "candidates.json", [{k: c[k] for k in ("id", "auto", "verdict", "final", "lat", "lon", "x", "z", "u", "area_m2", "elong", "slope", "drop")} for c in cand])

# ---- numbers -------------------------------------------------------------------------------------------------
LS = json.load(open(WORK / "level_stats.json")); SS = json.load(open(WORK / "suscept_stats.json"))
lab = dict(RM["labels"]); lab["failed_slope_units"] = int(Rg["label"][U["is_slope"] & Rg["observed"]].sum())
meta = {
    "scope": "korea", "generated": str(np.datetime64("now")) + "Z",
    "grid": {"w_km": W90 * 0.09, "h_km": H90 * 0.09, "h80": [H360, W360], "h40": [H180, W180], "height_scale": HS,
             "x0": X0, "y1": Y1, "epsg": 5179, "res_m": [90, 180, 360], "h3": 8},
    "view": {"scale": 6.4, "exag": 5.0, "exag_max": 14},
    "units": {"n": int(n), "cols": list(cols), "nd": nd},
    "features": SHIP,
    "counties": [{"id": c["id"], "en": c["en"], "ko": c["ko"], "prov": c["prov"], "units": c["units"], "cx": c["cx"], "cz": c["cz"]} for c in cnty],
    "provinces": [{k: p[k] for k in ("id", "en", "ko", "units", "cx", "cz", "lx", "lz")} for p in prv],
    "tracks": RM["tracks"], "radar": RM["radar"],
    "s2": [i["median_date"] for i in images], "images": images,
    "storm": RM["storm"], "series": RM["series"], "labels": lab, "suscept": SS, "anomaly": RM["anomaly"], "velocity": RM.get("velocity"), "sign": RM.get("sign"), "levels": LS,
    "region": {"bbox_km": [float(v) for v in (*km(*tf.transform(128.30, 36.85)), *km(*tf.transform(129.50, 36.15)))],
               "regional_meta": {"units": RM["units"]["n"], "check_first": RM["levels"]["levels"]["check_first"]}},
    "reach": REACH,
    "sources": {"s2": "Microsoft Planetary Computer, sentinel-2-l2a (first clear pixel, least cloudy scene first)",
                "dem": "Copernicus DEM GLO-30/GLO-90", "landcover": "ESA WorldCover 2021", "forest": "Hansen GFC v1.13",
                "rain": "ERA5 via Open-Meteo, 0.2 degree", "boundaries": "KOSTAT 2018 (southkorea-maps)", "osm": "OpenStreetMap (Geofabrik)",
                "nisar": "NISAR GUNW, North Gyeongsang only (regional build)"},
}
write_json(OUT / "meta.json", meta)
print("site/data/korea total:", round(sum(f.stat().st_size for f in OUT.glob('*')) / 1e6, 1), "MB")
