"""Download the public (no-login) supporting layers for GeoSentry, cropped to the study area.

Everything is resampled onto one grid: EPSG:32652 (UTM 52N), 20 m pixels, snapped to
80 m so it nests with the NISAR GUNW 80 m grid.

Run:  .venv/bin/python -I scripts/download_public.py [--only dem,s2,...]
Output: data/public/   (git-ignored, about 0.5 GB)
"""
import argparse
import csv
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
import requests
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "public"

# Study area: the March 2025 burn scar, Uiseong -> Andong -> Cheongsong -> Yeongyang -> Yeongdeok.
BBOX = (128.30, 36.15, 129.50, 36.85)  # west, south, east, north (lon/lat)
CRS = "EPSG:32652"
RES = 20
SNAP = 80

# Sentinel-2 dates where both tiles (52SDF, 52SEF) are nearly cloud-free.
S2_DATES = {
    "prefire_20250314": "2025-03-14",
    "postfire_20250408": "2025-04-08",
    "prestorm_20260612": "2026-06-12",
    "poststorm_20260806": "2026-08-06",
    "poststorm_20261002": "2026-10-02",
}
S2_BANDS = ["red", "nir", "swir16", "swir22", "scl"]

UA = {"User-Agent": "geosentry-hackathon/0.1"}


def grid():
    t = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
    w, s, e, n = BBOX
    xs, ys = zip(*[t.transform(x, y) for x, y in [(w, s), (w, n), (e, s), (e, n)]])
    x0 = math.floor(min(xs) / SNAP) * SNAP
    x1 = math.ceil(max(xs) / SNAP) * SNAP
    y0 = math.floor(min(ys) / SNAP) * SNAP
    y1 = math.ceil(max(ys) / SNAP) * SNAP
    width, height = int((x1 - x0) / RES), int((y1 - y0) / RES)
    return from_origin(x0, y1, RES, RES), width, height


TRANSFORM, WIDTH, HEIGHT = grid()


def warp(urls, resampling, dtype, nodata):
    """Read each source onto the study grid and mosaic (first valid pixel wins)."""
    out = np.full((HEIGHT, WIDTH), nodata, dtype=dtype)
    for url in urls:
        with rasterio.open(url) as src:
            with WarpedVRT(src, crs=CRS, transform=TRANSFORM, width=WIDTH, height=HEIGHT,
                           resampling=resampling, nodata=nodata) as vrt:
                a = vrt.read(1).astype(dtype)
        fill = out == nodata
        out[fill] = a[fill]
    return out


def save(path, arr, nodata):
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", driver="GTiff", height=HEIGHT, width=WIDTH, count=1,
                       dtype=arr.dtype, crs=CRS, transform=TRANSFORM, nodata=nodata,
                       compress="deflate", predictor=2 if arr.dtype.kind in "iu" else 3,
                       tiled=True) as dst:
        dst.write(arr, 1)
    print(f"  wrote {path.relative_to(ROOT)}  {path.stat().st_size / 1e6:.1f} MB", flush=True)


def dem():
    urls = [f"https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N36_00_E{lon}_00_DEM/"
            f"Copernicus_DSM_COG_10_N36_00_E{lon}_00_DEM.tif" for lon in (128, 129)]
    save(OUT / "dem_20m.tif", warp(urls, Resampling.bilinear, "float32", -9999.0), -9999.0)


def worldcover():
    base = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{}_Map.tif"
    urls = [base.format(t) for t in ("N36E126", "N36E129")]
    save(OUT / "worldcover_2021.tif", warp(urls, Resampling.nearest, "uint8", 0), 0)


def hansen():
    base = "https://storage.googleapis.com/earthenginepartners-hansen/GFC-2025-v1.13/Hansen_GFC-2025-v1.13_{}_40N_120E.tif"
    for layer in ("lossyear", "treecover2000"):
        save(OUT / f"hansen_{layer}.tif", warp([base.format(layer)], Resampling.nearest, "uint8", 255), 255)


def s2():
    for name, date in S2_DATES.items():
        body = {"collections": ["sentinel-2-l2a"], "bbox": list(BBOX), "limit": 50,
                "datetime": f"{date}T00:00:00Z/{date}T23:59:59Z"}
        feats = requests.post("https://earth-search.aws.element84.com/v1/search", json=body,
                              headers=UA, timeout=60).json()["features"]
        best = {}
        for f in feats:  # one item per MGRS tile: the least cloudy
            k = f["properties"]["grid:code"]
            if k not in best or f["properties"]["eo:cloud_cover"] < best[k]["properties"]["eo:cloud_cover"]:
                best[k] = f
        print(f"{name}: tiles {sorted(best)}", flush=True)
        for band in S2_BANDS:
            path = OUT / "s2" / f"{name}_{band}.tif"
            if path.exists():
                continue
            urls = [f["assets"][band]["href"] for f in best.values()]
            rs = Resampling.nearest if band == "scl" else Resampling.average
            dt = "uint8" if band == "scl" else "uint16"
            save(path, warp(urls, rs, dt, 0), 0)


def rain():
    """Daily rainfall (ERA5-based, ~10 km) on a 0.1 degree grid of points."""
    w, s, e, n = BBOX
    pts = [(round(la, 2), round(lo, 2)) for la in np.arange(s, n + 1e-6, 0.1) for lo in np.arange(w, e + 1e-6, 0.1)]
    rows = []
    for i in range(0, len(pts), 40):
        chunk = pts[i:i + 40]
        r = requests.get("https://archive-api.open-meteo.com/v1/archive", headers=UA, timeout=120, params={
            "latitude": ",".join(str(p[0]) for p in chunk), "longitude": ",".join(str(p[1]) for p in chunk),
            "start_date": "2025-01-01", "end_date": "2026-11-10", "daily": "precipitation_sum",
            "timezone": "Asia/Seoul"})
        r.raise_for_status()
        data = r.json()
        for p, d in zip(chunk, data if isinstance(data, list) else [data]):
            rows += [(p[0], p[1], t, v) for t, v in zip(d["daily"]["time"], d["daily"]["precipitation_sum"])]
        time.sleep(1)
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "rain_daily.csv", "w", newline="") as f:
        csv.writer(f).writerows([("lat", "lon", "date", "precip_mm"), *rows])
    print(f"  wrote data/public/rain_daily.csv  {len(rows)} rows", flush=True)


def boundaries():
    meta = requests.get("https://www.geoboundaries.org/api/current/gbOpen/KOR/ADM2/", headers=UA, timeout=60).json()
    gj = requests.get(meta["gjDownloadURL"], headers=UA, timeout=120).content
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "kor_adm2.geojson").write_bytes(gj)
    print(f"  wrote data/public/kor_adm2.geojson  {len(gj) / 1e6:.1f} MB", flush=True)


def osm():
    """Building centroids and roads from OpenStreetMap (what sits below each slope)."""
    w, s, e, n = BBOX
    q = (f'[out:json][timeout:300];(way["building"]({s},{w},{n},{e});'
         f'way["highway"~"motorway|trunk|primary|secondary|tertiary"]({s},{w},{n},{e}););out center tags;')
    r = requests.post("https://overpass-api.de/api/interpreter", data={"data": q}, headers=UA, timeout=400)
    r.raise_for_status()
    els = r.json()["elements"]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "osm_buildings_roads.json").write_text(json.dumps(els))
    nb = sum("building" in el.get("tags", {}) for el in els)
    print(f"  wrote data/public/osm_buildings_roads.json  {nb} buildings, {len(els) - nb} roads", flush=True)


def roads():
    """Main-road geometry (the osm step only keeps way centres)."""
    w, s, e, n = BBOX
    q = (f'[out:json][timeout:300];way["highway"~"motorway|trunk|primary|secondary|tertiary"]'
         f'({s},{w},{n},{e});out geom tags;')
    r = requests.post("https://overpass-api.de/api/interpreter", data={"data": q}, headers=UA, timeout=400)
    r.raise_for_status()
    els = [{"id": el["id"], "highway": el["tags"]["highway"], "ref": el["tags"].get("ref", ""),
            "name": el["tags"].get("name", ""),
            "line": [[round(p["lon"], 6), round(p["lat"], 6)] for p in el["geometry"]]}
           for el in r.json()["elements"] if "geometry" in el]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "osm_roads_geom.json").write_text(json.dumps(els, ensure_ascii=False))
    print(f"  wrote data/public/osm_roads_geom.json  {len(els)} roads", flush=True)


STEPS = {"dem": dem, "roads": roads, "worldcover": worldcover, "hansen": hansen, "rain": rain,
         "boundaries": boundaries, "osm": osm, "s2": s2}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=",".join(STEPS))
    args = ap.parse_args()
    print(f"grid {WIDTH} x {HEIGHT} px at {RES} m, {CRS}", flush=True)
    failed = []
    for name in args.only.split(","):
        print(f"[{name}]", flush=True)
        try:
            STEPS[name]()
        except Exception as ex:  # keep going; report at the end
            print(f"  FAILED: {type(ex).__name__}: {ex}", flush=True)
            failed.append(name)
    print("done. failed:", failed or "none", flush=True)
    sys.exit(1 if failed else 0)
