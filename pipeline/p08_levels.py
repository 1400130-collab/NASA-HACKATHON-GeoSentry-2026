"""Stage G: what sits below each slope, and the inspection level (a fixed readable rule, not a probability).
Output: data/work/levels.npz, data/work/level_stats.json"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from pyproj import Transformer
from rasterio import features
from rasterio.transform import from_origin
from common import PUB, WORK, load, save, write_json, X0, Y1, CRS, H20, W20

U = load("units"); T = load("terrain"); Sx = load("series"); A = load("anomaly"); Su = load("suscept")
N = U["h3"].size
H40, W40 = H20 // 2, W20 // 2
tf = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)

# buildings (way centres) and main roads on the 40 m grid
els = json.load(open(PUB / "osm_buildings_roads.json"))
b = np.array([(e["center"]["lon"], e["center"]["lat"]) for e in els if "building" in e.get("tags", {})])
bx, by = tf.transform(b[:, 0], b[:, 1])
bi, bj = ((Y1 - by) // 40).astype(int), ((bx - X0) // 40).astype(int)
ok = (bi >= 0) & (bi < H40) & (bj >= 0) & (bj < W40)
bcount = np.bincount(bi[ok] * W40 + bj[ok], minlength=H40 * W40)
roads = json.load(open(PUB / "osm_roads_geom.json"))
shapes = []
for r in roads:
    xs, ys = tf.transform([p[0] for p in r["line"]], [p[1] for p in r["line"]])
    if len(xs) >= 2:
        shapes.append(({"type": "LineString", "coordinates": list(zip(xs, ys))}, 1))
road40 = features.rasterize(shapes, out_shape=(H40, W40), transform=from_origin(X0, Y1, 40, 40), fill=0, dtype="uint8").ravel()

# follow the steepest-descent path 300 m (15 steps of 20 m) from every other pixel
recv = T["recv"].ravel()
ii, jj = np.meshgrid(np.arange(0, H20, 2), np.arange(0, W20, 2), indexing="ij")
unit = U["uid40"][ii // 2, jj // 2].ravel()
src = U["is_slope"][unit]
cur = (ii * W20 + jj).ravel()[src]; unit = unit[src].astype(np.int64)
pairs = []
for step in range(16):
    alive = cur >= 0
    cell = (cur[alive] // W20 // 2) * W40 + (cur[alive] % W20) // 2
    pairs.append(np.unique(unit[alive] * (H40 * W40) + cell))
    cur[alive] = recv[cur[alive]]
p = np.unique(np.concatenate(pairs))
pu, pc = p // (H40 * W40), p % (H40 * W40)
bld_below = np.bincount(pu, bcount[pc], N).astype("float32")
road_below = np.bincount(pu, road40[pc], N) > 0
print("buildings mapped:", int(ok.sum()), "| slope units with a building below:", int((bld_below[U["is_slope"]] > 0).sum()),
      "with a main road below:", int(road_below[U["is_slope"]].sum()), flush=True)

# movement: above the noise floor (p04 rule) AND consistent with downslope movement (detector, top 5%)
z_rule = Sx["moving"]
det = np.nan_to_num(A["detector_pct"])
moving = z_rule & (det >= 0.95)
pct = np.nan_to_num(Su["pct"])
exposed = (bld_below > 0) | road_below
level = np.zeros(N, np.uint8)                             # 0 not measurable, 1 no signal, 2 watch, 3 check first
s = U["is_slope"]
level[s & (Sx["n_meas"] > 0)] = 1
level[s & (moving | (pct >= 0.80))] = 2
level[s & (moving | (pct >= 0.95)) & exposed] = 3
names = json.load(open(WORK / "counties.json"))
S = {"slope_units": int(s.sum()), "z_rule_units": int((z_rule & s).sum()), "moving_units": int((moving & s).sum()),
     "levels": {k: int((level[s] == v).sum()) for k, v in [("not_measurable", 0), ("no_signal", 1), ("watch", 2), ("check_first", 3)]},
     "check_first_by_county": {nm: int(((level == 3) & (U["county"] == i + 1)).sum()) for i, nm in enumerate(names) if ((level == 3) & (U["county"] == i + 1)).any()},
     "check_first_moving": int(((level == 3) & moving).sum()),
     "buildings_mapped": int(ok.sum()), "units_building_below": int((bld_below[s] > 0).sum()), "units_road_below": int(road_below[s].sum())}
print(S)
# The danger index (0-100): the number the site shows and ranks by. Its bands are the levels, so it never disagrees
# with them: check first 80-100 (60% slope, 40% what is below), watch 50-79, the rest 0-49. Movement counts as the
# maximum slope part. Keep in step with site/js/score.js.
hz = np.where(moving, 100.0, pct * 100)
ex = np.minimum(100, np.round(80 * np.log1p(np.minimum(bld_below, 30)) / np.log(31) + 20 * road_below))
prio = np.where(level == 3, 80 + 20 * (0.6 * np.clip((hz - 95) / 5, 0, 1) + 0.4 * ex / 100),
                np.where(level == 2, 50 + 29.4 * np.clip((hz - 80) / 20, 0, 1), np.minimum(49.4, 49.4 * hz / 80)))
save("levels", level=level, moving=moving, bld_below=bld_below, road_below=road_below, prio=prio.astype("float32"))
write_json(WORK / "level_stats.json", S)
