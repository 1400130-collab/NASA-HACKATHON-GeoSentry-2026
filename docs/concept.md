# SLOPEWATCH concept (draft)

Draft notes written before the hackathon. Nothing here is built or validated.

## Who it is for

The local government officer who receives a landslide warning and has to decide which slopes in their district to check, reinforce or evacuate. The national research institute produces forecasts; local governments make the call.

## Why prevention, not prediction

- The existing warning system reacts to rain, so it works on a scale of hours.
- Ground movement can show up weeks or months earlier. That supports a different decision: which slopes to inspect and reinforce before the rainy season.
- We were told that the 2025 landslides were mostly forecast as high risk by the existing system. So we do not claim to catch what it misses. We add a measurement it does not use.

## Why NISAR

NISAR's L-band radar sees through vegetation better than earlier radar satellites, so it can measure ground movement on forested slopes. The challenge requires NISAR data, so it stays the main source. Sentinel-1 may be needed for history before NISAR's launch in 2025.

## Hero region

North Gyeongsang (Uiseong, Andong, Yecheon). Slopes burned in the 2025 wildfires are more landslide-prone. News reports say Andong designated 117 landslide-risk sites after the fires, and landslide advisories were issued in the area in July 2026.

## Backend

### Ground movement (not ML)

Stack NISAR interferogram products into a movement history per pixel, with atmospheric noise reduced. This is standard radar processing.

### Model 1: movement anomaly (self-supervised)

- Input: each slope's movement history.
- Model: a small sequence autoencoder trained on all slopes in the region. Slopes it reconstructs badly are flagged.
- Needs no labels.

### Model 2: landslide susceptibility (supervised)

- Labels: past landslide locations from NASA's global landslide catalog, plus Korea Forest Service records if available.
- Features: steepness, slope direction, curvature, burn status, forest loss, soil moisture, rainfall, NISAR movement rate.
- Model: gradient-boosted trees, with per-slope feature attributions as the listed reasons.
- Can be started without NISAR data; the movement feature is added later.
- Landslide records in the hero region alone are few, so it will train on a wider area.
- Must be tested on landslides held out by location, and the real accuracy reported.

### Model 3: surface-change segmentation (stretch)

- Input: NISAR radar brightness before and after.
- Model: a U-Net outlining burn scars, cleared forest and fresh landslide scars, with existing NASA disturbance maps as labels.

### Inspection level

Three levels: check first, watch, stable. Each slope shows its reasons, for example "moved 3 cm since March, steep, burned in 2025, 12 houses below". It is an inspection priority, not a probability of failure, and not a replacement for the national risk level.

## Demo plan

1. A 3D terrain map of the region with slopes coloured by inspection level.
2. Click a slope to see its movement history and reasons.
3. One real slope worked through end to end with real numbers.
4. If a suitable past landslide is found: a replay showing what the tool would have shown beforehand.
5. An auto-generated inspection sheet: the top slopes in a district, why each is listed, and a map.

## Build order

1. Confirm NISAR data can be downloaded and opened for the region.
2. Model 2 on elevation, rainfall and landslide records.
3. Ground-movement history for one area.
4. Model 1, then feed movement into model 2.
5. Map, inspection sheet, demo video and pitch.
6. Model 3 only if time remains.

Fallback if the movement pipeline does not work in time: before/after radar change maps for floods, forest loss and landslide scars.

## Risks and open questions

- How much NISAR data is public for the region is unknown.
- The movement pipeline is fiddly and may not finish in two days.
- No past landslide with a known date and place has been found for testing.
- How many Korean events the NASA landslide catalog holds is unknown.
- Whether national warnings are issued per region or per slope needs confirming.
