"""Stage K7: the home page hero for the nationwide map. Reads only what k06 wrote to site/data/korea.

  data/korea/hero.json, hero_height.bin.gz, hero_points.bin.gz   small terrain grid + flagged slopes for the 3D scene

img/terrain_still.jpg (closing link backdrop, and the hero when WebGL fails) is a frame captured from this 3D scene in a
browser at 2400 px, with a lower camera; it is not rebuilt here.

The hero is a close-up, not the whole country: the 220 x 150 km window with the most Check-first slopes per km2
(the Taebaek mountains, east Gangwon to north Gyeongsang), at the full 360 m grid. Seen from far enough back to fit
the whole peninsula, the terrain turns into a blob. Heights of 0 mean "not on the map" (sea) and fade into the page.
"""
import gzip
import json
from pathlib import Path

import numpy as np

SITE = Path(__file__).resolve().parents[2] / "site"
DATA = SITE / "data" / "korea"

meta = json.loads((DATA / "meta.json").read_text())
n, cols = meta["units"]["n"], meta["units"]["cols"]
units = np.frombuffer(gzip.decompress((DATA / "units.bin.gz").read_bytes()), dtype="<f4").reshape(len(cols), n)
col = {c: units[i] for i, c in enumerate(cols)}
h16 = np.frombuffer(gzip.decompress((DATA / "height.bin.gz").read_bytes()), dtype="<u2").reshape(meta["grid"]["h80"])
cell = meta["grid"]["w_km"] / h16.shape[1]                     # km per height cell (360 m)

# densest 220 x 150 km window of Check-first slopes, searched on a 10 km step
k3 = col["level"] == 3
WW, WH = 220, 150
best = max(((((col["x"][k3] >= x0) & (col["x"][k3] < x0 + WW) & (col["z"][k3] >= z0) & (col["z"][k3] < z0 + WH)).sum(), x0, z0)
            for x0 in range(0, int(meta["grid"]["w_km"]) - WW, 10) for z0 in range(0, int(meta["grid"]["h_km"]) - WH, 10)))
r0, c0 = round(best[2] / cell), round(best[1] / cell)
crop = h16[r0: r0 + round(WH / cell), c0: c0 + round(WW / cell)]

F = 1                                                          # full 360 m grid: ~250k vertices
hh, hw = crop.shape[0] // F, crop.shape[1] // F
blk = crop[: hh * F, : hw * F].reshape(hh, F, hw, F)
on = (blk > 0).mean(axis=(1, 3))
small = np.where(on >= 0.5, blk.astype(np.float32).sum(axis=(1, 3)) / np.maximum((blk > 0).sum(axis=(1, 3)), 1), 0)
small = np.where(on >= 0.5, np.maximum(small, 1), 0).round().astype("<u2")    # keep low coast > 0 so it stays land
(DATA / "hero_height.bin.gz").write_bytes(gzip.compress(small.tobytes(), 9))
w_km, h_km = hw * F * cell, hh * F * cell
ox, oz = c0 * cell, r0 * cell                                  # crop origin in grid km

pts = []
for level in (3, 2):
    u = np.flatnonzero(col["level"] == level)
    xz = np.stack([(col["x"][u] - ox) / w_km, (col["z"][u] - oz) / h_km], axis=1)
    xz = xz[((xz >= 0) & (xz <= 1)).all(1)]                    # only the slopes inside the window
    pts.append((xz * 65535).round().astype("<u2"))
(DATA / "hero_points.bin.gz").write_bytes(gzip.compress(np.concatenate(pts).tobytes(), 9))
(DATA / "hero.json").write_text(json.dumps({
    "w": hw, "h": hh, "w_km": round(w_km, 2), "h_km": round(h_km, 2), "height_scale": meta["grid"]["height_scale"],
    "n_check": len(pts[0]), "n_watch": len(pts[1]),
    "exag": 3.8, "contour_km": 0.1, "dot": 1.0,
    "cam": {"el": 0.5, "R": 76, "Rn": 92, "wide": [-4, 12], "narrow": [0, 8], "fog": [72, 190]}}))   # close enough that the corners stay off-screen                  # scene look, see site/js/hero.js

for p in ("hero_height.bin.gz", "hero_points.bin.gz", "hero.json"):
    print(f"  wrote site/data/korea/{p}  {(DATA / p).stat().st_size // 1024} KB")
print(f"  {hw}x{hh} grid, {w_km:.0f}x{h_km:.0f} km, {len(pts[0])} check-first and {len(pts[1])} watch slopes in view")
