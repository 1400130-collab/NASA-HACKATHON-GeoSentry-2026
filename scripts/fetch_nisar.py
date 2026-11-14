"""Fetch NISAR GUNW interferograms for the study area WITHOUT downloading whole files.

Each GUNW file is ~2.4 GB on NASA's servers. This script opens it over HTTPS, reads only
the window over our study area, and saves small GeoTIFFs (a few MB per interferogram).

Needs a free NASA Earthdata login. Put a token in the environment first:
    export EARTHDATA_TOKEN=...        (generate at https://urs.earthdata.nasa.gov -> Generate Token)
or have ~/.netrc set up for urs.earthdata.nasa.gov.

Run:
    .venv/bin/python -I scripts/fetch_nisar.py --catalog-only     # no login needed, lists what exists
    .venv/bin/python -I scripts/fetch_nisar.py --inspect          # print the HDF5 layout of one file
    .venv/bin/python -I scripts/fetch_nisar.py                    # crop every interferogram

STATUS: the catalog step is tested. The crop step is NOT yet tested against a real file
(no login was available when this was written). Run --inspect first and fix paths if needed.
"""
import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np
import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "nisar"
BBOX = (128.30, 36.15, 129.50, 36.85)  # keep in sync with download_public.py

# Track_Direction_Frame stacks that cover Uiseong/Andong (checked against CMR on 2026-11-13).
STACKS = ["125_A_020", "032_D_070", "024_A_020"]
COLLECTIONS = {"GUNW": ["C2854335566-ASF", "C3622247503-ASF"],   # provisional, validated
               "GCOV": ["C2854338529-ASF", "C3622241360-ASF"]}

# Layers to crop, matched by dataset name inside these HDF5 groups.
WANT = {"unwrappedInterferogram": ["unwrappedPhase", "coherenceMagnitude", "connectedComponents",
                                   "ionospherePhaseScreen"],
        "wrappedInterferogram": ["coherenceMagnitude"]}


def catalog(product):
    rows = []
    for cid in COLLECTIONS[product]:
        r = requests.get("https://cmr.earthdata.nasa.gov/search/granules.umm_json", timeout=60, params={
            "collection_concept_id": cid, "bounding_box": ",".join(map(str, BBOX)),
            "page_size": 500, "sort_key": "start_date"})
        r.raise_for_status()
        for it in r.json()["items"]:
            u = it["umm"]
            aa = {a["Name"]: a["Values"][0] for a in u["AdditionalAttributes"]}
            stack = f"{int(aa['TRACK_NUMBER']):03d}_{aa['ASCENDING_DESCENDING'][0]}_{int(aa['FRAME_NUMBER']):03d}"
            if stack not in STACKS:
                continue
            url = next(x["URL"] for x in u["RelatedUrls"] if x["URL"].startswith("https") and x["URL"].endswith(".h5")
                       and "QA_STATS" not in x["URL"])
            size = next((a["SizeInBytes"] for a in u["DataGranule"]["ArchiveAndDistributionInformation"]
                         if a["Name"].endswith(".h5") and "QA_STATS" not in a["Name"]), 0)
            if product == "GUNW":
                ref = aa["REFERENCE_ZERO_DOPPLER_START_TIME"][:10]
                sec = aa["SECONDARY_ZERO_DOPPLER_START_TIME"][:10]
            else:
                ref = sec = u["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"][:10]
            rows.append({"product": product, "stack": stack, "ref_date": ref, "sec_date": sec,
                         "size_gb": round(size / 1e9, 2), "granule": u["GranuleUR"], "url": url})
    rows.sort(key=lambda r: (r["stack"], r["ref_date"], r["sec_date"]))
    return rows


def write_catalog():
    rows = catalog("GUNW") + catalog("GCOV")
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "catalog.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    for p in ("GUNW", "GCOV"):
        for s in STACKS:
            sel = [r for r in rows if r["product"] == p and r["stack"] == s]
            if sel:
                print(f"{p} {s}: {len(sel)} files, {sum(r['size_gb'] for r in sel):.0f} GB if downloaded whole, "
                      f"{sel[0]['ref_date']} -> {sel[-1]['sec_date']}")
    print(f"wrote {OUT / 'catalog.csv'}")
    return rows


def open_remote(url):
    import earthaccess
    import h5py
    earthaccess.login()  # uses EARTHDATA_TOKEN, EARTHDATA_USERNAME/PASSWORD or ~/.netrc
    fs = earthaccess.get_fsspec_https_session()
    return h5py.File(fs.open(url, block_size=8 * 1024 * 1024, cache_type="blockcache"), "r")


def find_coords(h5, ds):
    g = ds.parent
    while g.name != "/":
        if "xCoordinates" in g and "yCoordinates" in g:
            return g
        g = g.parent
    raise KeyError(f"no coordinates found above {ds.name}")


def crop(row):
    import h5py
    import rasterio
    from pyproj import Transformer
    from rasterio.transform import from_origin

    outdir = OUT / "gunw" / row["stack"]
    tag = f"{row['ref_date']}_{row['sec_date']}".replace("-", "")
    if (outdir / f"{tag}_radargrid.npz").exists():  # written last, so the pair is complete
        return
    outdir.mkdir(parents=True, exist_ok=True)
    with open_remote(row["url"]) as h5:
        targets = []

        def visit(name, obj):
            if isinstance(obj, h5py.Dataset) and obj.ndim == 2:
                for grp, names in WANT.items():
                    if f"/{grp}/" in name and name.rsplit("/", 1)[-1] in names:
                        targets.append(obj)
        h5.visititems(visit)
        for ds in targets:
            cg = find_coords(h5, ds)
            x, y = cg["xCoordinates"][:], cg["yCoordinates"][:]
            epsg = int(np.array(cg["projection"]).item()) if "projection" in cg else 32652
            t = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
            w, s, e, n = BBOX
            xs, ys = zip(*[t.transform(a, b) for a, b in [(w, s), (w, n), (e, s), (e, n)]])
            ix = np.where((x >= min(xs)) & (x <= max(xs)))[0]
            iy = np.where((y >= min(ys)) & (y <= max(ys)))[0]
            if not len(ix) or not len(iy):
                print(f"  {ds.name}: study area not in this frame"); continue
            arr = ds[iy.min():iy.max() + 1, ix.min():ix.max() + 1]
            dx, dy = abs(x[1] - x[0]), abs(y[1] - y[0])
            if y[1] > y[0]:
                arr = arr[::-1]
            tr = from_origin(x[ix.min()] - dx / 2, max(y[iy.min()], y[iy.max()]) + dy / 2, dx, dy)
            layer = "_".join(ds.name.strip("/").split("/")[-3:]).replace("Interferogram", "")
            path = outdir / f"{tag}_{layer}.tif"
            with rasterio.open(path, "w", driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1,
                               dtype=arr.dtype, crs=f"EPSG:{epsg}", transform=tr, compress="deflate") as dst:
                dst.write(arr, 1)
            print(f"  wrote {path.relative_to(ROOT)} {arr.shape} {path.stat().st_size / 1e6:.1f} MB", flush=True)

        # Geometry and correction cubes (height x y x x, ~500 m posting): look direction,
        # incidence angle, troposphere and solid-earth-tide phase. Needed to correct the phase
        # and to combine ascending + descending tracks.
        rg = h5["science/LSAR/GUNW/metadata/radarGrid"]
        x, y = rg["xCoordinates"][:], rg["yCoordinates"][:]
        epsg = int(np.array(rg["projection"]).item())
        t = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
        w, s, e, n = BBOX
        xs, ys = zip(*[t.transform(a, b) for a, b in [(w, s), (w, n), (e, s), (e, n)]])
        pad = 2000
        ix = np.where((x >= min(xs) - pad) & (x <= max(xs) + pad))[0]
        iy = np.where((y >= min(ys) - pad) & (y <= max(ys) + pad))[0]
        sl = (slice(None), slice(iy.min(), iy.max() + 1), slice(ix.min(), ix.max() + 1))
        cubes = {k: rg[k][sl].astype("float32") for k in (
            "incidenceAngle", "losUnitVectorX", "losUnitVectorY", "perpendicularBaseline",
            "hydrostaticTroposphericPhaseScreen", "wetTroposphericPhaseScreen",
            "slantRangeSolidEarthTidesPhase") if k in rg}
        np.savez_compressed(outdir / f"{tag}_radargrid.npz", x=x[ix], y=y[iy], epsg=epsg,
                            heights=rg["heightAboveEllipsoid"][:], **cubes)
        print(f"  wrote {tag}_radargrid.npz ({len(cubes)} cubes)", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog-only", action="store_true")
    ap.add_argument("--inspect", action="store_true")
    args = ap.parse_args()
    rows = write_catalog()
    if args.catalog_only:
        sys.exit(0)
    gunw = [r for r in rows if r["product"] == "GUNW"]
    if args.inspect:
        with open_remote(gunw[0]["url"]) as h5:
            h5.visititems(lambda n, o: print(n, getattr(o, "shape", ""), getattr(o, "dtype", "")))
        sys.exit(0)
    for i, r in enumerate(gunw, 1):
        print(f"[{i}/{len(gunw)}] {r['stack']} {r['ref_date']} -> {r['sec_date']}", flush=True)
        try:
            crop(r)
        except Exception as ex:
            print(f"  FAILED: {type(ex).__name__}: {ex}", flush=True)
