"""Stage D: July 2026 storm scar candidates from Sentinel-2 (12 Jun vs 6 Aug, still bare on 2 Oct).

These are AUTOMATIC candidates. The plan's manual check has not been done; if data/work/review.json exists
(exported from site/review.html) its verdicts override the automatic class.
Output: data/work/labels.npz, data/work/candidates.json, data/work/label_stats.json, chips in site/data/chips/"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from scipy import ndimage as ndi
from skimage import measure
from pyproj import Transformer
from common import PUB, WORK, SITE, read, load, save, write_json, X0, Y1, CRS, H20, W20

T = load("terrain"); I = load("s2_idx"); U = load("units")
uid20 = np.repeat(np.repeat(U["uid40"], 2, 0), 2, 1)
wc = read(PUB / "worldcover_2021.tif")
pre, post, octo = I["ndvi_pre"], I["ndvi_post"], I["ndvi_oct"]
drop = pre - post
# Sentinel-2's own cloud mask leaks at cloud edges: buffer it by 200 m and add brightness/shadow tests on 6 Aug.
scl = read(PUB / "s2" / "poststorm_20260806_scl.tif")
red = read(PUB / "s2" / "poststorm_20260806_red.tif").astype("float32") / 1e4
nir = read(PUB / "s2" / "poststorm_20260806_nir.tif").astype("float32") / 1e4
cloudy = np.isin(scl, (0, 1, 3, 8, 9, 10)) | (red > 0.14) | (nir < 0.10)
cloudy = ndi.binary_dilation(ndi.binary_opening(cloudy, np.ones((3, 3))), iterations=10)
land_ok = np.isin(wc, (10, 20, 30, 60))
cand = (drop > 0.20) & (post < 0.55) & (pre > 0.35) & (T["slope"] > 15) & land_ok & np.isfinite(drop) & ~cloudy
still = np.isfinite(octo) & (octo < pre - 0.12)
visible = (pre > 0.35) & (T["slope"] > 15) & land_ok & np.isfinite(drop) & ~cloudy      # where a scar could have been seen at all
cand &= still
drop = np.where(cloudy, np.nan, drop)
lab, n = ndi.label(cand, np.ones((3, 3)))
props = measure.regionprops(lab)
to_ll = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
rows, keep = [], np.zeros(n + 1, np.uint8)       # 0 dropped, 1 likely failure, 2 likely clearing/other
for p in props:
    if p.area < 3:
        continue
    r0, c0 = p.centroid
    sl = T["slope"][lab == p.label] if p.area < 400 else T["slope"][p.slice][p.image]
    asp = T["aspect"][p.slice][p.image]
    asp_m = np.degrees(np.arctan2(np.sin(np.radians(asp)).mean(), np.cos(np.radians(asp)).mean())) % 360
    elong = p.major_axis_length / max(p.minor_axis_length, 1.0)
    # skimage orientation: angle between the row axis and the major axis, counter-clockwise. Row axis points south.
    major_az = (180 - np.degrees(p.orientation)) % 180            # azimuth of the major axis, 0..180
    misalign = min(abs(major_az - asp_m % 180), 180 - abs(major_az - asp_m % 180))
    relief = float(np.ptp(T["dem"][p.slice][p.image]))
    extent = p.area / max(p.bbox_area, 1)
    width_m = p.minor_axis_length * 20
    likely = (p.area <= 150) and ((elong >= 2.0 and misalign <= 35 and width_m <= 120) or (p.area <= 15 and sl.mean() >= 25))
    keep[p.label] = 1 if likely else 2
    lon, lat = to_ll.transform(X0 + 20 * c0 + 10, Y1 - 20 * r0 - 10)
    rows.append({"id": int(p.label), "auto": "failure" if likely else "clearing", "row": float(r0), "col": float(c0), "lat": lat, "lon": lon,
                 "area_m2": int(p.area * 400), "elong": round(float(elong), 2), "misalign": round(float(misalign), 1),
                 "slope": round(float(sl.mean()), 1), "relief": round(relief, 1), "drop": round(float(drop[p.slice][p.image].mean()), 2),
                 "unit": int(np.bincount(uid20[p.slice][p.image]).argmax())})

# human review overrides
rev_path = WORK / "review.json"
review = json.load(open(rev_path)) if rev_path.exists() else {}
for r in rows:
    v = review.get(str(r["id"]))
    r["verdict"] = v or "unreviewed"
    r["final"] = {"failure": 1, "logging": 2, "unclear": 0}.get(v, 1 if r["auto"] == "failure" else 2)
    keep[r["id"]] = r["final"]
cls = keep[lab]
fail_px = cls == 1
N = U["h3"].size
fpx = np.bincount(uid20[fail_px], minlength=N)
label = (fpx >= 2).astype(np.uint8)
clear_frac = np.bincount(uid20.ravel(), np.isfinite(drop).ravel(), N) / np.maximum(U["npx"], 1)
observed = clear_frac >= 0.6                                     # hexagons the optical pair actually saw
S = {"candidates_ge3px": len(rows), "auto_failure": int(sum(r["auto"] == "failure" for r in rows)),
     "auto_clearing_or_other": int(sum(r["auto"] == "clearing" for r in rows)),
     "human_reviewed": int(sum(r["verdict"] != "unreviewed" for r in rows)),
     "final_failure_scars": int(sum(r["final"] == 1 for r in rows)),
     "failed_slope_units": int((label.astype(bool) & U["is_slope"] & observed).sum()),
     "observed_slope_units": int((U["is_slope"] & observed).sum()),
     "failure_area_ha": float(fail_px.sum() * 0.04)}
print(S)
by = {}
names = json.load(open(WORK / "counties.json"))
for i, nm in enumerate(names):
    k = int((label.astype(bool) & U["is_slope"] & observed & (U["county"] == i + 1)).sum())
    if k: by[nm] = k
S["failed_units_by_county"] = by; print(by)
save("labels", label=label, fail_px=fpx, observed=observed, scar_class=cls.astype(np.uint8), visible=np.packbits(visible))
write_json(WORK / "candidates.json", rows)
write_json(WORK / "label_stats.json", S)
