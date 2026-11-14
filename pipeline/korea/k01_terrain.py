"""Stage K1: terrain features for all of South Korea on the 90 m grid.

Slope for the slope units comes from the 30 m DEM (averaged onto 90 m by scripts/download_korea.py's slope30 step)
when it is there; flow paths, curvature, relief and wetness come from the 90 m DEM.
Output: data/korea/work/terrain.npz"""
import heapq
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from numba import njit
from scipy import ndimage as ndi

from common_kr import PUB, WORK, H90, W90, RES, read

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))


@njit(cache=True)
def priority_flood(z, eps):
    """Barnes priority-flood with epsilon: fills pits so every cell drains to the edge or the sea."""
    h, w = z.shape
    out = z.copy()
    done = np.zeros((h, w), np.bool_)
    heap = [(0.0, 0)][:0]
    for i in range(h):
        for j in range(w):
            if i == 0 or j == 0 or i == h - 1 or j == w - 1 or z[i, j] <= 0.0:
                heapq.heappush(heap, (out[i, j], i * w + j))
                done[i, j] = True
    while len(heap) > 0:
        zc, idx = heapq.heappop(heap)
        i, j = idx // w, idx % w
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                ni, nj = i + di, j + dj
                if (di != 0 or dj != 0) and 0 <= ni < h and 0 <= nj < w and not done[ni, nj]:
                    done[ni, nj] = True
                    if out[ni, nj] <= zc:
                        out[ni, nj] = zc + eps
                    heapq.heappush(heap, (out[ni, nj], ni * w + nj))
    return out


@njit(cache=True)
def d8(zf):
    h, w = zf.shape
    recv = np.full(h * w, -1, np.int32)
    for i in range(h):
        for j in range(w):
            if zf[i, j] <= 0.0:
                continue                                   # sea: outlet
            best, bi = 0.0, -1
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    ni, nj = i + di, j + dj
                    if (di != 0 or dj != 0) and 0 <= ni < h and 0 <= nj < w:
                        d = (zf[i, j] - zf[ni, nj]) / (1.41421356 if di != 0 and dj != 0 else 1.0)
                        if d > best:
                            best, bi = d, ni * w + nj
            recv[i * w + j] = bi
    return recv


@njit(cache=True)
def accumulate(order, recv):
    acc = np.ones(recv.size, np.float32)
    for k in range(order.size):
        c = order[k]
        r = recv[c]
        if r >= 0:
            acc[r] += acc[c]
    return acc


dem = read(PUB / "dem_90m.tif").astype("float64")
assert dem.shape == (H90, W90), dem.shape
dem[~np.isfinite(dem) | (dem < -100)] = 0.0
dem = np.maximum(dem, 0.0)
gy, gx = np.gradient(ndi.gaussian_filter(dem, 0.6), RES)
dzdx, dzdy = gx, -gy
slope90 = np.degrees(np.arctan(np.hypot(dzdx, dzdy))).astype("float32")
aspect = (np.degrees(np.arctan2(-dzdx, -dzdy)) % 360).astype("float32")
if (PUB / "slope30_90m.tif").exists():
    slope = read(PUB / "slope30_90m.tif").astype("float32")
    steep = read(PUB / "steep30_90m.tif").astype("float32")
    bad = ~np.isfinite(slope)
    slope[bad] = slope90[bad]; steep[bad] = (slope90[bad] > 30)
    print("slope from the 30 m DEM", flush=True)
else:
    slope = slope90; steep = (slope90 > 25).astype("float32")
    print("slope from the 90 m DEM (30 m slope not downloaded)", flush=True)
curv = (ndi.laplace(ndi.gaussian_filter(dem, 1.0)) / RES**2 * 1000).astype("float32")
relief = (ndi.maximum_filter(dem, 5) - ndi.minimum_filter(dem, 5)).astype("float32")            # 450 m window
tpi = (dem - ndi.uniform_filter(dem, 11)).astype("float32")                                    # vs 1 km mean
print("slope done", flush=True)

zf = priority_flood(dem, 1e-3)
recv = d8(zf)
order = np.argsort(-zf.ravel(), kind="stable").astype(np.int64)
acc = accumulate(order, recv).reshape(H90, W90)
del order, zf
twi = np.log((acc * RES) / np.tan(np.radians(np.maximum(slope90, 0.5)))).astype("float32")
stream = (acc > 25) & (dem > 0)                         # > 0.2 km2 upstream
dstream = (ndi.distance_transform_edt(~stream) * RES).astype("float32")
print("flow done; stream frac", stream.mean(), flush=True)

np.savez(WORK / "terrain.npz", dem=dem.astype("float32"), slope=slope, slope90=slope90, steep=steep, aspect=aspect,
         dzdx=dzdx.astype("float32"), dzdy=dzdy.astype("float32"), curv=curv, relief=relief, tpi=tpi, twi=twi,
         dstream=dstream, recv=recv.reshape(H90, W90), acc=acc)
land = dem > 0
print("land slope pct [50,90,99]:", np.percentile(slope[land][::13], [50, 90, 99]).round(1))
