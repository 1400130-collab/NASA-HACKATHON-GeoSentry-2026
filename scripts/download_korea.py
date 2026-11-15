"""Download the public (no-login) layers for the nationwide GeoSentry map, on one grid for all of South Korea.

Grid: EPSG:5179, 90 m (see pipeline/korea/common_kr.py). North Korea and Japan are masked out later.
Sentinel-2 comes from Microsoft Planetary Computer (sentinel-2-l2a), read from the COG overviews (80 m)
so the whole country is a few GB of reads instead of a few TB.

Run:  .venv/bin/python -I scripts/download_korea.py [--only bounds,mask,dem,worldcover,hansen,s2,rain,osm,glc]
Output: data/korea/public/   (git-ignored, about 1.5 GB)
"""
import argparse
import csv
import io
import json
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import rasterio
import requests
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window, from_bounds

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline" / "korea"))
from common_kr import PUB, CRS, RES, X0, Y1, W90, H90, BBOX_LL, S2_PERIODS, transform90, write_tif  # noqa: E402

UA = {"User-Agent": "geosentry-hackathon/0.2"}
T90 = transform90()
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "4")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif,.TIF,.tiff")


def window_for(bounds_5179, pad=2):
    """Integer window of the national grid that covers bounds (left, bottom, right, top), clipped to the grid."""
    l, b, r, t = bounds_5179
    c0 = max(0, int(math.floor((l - X0) / RES)) - pad); c1 = min(W90, int(math.ceil((r - X0) / RES)) + pad)
    r0 = max(0, int(math.floor((Y1 - t) / RES)) - pad); r1 = min(H90, int(math.ceil((Y1 - b) / RES)) + pad)
    if c1 <= c0 or r1 <= r0:
        return None
    return Window(c0, r0, c1 - c0, r1 - r0)


def warp_into(src_arr, src_transform, src_crs, win, resampling, dtype, nodata, src_nodata=None):
    out = np.full((win.height, win.width), nodata, dtype=dtype)
    reproject(src_arr, out, src_transform=src_transform, src_crs=src_crs, src_nodata=src_nodata,
              dst_transform=rasterio.windows.transform(win, T90), dst_crs=CRS, dst_nodata=nodata, resampling=resampling)
    return out


def bounds():
    """KOSTAT 2018 province and municipality boundaries (southkorea-maps). Every other step needs these."""
    base = "https://raw.githubusercontent.com/southkorea/southkorea-maps/master/kostat/2018/json/"
    for n in ("provinces", "municipalities"):
        out = PUB / f"skorea_{n}_2018.json"
        if out.exists():
            continue
        r = requests.get(f"{base}skorea-{n}-2018-geo.json", headers=UA, timeout=120); r.raise_for_status()
        out.write_bytes(r.content)
        print(f"  wrote {out.name}  {len(r.content) / 1e6:.1f} MB", flush=True)


def sk_shape():
    """Union of the 17 provinces (lon/lat), for tile filtering."""
    from shapely.geometry import shape
    from shapely.ops import unary_union
    gj = json.load(open(PUB / "skorea_provinces_2018.json"))
    return unary_union([shape(f["geometry"]).buffer(0) for f in gj["features"]]).buffer(0.02)


# ---- DEM: Copernicus GLO-90 (the 30 m tiles are 10x the download; slope is computed on the 90 m grid) ----
def dem():
    land = sk_shape()
    from shapely.geometry import box
    tiles = [(la, lo) for la in range(33, 39) for lo in range(124, 132) if land.intersects(box(lo, la, lo + 1, la + 1))]
    urls = []
    for la, lo in tiles:
        name = f"Copernicus_DSM_COG_30_N{la:02d}_00_E{lo:03d}_00_DEM"
        urls.append(f"https://copernicus-dem-90m.s3.amazonaws.com/{name}/{name}.tif")
    print(f"  {len(urls)} DEM tiles", flush=True)
    write_tif(PUB / "dem_90m.tif", _mosaic(urls, Resampling.bilinear, "float32", -9999.0), -9999.0)


def slope30():
    """Mean slope and share steeper than 30 deg of the 30 m Copernicus DEM cells, averaged onto the 90 m grid."""
    from scipy import ndimage as ndi
    from shapely.geometry import box
    land = sk_shape()
    tiles = [(la, lo) for la in range(33, 39) for lo in range(124, 132) if land.intersects(box(lo, la, lo + 1, la + 1))]
    out = {k: np.full((H90, W90), np.nan, "float32") for k in ("slope30", "steep30")}

    def one(t):
        la, lo = t
        name = f"Copernicus_DSM_COG_10_N{la:02d}_00_E{lo:03d}_00_DEM"
        url = f"https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif"
        z = None
        for _ in range(4):
            try:
                with rasterio.open(url) as s_:
                    z = s_.read(1).astype("float64"); tr = s_.transform; crs = s_.crs
                break
            except Exception as e:  # noqa: BLE001
                print(f"    {t} retry: {e}", flush=True)
        if z is None:
            return t, None
        dx = abs(tr.a) * 111320 * math.cos(math.radians(la + 0.5)); dy = abs(tr.e) * 110574
        gy, gx = np.gradient(ndi.gaussian_filter(z, 1.0), dy, dx)
        sl = np.degrees(np.arctan(np.hypot(gx, gy))).astype("float32")
        win = window_for(transform_bounds(crs, CRS, *rasterio.transform.array_bounds(z.shape[0], z.shape[1], tr)))
        return t, (win, {"slope30": warp_into(sl, tr, crs, win, Resampling.average, "float32", np.nan),
                         "steep30": warp_into((sl > 30).astype("float32"), tr, crs, win, Resampling.average, "float32", np.nan)})

    with ThreadPoolExecutor(4) as ex:
        for t, r in ex.map(one, tiles):
            if r is None:
                continue
            win, res = r
            sl_ = (slice(win.row_off, win.row_off + win.height), slice(win.col_off, win.col_off + win.width))
            for k, a in res.items():
                o = out[k][sl_]; f = np.isnan(o) & np.isfinite(a); o[f] = a[f]
    for k, a in out.items():
        write_tif(PUB / f"{k}_90m.tif", a, np.nan)


# ---- land cover / forest -----------------------------------------------------------------------
def _warp_url(url, resampling, dtype, nodata, overview=None):
    kw = {"overview_level": overview} if overview is not None else {}
    with rasterio.open(url, **kw) as src:
        with WarpedVRT(src, crs=CRS, transform=T90, width=W90, height=H90, resampling=resampling, nodata=nodata) as vrt:
            l, b, r, t = transform_bounds(src.crs, CRS, *src.bounds)
            win = window_for((l, b, r, t))
            if win is None:
                return None, None
            return win, vrt.read(1, window=win).astype(dtype)


def _mosaic(urls, resampling, dtype, nodata, overview=None):
    out = np.full((H90, W90), nodata, dtype=dtype)

    def one(u):
        try:
            return _warp_url(u, resampling, dtype, nodata, overview)
        except rasterio.errors.RasterioIOError as e:
            print(f"    skip {u.split('/')[-1]}: {e}", flush=True)
            return None, None

    with ThreadPoolExecutor(4) as ex:
        for win, a in ex.map(one, urls):
            if win is None:
                continue
            o = out[win.row_off:win.row_off + win.height, win.col_off:win.col_off + win.width]
            f = (o == nodata) & (a != nodata); o[f] = a[f]
    return out


def worldcover():
    base = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{}_Map.tif"
    urls = [base.format(t) for t in ("N33E123", "N33E126", "N33E129", "N36E123", "N36E126", "N36E129", "N30E126")]
    # overview 2 = 80 m; the mode of 80 m classes on the 90 m grid
    write_tif(PUB / "worldcover_2021_90m.tif", _mosaic(urls, Resampling.mode, "uint8", 0, overview=2), 0)


def hansen():
    base = "https://storage.googleapis.com/earthenginepartners-hansen/GFC-2025-v1.13/Hansen_GFC-2025-v1.13_{}_40N_{}.tif"
    for layer, rs in (("lossyear", Resampling.nearest),):          # tree cover comes from WorldCover instead (saves ~200 MB)
        urls = [base.format(layer, e) for e in ("120E", "130E")]
        write_tif(PUB / f"hansen_{layer}_90m.tif", _mosaic(urls, rs, "uint8", 255), 255)


# ---- Sentinel-2 composites from Planetary Computer --------------------------------------------
PC_STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
S2_BANDS = {"B04": ("red", 3), "B08": ("nir", 3), "B12": ("swir22", 2), "SCL": ("scl", 2), "visual": ("vis", 3)}  # overview level -> 160 m


def s2(only_periods=None, resume=False):
    import planetary_computer
    import pystac_client
    from shapely.geometry import shape
    land = sk_shape()
    sk = np.asarray(_sk_mask90())
    cat = pystac_client.Client.open(PC_STAC)
    for key, (d0, d1, *_rest) in S2_PERIODS.items():
        if only_periods and key not in only_periods:
            continue
        have = (PUB / "s2" / f"{key}_vis.tif").exists()
        if have and not resume:
            print(f"  {key}: exists", flush=True); continue
        items = list(cat.search(collections=["sentinel-2-l2a"], bbox=list(BBOX_LL), datetime=f"{d0}/{d1}",
                                query={"eo:cloud_cover": {"lt": 70}}, max_items=2000).items())
        items = [i for i in items if land.intersects(shape(i.geometry))]
        # least cloudy first; ties -> most recent first
        items.sort(key=lambda i: (round(i.properties["eo:cloud_cover"] / 5), -i.datetime.timestamp()))
        print(f"  {key}: {len(items)} scenes over South Korea ({d0}..{d1})", flush=True)
        red = np.zeros((H90, W90), "uint16"); nir = red.copy(); sw = red.copy()
        vis = np.zeros((3, H90, W90), "uint8"); filled = np.zeros((H90, W90), bool)
        pday = np.full((H90, W90), -1, "int16")
        t0 = np.datetime64(d0)
        if have:                                   # second pass: keep what is there, fill only the holes
            red[:] = rasterio.open(PUB / "s2" / f"{key}_red.tif").read(1); nir[:] = rasterio.open(PUB / "s2" / f"{key}_nir.tif").read(1)
            sw[:] = rasterio.open(PUB / "s2" / f"{key}_swir22.tif").read(1); vis[:] = rasterio.open(PUB / "s2" / f"{key}_vis.tif").read()
            pday[:] = rasterio.open(PUB / "s2" / f"{key}_day.tif").read(1); filled[:] = (red > 0) & (vis.max(0) > 0)
            print(f"  {key}: resuming at cover {filled[sk].mean():.4f}", flush=True)

        def needed(item):                          # does this scene's footprint still have empty South Korean pixels?
            w = window_for(transform_bounds("EPSG:4326", CRS, *item.bbox))
            if w is None:
                return False
            sl_ = (slice(w.row_off, w.row_off + w.height), slice(w.col_off, w.col_off + w.width))
            return bool((sk[sl_] & ~filled[sl_]).any())

        def fetch(item):
            item = planetary_computer.sign(item)
            res = {}
            win = None
            for asset, (nm, ovr) in S2_BANDS.items():
                href = item.assets[asset].href
                for attempt in range(6):
                    try:
                        with rasterio.open(href, overview_level=ovr) as s:
                            if win is None:
                                win = window_for(transform_bounds(s.crs, CRS, *s.bounds))
                                if win is None:
                                    return item, None, None
                            a = s.read()
                            rs = Resampling.nearest if nm == "scl" else Resampling.average
                            if nm == "vis":
                                res[nm] = np.stack([warp_into(a[b], s.transform, s.crs, win, rs, "uint8", 0, 0) for b in range(3)])
                            else:
                                res[nm] = warp_into(a[0], s.transform, s.crs, win, rs, "uint16" if nm != "scl" else "uint8", 0, 0)
                        break
                    except Exception as e:  # noqa: BLE001  (network hiccups: retry, then give up on this scene)
                        if attempt == 5:
                            print(f"    {item.id} {asset}: {type(e).__name__} {e}", flush=True)
                            return item, None, None
                        time.sleep(3 + 5 * attempt)
            return item, win, res

        from scipy import ndimage as ndi
        done = 0
        with ThreadPoolExecutor(8) as ex:
            for k in range(0, len(items), 20):
                chunk = [i for i in items[k:k + 20] if needed(i)]
                for item, win, r in ex.map(fetch, chunk):
                    pass
                    if win is None:
                        continue
                    sl = (slice(win.row_off, win.row_off + win.height), slice(win.col_off, win.col_off + win.width))
                    scl = r["scl"]
                    clear = np.isin(scl, (4, 5, 6, 7, 11))
                    cloud = np.isin(scl, (3, 8, 9, 10)) | (scl == 0)
                    clear &= ~ndi.binary_dilation(cloud, iterations=2)               # 180 m buffer round clouds and shadows
                    clear &= (r["red"] > 0) & (r["nir"] > 0) & (r["vis"].max(0) > 0)
                    put = clear & ~filled[sl]
                    for dst, nm in ((red, "red"), (nir, "nir"), (sw, "swir22")):
                        dst[sl][put] = r[nm][put]
                    for b in range(3):
                        vis[b][sl][put] = r["vis"][b][put]
                    pday[sl][put] = int((np.datetime64(item.datetime.date()) - t0).astype(int))
                    filled[sl] |= put
                done += 20
                cov = filled[sk].mean()
                print(f"    {min(done, len(items))}/{len(items)} scenes ({len(chunk)} needed), South Korea filled {cov:.4f}", flush=True)
                if cov > 0.997:
                    break
        # whatever is still empty: take the least-cloudy scene's value regardless of the mask (better than a hole)
        print(f"  {key}: final cover {filled[sk].mean():.4f}", flush=True)
        for nm, a in (("red", red), ("nir", nir), ("swir22", sw)):
            write_tif(PUB / "s2" / f"{key}_{nm}.tif", a, 0)
        write_tif(PUB / "s2" / f"{key}_day.tif", pday, -1)
        write_tif(PUB / "s2" / f"{key}_vis.tif", vis, 0)


def _sk_mask90():
    """South Korea's land (all 250 municipalities) on the 90 m grid, buffered ~1 km into the sea."""
    p = PUB / "sk_mask_90m.tif"
    if p.exists():
        return rasterio.open(p).read(1).astype(bool)
    from rasterio import features
    from rasterio.warp import transform_geom
    gj = json.load(open(PUB / "skorea_municipalities_2018.json"))
    shapes = [(transform_geom("EPSG:4326", CRS, f["geometry"]), 1) for f in gj["features"]]
    m = features.rasterize(shapes, out_shape=(H90, W90), transform=T90, fill=0, dtype="uint8", all_touched=True)
    from scipy import ndimage as ndi
    m = ndi.binary_dilation(m.astype(bool), iterations=11).astype("uint8")
    write_tif(p, m, None)
    return m.astype(bool)


# ---- rain ----------------------------------------------------------------------------------------
def rain():
    """Daily rainfall (ERA5-based) on a 0.2 degree grid of points over South Korea."""
    sk = _sk_mask90()
    from pyproj import Transformer
    tf = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
    w, s, e, n = 124.6, 33.1, 131.8, 38.6
    lats = np.round(np.arange(s, n + 1e-6, 0.2), 2); lons = np.round(np.arange(w, e + 1e-6, 0.2), 2)
    pts = []
    for la in lats:
        for lo in lons:
            x, y = tf.transform(lo, la)
            j, i = int((x - X0) // RES), int((Y1 - y) // RES)
            near = 0 <= i < H90 and 0 <= j < W90 and sk[max(0, i - 120):i + 120, max(0, j - 120):j + 120].any()   # within ~11 km of land
            if near:
                pts.append((la, lo))
    print(f"  {len(pts)} rain points of {len(lats) * len(lons)}", flush=True)
    path = PUB / "rain_daily.csv"
    done = set()
    if path.exists():
        for r in csv.DictReader(open(path)):
            done.add((float(r["lat"]), float(r["lon"])))
    todo = [p for p in pts if p not in done]
    f = open(path, "a", newline=""); wr = csv.writer(f)
    if not done:
        wr.writerow(("lat", "lon", "date", "precip_mm"))
    for i in range(0, len(todo), 25):
        chunk = todo[i:i + 25]
        for attempt in range(8):
            r = requests.get("https://archive-api.open-meteo.com/v1/archive", headers=UA, timeout=180, params={
                "latitude": ",".join(str(p[0]) for p in chunk), "longitude": ",".join(str(p[1]) for p in chunk),
                "start_date": "2025-01-01", "end_date": "2026-11-08", "daily": "precipitation_sum", "timezone": "Asia/Seoul"})
            if r.status_code == 429 or r.status_code >= 500:
                wait = 30 * (attempt + 1); print(f"    {r.status_code}, waiting {wait}s", flush=True); time.sleep(wait); continue
            r.raise_for_status(); break
        data = r.json()
        for p, d in zip(chunk, data if isinstance(data, list) else [data]):
            wr.writerows((p[0], p[1], t, v) for t, v in zip(d["daily"]["time"], d["daily"]["precipitation_sum"]))
        f.flush()
        print(f"    rain {min(i + 25, len(todo))}/{len(todo)}", flush=True)
        time.sleep(3)
    f.close()


# ---- OpenStreetMap (Geofabrik extract) ---------------------------------------------------------
def osm():
    """Building centres, main roads and towns from the Geofabrik South Korea extract (downloaded separately)."""
    import osmium
    pbf = PUB / "south-korea-latest.osm.pbf"
    if not pbf.exists():
        r = requests.get("https://download.geofabrik.de/asia/south-korea-latest.osm.pbf", headers=UA, stream=True, timeout=600)
        r.raise_for_status()
        with open(pbf, "wb") as f:
            for c in r.iter_content(1 << 20):
                f.write(c)
    ROADS = {"motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link"}

    class H(osmium.SimpleHandler):
        def __init__(s):
            super().__init__(); s.b = []; s.roads = []; s.places = []

        def node(s, n):
            p = n.tags.get("place")
            if p in ("city", "town"):
                s.places.append({"place": p, "name": n.tags.get("name", ""), "ko": n.tags.get("name:ko", n.tags.get("name", "")),
                                 "en": n.tags.get("name:en", ""), "pop": n.tags.get("population", ""),
                                 "lon": round(n.location.lon, 5), "lat": round(n.location.lat, 5)})

        def way(s, w):
            t = w.tags
            if "building" in t:
                try:
                    xs = [nd.location.lon for nd in w.nodes]; ys = [nd.location.lat for nd in w.nodes]
                except osmium.InvalidLocationError:
                    return
                if xs:
                    s.b.append((sum(xs) / len(xs), sum(ys) / len(ys)))
            elif t.get("highway") in ROADS:
                try:
                    line = [[round(nd.location.lon, 5), round(nd.location.lat, 5)] for nd in w.nodes]
                except osmium.InvalidLocationError:
                    return
                s.roads.append({"highway": t.get("highway"), "ref": t.get("ref", ""), "line": line})

    h = H()
    h.apply_file(str(pbf), locations=True, idx="sparse_mem_array")
    b = np.array(h.b, "float64")
    np.savez_compressed(PUB / "osm_buildings.npz", lon=b[:, 0], lat=b[:, 1])
    (PUB / "osm_roads_geom.json").write_text(json.dumps(h.roads))
    (PUB / "osm_places.json").write_text(json.dumps(h.places, ensure_ascii=False))
    print(f"  {len(b)} buildings, {len(h.roads)} road ways, {len(h.places)} places", flush=True)


# ---- NASA Global Landslide Catalog (independent check outside the training region) ---------------
def glc():
    url = "https://data.nasa.gov/resource/dd9e-wu2v.json"
    r = requests.get(url, params={"country_name": "South Korea", "$limit": 5000}, headers=UA, timeout=120)
    r.raise_for_status()
    rows = r.json()
    (PUB / "nasa_glc_korea.json").write_text(json.dumps(rows, ensure_ascii=False))
    print(f"  {len(rows)} NASA GLC events in South Korea", flush=True)


STEPS = {"bounds": bounds, "mask": _sk_mask90, "dem": dem, "slope30": slope30, "worldcover": worldcover, "hansen": hansen, "s2": s2, "rain": rain, "osm": osm, "glc": glc}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=",".join(STEPS))
    ap.add_argument("--periods", default="")
    args = ap.parse_args()
    print(f"grid {W90} x {H90} px at {RES} m, {CRS}", flush=True)
    failed = []
    for name in args.only.split(","):
        print(f"[{name}]", flush=True)
        t = time.time()
        try:
            if name in ("s2", "s2fill") and args.periods:
                s2(args.periods.split(","), resume=name == "s2fill")
            else:
                STEPS[name]()
        except Exception as ex:  # keep going; report at the end
            import traceback; traceback.print_exc()
            print(f"  FAILED: {type(ex).__name__}: {ex}", flush=True)
            failed.append(name)
        print(f"  [{name}] {time.time() - t:.0f} s", flush=True)
    print("done. failed:", failed or "none", flush=True)
    sys.exit(1 if failed else 0)
