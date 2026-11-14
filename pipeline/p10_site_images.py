"""Still images for the website pages (site/img). Reads only what p09 already wrote to site/data.

  img/overview_dark.jpg   hillshade of the whole area with Watch and Check-first slopes marked
  img/fire_before.jpg     Sentinel-2, 14 March 2025
  img/fire_after.jpg      Sentinel-2, 8 April 2025
  data/hero_*             small terrain grid and flagged slopes for the 3D scene on the home page
"""
import gzip
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SITE = Path(__file__).resolve().parent.parent / "site"
DATA, OUT = SITE / "data", SITE / "img"
OUT.mkdir(exist_ok=True)

meta = json.loads((DATA / "meta.json").read_text())
n, cols = meta["units"]["n"], meta["units"]["cols"]
units = np.frombuffer(gzip.decompress((DATA / "units.bin.gz").read_bytes()), dtype="<f4").reshape(len(cols), n)
col = {c: units[i] for i, c in enumerate(cols)}

# hillshade from the normal map, same lighting as the inspection sheet, tinted like the page paper
nm = np.asarray(Image.open(DATA / "normal.jpg").convert("RGB"), dtype=np.float32) / 255
nx, ny = (nm[..., 0] - 0.5) * 4.8, (nm[..., 1] - 0.5) * 4.8
shade = np.clip((-0.55 * nx + 0.55 * ny + 0.63) / np.sqrt(nx**2 + ny**2 + 1) * 1.15, 0, 1)
H, W = shade.shape
kx, kz = W / meta["grid"]["w_km"], H / meta["grid"]["h_km"]

for src, dst in (("s2_prefire_20250314.jpg", "fire_before.jpg"), ("s2_postfire_20250408.jpg", "fire_after.jpg")):
    im = Image.open(DATA / src).convert("RGB")
    im.resize((1400, round(1400 * im.height / im.width)), Image.LANCZOS).save(OUT / dst, quality=80, optimize=True)

for p in sorted(OUT.glob("*.jpg")):
    print(f"  wrote site/img/{p.name}  {p.stat().st_size // 1024} KB")

# ---- home page hero: a light terrain grid and the flagged slopes, small enough to load at once ----
h16 = np.frombuffer(gzip.decompress((DATA / "height.bin.gz").read_bytes()), dtype="<u2").reshape(meta["grid"]["h80"])
hh, hw = h16.shape[0] // 2, h16.shape[1] // 2
small = h16[: hh * 2, : hw * 2].reshape(hh, 2, hw, 2).mean(axis=(1, 3)).round().astype("<u2")
(DATA / "hero_height.bin.gz").write_bytes(gzip.compress(small.tobytes(), 9))
pts = []
for level in (3, 2):
    u = np.flatnonzero(col["level"] == level)
    xz = np.stack([col["x"][u] / meta["grid"]["w_km"], col["z"][u] / meta["grid"]["h_km"]], axis=1)
    pts.append((np.clip(xz, 0, 1) * 65535).round().astype("<u2"))
(DATA / "hero_points.bin.gz").write_bytes(gzip.compress(np.concatenate(pts).tobytes(), 9))
(DATA / "hero.json").write_text(json.dumps({
    "w": hw, "h": hh, "w_km": meta["grid"]["w_km"], "h_km": meta["grid"]["h_km"],
    "height_scale": meta["grid"]["height_scale"], "n_check": len(pts[0]), "n_watch": len(pts[1])}))

# dark version of the overview: fallback behind the 3D hero and backdrop of the closing link
dark = np.array([11, 12, 13], dtype=np.float32) + (np.array([92, 92, 90], dtype=np.float32) - 11) * (shade[..., None] ** 1.6)
base = Image.fromarray(dark.astype(np.uint8)).convert("RGBA")
layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
g = ImageDraw.Draw(layer)
for level, rgba, r in ((2, (255, 176, 32, 70), 1.8), (3, (255, 77, 46, 255), 3.4)):
    for u in np.flatnonzero(col["level"] == level):
        x, z = col["x"][u] * kx, col["z"][u] * kz
        g.ellipse((x - r, z - r, x + r, z + r), fill=rgba)
Image.alpha_composite(base, layer).convert("RGB").resize((1800, round(1800 * H / W)), Image.LANCZOS).save(OUT / "overview_dark.jpg", quality=82, optimize=True)
for p in ("hero_height.bin.gz", "hero_points.bin.gz", "hero.json"):
    print(f"  wrote site/data/{p}  {(DATA / p).stat().st_size // 1024} KB")
print(f"  wrote site/img/overview_dark.jpg  {(OUT / 'overview_dark.jpg').stat().st_size // 1024} KB")
