"""Stage H: write everything the static site needs into site/data/ (no server, no raw data)."""
import gzip, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from pyproj import Transformer
from common import PUB, WORK, SITE, TRACKS, read, load, write_json, X0, Y1, CRS, H20, W20, BBOX

OUT = SITE / "data"; OUT.mkdir(parents=True, exist_ok=True)
U = load("units"); T = load("terrain"); Sx = load("series"); A = load("anomaly"); Su = load("suscept")
Lv = load("levels"); Lb = load("labels"); Nz = load("nisar"); Vl = load("velocity")
tf = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
names = json.load(open(WORK / "counties.json"))
KO = {"Uiseong-gun": "의성군", "Andong-si": "안동시", "Cheongsong-gun": "청송군", "Yeongyang-gun": "영양군", "Yeongdeok-gun": "영덕군",
      "Uljin-gun": "울진군", "Pohang-si": "포항시", "Yeongju-si": "영주시", "Bonghwa-gun": "봉화군", "Yecheon-gun": "예천군",
      "Gunwi-gun": "군위군", "Gumi-si": "구미시", "Sangju-si": "상주시", "Mungyeong-si": "문경시", "Danyang-gun": "단양군",
      "Yeongcheon-si": "영천시", "Jecheon-si": "제천시", "Gimcheon-si": "김천시"}


def gz(name, arr):
    (OUT / name).write_bytes(gzip.compress(np.ascontiguousarray(arr).tobytes(), 6))
    print(f"  {name}: {(OUT / name).stat().st_size / 1e6:.2f} MB", flush=True)


def km(lon, lat):
    x, y = tf.transform(lon, lat)
    return (np.asarray(x) - X0) / 1000, (Y1 - np.asarray(y)) / 1000


# ---- terrain -----------------------------------------------------------------
dem = T["dem"]
H80, W80 = H20 // 4, W20 // 4
h80 = dem[:H80 * 4, :W80 * 4].reshape(H80, 4, W80, 4).mean((1, 3))
gz("height.bin.gz", np.clip(h80 * 40, 0, 65535).astype("<u2"))
nx, ny = -T["dzdx"], -T["dzdy"]                                   # east, north components of the (unnormalised) normal
H40, W40 = H20 // 2, W20 // 2
ds = lambda a: a[:H40 * 2, :W40 * 2].reshape(H40, 2, W40, 2).mean((1, 3))
nx, ny = ds(nx), ds(ny)
enc = lambda v: np.clip(v * 0.5 / 1.2 + 0.5, 0, 1)                # slopes up to 1.2 (50 deg) fit in 8 bits
Image.fromarray((np.stack([enc(nx), enc(ny), np.clip(ds(T["curv"]) / 6 + 0.5, 0, 1)], -1) * 255).astype("uint8")).save(OUT / "normal.jpg", quality=92)

# ---- units -------------------------------------------------------------------
sl = np.where(U["is_slope"])[0]
n = sl.size
remap = np.zeros(U["h3"].size, np.int64); remap[sl] = np.arange(1, n + 1)
ids = remap[U["uid40"]]
gz("unitid.bin.gz", np.stack([ids & 255, (ids >> 8) & 255, (ids >> 16) & 255, np.full_like(ids, 255)], -1).astype("u1"))
ux, uz = (U["ux"][sl] - X0) / 1000, (Y1 - U["uy"][sl]) / 1000
feat_names = json.load(open(WORK / "suscept_stats.json"))["features"]
contrib = Su["contrib"][sl][:, :-1]; Xv = Su["X"][sl]
top = np.argsort(-contrib, 1)[:, :3]
rows = np.arange(n)[:, None]
tc = contrib[rows, top]
top = np.where(tc > 0.05, top, -1)
cols = {
    "x": ux, "z": uz, "lat": U["lat"][sl], "lon": U["lon"][sl], "elev": U["dem"][sl], "slope": U["slope"][sl], "aspect": U["aspect"][sl],
    "county": U["county"][sl], "level": Lv["level"][sl], "moving": Lv["moving"][sl], "pct": Su["pct"][sl], "prio": Lv["prio"][sl],
    "bld": Lv["bld_below"][sl], "road": Lv["road_below"][sl], "dnbr": U["dnbr"][sl], "burn": U["burn_frac"][sl], "ndvi": U["ndvi_pre"][sl],
    "rain_storm": U["rain_storm"][sl], "rain_ante": U["rain_ante30"][sl], "det": A["detector_pct"][sl], "zmax": Sx["zmax"][sl],
    "label": Lb["label"][sl], "seen": Lb["observed"][sl],
    # time-series inversion (p04b): downslope rate after the storm, mm per 30 days, its error bar, and tracks used (NaN = one direction only)
    "vd": Vl["v_post"][sl], "vds": Vl["s_post"][sl], "vdn": Vl["ntracks"][sl],
    # the rest of the solved model, so the map can redraw the fit: rate before the storm, step at the storm, and the shared (non-sliding) term
    "vpre": Vl["v_pre"][sl], "vstep": Vl["step"][sl], "cpre": Vl["common_pre"][sl], "cstep": Vl["common_step"][sl], "cpost": Vl["common_post"][sl],
    "r1": top[:, 0], "r2": top[:, 1], "r3": top[:, 2], "v1": Xv[rows[:, 0], np.maximum(top[:, 0], 0)], "v2": Xv[rows[:, 0], np.maximum(top[:, 1], 0)],
    "v3": Xv[rows[:, 0], np.maximum(top[:, 2], 0)],
}
# simulated debris flow (p11): best-fit friction (ro_) and the far-reaching case (rf_); NaN where not simulated
HAVE_RO = (WORK / "runout.npz").exists()
if HAVE_RO:
    Ro = load("runout")
    cols["sim"] = Lv["sim"][sl]; cols["bld300"] = Lv["bld300"][sl]; cols["road300"] = Lv["road300"][sl]
    for k in ("ro_len", "ro_bld", "ro_road", "rf_len", "rf_drop", "rf_bld", "rf_road", "rf_tbld", "rf_vmax", "rf_dir", "rf_left"):
        cols[k] = Ro[k][sl]
# The heaviest 48 h rain each slope has stood through since the fire (nearest 0.1 degree rain point), and the day it
# ended, counted from the first day of the rain file. A fact about past rain, not a threshold.
Rn = np.load(WORK / "rain.npz")
rpt = np.argmin((U["lat"][sl, None] - Rn["pts"][None, :, 0]) ** 2 + (U["lon"][sl, None] - Rn["pts"][None, :, 1]) ** 2, axis=1)
r0 = int(np.where(Rn["dates"] == "2025-04-08")[0][0])
r48 = Rn["R"][:, r0 + 1:] + Rn["R"][:, r0:-1]
cols["rec48"] = r48.max(1)[rpt]; cols["rec_day"] = (r0 + 1 + r48.argmax(1))[rpt]
RAIN_REC = {"since": "2025-04-08", "until": str(Rn["dates"][-1]), "day0": str(Rn["dates"][0]), "grid_deg": 0.1,
            "mm_min_p50_max": [float(v) for v in np.percentile(cols["rec48"], [0, 50, 100])]}
for tr in TRACKS:
    t = tr[:3]
    cols[f"cum_{t}"] = Sx[f"{tr}__cum_post"][sl]; cols[f"sig_{t}"] = Sx[f"{tr}__sig_post"][sl]
    cols[f"meas_{t}"] = Sx[f"{tr}__measurable"][sl]; cols[f"sens_{t}"] = Nz[f"{tr}__sens"][sl]
    cols[f"cohpre_{t}"] = Sx[f"{tr}__pre_coh"][sl]; cols[f"cohstorm_{t}"] = Sx[f"{tr}__storm_coh"][sl]
gz("units.bin.gz", np.stack([np.asarray(v, "float32") for v in cols.values()], 0).astype("<f4"))

# debris-flow animation: per flagged slope, the 10 m cells the far-reaching flow covers.
# Layout: u32 flows | u32 unit[flows] | u32 count[flows] | u16 col[cells] | u16 row[cells] | u8 arrival (0.5 s) | u8 depth (2 cm) | u8 also in the best-fit case
if HAVE_RO:
    nf = Ro["an_unit"].size
    buf = b"".join([np.array([nf], "<u4").tobytes(), (remap[Ro["an_unit"]] - 1).astype("<u4").tobytes(), Ro["an_n"].astype("<u4").tobytes(),
                    Ro["an_c"].astype("<u2").tobytes(), Ro["an_r"].astype("<u2").tobytes(), Ro["an_t"].tobytes(), Ro["an_d"].tobytes(), Ro["an_k"].tobytes()])
    (OUT / "runout.bin.gz").write_bytes(gzip.compress(buf, 6))
    print(f"  runout.bin.gz: {(OUT / 'runout.bin.gz').stat().st_size / 1e6:.2f} MB ({int(Ro['an_n'].sum())} cells)", flush=True)

# movement history: cumulative cm per track and date (int16, 0.01 cm; -32768 = no data) and coherence per pair (uint8)
st = json.load(open(WORK / "series_stats.json")); ns = json.load(open(WORK / "nisar_stats.json"))
ND = max(len(st["tracks"][t]["dates"]) for t in TRACKS)
ser = np.full((n, 3, ND), -32768, "<i2"); cohs = np.zeros((n, 3, ND - 1), "u1")
for k, tr in enumerate(TRACKS):
    inc = Sx[f"{tr}__inc"][sl]; cum = Sx[f"{tr}__cum"][sl]
    valid = np.concatenate([np.ones((n, 1), bool), ~np.isnan(inc)], 1) & Sx[f"{tr}__measurable"][sl][:, None]
    q = np.clip(np.round(cum * 100), -32000, 32000).astype("<i2"); q[~valid] = -32768
    ser[:, k, :q.shape[1]] = q
    c = np.nan_to_num(Nz[f"{tr}__coh20"][sl]); cohs[:, k, :c.shape[1]] = np.clip(c * 255, 0, 255)
gz("series.bin.gz", ser); gz("coh.bin.gz", cohs)

# ---- imagery (Sentinel-2 false colour: SWIR, NIR, red) -------------------------
def fc(name):
    b = [read(PUB / "s2" / f"{name}_{k}.tif").astype("float32") / 10000 for k in ("swir22", "nir", "red")]
    rgb = np.clip(np.stack([b[0] / 0.34, b[1] / 0.52, b[2] / 0.20], -1), 0, 1) ** 0.85
    rgb = rgb[:H40 * 2, :W40 * 2].reshape(H40, 2, W40, 2, 3).mean((1, 3))
    Image.fromarray((rgb * 255).astype("uint8")).save(OUT / f"s2_{name.split('_')[0]}_{name.split('_')[1]}.jpg", quality=84)
for nm in ["prefire_20250314", "postfire_20250408", "prestorm_20260612", "poststorm_20260806", "poststorm_20261002"]:
    fc(nm)
print("  imagery:", sum(f.stat().st_size for f in OUT.glob("s2_*.jpg")) / 1e6, "MB")

# ---- radar rasters for the pairs that span the storm ---------------------------
for tr in TRACKS:
    phi, coh, hp, cov = np.load(WORK / f"storm_{tr}.npy")
    full = np.zeros((H80, W80, 4), "u1")
    wrapped = (np.nan_to_num(phi) % (2 * np.pi)) / (2 * np.pi)
    r = np.stack([wrapped * 255, np.clip(np.nan_to_num(coh), 0, 1) * 255, np.clip(np.nan_to_num(hp) / 3 * 127 + 128, 0, 255),
                  np.where((cov > 0) & np.isfinite(phi), 255, 0)], -1).astype("u1")
    full[:r.shape[0], 1:1 + r.shape[1]] = r                           # the NISAR grid starts 80 m east of ours
    gz(f"radar_{tr[:3]}.bin.gz", full)

# ---- vectors -----------------------------------------------------------------
gj = json.load(open(PUB / "kor_adm2.geojson"))
w, s, e, nn = BBOX
counties = []
for f in gj["features"]:
    nm = f["properties"]["shapeName"]
    if nm not in names:
        continue
    g = f["geometry"]; lines = []
    for poly in (g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]):
        for ring in poly:
            r = np.array(ring)
            x, z = km(r[:, 0], r[:, 1])
            inside = (x > -1) & (x < W20 * 0.02 + 1) & (z > -1) & (z < H20 * 0.02 + 1)
            if inside.sum() < 2:
                continue
            seg, cur = [], []
            for i in range(len(x)):
                if inside[i]:
                    cur.append([round(float(x[i]), 3), round(float(z[i]), 3)])
                elif cur:
                    seg.append(cur); cur = []
            if cur: seg.append(cur)
            lines += [c for c in seg if len(c) > 1]
    ci = names.index(nm) + 1
    m = U["county"][sl] == ci
    counties.append({"id": ci, "en": nm.replace("-gun", "").replace("-si", ""), "full": nm, "ko": KO.get(nm, nm), "lines": lines,
                     "cx": float(ux[m].mean()) if m.any() else None, "cz": float(uz[m].mean()) if m.any() else None, "units": int(m.sum())})
roads = []
rank = {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4}
for r in json.load(open(PUB / "osm_roads_geom.json")):
    a = np.array(r["line"]); x, z = km(a[:, 0], a[:, 1])
    pts = np.round(np.stack([x, z], 1), 3)
    keep = [0]
    for i in range(1, len(pts)):
        if np.hypot(*(pts[i] - pts[keep[-1]])) > 0.06 or i == len(pts) - 1:
            keep.append(i)
    if len(keep) > 1:
        roads.append({"k": rank.get(r["highway"].replace("_link", ""), 4), "p": pts[keep].tolist()})
els = json.load(open(PUB / "osm_buildings_roads.json"))
b = np.array([(el["center"]["lon"], el["center"]["lat"]) for el in els if "building" in el.get("tags", {})])
bx, bz = km(b[:, 0], b[:, 1])
towns = [("Uiseong", "의성", 128.6970, 36.3527), ("Andong", "안동", 128.7294, 36.5684), ("Cheongsong", "청송", 129.0571, 36.4359),
         ("Yeongyang", "영양", 129.1124, 36.6667), ("Yeongdeok", "영덕", 129.3653, 36.4150)]
write_json(OUT / "vectors.json", {"counties": counties, "roads": roads,
                                  "buildings": np.round(np.stack([bx, bz], 1), 3).tolist(),
                                  "towns": [{"en": a, "ko": k, "x": float(km(lo, la)[0]), "z": float(km(lo, la)[1])} for a, k, lo, la in towns]})
print(f"  vectors.json: {(OUT / 'vectors.json').stat().st_size / 1e6:.2f} MB")

# ---- rain --------------------------------------------------------------------
R = np.load(WORK / "rain.npz")
d = R["dates"]; m = (d >= "2026-06-01") & (d <= "2026-10-31")
pts = R["pts"]; px, pz = km(pts[:, 1], pts[:, 0])
lats, lons = np.unique(pts[:, 0]), np.unique(pts[:, 1])
grid = R["R"][:, m].reshape(len(lats), len(lons), -1)[::-1]              # north row first
write_json(OUT / "rain.json", {"dates": d[m].tolist(), "mean": np.round(R["R"][:, m].mean(0), 2).tolist(),
                               "max": np.round(R["R"][:, m].max(0), 1).tolist(), "rows": len(lats), "cols": len(lons),
                               "x0": float(px.min()), "x1": float(px.max()), "z0": float(pz.min()), "z1": float(pz.max()),
                               "grid": np.round(grid.transpose(2, 0, 1), 1).reshape(int(m.sum()), -1).tolist()})

# ---- scar candidates + review sheet --------------------------------------------
cand = json.load(open(WORK / "candidates.json"))
for c in cand:
    c["x"] = round((c["col"] * 20 + 10) / 1000, 3); c["z"] = round((c["row"] * 20 + 10) / 1000, 3)
    c["u"] = int(remap[c["unit"]]) - 1
write_json(OUT / "candidates.json", [{k: c[k] for k in ("id", "auto", "verdict", "final", "lat", "lon", "x", "z", "u", "area_m2", "elong", "slope", "drop")} for c in cand])
def fc20(name):
    b = [read(PUB / "s2" / f"{name}_{k}.tif").astype("float32") / 10000 for k in ("swir22", "nir", "red")]
    return (np.clip(np.stack([b[0] / 0.34, b[1] / 0.52, b[2] / 0.20], -1), 0, 1) ** 0.85 * 255).astype("uint8")
imgs = [fc20(k) for k in ("prestorm_20260612", "poststorm_20260806", "poststorm_20261002")]
R_, Z_, PER = 32, 2, 4
sheet = Image.new("RGB", (PER * 3 * R_ * 2 * Z_, ((len(cand) + PER - 1) // PER) * R_ * 2 * Z_))
for k, c in enumerate(cand):
    i0 = int(np.clip(c["row"] - R_, 0, H20 - 2 * R_)); j0 = int(np.clip(c["col"] - R_, 0, W20 - 2 * R_))
    for t, im in enumerate(imgs):
        tile = Image.fromarray(im[i0:i0 + 2 * R_, j0:j0 + 2 * R_]).resize((2 * R_ * Z_,) * 2, Image.NEAREST)
        sheet.paste(tile, ((k % PER) * 3 * 2 * R_ * Z_ + t * 2 * R_ * Z_, (k // PER) * 2 * R_ * Z_))
sheet.save(OUT / "review_sheet.jpg", quality=88)

# ---- example slopes for the home page's inversion animation ---------------------
exs = json.load(open(WORK / "inversion_examples.json"))
for e in exs:
    i = e.pop("idx"); e["u"] = int(remap[i]) - 1; ci = int(U["county"][i])
    e["en"] = names[ci - 1].replace("-gun", "").replace("-si", "") if ci else ""; e["ko"] = KO.get(names[ci - 1], "") if ci else ""
    e["moving"] = bool(Lv["moving"][i])
write_json(OUT / "inversion.json", exs)

# ---- numbers -------------------------------------------------------------------
meta = {
    "generated": str(np.datetime64("now")) + "Z",
    "grid": {"w_km": W20 * 0.02, "h_km": H20 * 0.02, "h80": [H80, W80], "h40": [H40, W40], "height_scale": 40, "x0": X0, "y1": Y1, "epsg": 32652},
    "units": {"n": int(n), "cols": list(cols), "nd": ND},
    "features": feat_names, "counties": [{"id": c["id"], "en": c["en"], "ko": c["ko"], "units": c["units"], "cx": c["cx"], "cz": c["cz"]} for c in counties],
    "tracks": {tr[:3]: {"name": tr, "dir": "ascending" if "_A_" in tr else "descending", "dates": st["tracks"][tr]["dates"],
                        "noise_pair": st["tracks"][tr]["noise_cm_per_pair_slopes"], "pre": st["tracks"][tr]["pre_pairs"],
                        "storm": st["tracks"][tr]["storm_pairs"], "post": st["tracks"][tr]["post_pairs"],
                        "coh_median": [p["coh_median"] for p in ns[tr]["pairs"]], "pass_frac": [p["pass_frac"] for p in ns[tr]["pairs"]],
                        "measurable": st["tracks"][tr]["slope_units_measurable"],
                        "stable_cum_median": st["tracks"][tr]["stable_cum_post_median_cm"], "stable_cum_mad": st["tracks"][tr]["stable_cum_post_mad_cm"],
                        "slopes_cum_mad": st["tracks"][tr]["slopes_cum_post_mad_cm"]} for tr in TRACKS},
    "radar": json.load(open(WORK / "radar_meta.json"))[TRACKS[0]],
    "s2": ["2025-03-14", "2025-04-08", "2026-06-12", "2026-08-06", "2026-10-02"],
    "storm": ["2026-07-18", "2026-07-19"],
    "series": {k: st[k] for k in ("stable_units", "ascending_agreement", "asc_desc_r", "movement")},
    "labels": json.load(open(WORK / "label_stats.json")),
    "suscept": json.load(open(WORK / "suscept_stats.json")),
    "anomaly": json.load(open(WORK / "anomaly_stats.json")),
    "velocity": json.load(open(WORK / "velocity_stats.json")),
    "sign": json.load(open(WORK / "sign_check.json")) if (WORK / "sign_check.json").exists() else None,
    "levels": json.load(open(WORK / "level_stats.json")),
}
meta["rain_record"] = RAIN_REC
if HAVE_RO:
    # For the nationwide map (EPSG:5179): where this grid's corners and a 7 x 6 lattice of its points fall there, so the
    # browser can place the simulated flows without a projection library. Plus the flow the storm replay zooms in on.
    t5 = Transformer.from_crs(CRS, "EPSG:5179", always_xy=True)
    gx, gz = np.meshgrid(np.linspace(0, W20 * 0.02, 7), np.linspace(0, H20 * 0.02, 6))
    ex, ny_ = t5.transform(X0 + gx.ravel() * 1000, Y1 - gz.ravel() * 1000)
    c3 = np.where((Lv["level"][sl] == 3) & (Ro["rf_len"][sl] > 150))[0]
    show = int(c3[np.lexsort((Ro["rf_len"][sl][c3], Ro["rf_bld"][sl][c3]))[-1]])
    meta["flows"] = {"nx": 7, "nz": 6, "w_km": W20 * 0.02, "h_km": H20 * 0.02, "e": [round(float(v), 1) for v in ex], "n": [round(float(v), 1) for v in ny_],
                     "show": {"unit": show, "dir": float(Ro["rf_dir"][sl][show]), "bld": int(Ro["rf_bld"][sl][show]), "len": float(Ro["rf_len"][sl][show])}}
if HAVE_RO: meta["runout"] = json.load(open(WORK / "runout_stats.json"))
if (WORK / "stability_stats.json").exists(): meta["stability"] = json.load(open(WORK / "stability_stats.json"))
write_json(OUT / "meta.json", meta)
print("site/data total:", round(sum(f.stat().st_size for f in OUT.glob('*')) / 1e6, 1), "MB")
