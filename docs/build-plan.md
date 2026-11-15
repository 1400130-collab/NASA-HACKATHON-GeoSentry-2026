# GeoSentry build plan

Written 13 November 2026, the night before the hackathon (14–15 November, Seoul). This replaces the build order in [concept.md](concept.md). Nothing below is built yet. Every result marked **TBD** is a number we have to measure, not one we already know.

## 1. What we found today that changes the plan

| Finding | Why it matters |
|---|---|
| NISAR covers our region. Three tracks (125 ascending, 024 ascending, 032 descending), one pass every 12 days, 21 June to 1 November 2026. 23 interferograms in total. | The hard version is possible. This was the biggest open risk. |
| NISAR only started imaging Korea in late June 2026. | We have about four months of movement history, not years. We cannot claim long-term trends. |
| On 18–19 July 2026 heavy rain hit Uiseong and Andong: 217 people evacuated, roads washed out, temporary housing for 2025 wildfire victims flooded, landslide advisories issued (news reports, see Sources). | This is our test event. It is inside the burn scar and inside the NISAR record. |
| NISAR passed over on 9, 10, 16 and 21 July. The first clear Sentinel-2 optical image after the storm is 6 August. | Radar saw the ground 2 days after the storm. Optical satellites were blocked by cloud for 18 days. We can measure this, not just say it. |
| Only 1–2 interferograms exist before the storm. | A "movement before failure" test on the July storm is thin. The hindsight test must rest mainly on the susceptibility model, with movement as one input. |
| Full files are 2.4 GB (interferogram) to 7 GB (backscatter). Reading only our window over the internet gives about 10 MB per interferogram. | No large files on anyone's laptop. Tested and working. |

## 2. The claim we will prove

> Using only data from before the July 2026 storm, our ranking would have sent inspectors to the slopes that failed far more often than chance. The same pipeline now lists the slopes still moving, to check before the 2027 rainy season.

Three numbers carry the pitch. We commit to reporting each one whatever it turns out to be.

1. **Hindsight capture rate.** Of the slopes that failed in July 2026, what share were in our top 10% "check first" list built from pre-storm data only? Compared with a slope-steepness-only ranking and with chance (10%).
2. **Smallest movement we can detect.** Measured from real NISAR noise with an injection test (section 6.1). In centimetres.
3. **What NISAR adds.** The capture rate with and without the NISAR inputs.

What we will not claim: that we predict the day of a landslide, that we beat the national warning system, or that four months of data show a long-term trend.

## 3. Regions

- **Demo region:** the March 2025 burn scar from Uiseong through Andong, Cheongsong and Yeongyang to Yeongdeok. Box: 128.30–129.50°E, 36.15–36.85°N (about 108 × 78 km).
- **Why one region for the demo:** past winners picked one specific place, and movement processing for all of Korea is out of reach in two days.
- **Second training region (labels B):** Sancheong, South Gyeongsang. It also burned in March 2025 and had many landslides in the July 2025 rain. It gives the susceptibility model more failure examples on burned slopes. There is no NISAR before that event (the satellite launched 30 July 2025), so Sancheong is used for terrain and burn features only.

## 4. Data

All on one grid: UTM zone 52N (EPSG:32652), 20 m pixels, aligned to NISAR's 80 m grid.

| Layer | Source | Login | State |
|---|---|---|---|
| NISAR interferograms (GUNW): unwrapped phase, coherence at 80 m and 20 m, ionosphere screen, troposphere and geometry cubes. 23 pairs, 3 tracks. | NASA ASF DAAC | Earthdata token | Fetching (`scripts/fetch_nisar.py`) |
| NISAR backscatter (GCOV) HH + HV, 2 dates before and 2 after the storm | NASA ASF DAAC | Earthdata token | Not fetched. Only needed for model 3. |
| Elevation, 30 m | Copernicus DEM | None | Downloaded |
| Sentinel-2 red, NIR, SWIR, cloud mask: before fire (14 Mar 2025), after fire (8 Apr 2025), before storm (12 Jun 2026), after storm (6 Aug and 2 Oct 2026) | AWS open data | None | Downloading |
| Tree cover and loss year to 2025 | Hansen Global Forest Change v1.13 | None | Downloaded |
| Land cover 2021 | ESA WorldCover | None | Downloaded |
| Daily rainfall 2025–2026, 0.1° grid | Open-Meteo (ERA5) | None | Downloaded. Coarse and reads low in extreme rain. |
| County boundaries | geoBoundaries | None | Downloaded |
| Buildings and main roads | OpenStreetMap | None | Downloading. Rural building coverage may be patchy. |
| Past landslide records | Korea Forest Service API on data.go.kr | API key | Not requested. Unknown whether it includes coordinates. |
| National landslide hazard map grade | Korea Forest Service | Unknown | Not found. Wanted as a baseline. |

Scripts: `scripts/download_public.py`, `scripts/fetch_nisar.py`. Data lands in `data/` (git-ignored). The token lives in `.env` (git-ignored).

Dropped: NASA's Global Landslide Catalog. Its download links did not respond today, and it is known to hold few, imprecisely located Korean events.

## 5. Pipeline

```
A  Terrain + slope units ──────────────┐
B  Burn severity, vegetation ──────────┤
C  NISAR → movement history per unit ──┼─→ E  Model 2: susceptibility (pre-storm inputs only)
D  July 2026 failure labels ───────────┘        │
C  ────────────────→ F  Model 1: movement anomaly (post-storm monitoring)
                                                 ↓
                       G  Inspection level + reasons + houses below
                                                 ↓
                       H  Static map site + printable inspection sheet
```

### A. Terrain and slope units

- From the DEM: slope angle, aspect, curvature, local relief, flow accumulation, wetness index, distance to stream.
- **Units:** start with a hexagon grid about 170 m across (H3 resolution 9), keeping hexes with mean slope above 10°. Expect a few tens of thousands of units. Upgrade to true slope units (half-basins split at ridges and streams, using the `whitebox` package) only if hexes are working end to end by Saturday evening.
- Radar visibility per unit and track: NISAR's own mask layer plus slope and aspect against the look direction. A slope the radar cannot see is labelled "not measurable", never "stable".

### B. Burn and vegetation

- Burn severity: change in the burn ratio (NIR and SWIR) between 14 March and 8 April 2025.
- Recovery: vegetation index on 12 June 2026.
- Tree cover in 2000 and loss year.

### C. NISAR movement history (radar processing, not ML)

For each of the 23 interferograms:

1. Convert phase to line-of-sight movement. One full cycle is about 12 cm at L-band; read the exact wavelength from the file. Confirm the sign convention on a known feature before trusting direction.
2. Subtract the ionosphere screen, troposphere (hydrostatic + wet, interpolated to ground height from the cubes) and solid-earth tides. None are applied in the product by default.
   - Checked on the first pair (track 024, 27 June→9 July): the ionosphere screen spans −11 to −25 radians, larger than the raw phase itself (−4 to +9). This correction decides whether the result is usable, so test it first.
3. Mask pixels with coherence below 0.3 or outside the main unwrapped region. On the first pair the median coherence is 0.40 and 66% of covered pixels pass.
4. Remove what is left of the atmosphere with a spatial high-pass filter (about 2 km), so each slope is measured relative to its surroundings.
5. Chain the pairs in date order into a cumulative series per track: 9 dates for tracks 125 and 024, 8 for track 032.
6. Take the median per unit and the fraction of valid pixels.

Then:

- **Noise floor:** the spread of the series on flat valley floors and towns, which should not move. This sets the smallest movement we can report.
- **Two look directions:** combine track 125 (ascending) and 032 (descending) into vertical and east–west movement. Stretch: project onto the downslope direction.
- **Known weakness:** the pairs form a single chain with no redundant pairs, so one bad unwrap carries through the rest of the series. We flag jumps close to a whole cycle (12 cm) as suspected unwrapping errors instead of movement.

### D. Failure labels for the July 2026 storm

1. Sentinel-2, 12 June against 6 August 2026: vegetation drop, on slopes above 15°, not cropland or built-up, cloud-free, at least 4 connected pixels. Must still be bare on 2 October.
2. **Manual check.** One person reviews every candidate on before/after false-colour images and marks it failure, logging, or unclear. Budget two hours. Only "failure" becomes a label.
3. Independent radar check: does NISAR 20 m coherence drop in the pair spanning the storm (9→21 July on track 024, 16 July→21 August on 125, 10 July→15 August on 032) at the same places?

Known trap: burned timber is being cleared across this area, and clearing looks like a scar in a vegetation index. Shape (long and narrow, running downslope) and the manual check are the defence. Report how many candidates were rejected.

**Labels B (Sancheong, July 2025):** same method on Sentinel-2 images from before and after that storm. About 200 MB more to download.

### E. Model 2: susceptibility (gradient-boosted trees)

- **Job:** rank every unit by how likely it was to fail, from information available before 18 July 2026.
- **Inputs:** terrain (A), burn and recovery (B), land cover, rainfall before the storm, and from NISAR: pre-storm coherence and the 1–2 pre-storm movement measurements.
- **Labels:** D, plus labels B.
- **Model:** LightGBM, with class weighting for the rare failures.
- **Testing:** hold out whole counties in turn (train on four, test on the fifth), so the model is never tested next to slopes it trained on.
- **Reported:** capture curve (share of failures found against share of slopes inspected), precision-recall, and the three comparisons: steepness only, steepness + burn rule, and the model without NISAR inputs. Add the national hazard grade if we obtain it.
- **Reasons:** per-unit feature attributions (SHAP), turned into plain sentences: "steep (34°), burned at high severity, vegetation not recovered".
- **Leak check:** no input may come from after 18 July 2026 in the hindsight run. The 2026 monitoring run is separate and may use everything.

### F. Model 1: movement anomaly (sequence autoencoder)

- **Job:** in the post-storm series (21 July to 20 October), find units whose movement does not look like normal noise.
- **Input per unit:** movement and coherence from each of the three tracks on a common 12-day timeline.
- **Model:** a small GRU or 1D-convolution autoencoder in PyTorch, trained on all units. A few minutes on the M4.
- **Score:** reconstruction error, counted as real only when at least two tracks agree or one track exceeds the noise floor.
- **Baseline it must beat:** a plain movement-rate-over-noise score. If it does not beat it, we say so and ship the simpler score.
- **Testing without labels (injection test):** take real series from held-out quiet units, add artificial steady movement of 1, 2, 3 and 5 cm, and measure how often each is caught at a fixed false-alarm rate. This gives number 2 in section 2.

### Model 3: storm-scar mapping from radar (U-Net, stretch)

- **Job:** outline fresh scars from NISAR alone, days after a storm, through cloud.
- **Inputs:** coherence before and across the storm, and HH/HV backscatter change (needs the GCOV crop).
- **Labels:** the manually checked scars from D.
- **Start only if** gate G3 passes (section 8). Otherwise the coherence-drop map from D.3 stands in, and we present it as a threshold, not a model.

### G. Inspection level

A fixed, readable rule on top of the models. Not a probability.

| Level | Rule |
|---|---|
| Check first | Confirmed movement with buildings or a road below, or top 5% susceptibility with buildings or a road below |
| Watch | Confirmed movement, or top 20% susceptibility |
| No signal | Measurable, and none of the above |
| Not measurable | Radar cannot see the slope well enough on any track |

"Below" means within about 300 m downslope along the flow path. Each unit carries its reasons, its movement in cm with the noise floor, and the count of buildings below.

### H. What people open

- **Static site**, no server: MapLibre map with 3D terrain, units coloured by level, vector tiles in one PMTiles file, one small JSON per unit loaded on click (movement chart, reasons, before/after images).
- **Storm replay:** a slider from June to October showing rain, the 18–19 July storm, what NISAR saw on 21 July, and what optical saw on 6 August.
- **Inspection sheet:** one printable page per township in Korean: top slopes, why each is listed, a map. English toggle on the site.
- **Hosting:** Cloudflare Pages or GitHub Pages from a separate public repository holding only the built site and code. Anyone with the link sees everything. Nobody downloads data or logs in. Expected size: tens of MB.
- **Before anything goes public:** the interview transcripts in `interview/` are verbatim and the researcher asked us to avoid direct quotes. Leave them out of the public repository, or email the researcher first.

## 6. How we know it works

1. **Hindsight test** (section 5E): held-out counties, pre-storm inputs only, three baselines.
2. **Injection test** (section 5F): detection rate against movement size.
3. **Stable-ground check:** towns and valley floors should show no movement. If they do, the processing is wrong.
4. **Track agreement:** two ascending tracks see the same slopes from nearly the same direction, so their series should agree. Report the correlation.
5. **Radar against optical:** overlap between coherence-drop patches and checked Sentinel-2 scars.
6. **One real slope, end to end:** pick the clearest checked failure and show everything we had on it before the storm and after.

Success thresholds, set now so we cannot move them later: capture in the top 10% at least twice chance and above steepness-only; stable ground within the noise floor; the two ascending tracks positively correlated on moving units.

## 7. Schedule

Hours count from the Saturday start. Confirm the local submission deadline at the opening; the plan assumes a feature freeze 5 hours before it.

**Tonight (Friday)**
- Finish downloads. Open one interferogram and check it looks like terrain-correlated fringes, not noise.
- Request a data.go.kr API key for the Korea Forest Service past-landslide API.
- Email the researcher follow-up question 4 (a past landslide with known date and place).
- Install `tippecanoe` for map tiles. Decide roles.
- Check the local rules on work done before the event. Tonight's work is data download and planning only.

**Roles** (merge if fewer than four people)
- **Radar:** sections C and F.
- **Model:** sections A, B, E, G.
- **Labels and validation:** section D, the manual check, section 6.
- **Product and pitch:** section H, video, slides, submission text. Owns presentation from hour 0.

| Hours | Radar | Model | Labels | Product |
|---|---|---|---|---|
| 0–3 | Corrections on one track, one pair | Terrain features, hex units | Scar candidates from Sentinel-2 | Map shell with terrain and fake data |
| 3–6 | All pairs, track 125. Noise floor. | Burn features, feature table | Manual check | Click panel, chart, level colours |
| 6–7 | **Gate G1** | **Gate G2** | | |
| 7–11 | Tracks 032 and 024. Track agreement. | First model, county hold-out, baselines | Sancheong labels B | Real units on the map |
| 11–14 | Per-unit series, visibility mask | Add NISAR inputs, ablation, SHAP reasons | Radar-against-optical check | Storm replay slider |
| 14–16 | Autoencoder + injection test | Inspection-level rule, exposure counts | Pick the worked-example slope | Inspection sheet |
| 16 | **Gate G3** | | | |
| 16–22 | Two-direction movement, or help product | Final runs, freeze numbers | Validation figures | Deploy public site |
| 22–25 | Model 3 only if G3 passed | Write method section | Check every number in the pitch against outputs | Video, slides, submission text |
| Last 5 | Freeze. Rehearse. Submit early. | | | |

## 8. Gates and fallbacks

| Gate | Question | If no |
|---|---|---|
| G1, hour 6 | Does one track give a clean movement map with stable ground near zero? | Drop the time series. Use coherence change only: NISAR as a through-cloud storm-damage mapper, plus model 2 on non-movement inputs. |
| G2, hour 6 | Are there at least 30 checked failures from July 2026? | Train on Sancheong labels B and test transfer to the demo region. Present the July 2026 storm as a case study, not a statistical test. |
| G3, hour 16 | Are the site, model 2 and model 1 all working with real data? | No model 3. Spend the time on the site and pitch. |
| Any time | Does a result look too good? | Assume a leak (post-storm input, or neighbouring units split across train and test) until shown otherwise. |

## 9. How it maps to the judging criteria

| Criterion | What we show |
|---|---|
| Impact | A named user (the district officer), a named decision (which slopes to inspect), a printable sheet in Korean |
| Creativity | Using the gap between radar and optical after a storm; three radar tracks on one slope; "not measurable" as an honest fourth level |
| Validity | The hindsight test on held-out counties, the injection test, the stable-ground check, and stated limits |
| Relevance | NISAR is the core measurement, and we report exactly what it adds |
| Presentation | One storm, one slope, one map. The replay slider is the opening of the demo. |

Submission needs (from the 2025 guide; confirm for 2026): summary, demo as slides or a 30-second video, public project link, data sources, references, and a disclosure of AI use. We used AI tools heavily and must say so.

## 10. Risks

| Risk | Handling |
|---|---|
| The storm caused flooding and road washouts but few hillside failures | Gate G2 and labels B |
| Timber clearing mistaken for scars | Manual check, shape filter, report rejections |
| Four months and a single chain of pairs: noisy movement | Noise floor stated beside every measurement; two-track confirmation |
| Most Korean landslides are sudden and may show no movement beforehand | Movement is one input, not the whole method. We report what NISAR adds even if it is small. |
| Summer vegetation lowers coherence | L-band copes better than C-band; report the share of slopes measurable |
| Products are "provisional" quality | Say so; the last cycle (25 Oct–1 Nov) is in the validated collection |
| OpenStreetMap misses rural buildings | Say so on the sheet; add a national building layer if a key is available |
| Too much scope for two days | Gates. Model 3, slope units and downslope projection are all optional. |

## Sources

- [NISAR GUNW product guide (ASF)](https://nisar-docs.asf.alaska.edu/gunw/)
- [Evacuations in northern North Gyeongsang, 19 July 2026 (ekn.kr)](https://m.ekn.kr/view.php?key=20260719028003612)
- [Recovery after the rain in North Gyeongsang, 20 July 2026 (Korea Daily)](https://www.koreadaily.com/article/20260720183901180)
- [Flood damage in Uiseong and Andong, 19 July 2026 (Nate News)](https://news.nate.com/view/20260719n08078)
- [Temporary housing swept away in Uiseong and Andong (Nate News)](https://m.news.nate.com/view/20260719n07391)
- [Andong flood site and wildfire survivors (Greenpeace Korea)](https://www.greenpeace.org/korea/update/38057/blog-ce-climate-disaster-site-flooded/)
- [Korea Forest Service past-landslide API (data.go.kr)](https://www.data.go.kr/data/15074816/openapi.do)
