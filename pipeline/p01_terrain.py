"""Stage A1: terrain features from the 20 m DEM.
Output: data/work/terrain.npz (slope, aspect, curvature, relief, tpi, twi, dist_stream, receiver)."""
import heapq
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from numba import njit
from scipy import ndimage as ndi
from common import PUB, read, save, H20, W20

RES = 20.0


@njit(cache=True)
def priority_flood(z, eps):
    """Barnes priority-flood with epsilon: fills pits so every cell drains to the edge."""
    h, w = z.shape
    out = z.copy()
    done = np.zeros((h, w), np.bool_)
    heap = [(0.0, 0)][:0]
    for i in range(h):
        for j in range(w):
            if i == 0 or j == 0 or i == h - 1 or j == w - 1:
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
    """Steepest-descent receiver index for every cell (-1 at outlets)."""
    h, w = zf.shape
    recv = np.full(h * w, -1, np.int32)
    for i in range(h):
        for j in range(w):
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


dem = read(PUB / "dem_20m.tif").astype("float64")
assert dem.shape == (H20, W20)
zs = ndi.gaussian_filter(dem, 1.0)                     # the DSM is noisy at 20 m; smooth 1 px
gy, gx = np.gradient(zs, RES)                           # gy: +row = south
dzdx, dzdy = gx, -gy                                    # east, north
slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy))).astype("float32")
aspect = (np.degrees(np.arctan2(-dzdx, -dzdy)) % 360).astype("float32")   # azimuth the slope faces (downhill)
curv = (ndi.laplace(ndi.gaussian_filter(dem, 2.0)) / RES**2 * 1000).astype("float32")  # >0 hollow, <0 ridge
relief = (ndi.maximum_filter(dem, 9) - ndi.minimum_filter(dem, 9)).astype("float32")   # 180 m window
tpi = (dem - ndi.uniform_filter(dem, 51)).astype("float32")                           # vs 1 km mean
print("slope done", flush=True)

zf = priority_flood(dem, 1e-3)
recv = d8(zf)
order = np.argsort(-zf.ravel(), kind="stable").astype(np.int64)
acc = accumulate(order, recv).reshape(H20, W20)
twi = np.log((acc * RES) / np.tan(np.radians(np.maximum(slope, 0.5)))).astype("float32")
stream = acc > 500                                      # > 0.2 km2 upstream
dstream = (ndi.distance_transform_edt(~stream) * RES).astype("float32")
print("flow done; stream frac", stream.mean(), flush=True)

save("terrain", dem=dem.astype("float32"), slope=slope, aspect=aspect, dzdx=dzdx.astype("float32"),
     dzdy=dzdy.astype("float32"), curv=curv, relief=relief, tpi=tpi, twi=twi, dstream=dstream,
     recv=recv.reshape(H20, W20), acc=acc)
print("slope pct [50,90,99]:", np.percentile(slope, [50, 90, 99]).round(1), " >10deg:", (slope > 10).mean().round(3),
      " >15deg:", (slope > 15).mean().round(3))
