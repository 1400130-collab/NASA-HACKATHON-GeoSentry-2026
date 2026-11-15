# 30-second demo video: script and shot list

Rules from the Space Apps submission guide: 30 seconds or less, public link (YouTube or Google Drive, no login), English subtitles if anyone speaks Korean. No faces or voices of anyone under 18. The video must name the team, the members and the challenge.

Every shot is a screen recording of the real site (`map.html` and `index.html`), so nothing needs an AI watermark. If you add any AI-generated image or voice, it needs a visible watermark.

| Time | On screen | Voice-over / subtitle |
|---|---|---|
| 0:00–0:03 | Black. White text: **SLOPEWATCH**, then *Team GeoSentry · NASA Space Apps Seoul 2026 · Dancing with the Stars: SARs* | "We're Team GeoSentry." |
| 0:03–0:08 | Map, North Gyeongsang. Storm replay playing: the rain bar hits 18–19 July and the timeline shows clouds. | "In July 2026, a storm hit hills that burned the year before. Optical satellites saw nothing for 18 days." |
| 0:08–0:14 | Switch to *Ground movement*, then *Radar clarity*. Camera dips toward one scar. | "NISAR's radar sees through cloud. It measures each slope moving, to a few centimetres, every 12 days." |
| 0:14–0:20 | Zoom out to all of Korea. *Where to check first* layer. The 3,291 counter and the sidebar list scroll. | "Two models turn that into a short list: 3,291 slopes to check first, with a house or road below." |
| 0:20–0:25 | Click one slope. Slope details panel, then *Inspection sheet* opens and is printed (or shown as PDF). | "Every county gets a one-page inspection sheet, in Korean, with the reason for each slope." |
| 0:25–0:30 | Home page section 07 bar chart (25% vs 5%), then closing card: *Check these slopes first.* | "Our list would have reached five times more of July's failures than chance. Fix the slope before the rain does." |

## Recording tips

- Record at 1920×1080 with the browser in full screen. Hide the bookmarks bar.
- `map.html` has a built-in *Storm replay* button that runs the camera moves; record it once and cut from it.
- The replay now ends with the debris-flow simulation (every flagged slope in the burn area lets go, then the camera follows one flow to the houses it reaches). The *Debris flows (burn area)* switch on the map plays the same thing on its own; either makes a good three-second shot. There are now three trained models: the detector, the ranker, and the reach model, which learned from the GPU physics runs how far debris travels and sets how far downhill the list looks for each slope. The physics solver itself is not a trained model, so say "three models and a physics engine".
- Keep subtitles on screen for the whole video, white text on a dark strip, at least 40 px high.
- Check the length: export, then confirm it is 0:30 or shorter before uploading.
