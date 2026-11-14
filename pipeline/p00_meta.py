"""Read the radar wavelength (and the layover/shadow mask if present) from one remote GUNW file per track.
Needs EARTHDATA_TOKEN in .env. Reads a few KB; nothing is downloaded whole."""
import csv, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, WORK, TRACKS, write_json

for line in (ROOT / ".env").read_text().splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

import earthaccess, h5py
earthaccess.login()
fs = earthaccess.get_fsspec_https_session()
rows = [r for r in csv.DictReader(open(ROOT / "data/nisar/catalog.csv")) if r["product"] == "GUNW"]
out = {}
for t in TRACKS:
    url = next(r["url"] for r in rows if r["stack"] == t)
    with h5py.File(fs.open(url, block_size=4 * 1024 * 1024, cache_type="blockcache"), "r") as h:
        f = float(h["science/LSAR/GUNW/grids/frequencyA/centerFrequency"][()])
        ident = h["science/LSAR/identification"]
        look = ident["lookDirection"][()].decode() if "lookDirection" in ident else "?"
        out[t] = {"center_frequency_hz": f, "wavelength_m": 299792458.0 / f, "look": look}
        print(t, out[t], flush=True)
write_json(WORK / "radar_meta.json", out)
