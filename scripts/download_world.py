"""Download the real-world layers for the 3D map: buildings, roads, railways, water, land use, land cover polygons.

Source: Overture Maps (release below), read straight from its public S3 bucket with DuckDB, cut to the box of South Korea.
  buildings        OpenStreetMap + the East Asian building footprints of Shi et al. 2024 (doi:10.5281/zenodo.8174931), ODbL / CC BY 4.0
  everything else  OpenStreetMap (ODbL)

Run:  .venv/bin/python -I scripts/download_world.py [buildings segment water land_use land infrastructure]
Output: data/world/raw/*.parquet   (git-ignored, about 1.5 GB)
"""
import sys
import time
from pathlib import Path

import duckdb

RELEASE = "2026-10-21.0"
BBOX = (124.5, 33.0, 131.95, 38.7)                  # lon/lat box of South Korea, the same as the nationwide map
OUT = Path(__file__).resolve().parents[1] / "data" / "world" / "raw"
OUT.mkdir(parents=True, exist_ok=True)
SRC = f"s3://overturemaps-us-west-2/release/{RELEASE}"
LAYERS = {
    "buildings": ("theme=buildings/type=building", "geometry, height, num_floors, class, subtype, sources[1].dataset AS ds"),
    "segment": ("theme=transportation/type=segment", "geometry, subtype, class, CAST(road_flags AS VARCHAR) AS flags, CAST(rail_flags AS VARCHAR) AS rflags"),
    "water": ("theme=base/type=water", "geometry, subtype, class, is_intermittent"),
    "land_use": ("theme=base/type=land_use", "geometry, subtype, class"),
    "land": ("theme=base/type=land", "geometry, subtype, class"),
    "infrastructure": ("theme=base/type=infrastructure", "geometry, subtype, class, height"),
}


def main(names):
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2'; SET enable_progress_bar=false;")
    w, s, e, n = BBOX
    for name in names:
        out = OUT / f"{name}.parquet"
        if out.exists():
            print(f"  {name}: already there", flush=True); continue
        path, cols = LAYERS[name]
        t = time.time()
        tmp = out.with_suffix(".part")
        con.execute(f"""COPY (SELECT {cols}, bbox.xmin AS x0, bbox.ymin AS y0, bbox.xmax AS x1, bbox.ymax AS y1
            FROM read_parquet('{SRC}/{path}/*', hive_partitioning=1)
            WHERE bbox.xmax > {w} AND bbox.xmin < {e} AND bbox.ymax > {s} AND bbox.ymin < {n})
            TO '{tmp}' (FORMAT PARQUET, COMPRESSION ZSTD)""")
        tmp.rename(out)
        rows = con.execute(f"SELECT count(*) FROM read_parquet('{out}')").fetchone()[0]
        print(f"  {name}: {rows:,} rows, {out.stat().st_size / 1e6:.0f} MB, {time.time() - t:.0f} s", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:] or list(LAYERS))
