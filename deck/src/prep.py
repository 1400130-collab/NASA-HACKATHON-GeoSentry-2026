"""Prepare deck images: bake dark gradients into the 3D map captures so slide text reads on top."""
import sys
import numpy as np
from PIL import Image

S, REPO = sys.argv[1], sys.argv[2]
SHOTS, OUT = f"{S}/shots", f"{S}/build/img"
BG = np.array([11, 12, 13], dtype=np.float32)


def ramp(n, start, end, power=1.0):
    """1 at `start`, 0 at `end` (fractions of n), clamped, eased."""
    t = (np.arange(n) / (n - 1) - start) / (end - start)
    return np.clip(1 - t, 0, 1) ** power


def shade(im, left=None, bottom=None, top=None, right=None, dim=0.0, flat=0.0):
    a = np.asarray(im.convert("RGB"), dtype=np.float32)
    h, w, _ = a.shape
    alpha = np.full((h, w), dim, dtype=np.float32)
    if left:
        alpha = np.maximum(alpha, left[0] * ramp(w, flat, left[1], left[2])[None, :])
    if right:
        alpha = np.maximum(alpha, right[0] * ramp(w, 0, right[1], right[2])[::-1][None, :])
    if bottom:
        alpha = np.maximum(alpha, bottom[0] * ramp(h, 0, bottom[1], bottom[2])[::-1][:, None])
    if top:
        alpha = np.maximum(alpha, top[0] * ramp(h, 0, top[1], top[2])[:, None])
    a = a * (1 - alpha[..., None]) + BG * alpha[..., None]
    return Image.fromarray(a.clip(0, 255).astype(np.uint8))


def save(im, name, w=None, q=88):
    if w and im.width != w:
        im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.save(f"{OUT}/{name}", quality=q, optimize=True)
    print(name, im.size)


# 1 title: check-first map of the burn area, dark on the left for the headline
im = Image.open(f"{SHOTS}/hero_a.png")
save(shade(im, left=(0.97, 0.66, 1.0), bottom=(0.7, 0.28, 1.5), top=(0.55, 0.2, 1.2)), "hero.jpg", 2400)

# 5 NASA data: raw interferogram draped on terrain
im = Image.open(f"{SHOTS}/r_ifg_andong.png")
save(shade(im, left=(0.95, 0.74, 1.0), bottom=(0.85, 0.32, 1.4), top=(0.94, 0.32, 1.0), flat=0.3), "ifg.jpg", 2400)

# 4 product UI, untouched
save(Image.open(f"{SHOTS}/r_ui_selected.png").convert("RGB"), "ui.jpg", 2400, 90)

# 7 nationwide map, faded into the background on every side
im = Image.open(f"{SHOTS}/k_level_home.png").crop((640, 70, 2280, 1790))
save(shade(im, left=(1.0, 0.22, 1.2), right=(1.0, 0.10, 1.0), top=(1.0, 0.08, 1.0), bottom=(1.0, 0.10, 1.0)), "korea.jpg", 1400)

# 2 Sentinel-2 false colour, before and after the March 2025 fires (same footprint)
for k in ("before", "after"):
    save(Image.open(f"{REPO}/site/img/fire_{k}.jpg").convert("RGB"), f"fire_{k}.jpg", 1100)
