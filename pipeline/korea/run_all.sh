#!/bin/sh
# Nationwide build: download public layers (no login), then rebuild site/data/korea/.
#   sh pipeline/korea/run_all.sh            everything (downloads take ~30-60 min, mostly Sentinel-2)
#   sh pipeline/korea/run_all.sh build      stages only, from data/korea/public/
# Needs the North Gyeongsang build in site/data/ (NISAR, labels) - it ships with the repo.
set -e
cd "$(dirname "$0")/../.."
PY=".venv/bin/python -I"
if [ "$1" != "build" ]; then
  $PY scripts/download_korea.py --only bounds,mask,dem,slope30,worldcover,hansen,rain,osm
  $PY scripts/download_korea.py --only s2 --periods prefire_2025,postfire_2025,prestorm_2026,poststorm_2026,latest_2026
fi
for s in k01_terrain k02_units k03_region k04_model k05_levels k06_export k07_site_images; do $PY pipeline/korea/$s.py; done
echo "done. Preview: python3 -m http.server 5173 --directory site  ->  map.html (nationwide), map.html?area=region (20 m)"
