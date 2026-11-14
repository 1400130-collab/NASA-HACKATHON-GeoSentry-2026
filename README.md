# SLOPEWATCH (working title)

> **DRAFT.** These are pre-hackathon idea notes. Nothing described here is built or validated yet, and the details will change.

NASA Space Apps Challenge 2026, Seoul · Challenge: *Dancing with the Stars: SARs* (NISAR surface change)

## The idea in one line

The warning system tells you when to run. We show which slopes to fix before you have to.

## The problem

- Landslide warnings in Korea are driven by rainfall and soil water content, combined with a static hazard map of terrain and geology (from an expert consultation, see [docs/expert-consultation.md](docs/expert-consultation.md)).
- That tells a region when conditions are dangerous. It does not measure whether a particular slope is already moving.
- Local government officers are the ones who decide which slopes to check, reinforce or evacuate.

## What we want to build

An interactive map for one region (North Gyeongsang, where the 2025 wildfires burned large areas of hillside) that:

1. Measures ground movement on each slope from NISAR radar.
2. Flags slopes whose movement is unusual or speeding up.
3. Ranks slopes into three inspection levels (check first, watch, stable) and lists the reasons for each.
4. Produces a one-page inspection sheet a district officer could use.

This is a prevention tool. It does not predict the day a landslide will happen, and we will not claim that it does.

## Planned pipeline

```
NISAR radar passes
  → ground-movement history per slope (radar processing)
  → model 1: movement anomaly score (self-supervised autoencoder)
  → model 2: landslide susceptibility + reasons (gradient-boosted trees)
  → inspection level per slope
  → API → map + inspection sheet
```

A third model (segmenting burn scars, cleared forest and landslide scars from radar brightness) is a stretch goal. Details are in [docs/concept.md](docs/concept.md).

## Status

| Item | State |
|---|---|
| Idea and framing | Drafted |
| Expert consultation | One phone interview done |
| NISAR data access for the region | Confirmed: 3 tracks, 23 interferograms, 21 June to 1 November 2026 |
| Past event to test against | 18–19 July 2026 storm in Uiseong and Andong. Failure locations still to be mapped. |
| Code for this idea | Data download scripts only |

## What's in this repo

- [docs/build-plan.md](docs/build-plan.md): the build plan for the hackathon weekend (data, pipeline, models, validation, schedule)
- [docs/concept.md](docs/concept.md): the original idea notes. The build plan supersedes its build order.
- [scripts/](scripts/): data download scripts. Data goes to `data/`, which is not in git.
- [docs/research.md](docs/research.md): what past Space Apps winners had in common
- [docs/expert-consultation.md](docs/expert-consultation.md): anonymised summary of the expert interview
- [docs/outreach.md](docs/outreach.md): who else to talk to and the interview questions
- [interview/](interview/): the interview transcript in Korean and English, with the researcher's name and email removed. Machine-transcribed and not checked by ear.
- [demo/](demo/): a simulated demo from an earlier idea (SPHEREx sky changes). Not part of SLOPEWATCH.

## What is built (13 Nov 2026, still a draft)

- `pipeline/` turns the downloaded data into results: terrain and 85,690 hexagon slope units, NISAR movement per slope on three tracks, storm scar candidates, the susceptibility model (LightGBM), movement detectors (GRU, autoencoder, classical baselines) with an injection test, inspection levels. Rebuild with `sh pipeline/run_all.sh` (about 4 minutes).
- `site/` is the static site: a home page (`index.html`), the 3D map (`map.html`), method, results and about pages, a printable inspection sheet (`sheet.html`), and a page for the manual scar check (`review.html`). Preview with `python3 -m http.server 5173 --directory site`.
- Every number on the site is read from `site/data/meta.json`, which the pipeline writes. Nothing is typed in by hand.

Measured so far, and what is weak:

- Hindsight test: 31% of the July 2026 failed slopes fall in the top 10% of the ranking (chance 10%, steepness alone 7%). This rests on 29 slopes found automatically; nobody has checked them yet, and many sit beside older clearings.
- Adding NISAR's pre-storm inputs did not improve that ranking (17% with, 31% without), so the ranking does not use them.
- Injection test: a learned detector catches half of 2.5 cm downslope movements and 80% of 3.9 cm ones at 1% false alarms, against 33% at 3 cm for a matched filter. The sequence autoencoder did worse than a plain z-score and is not used.
- The sign of the radar phase (toward or away from the satellite) is assumed, not confirmed.

To do the manual check: open `site/review.html`, mark each patch, export `review.json`, save it as `data/work/review.json`, then run `sh pipeline/run_all.sh labels`.

## Nationwide map (14 Nov 2026)

`site/map.html` now covers all of South Korea (North Korea and Japan masked out); the North Gyeongsang 20 m map is still there at `map.html?area=region` (switch in the top-left of the map).

- Grid: EPSG:5179, 90 m analysis, 180 m slope-unit raster, 360 m 3D mesh; slope units are H3 resolution 8 (129,948 slope units).
- Sentinel-2 L2A from Microsoft Planetary Computer, five composites (Feb-Mar 2025, Apr 2025, May-Jul 2026, Aug 2026, latest Nov 2026), least cloudy scene first with clouds masked; natural colour and SWIR/NIR/red. Copernicus DEM (30 m slope), ESA WorldCover, Hansen 2025 loss, ERA5 rain (0.2 degree), OpenStreetMap buildings and roads, KOSTAT 2018 boundaries (17 provinces, 250 cities/counties).
- The risk model learns from the July 2026 failures in North Gyeongsang (the only labels) with whole counties held out, then ranks every slope in the country. It is trained jointly with the regional build: a label classifier (the 20 failed hexagons) plus a "student" that learns, from the nationwide inputs, to reproduce the 20 m regional model's ranking of 85,690 individual slopes; the shipped score is the mean of their two ranks. Hindsight capture in the top 10%, counties held out (the regional teacher is retrained without them too): joint 25% (90% range 10–40%, AUC 0.70), classifier alone 25% (AUC 0.62), student alone 35% (AUC 0.74), steepness alone 15%, chance 10%. Only 20 failed units, so these differences are inside the noise. It is not validated outside the training region.
- NISAR movement exists only for North Gyeongsang (the regional build, aggregated to the national units). Elsewhere levels rest on the ranking plus what lies below the slope. Extending NISAR needs an Earthdata login.
- Leaderboard (trophy button on the map): provinces and cities/counties ranked by check-first slopes, by share of their slopes, or by buildings below. Counted in the browser from the per-slope levels.
- Rebuild: `sh pipeline/korea/run_all.sh` (downloads into `data/korea/`, git-ignored) or `sh pipeline/korea/run_all.sh build`.
