#!/bin/sh
# Rebuild everything from data/ into site/data/. About 4 minutes on an M4.
#   sh pipeline/run_all.sh            all stages
#   sh pipeline/run_all.sh labels     from the label stage on (use after saving data/work/review.json)
set -e
cd "$(dirname "$0")/.."
PY=".venv/bin/python -I"
if [ "$1" != "labels" ]; then
  [ -f data/work/radar_meta.json ] || $PY pipeline/p00_meta.py      # needs EARTHDATA_TOKEN in .env, reads a few KB
  $PY pipeline/p01_terrain.py
  $PY pipeline/p02_units.py
  $PY pipeline/p03_nisar.py
  $PY pipeline/p04_series.py
  $PY pipeline/p04b_velocity.py
fi
$PY pipeline/p05_labels.py
$PY pipeline/p06_susceptibility.py
$PY pipeline/p07_anomaly.py
$PY pipeline/p11_runout.py        # GPU debris-flow reach for the flagged slopes. Reuses earlier results; from scratch (or with --all) about 25 min
[ "$STABILITY" = "1" ] && $PY pipeline/p12_stability.py   # optional, about 8 min: soil-strength model and the rain test (numbers only)
$PY pipeline/p08_levels.py
$PY pipeline/p09_export.py
$PY pipeline/p10_site_images.py
echo "done. Preview: python3 -m http.server 5173 --directory site"
