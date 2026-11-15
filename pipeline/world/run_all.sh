#!/bin/sh
# Rebuild the real-world layers of the 3D map (buildings, trees, land cover, water, roads): site/data/world/
# About 15 minutes, most of it the downloads. Needs the nationwide build (site/data/korea/) for the land mask.
set -e
cd "$(dirname "$0")/../.."
PY=.venv/bin/python
mkdir -p data/world/raster
$PY -I scripts/download_world.py                      # Overture Maps: buildings, roads, water, land use (1.3 GB)
for t in 120E 130E; do                                # GLAD GLCLUC 2020 forest height, from NASA GEDI lidar (270 MB)
  [ -f data/world/raster/gedi_2020_40N_$t.tif ] || curl -sL -o data/world/raster/gedi_2020_40N_$t.tif \
    "https://glad.umd.edu/users/Potapov/GLCLUC2020/Forest_height_2020/2020_40N_$t.tif"
done
for rc in R5_C30 R6_C30; do                           # JRC GHSL mean building height 2018 (36 MB)
  [ -f data/world/raster/ghsl_anbh_$rc.zip ] || curl -sL -o data/world/raster/ghsl_anbh_$rc.zip \
    "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_BUILT_H_GLOBE_R2023A/GHS_BUILT_H_ANBH_E2018_GLOBE_R2023A_54009_100/V1-0/tiles/GHS_BUILT_H_ANBH_E2018_GLOBE_R2023A_54009_100_V1_0_$rc.zip"
done
$PY -I pipeline/world/w01_rasters.py                  # land cover, canopy height, building height, ground textures
$PY -I pipeline/world/w02_tiles.py                    # 4 km tiles + index.json
