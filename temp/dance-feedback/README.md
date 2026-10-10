# Move ratings mockup

Temporary mockup of the Just Dance–style judgement popups for aerodance. When a move is judged, the rating appears in the **top-left corner** with a combo counter underneath. Like the main app, it renders in-engine (no DOM UI) at a **640×480 buffer stretched to 16:9** with pixelated scaling. The two captured glass dancers perform centre stage for context.

## Designs

Five minimal Frutiger Aero designs, plus the original bubble badge for comparison. Each keeps to one idea in flat colour and nothing glows; over the bright sky the words stay readable through a deep ink colour, a thin outline or a tight shadow. Switch with **Q–Y** or the top row of chips; `#design1`–`#design6` in the URL picks the starting one.

| Key | Design | Look |
| --- | --- | --- |
| Q | Sky Glow | White letters in a liquid glass capsule tinted with the rating colour: bright rim, thickness along the inside edge, top highlight, light gathering at the bottom. Slides in and wobbles like water as it lands; on a Miss the letters spill out and the empty capsule fades |
| W | Aqua Line | Just the word: evenly spaced capitals in flat deep ink of the rating colour |
| E | Waterline | Pale glass letters with a thin outline, filled with flat water. The level is the grade: Perfect brims, Great is nearly full, Miss barely wets the bottom and drains |
| R | Mirror | Flat colour letters that rise in one by one over a faint reflection |
| T | Bubble | Rounded white letters with a flat coloured edge beside one glossy dot in the rating colour; Miss pops it |
| Y | Badge v1 | The first version: glossy gel pill with an icon disc |

## Ratings

The motion is shared by every design and kept minimal (no sunbursts, star bursts or droplets); colours come from the rating, and Perfect gets an iridescent soap-bubble finish.

| Key | Rating | Behaviour |
| --- | --- | --- |
| 1 | Perfect | Slams in from large, iridescent finish, three crisp twinkles |
| 2 | Great | Mint green, pop-in overshoot |
| 3 | Good | Sky blue, pop-in |
| 4 | OK | Lavender, smaller and softer pop |
| 5 | Miss | Red, shakes on arrival, then the letters come apart and tumble down; breaks the combo |

Perfect, Great, Good and OK build the combo (`×N COMBO`, shown from 2); Miss breaks it (`×N COMBO BROKEN`). A new rating hurries the previous one off. The combo line is drawn in the active design's style.

## Controls

- **1–5** or the bottom chips: show a rating. **A** or **Space**: auto-play (roughly on the beat of a 118 BPM song, weighted towards good results).
- **H**: hold each rating on screen until the next one.
- **G**: gallery, all five ratings of the current design at once (open it directly with `?gallery`).

## View

From the repository root:

```sh
npx vite --config temp/dance-feedback/vite.config.js
```

Open http://localhost:5176 (or http://localhost:5176/?gallery to compare designs). The root `npm run build` also writes it to `dist/dance-feedback/`, so production and PR previews serve it at `/dance-feedback/`.

## Code

- `client/src/textFeedback.js`: the minimal popups. `createTextFeedback()` returns `{ trigger(type, now), draw(ctx, now), setDesign(i), setHold(on), drawSample(...), combo }` and owns the shared timing and motion (pop-in, Perfect slam, Miss falling apart, twinkles, combo).
- `client/src/designs.js`: the five looks. Each design is a small object with `font`, `tracking`, `draw(ctx, P)`, optional settings (`lead`, `comboGap`) and optional `letters`/`transform` hooks, so a new style is one more entry. Bubble uses Nunito (`@fontsource/nunito`); the others use Inter.
- `client/src/ratings.js`: rating palettes and timings shared by everything, and the original badge renderer (`createFeedback()`).
- `client/src/App.jsx`: the demo stage (sky, glossy floor, glass puck, bubbles, dancers from `temp/frutiger-character`), the controls and the overlay pass.

All popups draw with the 2D canvas API in 1600×900 design units, the same way `client/src/menu/MainMenu.jsx` draws the title menu, so they can move into the game as-is.
