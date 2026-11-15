# Pitch script: backend and ML (about 2 minutes)

Every number here comes from `site/data/meta.json` (run of 2026-11-13). If the pipeline is rerun, check them again.

`[ ]` = what is on screen. Plain text = what you say.

---

## 1. The data (20 s)

`[method page, pipeline diagram]`

Our backend is ten Python steps that run on a laptop in a few minutes.

We cut the burn area, about 108 by 78 km, into **85,690 hexagon slopes**. For each one we collect terrain from the elevation model, burn damage and vegetation from Sentinel-2, rainfall, and the main thing: ground movement from **NISAR**.

## 2. NISAR (25 s)

`[map, movement layer, scrub the timeline]`

NISAR is a radar satellite. It passes every 12 days, and by comparing two passes we get how far the ground moved toward or away from it.

We use three tracks from June to October 2026. After we remove the atmosphere, the ionosphere and a terrain effect we found in the data, the noise is about **0.3 to 0.4 cm** per hexagon per pass. So we can see centimetres, from space.

## 3. Model 1: is this slope moving? (30 s)

`[results page, detection curve]`

Real landslide movement is rare, so we have almost no examples to train on. Our fix: we take real NISAR noise and **inject fake downhill movement** into it, then train a small GRU network to tell the two apart.

At 1 false alarm in 100, it catches **66% of 3 cm movements**. A classic matched filter catches 33%, and a simple threshold 22%. We also tried an autoencoder. It was worse than the threshold, so we dropped it.

## 4. Model 2: which slopes are weak? (30 s)

`[results page, capture curve]`

The second model is LightGBM with 26 inputs: terrain, burn and rain. We tested it on the July 2026 storm, using only data from before the storm, and with whole counties held out.

The top 10% of its ranking contains **31% of the slopes that failed**. Steepness alone gets 7%, and random gets 10%.

Honest part: that is only 29 failed slopes, found automatically from satellite images and not yet checked by a person. The range is 17 to 45%.

## 5. What the officer gets (15 s)

`[map, click a red slope, open the inspection sheet]`

Every slope gets one danger index from 0 to 100, from a rule anyone can read. Higher is worse, and the list is in that order:

- 50 to 79, **Watch**: moving, or top 20% weakest (15,863 slopes)
- 80 to 100, **Check first**: moving or top 5%, with a building or main road within 300 m downhill (1,335 slopes)

Inside Check first the number is 60% the slope and 40% what is below it. It is an inspection priority, not a % chance.

Then everything is exported as a static site. No server, nothing to download.

---

## If the judges ask

| Question | Answer |
|---|---|
| Do you predict landslides? | No. We rank slopes for inspection before the rainy season. |
| Does NISAR improve model 2? | Not provably. With NISAR inputs it catches 11 instead of 9 of the 29 failed slopes in the top 10%, a gain that holds in only 68% of resamples, so the shipped ranking leaves them out. NISAR enters the danger index through the movement flag. |
| Why trust a model trained on fake movement? | The noise is real, only the movement is injected. Tested on held-out hexagons. 50% detection at 2.5 cm, 80% at 3.9 cm, on slopes the radar sees at a useful angle (73% of them). |
| How many slopes are moving right now? | We solve all 23 radar pairs together into one downslope rate per slope, with an error bar of about ±7 mm a month. 99.9% of slopes show no detectable movement. 14 pass both the 4-error-bar rule and the detector. We proved which way is downhill by checking the radar against weather data and against Earth tides we computed from the Sun and Moon, so radar changes that read as uphill (74 slopes) are not counted. |
| What can't you measure? | 873 slopes, where the radar signal is too weak. They are marked Not measurable, not safe. |
| Biggest weakness? | Labels. 33 scars from 170 candidates, automatic, zero human-checked so far. |
| What matters most in model 2? | Rain in the 30 days before, vegetation after the fire, and relief. |
