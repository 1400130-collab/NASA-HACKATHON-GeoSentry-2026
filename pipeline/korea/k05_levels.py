"""Stage K5: what sits below each slope, and the inspection level (the regional rule, applied nationwide).

  level 0  radar can't see it    inside the NISAR footprint, no track can measure it (and no high rank)
  level 1  nothing flagged       no measured movement (or no radar there) and not in the top 20%
  level 2  watch                 movement, or top 20% susceptibility nationwide
  level 3  check first           movement or top 5% nationwide, with a building or main road within the slope's debris reach
"Debris reach" is per slope: simulated on the GPU where the physics was run, predicted by ML model 3 (k04b, an emulator of
that simulation) everywhere else. Without k04b's output every slope gets the old fixed ~360 m.
Movement exists only where NISAR was processed (North Gyeongsang); everywhere else the level rests on the ranking.
Output: data/korea/work/levels.npz, level_stats.json"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from pyproj import Transformer
from rasterio import features

from common_kr import PUB, WORK, CRS, H90, W90, H180, W180, X0, Y1, transform90, write_json

U = np.load(WORK / "units.npz"); Rg = np.load(WORK / "region.npz"); Su = np.load(WORK / "suscept.npz")
T = np.load(WORK / "terrain.npz", mmap_mode="r")
N = U["h3"].size
tf = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)

# buildings per 90 m cell, main roads rasterised on 90 m
B = np.load(PUB / "osm_buildings.npz")
bx, by = tf.transform(B["lon"], B["lat"])
bi, bj = ((Y1 - by) // 90).astype(np.int64), ((bx - X0) // 90).astype(np.int64)
ok = (bi >= 0) & (bi < H90) & (bj >= 0) & (bj < W90)
bcount = np.bincount(bi[ok] * W90 + bj[ok], minlength=H90 * W90).astype("float32")
roads = json.load(open(PUB / "osm_roads_geom.json"))
MAIN = {"motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link"}
shapes = []
for r in roads:
    if r["highway"] in MAIN and len(r["line"]) >= 2:
        xs, ys = tf.transform([p[0] for p in r["line"]], [p[1] for p in r["line"]])
        shapes.append(({"type": "LineString", "coordinates": list(zip(xs, ys))}, 1))
road90 = features.rasterize(shapes, out_shape=(H90, W90), transform=transform90(), fill=0, dtype="uint8", all_touched=True).ravel()
print(f"buildings on the grid: {ok.sum():,}; road cells: {road90.sum():,}", flush=True)

# follow steepest descent from every 90 m pixel of a slope unit, as far as that unit's debris reach (whole 90 m steps,
# 1 to 6); 4 steps (~360 m) for every unit when there is no reach file
HAVE_REACH = (WORK / "reach.npz").exists()
reach = np.load(WORK / "reach.npz")["reach"] if HAVE_REACH else np.full(N, 360.0, "float32")
steps_u = np.clip(np.ceil(np.nan_to_num(reach, nan=360.0) / 90), 1, 6).astype(np.int64)
uid180 = U["uid180"]
uid90 = np.repeat(np.repeat(uid180, 2, 0), 2, 1)
uid90 = np.pad(uid90, ((0, H90 - uid90.shape[0]), (0, W90 - uid90.shape[1]))).ravel()
recv = np.asarray(T["recv"]).ravel()
src = np.where(uid90 > 0)[0]
unit = uid90[src].astype(np.int64) - 1
keep = U["is_slope"][unit]
cur = src[keep].astype(np.int64); unit = unit[keep]
pairs, pairs_old = [], []
for step in range(7):
    alive = cur >= 0
    key = unit[alive] * (H90 * W90) + cur[alive]
    pairs.append(np.unique(key[steps_u[unit[alive]] >= step]))
    if step <= 4: pairs_old.append(np.unique(key))                       # the fixed 360 m, kept to show what the reach changes
    nxt = cur.copy(); nxt[alive] = recv[cur[alive]]; cur = nxt


def below(prs):
    p = np.unique(np.concatenate(prs))
    pu, pc = p // (H90 * W90), p % (H90 * W90)
    return np.bincount(pu, bcount[pc], N).astype("float32"), np.bincount(pu, road90[pc], N) > 0


bld_below, road_below = below(pairs)
bld_360, road_360 = below(pairs_old)
s = U["is_slope"]
print(f"slope units with a building below: {(bld_below[s] > 0).sum():,}; with a main road below: {road_below[s].sum():,}", flush=True)

moving = Rg["moving"].copy()                      # the regional rule (downslope rate from the time-series inversion >= 4 error bars above zero AND the GRU detector agrees), any child slope
pct = np.nan_to_num(Su["pct"])
exposed = (bld_below > 0) | road_below
level = np.zeros(N, np.uint8)
radar_blind = Rg["inreg"] & (Rg["n_meas"] == 0)
level[s & ~radar_blind] = 1
level[s & (moving | (pct >= 0.80))] = 2
level[s & (moving | (pct >= 0.95)) & exposed] = 3
counties = json.load(open(WORK / "counties.json")); provinces = json.load(open(WORK / "provinces.json"))
S = {"slope_units": int(s.sum()), "moving_units": int((moving & s).sum()), "z_rule_units": int((Rg["moving"] & s).sum()),
     "levels": {k: int((level[s] == v).sum()) for k, v in [("not_measurable", 0), ("no_signal", 1), ("watch", 2), ("check_first", 3)]},
     "check_first_by_county": {str(c["id"]): int(((level == 3) & (U["county"] == c["id"])).sum()) for c in counties if ((level == 3) & (U["county"] == c["id"])).any()},
     "check_first_by_province": {p_["en"]: int(((level == 3) & (U["prov"] == p_["id"])).sum()) for p_ in provinces},
     "watch_by_province": {p_["en"]: int(((level == 2) & (U["prov"] == p_["id"])).sum()) for p_ in provinces},
     "slopes_by_province": {p_["en"]: int((s & (U["prov"] == p_["id"])).sum()) for p_ in provinces},
     "check_first_moving": int(((level == 3) & moving).sum()),
     "radar_units": int((s & Rg["inreg"]).sum()), "radar_measured": int((s & (Rg["n_meas"] > 0)).sum()),
     "buildings_mapped": int(ok.sum()), "units_building_below": int((bld_below[s] > 0).sum()), "units_road_below": int(road_below[s].sum())}
hz_ = s & (moving | (pct >= 0.95)); e360 = (bld_360 > 0) | road_360
S["reach"] = {"used": bool(HAVE_REACH), "check_first_fixed_360m": int((hz_ & e360).sum()), "dropped": int((hz_ & e360 & ~exposed).sum()),
              "added": int((hz_ & ~e360 & exposed).sum()), "flagged": int(hz_.sum()),
              "steps_share": {str(k): float((steps_u[s] == k).mean()) for k in range(1, 7)}}
print(json.dumps({k: S[k] for k in ("slope_units", "moving_units", "levels", "check_first_by_province")}, ensure_ascii=False), flush=True)
# The danger index (0-100): the number the site shows and ranks by. Its bands are the levels, so it never disagrees
# with them: check first 80-100 (60% slope, 40% what is below), watch 50-79, the rest 0-49. Movement counts as the
# maximum slope part. Keep in step with site/js/score.js.
hz = np.where(moving, 100.0, pct * 100)
ex = np.minimum(100, np.round(80 * np.log1p(np.minimum(bld_below, 30)) / np.log(31) + 20 * road_below))
prio = np.where(level == 3, 80 + 20 * (0.6 * np.clip((hz - 95) / 5, 0, 1) + 0.4 * ex / 100),
                np.where(level == 2, 50 + 29.4 * np.clip((hz - 80) / 20, 0, 1), np.minimum(49.4, 49.4 * hz / 80)))
np.savez_compressed(WORK / "levels.npz", level=level, moving=moving, bld_below=bld_below, road_below=road_below, prio=prio.astype("float32"))
np.save(WORK / "bcount90.npy", bcount.reshape(H90, W90))
write_json(WORK / "level_stats.json", S)
