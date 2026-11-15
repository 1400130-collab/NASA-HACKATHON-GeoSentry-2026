"""Cut the real-world layers into the 4 km tiles the 3D map streams (site/data/world/t/<tx>_<tz>.bin.gz).

In   data/world/raw/*.parquet        (scripts/download_world.py: Overture Maps = OpenStreetMap + Shi et al. 2024 footprints)
     data/world/raster/*.npy, .npz   (w01_rasters.py: ESA WorldCover, NASA GEDI canopy height, GHSL building height)
Out  site/data/world/t/*.bin.gz, site/data/world/index.json

One tile, little endian, gzip'd (coordinates are int16 steps of 0.25 m from the tile's north-west corner, x east, y south;
inside a ring the first vertex is absolute and the rest are differences):
  u32 x 8   'SWT1', nB, nBv, nL, nLv, nP, nPr, nPv
  buildings (largest first, so a prefix is a coarser level of detail)
            u8 nv[nB] · u8 cls[nB] · u16 height_dm[nB] · i16 xy[2 nBv]
  lines     u8 cls[nL] · u16 nv[nL] · i16 xy[2 nLv]            roads 0-6, rail 10, river 20, stream 21, canal 22
  polygons  u8 cls[nP] · u8 rings[nP] · u16 nv[nPr] · i16 xy[2 nPv]   water 30, land use 40-48, sand 50, rock 51, wetland 52
  ground    u8[80 x 80]   land-cover class << 4 | canopy height / 2 m

Run:  .venv/bin/python -I pipeline/world/w02_tiles.py [--only buildings,lines,polys] [--limit-bbox w,s,e,n]
"""
import argparse
import gzip
import json
import os
import shutil
import struct
import sys
import time

import duckdb
import numpy as np
import shapely
from pyproj import Transformer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common_w import (CRS, X0, Y1, WM, HM, TILE, NTX, NTZ, CELL, NC, Q, RAW, RASTER, OUT, REGION, LC_NAMES, PALETTE, sk_mask)  # noqa: E402

TDIR = OUT / "t"
WORK = RASTER.parent / "work"
WORK.mkdir(exist_ok=True)
LL2K = Transformer.from_crs(4326, CRS, always_xy=True)
LL2MOLL = Transformer.from_crs(4326, "ESRI:54009", always_xy=True)
MASK, MPP = sk_mask()
MARGIN = 40.0                                                    # features are cut this far outside their tile
CHUNK = 250_000

ROAD = {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4, "residential": 5, "unclassified": 5, "living_street": 5,
        "service": 6, "track": 6}
WATER_LINE = {"river": 20, "stream": 21, "canal": 22}
WATER_POLY_SKIP = {"ocean", "physical", "human_made", "spring"}
LAND_USE = {"agriculture": 40, "horticulture": 41, "park": 42, "recreation": 42, "golf": 42, "managed": 42, "protected": 42,
            "residential": 43, "developed": 44, "construction": 44, "transportation": 44, "education": 46, "medical": 46,
            "military": 46, "religious": 46, "cemetery": 47, "resource_extraction": 48, "landfill": 48}
LAND_USE_CLASS = {"commercial": 45, "retail": 45, "farmyard": 43, "greenhouse_horticulture": 44}
LAND = {"sand": 50, "rock": 51, "wetland": 52}
BCLASS = {"residential": 1, "commercial": 2, "industrial": 3, "agricultural": 5, "civic": 4, "education": 4, "medical": 4, "religious": 4,
          "military": 4, "transportation": 3, "service": 3, "entertainment": 2, "outbuilding": 1}


def to_grid(c):
    """lon/lat -> metres east of X0 and south of Y1."""
    x, y = LL2K.transform(c[:, 0], c[:, 1])
    return np.column_stack([x - X0, Y1 - y])


def land_at(mx, mz):
    """Mask value under points on the grid: > 200 South Korea, about 128 another country, 0 sea."""
    j = np.clip((mx / MPP).astype(int), 0, MASK.shape[1] - 1); i = np.clip((mz / MPP).astype(int), 0, MASK.shape[0] - 1)
    return MASK[i, j]


def near_korea(mx, mz, r=2):
    """True within r mask pixels (360 m) of South Korean land: keeps piers and shore buildings, drops other countries."""
    j = np.clip((mx / MPP).astype(int), r, MASK.shape[1] - 1 - r); i = np.clip((mz / MPP).astype(int), r, MASK.shape[0] - 1 - r)
    best = np.zeros(len(mx), "uint8")
    for di in (-r, 0, r):
        for dj in (-r, 0, r):
            best = np.maximum(best, MASK[i + di, j + dj])
    return (best > 200) & (land_at(mx, mz) != 128) | (land_at(mx, mz) > 200)


def rows(name, cols, where=""):
    con = duckdb.connect(); con.execute("LOAD spatial")
    cur = con.execute(f"SELECT ST_AsWKB(geometry) AS g, {cols} FROM read_parquet('{RAW / (name + '.parquet')}') {where}")
    while True:
        chunk = cur.fetchmany(CHUNK)
        if not chunk:
            return
        yield chunk


# ---- buildings ------------------------------------------------------------------------------------------------
def building_heights(lon, lat, height, floors, area):
    """Metres. The footprint's own height or floor count where it has one, else the GHSL mean building height of its
    100 m cell, else one storey (two for a big footprint)."""
    A = np.load(RASTER / "anbh100.npz")
    mx, my = LL2MOLL.transform(lon, lat)
    anbh = np.zeros(len(lon), "float32")
    for rc in ("R5_C30", "R6_C30"):
        a = A[rc]; x0, y1, res = A[rc + "_t"]
        j = np.floor((mx - x0) / res).astype(int); i = np.floor((y1 - my) / res).astype(int)
        ok = (i >= 0) & (j >= 0) & (i < a.shape[0]) & (j < a.shape[1])
        anbh[ok] = np.maximum(anbh[ok], a[i[ok], j[ok]])
    h = np.where(area > 400, 6.5, 3.6).astype("float32")
    src = np.zeros(len(lon), "uint8")                           # 0 default, 1 GHSL, 2 floors, 3 measured height
    f = anbh >= 2.5; h[f] = np.maximum(anbh[f], 3.2); src[f] = 1
    small = (area < 45) & (src == 1); h[small] = np.minimum(h[small], 4.5)       # sheds do not share the tower's height
    f = np.isfinite(floors) & (floors > 0); h[f] = floors[f] * 3.1 + 1.0; src[f] = 2
    f = np.isfinite(height) & (height > 1.5); h[f] = height[f]; src[f] = 3
    return np.clip(h, 2.5, 600), src


def buildings(bbox=None):
    t0 = time.time()
    where = f"WHERE x1 > {bbox[0]} AND x0 < {bbox[2]} AND y1 > {bbox[1]} AND y0 < {bbox[3]}" if bbox else ""
    out = {k: [] for k in ("tile", "imp", "nv", "cls", "h", "xy", "src")}
    total = kept = 0
    for chunk in rows("buildings", "height, num_floors, class, subtype, ds", where):
        total += len(chunk)
        g = shapely.from_wkb([r[0] for r in chunk])
        height = np.array([r[1] if r[1] is not None else np.nan for r in chunk], "float32")
        floors = np.array([r[2] if r[2] is not None else np.nan for r in chunk], "float32")
        cls = np.array([BCLASS.get(r[4] or "", 0) if not (r[3] in ("greenhouse", "farm_auxiliary", "barn", "shed")) else 5 for r in chunk], "uint8")
        # a multipolygon is a few detached blocks: each becomes its own building
        parts, pi = shapely.get_parts(g, return_index=True)
        f = shapely.get_type_id(parts) == 3
        parts, pi = parts[f], pi[f]
        ll = shapely.get_coordinates(shapely.centroid(parts))
        poly = shapely.polygons(shapely.get_exterior_ring(parts))                  # courtyards are filled in
        poly = shapely.transform(poly, to_grid)
        poly = shapely.simplify(poly, 0.7, preserve_topology=True)
        area = shapely.area(poly)
        c = shapely.get_coordinates(shapely.centroid(poly))
        nvert = shapely.get_num_coordinates(poly) - 1
        many = nvert > 48                                                           # a few traced outlines have hundreds of points
        if many.any():
            poly[many] = shapely.simplify(poly[many], 3.0, preserve_topology=True); nvert = shapely.get_num_coordinates(poly) - 1
        ok = (area >= 14) & (nvert >= 3) & (nvert <= 250) & (c[:, 0] >= 0) & (c[:, 1] >= 0) & (c[:, 0] < WM) & (c[:, 1] < HM)
        ok &= near_korea(np.nan_to_num(c[:, 0]), np.nan_to_num(c[:, 1]))
        poly, pi, area, c, ll, nvert = poly[ok], pi[ok], area[ok], c[ok], ll[ok], nvert[ok]
        if not len(poly):
            continue
        h, src = building_heights(ll[:, 0], ll[:, 1], height[pi], floors[pi], area)
        xy, idx = shapely.get_coordinates(shapely.get_exterior_ring(poly), return_index=True)
        last = np.r_[idx[1:] != idx[:-1], True]                                    # drop each ring's closing vertex
        xy = xy[~last]
        tx = (c[:, 0] // TILE).astype(np.int32); tz = (c[:, 1] // TILE).astype(np.int32)
        out["tile"].append(tz * NTX + tx); out["imp"].append((area * (1 + h / 12)).astype("float32")); out["nv"].append(nvert.astype("uint8"))
        out["cls"].append(cls[pi]); out["h"].append(np.round(h * 10).astype("uint16")); out["src"].append(src)
        out["xy"].append(np.round(xy / Q).astype(np.int32))
        kept += len(poly)
        print(f"  buildings {total:,} read, {kept:,} kept  {time.time() - t0:.0f} s", flush=True)
    o = {k: np.concatenate(v) for k, v in out.items()}
    order = np.lexsort((-o["imp"], o["tile"]))
    start = np.r_[0, np.cumsum(o["nv"].astype(np.int64))]
    # reorder the vertex stream to follow the building order
    lens = o["nv"][order].astype(np.int64)
    src_start = start[:-1][order]
    take = np.repeat(src_start - np.r_[0, np.cumsum(lens)[:-1]], lens) + np.arange(lens.sum())
    np.savez(WORK / "buildings.npz", tile=o["tile"][order], nv=o["nv"][order], cls=o["cls"][order], h=o["h"][order], xy=o["xy"][take], src=o["src"][order])
    hs = o["src"]
    print(f"buildings: {kept:,} of {total:,}; height from footprint {int((hs == 3).sum()):,}, floors {int((hs == 2).sum()):,}, "
          f"GHSL {int((hs == 1).sum()):,}, default {int((hs == 0).sum()):,}", flush=True)


# ---- lines and polygons ---------------------------------------------------------------------------------------
def spread(geoms, cls, kind):
    """Assign each feature to every tile its box touches and cut it to that tile (plus a margin).
    Returns parts, their class and tile key."""
    b = shapely.bounds(geoms)
    tx0 = np.clip(((b[:, 0] - MARGIN) // TILE).astype(int), 0, NTX - 1); tx1 = np.clip(((b[:, 2] + MARGIN) // TILE).astype(int), 0, NTX - 1)
    tz0 = np.clip(((b[:, 1] - MARGIN) // TILE).astype(int), 0, NTZ - 1); tz1 = np.clip(((b[:, 3] + MARGIN) // TILE).astype(int), 0, NTZ - 1)
    one = (tx0 == tx1) & (tz0 == tz1)
    fi = [np.nonzero(one)[0]]; tk = [tz0[one] * NTX + tx0[one]]
    multi = np.nonzero(~one)[0]
    mf, mt = [], []
    for i in multi:
        for tz in range(tz0[i], tz1[i] + 1):
            for tx in range(tx0[i], tx1[i] + 1):
                mf.append(i); mt.append(tz * NTX + tx)
    parts = [geoms[one]]; pcls = [cls[one]]; pt = [tk[0]]
    if mf:
        mf = np.array(mf); mt = np.array(mt)
        tx = mt % NTX; tz = mt // NTX
        boxes = shapely.box(tx * TILE - MARGIN, tz * TILE - MARGIN, (tx + 1) * TILE + MARGIN, (tz + 1) * TILE + MARGIN)
        cut = shapely.intersection(geoms[mf], boxes)
        p, pi = shapely.get_parts(cut, return_index=True)
        f = shapely.get_type_id(p) == (1 if kind == "line" else 3)
        f &= ~shapely.is_empty(p)
        parts.append(p[f]); pcls.append(cls[mf][pi[f]]); pt.append(mt[pi[f]])
    return np.concatenate(parts), np.concatenate(pcls), np.concatenate(pt)


def keep_korea(geoms):
    c = shapely.get_coordinates(shapely.point_on_surface(geoms)) if len(geoms) else np.zeros((0, 2))
    v = land_at(np.nan_to_num(c[:, 0]), np.nan_to_num(c[:, 1]))
    b = shapely.bounds(geoms)
    return ((v > 200) | (v < 64)) & (b[:, 2] > 0) & (b[:, 3] > 0) & (b[:, 0] < WM) & (b[:, 1] < HM)


def lines(bbox=None):
    t0 = time.time()
    where = f"WHERE x1 > {bbox[0]} AND x0 < {bbox[2]} AND y1 > {bbox[1]} AND y0 < {bbox[3]}" if bbox else ""
    acc = {"tile": [], "cls": [], "nv": [], "xy": []}

    def add(g, cls, tol):
        f = np.isin(shapely.get_type_id(g), (1, 5)); g, cls = g[f], cls[f]
        p, pi = shapely.get_parts(g, return_index=True); cls = cls[pi]
        p = shapely.transform(p, to_grid)
        p = shapely.simplify(p, tol, preserve_topology=False)
        f = ~shapely.is_empty(p) & (shapely.length(p) > 8); p, cls = p[f], cls[f]
        f = keep_korea(p); p, cls = p[f], cls[f]
        parts, pcls, pt = spread(p, cls, "line")
        if not len(parts):
            return
        xy, idx = shapely.get_coordinates(parts, return_index=True)
        nv = np.bincount(idx, minlength=len(parts))
        f = (nv >= 2) & (nv < 65000)
        if not f.all():
            keep = f[idx]; xy = xy[keep]; parts, pcls, pt, nv = parts[f], pcls[f], pt[f], nv[f]
        acc["tile"].append(pt); acc["cls"].append(pcls.astype("uint8")); acc["nv"].append(nv.astype("uint16")); acc["xy"].append(np.round(xy / Q).astype(np.int32))

    n = 0
    for chunk in rows("segment", "subtype, class, flags, rflags", where):
        g = shapely.from_wkb([r[0] for r in chunk])
        cls = np.full(len(chunk), 255, "uint8")
        for i, r in enumerate(chunk):
            if r[1] == "road":
                if r[3] and "is_tunnel" in r[3]:
                    continue
                cls[i] = ROAD.get(r[2] or "", 255)
            elif r[1] == "rail":
                if (r[4] and "is_tunnel" in r[4]) or r[2] in ("subway", "monorail", "funicular"):
                    continue
                cls[i] = 10
        f = cls < 255
        add(g[f], cls[f], 1.5)
        n += int(f.sum()); print(f"  lines: {n:,} road and rail segments  {time.time() - t0:.0f} s", flush=True)
    for chunk in rows("water", "subtype, class, is_intermittent", where):
        g = shapely.from_wkb([r[0] for r in chunk])
        cls = np.array([WATER_LINE.get(r[1] or "", 255) if r[2] not in ("ditch", "drain") else 255 for r in chunk], "uint8")
        f = cls < 255
        add(g[f], cls[f], 2.5)
        n += int(f.sum()); print(f"  lines: + waterways, {n:,}  {time.time() - t0:.0f} s", flush=True)
    o = {k: np.concatenate(v) for k, v in acc.items()}
    save_sorted("lines", o, (o["cls"],))


def polys(bbox=None):
    t0 = time.time()
    where = f"WHERE x1 > {bbox[0]} AND x0 < {bbox[2]} AND y1 > {bbox[1]} AND y0 < {bbox[3]}" if bbox else ""
    acc = {"tile": [], "cls": [], "nr": [], "nv": [], "xy": []}

    def add(g, cls, tol, min_area):
        f = np.isin(shapely.get_type_id(g), (3, 6)); g, cls = g[f], cls[f]
        p, pi = shapely.get_parts(g, return_index=True); cls = cls[pi]
        p = shapely.transform(p, to_grid)
        p = shapely.make_valid(shapely.simplify(p, tol, preserve_topology=True))
        p, pi = shapely.get_parts(p, return_index=True); cls = cls[pi]
        f = (shapely.get_type_id(p) == 3) & (shapely.area(p) >= min_area); p, cls = p[f], cls[f]
        f = keep_korea(p); p, cls = p[f], cls[f]
        parts, pcls, pt = spread(p, cls, "poly")
        if not len(parts):
            return
        rings, ri = shapely.get_rings(parts, return_index=True)
        xy, idx = shapely.get_coordinates(rings, return_index=True)
        last = np.r_[idx[1:] != idx[:-1], True]; xy = xy[~last]
        rnv = np.bincount(idx, minlength=len(rings)) - 1
        nr = np.bincount(ri, minlength=len(parts))
        bad = (nr > 255) | (np.bincount(ri, weights=(rnv > 65000) | (rnv < 3), minlength=len(parts)) > 0)
        if bad.any():                                           # absurd outlines: keep only the outer ring, simplified hard
            fix = shapely.polygons(shapely.get_exterior_ring(shapely.simplify(parts[bad], 25, preserve_topology=True)))
            parts[bad] = fix
            f = (shapely.get_type_id(parts) == 3) & ~shapely.is_empty(parts) & (shapely.get_num_coordinates(parts) < 65000) & (shapely.get_num_coordinates(parts) > 3)
            parts, pcls, pt = parts[f], pcls[f], pt[f]
            rings, ri = shapely.get_rings(parts, return_index=True)
            xy, idx = shapely.get_coordinates(rings, return_index=True)
            last = np.r_[idx[1:] != idx[:-1], True]; xy = xy[~last]
            rnv = np.bincount(idx, minlength=len(rings)) - 1
            nr = np.bincount(ri, minlength=len(parts))
        acc["tile"].append(pt); acc["cls"].append(pcls.astype("uint8")); acc["nr"].append(nr.astype("uint8")); acc["nv"].append(rnv.astype("uint16"))
        acc["xy"].append(np.round(xy / Q).astype(np.int32))

    n = 0
    for chunk in rows("water", "subtype, class", where):
        g = shapely.from_wkb([r[0] for r in chunk])
        cls = np.array([30 if (r[1] not in WATER_POLY_SKIP and r[2] not in ("wastewater", "swimming_pool")) else 255 for r in chunk], "uint8")
        f = cls < 255; add(g[f], cls[f], 2.5, 150)
        n += int(f.sum()); print(f"  polygons: water {n:,}  {time.time() - t0:.0f} s", flush=True)
    for chunk in rows("land_use", "subtype, class", where):
        g = shapely.from_wkb([r[0] for r in chunk])
        cls = np.array([LAND_USE_CLASS.get(r[2] or "", LAND_USE.get(r[1] or "", 255)) for r in chunk], "uint8")
        f = cls < 255; add(g[f], cls[f], 4.0, 400)
        n += int(f.sum()); print(f"  polygons: + land use {n:,}  {time.time() - t0:.0f} s", flush=True)
    for chunk in rows("land", "subtype, class", where):
        g = shapely.from_wkb([r[0] for r in chunk])
        cls = np.array([LAND.get(r[1] or "", 255) for r in chunk], "uint8")
        f = cls < 255
        if f.any():
            add(g[f], cls[f], 4.0, 600)
        n += int(f.sum()); print(f"  polygons: + land {n:,}  {time.time() - t0:.0f} s", flush=True)
    o = {k: np.concatenate(v) for k, v in acc.items()}
    # rings follow their polygon; sort polygons by tile then class (draw order)
    order = np.lexsort((o["cls"], o["tile"]))
    rstart = np.r_[0, np.cumsum(o["nr"].astype(np.int64))]; vstart = np.r_[0, np.cumsum(o["nv"].astype(np.int64))]
    rl = o["nr"][order].astype(np.int64)
    rtake = np.repeat(rstart[:-1][order] - np.r_[0, np.cumsum(rl)[:-1]], rl) + np.arange(rl.sum())
    vl = o["nv"][rtake].astype(np.int64)
    vtake = np.repeat(vstart[:-1][rtake] - np.r_[0, np.cumsum(vl)[:-1]], vl) + np.arange(vl.sum())
    np.savez(WORK / "polys.npz", tile=o["tile"][order], cls=o["cls"][order], nr=o["nr"][order], nv=o["nv"][rtake], xy=o["xy"][vtake])
    print(f"polygons: {len(order):,} parts, {len(rtake):,} rings, {len(vtake):,} vertices", flush=True)


def save_sorted(name, o, keys):
    order = np.lexsort((*keys, o["tile"]))
    start = np.r_[0, np.cumsum(o["nv"].astype(np.int64))]
    lens = o["nv"][order].astype(np.int64)
    take = np.repeat(start[:-1][order] - np.r_[0, np.cumsum(lens)[:-1]], lens) + np.arange(lens.sum())
    np.savez(WORK / f"{name}.npz", tile=o["tile"][order], cls=o["cls"][order], nv=o["nv"][order], xy=o["xy"][take])
    print(f"{name}: {len(order):,} parts, {len(take):,} vertices", flush=True)


# ---- tiles ------------------------------------------------------------------------------------------------------
def delta(xy, nv, origin):
    """Global integer coordinates -> int16, relative to the tile corner, differenced inside each ring."""
    if len(xy) == 0:
        return np.zeros((0, 2), "<i2")
    rel = xy - origin
    d = np.diff(rel, axis=0, prepend=rel[:1])
    first = np.r_[0, np.cumsum(nv.astype(np.int64))[:-1]]
    d[first] = rel[first]
    return np.clip(d, -32768, 32767).astype("<i2")


def region_fit():
    """Cubic polynomials between the nationwide grid (metres from its corner) and the regional map (km from its corner),
    so the regional map can lay the same tiles on its own UTM grid. Exact to a few millimetres over the box."""
    R = REGION
    k2u = Transformer.from_crs(CRS, f"EPSG:{R['epsg']}", always_xy=True)
    u = np.linspace(-0.1, 1.1, 40)
    ux, uy = np.meshgrid(R["x0"] + u * R["w"], R["y1"] - u * R["h"])
    kx, ky = k2u.transform(ux.ravel(), uy.ravel(), direction="INVERSE")
    nat = np.column_stack([kx - X0, Y1 - ky]); reg = np.column_stack([(ux.ravel() - R["x0"]) / 1000, (R["y1"] - uy.ravel()) / 1000])
    c = nat.mean(0); S = 60000.0

    def basis(p, c, s):
        a, b = (p[:, 0] - c[0]) / s, (p[:, 1] - c[1]) / s
        return np.column_stack([np.ones_like(a), a, b, a * a, a * b, b * b, a ** 3, a * a * b, a * b * b, b ** 3])
    fwd = np.linalg.lstsq(basis(nat, c, S), reg, rcond=None)[0]
    rc = reg.mean(0); RS = 60.0
    inv = np.linalg.lstsq(basis(reg, rc, RS), nat, rcond=None)[0]
    e1 = np.abs(basis(nat, c, S) @ fwd - reg).max() * 1000; e2 = np.abs(basis(reg, rc, RS) @ inv - nat).max()
    print(f"region fit: max error {e1 * 1000:.1f} mm forward, {e2 * 1000:.1f} mm inverse", flush=True)
    return {"c": c.tolist(), "s": S, "fx": fwd[:, 0].tolist(), "fz": fwd[:, 1].tolist(),
            "rc": rc.tolist(), "rs": RS, "ix": inv[:, 0].tolist(), "iz": inv[:, 1].tolist()}


def tiles():
    t0 = time.time()
    B = np.load(WORK / "buildings.npz"); L = np.load(WORK / "lines.npz"); P = np.load(WORK / "polys.npz")
    lc = np.load(RASTER / "lc50.npy"); can = np.load(RASTER / "canopy50.npy")
    ground = ((lc << 4) | np.minimum(can // 2, 15)).astype("uint8")
    # no ground outside South Korea: the map shows no data there
    yy = np.minimum(((np.arange(ground.shape[0]) + 0.5) * CELL / MPP).astype(int), MASK.shape[0] - 1)
    xx = np.minimum(((np.arange(ground.shape[1]) + 0.5) * CELL / MPP).astype(int), MASK.shape[1] - 1)
    m50 = MASK[yy][:, xx]
    ground[(m50 > 64) & (m50 <= 200)] = 0
    korea = m50 > 200

    def index(tile, counts):
        """first row and vertex of every tile in a layer sorted by tile"""
        keys, first, cnt = np.unique(tile, return_index=True, return_counts=True)
        v = np.r_[0, np.cumsum(counts.astype(np.int64))]
        return {int(k): (int(f), int(f + c), int(v[f]), int(v[f + c])) for k, f, c in zip(keys, first, cnt)}
    bi = index(B["tile"], B["nv"]); li = index(L["tile"], L["nv"])
    pr = np.r_[0, np.cumsum(P["nr"].astype(np.int64))]; pv = np.r_[0, np.cumsum(P["nv"].astype(np.int64))]
    keys, first, cnt = np.unique(P["tile"], return_index=True, return_counts=True)
    pi = {int(k): (int(f), int(f + c)) for k, f, c in zip(keys, first, cnt)}
    Bxy, Lxy, Pxy = B["xy"], L["xy"], P["xy"]
    Bnv, Bcls, Bh = B["nv"], B["cls"], B["h"]; Lnv, Lcls = L["nv"], L["cls"]; Pnr, Pnv, Pcls = P["nr"], P["nv"], P["cls"]

    if TDIR.exists():
        shutil.rmtree(TDIR)
    TDIR.mkdir(parents=True)
    listed = []; total = 0; nb_total = 0; biggest = (0, "")
    for tz in range(NTZ):
        for tx in range(NTX):
            key = tz * NTX + tx
            g = ground[tz * NC:(tz + 1) * NC, tx * NC:(tx + 1) * NC]
            has_land = korea[tz * NC:(tz + 1) * NC, tx * NC:(tx + 1) * NC].any()
            if not has_land and key not in bi:
                continue
            origin = np.array([tx * TILE / Q, tz * TILE / Q], np.int64)
            parts = []
            b0, b1, bv0, bv1 = bi.get(key, (0, 0, 0, 0)); l0, l1, lv0, lv1 = li.get(key, (0, 0, 0, 0)); p0, p1 = pi.get(key, (0, 0))
            r0, r1 = int(pr[p0]), int(pr[p1]); v0, v1 = int(pv[r0]), int(pv[r1])
            head = struct.pack("<4s7I", b"SWT1", b1 - b0, bv1 - bv0, l1 - l0, lv1 - lv0, p1 - p0, r1 - r0, v1 - v0)
            parts += [head, Bnv[b0:b1].tobytes(), Bcls[b0:b1].tobytes(), Bh[b0:b1].astype("<u2").tobytes(), delta(Bxy[bv0:bv1], Bnv[b0:b1], origin).tobytes()]
            parts += [Lcls[l0:l1].tobytes(), Lnv[l0:l1].astype("<u2").tobytes(), delta(Lxy[lv0:lv1], Lnv[l0:l1], origin).tobytes()]
            parts += [Pcls[p0:p1].tobytes(), Pnr[p0:p1].tobytes(), Pnv[r0:r1].astype("<u2").tobytes(), delta(Pxy[v0:v1], Pnv[r0:r1], origin).tobytes()]
            parts.append(np.ascontiguousarray(g).tobytes())
            raw = gzip.compress(b"".join(parts), 9, mtime=0)
            (TDIR / f"{tx}_{tz}.bin.gz").write_bytes(raw)
            listed.append(key); total += len(raw); nb_total += b1 - b0
            if len(raw) > biggest[0]:
                biggest = (len(raw), f"{tx}_{tz}")
        if tz % 20 == 0:
            print(f"  row {tz}/{NTZ}: {len(listed):,} tiles, {total / 1e6:.0f} MB  {time.time() - t0:.0f} s", flush=True)
    idx = {
        "version": 1, "tile_m": TILE, "q_m": Q, "cells": NC, "ntx": NTX, "ntz": NTZ, "crs": CRS, "x0": X0, "y1": Y1,
        "tiles": listed, "counts": {"tiles": len(listed), "buildings": int(nb_total), "lines": int(len(Lnv)), "polygons": int(len(Pnr))},
        "palette": PALETTE, "lc_names": LC_NAMES, "region": region_fit(),
        "sources": {
            "buildings": "Overture Maps 2026-10-21 (OpenStreetMap, ODbL; Shi et al. 2024 East Asian building footprints, doi:10.5281/zenodo.8174931, CC BY 4.0)",
            "building_height": "footprint height or floors where mapped, otherwise JRC GHSL GHS-BUILT-H R2023A (2018, 100 m)",
            "roads_rail_water_landuse": "OpenStreetMap via Overture Maps 2026-10-21 (ODbL)",
            "land_cover": "ESA WorldCover 2021 v200 (CC BY 4.0)",
            "canopy_height": "GLAD GLCLUC 2020 forest height, from NASA GEDI lidar and Landsat (Potapov et al. 2022)",
        },
    }
    (OUT / "index.json").write_text(json.dumps(idx, separators=(",", ":")))
    print(f"tiles: {len(listed):,}, {total / 1e6:.0f} MB, {nb_total:,} buildings; biggest {biggest[1]} {biggest[0] / 1e6:.2f} MB  {time.time() - t0:.0f} s", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="buildings,lines,polys,tiles")
    ap.add_argument("--limit-bbox", default=None, help="lon/lat w,s,e,n: bake a small area only (for testing)")
    a = ap.parse_args()
    bbox = [float(v) for v in a.limit_bbox.split(",")] if a.limit_bbox else None
    for s in a.only.split(","):
        print(f"== {s}", flush=True)
        {"buildings": lambda: buildings(bbox), "lines": lambda: lines(bbox), "polys": lambda: polys(bbox), "tiles": tiles}[s]()
