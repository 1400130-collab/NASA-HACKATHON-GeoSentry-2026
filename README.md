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
| **Real-world detail** | Zoom in and the terrain carries the real place: 3.65 million buildings in 3D, trees as tall as NASA GEDI measured them, land cover, fields, rivers, reservoirs, every road and railway. All of it lies on the same relief as the slope layers. |
| **Inspection sheet** | One printable page per county, in Korean, for field use. |

### How it works

```
NISAR GUNW interferograms (3 orbits, 23 pairs, Jun–Oct 2026)
  → ground movement history for every slope
  → model 1, the detector (GRU neural network): real movement or noise?
Terrain, burn severity, vegetation, land cover (Copernicus DEM, Sentinel-2, ESA WorldCover, Hansen GFC)
  → model 2, the ranker (LightGBM): which slopes look like the ones that failed in July 2026?
Physics: a GPU debris-flow simulation lets each flagged slope in the burn area go and follows the flow downhill
  → model 3, the reach model (LightGBM): learns the simulation, predicts how far debris runs below every slope in Korea
Rule: CHECK FIRST = (ranker top 5%, or real movement) AND a building or main road inside the slope's debris reach
      (regional 20 m map: the simulated flow itself has to reach it)
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

**Where the debris goes.** For the 4,351 slopes that the ranker or the radar flags on the regional map, a shallow-water solver with Voellmy friction (`pipeline/runout_solver.py`, PyTorch on the Mac GPU, 4,351 slopes at once) releases one 40 m × 40 m slide, 1.5 m deep, at the steepest spot and follows it. The debris reaches a mapped building or main road from 664 of them with cautious friction and 417 with the best-fit friction, against 1,326 under the old rule ("anything within 300 m downhill"). The check-first list is now those 664 slopes, each with a flow path, a reach and the buildings in it, and the map plays the flows in the storm replay. On a test plane the deposit's centre stops 13% short of where a rigid sliding block would (a spreading flow should stop a little short), and volume is conserved.

**A third model learns the physics.** The simulation only covers the burn area, so `pipeline/korea/k04b_reach.py` trains gradient-boosted trees on its 4,351 runs to predict the simulated reach from terrain alone. On counties it never saw it gets R² 0.46 and a typical error of ×1.22 (a constant gets ×1.45). Every slope in the country gets its own reach (161–345 m for 80% of them), and the nationwide rule looks that far downhill instead of 360 m everywhere. That moves 139 slopes: 110 leave the check-first list and 29 join it, leaving 3,168. The error is measured against the simulator, not against real debris flows, and it was trained only on flagged slopes in one region.

### What did not work

- **Pinning down the friction.** The two friction numbers were tuned so simulated run-out matches the 33 July 2026 scars. The scars are too small for that: their median length is 50 m, two and a half pixels. Friction μ anywhere from 0.06 to 0.33 fits about equally well, and on held-out counties the simulation is off by a typical factor of 1.59, worse than assuming every slide runs the median length (1.43). So the simulation gives a physically routed path, not a validated reach. We show two cases (best fit μ 0.27, median run 121 m; most mobile friction the scars cannot rule out μ 0.06, median 242 m) and let the cautious one decide the list.

- **NISAR inputs in the susceptibility model.** With pre-storm radar inputs (now including the downslope rate from the time-series inversion) the model caught 11 instead of 9 of the 29 failed slopes in its top 10%. That gain holds in only 68% of resamples, so the shipped model still leaves them out. NISAR enters the danger index through the movement flag instead.
- **Detectable sliding.** All 23 NISAR pairs are solved together into one downslope rate per slope with an error bar (`pipeline/p04b_velocity.py`). The typical error bar is ±7 mm a month, and 99.9% of the 69,799 slopes seen from two directions show no detectable movement. 95 slopes stand 4 error bars from zero: 21 downslope, which count as movement, and 74 upslope, which sliding cannot be, so they are not counted (cause unknown). After the detector agrees, 14 slopes are flagged as moving.
- **Rain thresholds from a physics model.** `pipeline/p12_stability.py` is an infinite-slope stability model with rain soaking into the soil, written in PyTorch so gradient descent tunes its soil numbers on the failures. It was meant to give each slope a number like "fails at 180 mm in 48 h". It does not, and we do not show one: rain does not separate the failed slopes in this data. Failed slopes had no more rain than the rest (AUC 0.43, where 0.5 is chance), the wettest 48 h between the two photos was 84 mm against 106 mm that the same slopes had already stood through since the fire, and the model's held-out top 10% holds 10% of the failures (chance is 10%, the ranker gets 31%). The one consistent result is the sign: fitted cohesion is lower on burned ground in every fold (0.2–1.3 kPa against 1.8–4.8 kPa unburned, for a 1.5 m soil layer), but the burned value sits at its lower bound, so read it as a direction, not a measurement. What the regional map shows instead is a fact, not a threshold: the heaviest 48 h rain each slope has stood through since the fire (87–189 mm, median 122 mm, from the 0.1° daily rain grid), and a "Rain forecast" layer whose slider lights up the flagged slopes that a forecast would take past that.
- **A sequence autoencoder** caught 7% of 3 cm movements, worse than a plain z-score (22%), so it was dropped.

### Limits

- The 20 failed slopes were found automatically and have not been checked by hand. [docs/label-review.md](docs/label-review.md) lists them, with the ones the radar does not support first.
- The sign of the radar phase was checked on all 23 pairs against weather-model delays and computed Earth tides (`analysis/sign_check.py`), not yet on a known moving slope. What causes the 74 uphill-reading changes is not known.
- A slope seen from one radar direction only (14,973 of them) cannot be given a downslope rate.
- The ranking is validated only in North Gyeongsang, the one place failures are mapped.
- It does not say when a slope will fail and must not be used to decide evacuations.
- The 3D buildings are the footprints that are openly mapped (OpenStreetMap and footprints traced from satellite images), about 3.65 million. Some buildings are missing, and most heights are an average for the 100 m around the building, not a survey. NASA publishes no building data, so these come from open sources; the trees and forest come from NASA GEDI. The risk levels do not use this layer.

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
| **GLAD GLCLUC 2020 forest height** (30 m) | UMD GLAD, from **NASA GEDI** lidar and Landsat | Height of the 3D trees |
| Overture Maps 2026-10-21 | OpenStreetMap (ODbL) + East Asian building footprints, Shi et al. 2024 (CC BY 4.0) | 3D buildings, local roads, railways, water, land use on the map |
| GHSL GHS-BUILT-H 2018 (100 m) | EC JRC | Building height where a footprint has none |
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
- Rebuild the regional results: `sh pipeline/run_all.sh` (about 4 minutes, plus about 25 the first time for the debris-flow simulation, which afterwards only reruns slopes that changed; `STABILITY=1` adds the soil-strength model; needs the data in `data/`, see [scripts/](scripts/), and a free NASA Earthdata token for NISAR).
- Rebuild the nationwide results: `sh pipeline/korea/run_all.sh`.
- Rebuild the real-world layers (buildings, trees, ground): `sh pipeline/world/run_all.sh` (about 15 minutes, 1.6 GB of downloads, no login).
- Recompute the new statistics: `python3 analysis/headline_stats.py` and `python3 analysis/radar_scar_check.py`.

## Repository

- `pipeline/`: regional pipeline (terrain, slope units, NISAR, labels, models, levels, export). `pipeline/korea/`: nationwide build.
- `pipeline/world/`: the real-world layers of the map. `site/data/world/`: their output, 7,415 tiles of 4 km (120 MB) that the map streams around the camera.
- `analysis/`: uncertainty and independent radar checks.
- `site/`: the static website. Every number is read from `site/data/**/meta.json`, `stats.json` or `radar_check.json`.
- `docs/`: [build plan](docs/build-plan.md), [concept](docs/concept.md), [expert consultation](docs/expert-consultation.md), [past winners research](docs/research.md), [label review list](docs/label-review.md), [demo video script](docs/demo-video.md).
- `interview/`: anonymised interview transcript (Korean and English).
- `demo/`: an earlier, unrelated idea (SPHEREx sky changes). Not part of SLOPEWATCH.

*SLOPEWATCH is a student prototype. It is not endorsed by NASA, ISRO, ESA, the Korea Forest Service or any research institute.*
