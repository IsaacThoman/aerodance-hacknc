# Thumbnails

27 thumbnails of the six dance stages, each **with** the "aerodance." wordmark (`with-logo/`) and **without** it (`no-logo/`). All are **2160×1440 (3:2)** lossless PNGs, rendered in-engine from the real stages, dancers and post-processing in [`temp/frutiger-character`](../frutiger-character).

## Pixel perfect

The game draws a 640×480 buffer and shows it at 16:9, so each of its pixels is 4:3 wide. These thumbnails use that same pixel grid cropped to 3:2: a 540×480 buffer with the same pixel size and shape, the same bloom, grade and ACES tone mapping, and the same 4× MSAA. Each buffer pixel is written as an exact 4×3 block of the PNG, with no filtering, resampling or compression loss. You can check it: downsampling any image to 540×480 and back with nearest-neighbour gives the identical file.

The wordmark is the title screen's own (`drawTitle` in `client/src/ui/draw.js`, Inter 800/200), drawn at the title menu's scale into a buffer-sized canvas and composited with nearest filtering, exactly as the game's canvas UI draws it. Each `with-logo` image is the matching `no-logo` frame with the wordmark added on top.

## Shots

| Stage | Shots |
| --- | --- |
| Skyline Sanctuary | `sanctuary-skyline` (wide over the terrace and city), `sanctuary-hero`, `sanctuary-canopy` (¾ right), `sanctuary-towers` (worm's-eye), `sanctuary-closeup` (blue) |
| Coral Dome | `reef-dome` (the dome from outside), `reef-hero`, `reef-inside` (low ¾ under the glass), `reef-crown` (worm's-eye up to the crown) |
| Open Reef | `openreef-garden` (wide), `openreef-hero`, `openreef-surface` (worm's-eye up to the surface), `openreef-turtle` (¾ right) |
| Emerald Falls | `falls-valley` (wide over the falls and islands), `falls-meadow`, `falls-rainbow` (¾ right), `falls-cliffs` (¾ left), `falls-closeup` (purple) |
| Club Aquarium | `club-floor` (wide over the club and crowd), `club-dj`, `club-aquarium` (¾ right), `club-stage` (low, under the mirror ball) |
| Sugarsand Sunset | `beach-sunset` (wide), `beach-hero`, `beach-ball` (¾ left), `beach-palm` (¾ right), `beach-closeup` (purple) |

The dancers hold four moments of the capture: 3.1 s (purple's lunge), 5 s (blue's hands up), 9 s (reach) and 12.9 s (blue's wide arms). Club shots land just after a beat, when the lights peak.

## Animated GIF

`with-logo/reef-inside.gif` is the `reef-inside` shot in motion: the same camera, wordmark and 3:2 frame, with the dancers dancing and the reef moving. It is **720×480 and 4.6 MB**, under Devpost's 5 MB limit, and runs 3.6 s (72 frames at 20 fps), looping forever.

- **Size:** a 2160×1440 GIF can't get under 5 MB: it came to 33–37 MB however it was tuned. So the GIF is rendered in-engine at 720×480 with square pixels, roughly the size it's shown at. Every GIF pixel is a rendered pixel, with no resampling. The clip shares one 256-color palette with a light ordered dither.
- **Hold:** most of a GIF's bytes go to the water's faint shimmer. Background pixels that changed by no more than 10/255 since the last frame keep their color, which GIF stores almost for free. The dancers are never held: each frame also renders a mask of them, because the reef moving behind their translucent gel would otherwise leave faint ghosts. This roughly halves the file (8.5 MB without it).
- **Loop:** the clip covers 6.1–9.7 s of the dance, from the hands-up to the reach, and includes the PNG's moment (9 s). Over the last 0.6 s the dancers ease into the start, so they loop seamlessly. The background can't loop, so the turtle and fish jump back at the seam.

## Render

From the repository root, after `npm ci`:

```sh
npm --prefix temp/thumbnails ci
node temp/thumbnails/scripts/render.mjs                         # all shots, into this folder
node temp/thumbnails/scripts/render.mjs --only club-dj,beach-hero
node temp/thumbnails/scripts/render.mjs --spec my-shots.json --out /tmp/thumbs   # one-off shots
node temp/thumbnails/scripts/render.mjs --gifs                                   # the animated GIFs
```

It needs Google Chrome (driven headless by `playwright-core`, with GPU WebGL) and network access for the Inter font, plus ffmpeg for GIFs. A full run takes under 2 minutes on an M3 Pro. Renders are deterministic: re-rendering on the same machine gives byte-identical files. A different GPU or driver may differ slightly.

## Code

- `client/src/shots.js`: the shot list. Each shot has a stage, how long the stage plays before the capture (`time`), the dance-capture moment the dancers hold (`pose`), a camera, optional dancer placement and gel opacity (`reef-inside` uses 0.92 instead of 0.85 so the dancers read against the bright water), and the wordmark's position and size. Add or tweak a shot here and re-render it with `--only`. `CLIPS` lists the GIFs: a shot, a stretch of the dance, a frame rate, and optionally a render size, background hold and size limit.
- `client/src/App.jsx`: the capture page. It mounts one stage with the dancers, swaps in the shot's 3:2 camera for the stage's orbiting 16:9 one, steps the clock by hand at 60 fps to the shot's time (`frameloop="never"`), and reads back the frame with and without the wordmark. For GIFs it captures a run of frames with the dancers dancing in step with the stage. `?shot=<id>` opens a shot in the browser (`npx vite --config temp/thumbnails/vite.config.js`, port 5179).
- `scripts/render.mjs`: builds the page, drives Chrome, upscales each frame into exact 4×3 blocks and writes the PNGs with its own encoder. It holds the background of each GIF frame and pipes the frames to ffmpeg.

The stages needed two small, backward-compatible changes to render at 3:2: `RenderPipeline` takes an optional buffer size and display aspect (`stages/shared/post.jsx`), and the sanctuary and beach lens flares follow the camera's aspect. The game always renders at the old defaults, so it looks the same as before.
