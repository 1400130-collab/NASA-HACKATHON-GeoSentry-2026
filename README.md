# SLOPEWATCH: check these slopes first

**Team GeoSentry** · NASA Space Apps Challenge 2026, Seoul · Challenge: *Dancing with the Stars: SARs* (NISAR surface change)

> Landslide warnings tell people when to run. SLOPEWATCH tells local governments which slopes to fix before the rain comes.

SLOPEWATCH turns NISAR L-band radar, Sentinel-2 imagery and terrain data into a ranked list of hillsides for every city and county in South Korea. It lists the slopes an officer should inspect first, gives the reasons for each, and prints a one-page inspection sheet per county.

It is a prevention tool. It does not predict when a slope will fail, and it is not a warning system.

## The problem

- Korea's landslide warnings combine soil water content from rainfall with a fixed hazard map of terrain and geology. That tells a region **when** conditions are dangerous.
- Nothing in that chain measures whether a particular hillside is **already moving** (from an expert consultation with a landslide researcher at a national institute, see [docs/expert-consultation.md](docs/expert-consultation.md)).
- A district officer decides which slopes to inspect and reinforce. They have hundreds of hillsides and a small team.

## What we built

| | |
|---|---|
| **Coverage** | 129,948 slope units in all 17 provinces. NISAR movement at 20 m over the North Gyeongsang burn area (85,690 units). |
| **Output** | 3,291 slopes to *check first* and 22,768 to *watch*. Each one shows its reasons. |
| **Interactive map** | 3D terrain of all of Korea with layers for priority, AI risk score, ground movement, fire damage and satellite photos, plus a storm replay. |
| **Inspection sheet** | One printable page per county, in Korean, for field use. |

### How it works

```
NISAR GUNW interferograms (3 orbits, 23 pairs, Jun–Oct 2026)
  → ground movement history for every slope
  → model 1, the detector (GRU neural network): real movement or noise?
Terrain, burn severity, vegetation, land cover (Copernicus DEM, Sentinel-2, ESA WorldCover, Hansen GFC)
  → model 2, the ranker (LightGBM): which slopes look like the ones that failed in July 2026?
Rule: CHECK FIRST = (ranker top 5%, or real movement) AND a building or main road within ~300 m downhill
  → map + county inspection sheets (static site, no server)
```

### Why North Gyeongsang

The March 2025 wildfires burned large areas of hillside from Uiseong to the east coast. On 18–19 July 2026 heavy rain hit the burn scar and 217 people were evacuated. Clouds hid the ground from optical satellites until 6 August. NISAR imaged it through the cloud on 21 July. That storm is our test case.

## Results

All figures are read from pipeline output files. None are typed in by hand.

**Hindsight test.** 25% of the slopes that failed in the July 2026 storm (5 of 20) were in our top 5%, using only pre-storm data, scored on counties the model never saw.

| Method | Failed slopes in top 5% | 90% interval | p vs chance |
|---|---|---|---|
| Random | 5% | | |
| Steepness only | 2 / 20 | 2–28% | 0.26 |
| Steep + burned rule | 3 / 20 | 4–34% | 0.08 |
| **SLOPEWATCH** | **5 / 20** | **10–46%** | **0.003** |

The model beats chance clearly. With 20 failures it cannot yet prove it beats the simple rule; the intervals overlap. ([analysis/headline_stats.py](analysis/headline_stats.py))

**Detection test.** We hid artificial downslope movement in real NISAR noise on slopes the detector had not seen. At 1% false alarms, the GRU detector catches half of 2.5 cm movements and 80% of 3.9 cm movements on well-oriented slopes. At 3 cm it catches 66%, against 33% for a matched filter and 22% for a z-score.

**Independent radar check of the labels.** The failure scars were found in Sentinel-2 optical images only. On the descending orbit (10 Jul → 15 Aug), radar coherence dropped sharply (more than 0.1 below the surrounding ground) at 55% of scars, 39% of old forest clearings that were bare before the storm, and 20% of random places. Scars against clearings: p = 0.03. The pair ending 21 July, two days after the storm and 16 days before the first clear optical image, already shows a weak signal (33% vs 19%, p = 0.04). Three orbits were tested, so these are supporting evidence, not proof. ([analysis/radar_scar_check.py](analysis/radar_scar_check.py))

**What it asks of an officer.** The median county gets 7 slopes to check first (the busiest gets 252). In the burn area, visiting the top 360 of 7,207 slopes would have reached 5 of the 20 July failures, against 1 for random visits.

### What did not work

- **NISAR inputs in the ranker.** Adding pre-storm radar readings made the ranking worse, so the ranker does not use them. NISAR is used for movement detection and for seeing the ground through cloud.
- **A sequence autoencoder** caught 7% of 3 cm movements, worse than a plain z-score (22%), so it was dropped.

### Limits

- The 20 failed slopes were found automatically and have not been checked by hand. [docs/label-review.md](docs/label-review.md) lists them, with the ones the radar does not support first.
- The sign convention of the radar phase (toward or away from the satellite) is assumed, not yet confirmed on a known moving slope.
- The ranking is validated only in North Gyeongsang, the one place failures are mapped.
- It does not say when a slope will fail and must not be used to decide evacuations.

## NASA data and other sources

| Data | Provider | Used for |
|---|---|---|
| **NISAR L2 GUNW interferograms** (3 tracks, 23 pairs) | NASA / ISRO, via NASA ASF DAAC (Earthdata) | Ground movement, coherence, radar check |
| **Hansen Global Forest Change v1.13** | UMD / Google / USGS / NASA | Forest loss before and after the fire |
| Sentinel-2 L2A | ESA Copernicus, via Microsoft Planetary Computer | Burn severity, vegetation, storm scars |
| Copernicus DEM GLO-30 / GLO-90 | ESA | Terrain, slope units |
| ESA WorldCover 2021 | ESA | Land cover |
| ERA5 rainfall | ECMWF, via Open-Meteo | Rain before and during the storm |
| OpenStreetMap | OSM contributors (ODbL) | Buildings and main roads below each slope |
| KOSTAT 2018 boundaries | Statistics Korea, via southkorea-maps | City, county and province borders |

## Tools

Python, NumPy, SciPy, LightGBM, PyTorch (GRU), H3 hexagons, three.js, plain HTML/CSS/JS.

## Use of AI (SI) tools

We used AI coding assistants to help write code and draft text. These parts were drafted with Claude Code (Anthropic), then reviewed and run by the team: the scripts in `analysis/`, sections 08–10 of the home page, sections 07–08 of the results page, this README, [docs/label-review.md](docs/label-review.md) and [docs/demo-video.md](docs/demo-video.md). The two models (the GRU detector and the LightGBM ranker) are our own, trained only on the satellite data listed above. No numbers are written by hand or by an AI.

## Team

Team GeoSentry, high school students in Seoul. *(Add member names here.)*

## Run it

```bash
python3 -m http.server 5173 --directory site     # then open http://localhost:5173
```

- `site/index.html`: home page. `site/map.html`: 3D map of Korea (`map.html?area=region` for the 20 m North Gyeongsang build with NISAR). `site/sheet.html`: inspection sheets. `site/review.html`: manual label review.
- Rebuild the regional results: `sh pipeline/run_all.sh` (about 4 minutes; needs the data in `data/`, see [scripts/](scripts/), and a free NASA Earthdata token for NISAR).
- Rebuild the nationwide results: `sh pipeline/korea/run_all.sh`.
- Recompute the new statistics: `python3 analysis/headline_stats.py` and `python3 analysis/radar_scar_check.py`.

## Repository

- `pipeline/`: regional pipeline (terrain, slope units, NISAR, labels, models, levels, export). `pipeline/korea/`: nationwide build.
- `analysis/`: uncertainty and independent radar checks.
- `site/`: the static website. Every number is read from `site/data/**/meta.json`, `stats.json` or `radar_check.json`.
- `docs/`: [build plan](docs/build-plan.md), [concept](docs/concept.md), [expert consultation](docs/expert-consultation.md), [past winners research](docs/research.md), [label review list](docs/label-review.md), [demo video script](docs/demo-video.md).
- `interview/`: anonymised interview transcript (Korean and English).
- `demo/`: an earlier, unrelated idea (SPHEREx sky changes). Not part of SLOPEWATCH.

*SLOPEWATCH is a student prototype. It is not endorsed by NASA, ISRO, ESA, the Korea Forest Service or any research institute.*
