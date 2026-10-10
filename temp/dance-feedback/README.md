# Move ratings mockup

Temporary mockup of the Just Dance–style judgement popups for aerodance. When a move is judged, the rating appears in the **top-left corner** with a combo counter underneath. Like the main app, it renders in-engine (no DOM UI) at a **640×480 buffer stretched to 16:9** with pixelated scaling. The two captured glass dancers perform centre stage for context.

## Designs

Five text-only Frutiger Aero designs (no container), plus the original bubble badge for comparison. Switch with **Q–Y** or the top row of chips; `#design1`–`#design6` in the URL picks the starting one.

| Key | Design | Look |
| --- | --- | --- |
| Q | Aqua Gel | Chunky glossy gel letters: white rim, coloured body, gloss band, sweeping glint, mirror reflection |
| W | Chrome Aero | Vista-style chrome: sky above a dark horizon band, rating colour below, bevel, coloured aura, lens sparkles |
| E | Liquid | Translucent water letters that drop in one by one with a bounce, drifting caustics, gentle wave, specular dots |
| R | Sky Glow | Airy white letters glowing in the rating colour, sliding in with afterimages over an anamorphic light streak, twinkles |
| T | Holo Glass | Smoky glass letters with an iridescent rim and drifting light stripe, swinging in like a glass panel |
| Y | Badge v1 | The first version: glossy gel pill with an icon disc |

## Ratings

The motion is shared by every design; colours come from the rating.

| Key | Rating | Behaviour |
| --- | --- | --- |
| 1 | Perfect | Slams in from large, rainbow colouring, spinning sunburst, gold stars |
| 2 | Great | Mint green, pop-in overshoot, sparkles |
| 3 | Good | Sky blue, pop-in, a few sparkles |
| 4 | OK | Lavender, smaller and softer pop |
| 5 | Miss | Red, shakes on arrival, then the letters come apart and tumble down with droplets; breaks the combo |
| 6 | Not even trying | Grey, shuffles in without energy, letters droop, floating "z"s, deflates out; breaks the combo |

Perfect, Great, Good and OK build the combo (`×N COMBO`, shown from 2); Miss and Not even trying break it (`×N COMBO BROKEN`). A new rating hurries the previous one off. The combo line is drawn in the active design's style.

## Controls

- **1–6** or the bottom chips: show a rating. **A** or **Space**: auto-play (roughly on the beat of a 118 BPM song, weighted towards good results).
- **H**: hold each rating on screen until the next one.
- **G**: gallery, all six ratings of the current design at once (open it directly with `?gallery`).

## View

From the repository root:

```sh
npx vite --config temp/dance-feedback/vite.config.js
```

Open http://localhost:5176 (or http://localhost:5176/?gallery to compare designs). The root `npm run build` also writes it to `dist/dance-feedback/`, so production and PR previews serve it at `/dance-feedback/`.

## Code

- `client/src/textFeedback.js`: the text-only popups. `createTextFeedback()` returns `{ trigger(type, now), draw(ctx, now), setDesign(i), setHold(on), drawSample(...), combo }` and owns the shared timing and motion (pop-in, Perfect slam and sunburst, Miss falling apart, Not even trying drooping, particles, combo).
- `client/src/designs.js`: the five looks. Each design is a small object with `font`, `tracking`, `draw(ctx, P)` and optional `letters`/`transform` hooks, so a new style is one more entry.
- `client/src/ratings.js`: rating palettes and timings shared by everything, and the original badge renderer (`createFeedback()`).
- `client/src/App.jsx`: the demo stage (sky, glossy floor, glass puck, bubbles, dancers from `temp/frutiger-character`), the controls and the overlay pass.

All popups draw with the 2D canvas API in 1600×900 design units, the same way `client/src/menu/MainMenu.jsx` draws the title menu, so they can move into the game as-is.
