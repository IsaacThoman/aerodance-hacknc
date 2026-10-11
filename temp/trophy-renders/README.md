# Trophy renders

In-engine renders of the winner's trophy NFT: the same traits as `server/trophyArt.js` (stage, glass colour, shape, finish, golden halo), built as a real 3D trophy and rendered on that stage's own scene, lights and post-processing from [`packages/stages`](../../packages/stages), with the title screen's wordmark and a name card on top. Each render is **1080×1080** (the NFT's 1:1).

`renders/<battleId>.png` has the 2D layer and `renders/plain/<battleId>.png` doesn't. The samples are the six battles from the SVG gallery, one per stage, covering every shape and finish.

## What's in a render

| Trait | In 3D |
| --- | --- |
| Stage | The stage itself, framed on its dance floor (`FRAMING` in `client/src/shots.js`) |
| Shape | **Classic**, **Goblet** and **Star**: the SVG's bowl Béziers turned on a lathe, with a real glass wall. **Bubble**: a glass sphere with a little glass dancer inside. **Dancer**: the game's own character (`packages/character`) holding the capture's hands-up pose |
| Finish | **Glass**: tinted transmissive glass with a glowing drink and fizz. **Chrome**: polished metal. **Iridescent**: pearly opal with a thin-film rainbow |
| Golden halo (sync ≥ 0.7) | Gold halo rings, light column and name-card rim instead of the stage's accent |
| Pops / flair | Soap bubbles / glints around the trophy |

Every trophy stands on a white glass pedestal with a WINNER plate, inside halo rings and the winner's light column, like the win screens.

## Keeping the trophy clear

The trophy has to read on every stage, from the white Sanctuary terrace to the dark club, so the renders treat it like a product shot (`client/src/pipeline.jsx`, the game's pipeline plus two passes):

- **Depth of field:** the trophy stays sharp and the stage goes soft.
- **Backdrop:** everything outside the trophy's silhouette is dimmed and desaturated a little, feathered into a soft spotlight.
- **Studio reflections:** the trophy's materials reflect a light box (`RoomEnvironment`) instead of the stage's sky, so chrome and glass keep crisp highlights even in hazy water.
- Glows and lights scale down on stages that bloom early (the club), and bloom never starts below 1.6 in these shots.

The grade is the game's own (`GradeShader`, exported from `packages/stages/shared/post.jsx`).

## Render

From the repository root, after `npm ci`:

```sh
node temp/trophy-renders/scripts/render.mjs                        # the six samples, into renders/
node temp/trophy-renders/scripts/render.mjs --only 3wegvq,tadr5e
node temp/trophy-renders/scripts/render.mjs --spec battles.json --out /tmp/trophies   # any battles
```

A spec is a list of `{ id, score, pops, sync, flair }`; the id seeds the traits exactly as the server does. It needs Google Chrome or Microsoft Edge (`CHROME_PATH` picks another) with GPU WebGL, and network access for the Inter font. There's nothing extra to install: the script drives the browser over the DevTools protocol with Node's own WebSocket. Each trophy takes 15–60 s on integrated graphics.

To look at one live, start the capture page (`npx vite --config temp/trophy-renders/vite.config.js`, port 5180) and open `?battle=<id>` or `?spec=<JSON>`; `window.__trophy.render()` steps the stage and draws the frame.

## Code

- `client/src/Trophy.jsx`: the 3D trophy, pedestal, halo rings, light column, bubbles and glints.
- `client/src/pipeline.jsx`: the render pipeline with the depth of field and backdrop passes.
- `client/src/hud.js`: the 2D layer, drawn with the game's UI kit (`client/src/ui/draw.js`).
- `client/src/App.jsx`: the capture page. It mounts the battle's stage and trophy, swaps in a square camera, steps the clock by hand to the framing's time (`frameloop="never"`) and reads back the frame with and without the 2D layer.
- `client/src/shots.js`: the sample battles and each stage's framing.
- `client/src/sha256.js`: `node:crypto`'s sha256 in plain JS, so `server/trophyArt.js` runs in the browser (aliased in `vite.config.js`).

These are offline renders: the live NFT still points at the server's SVG (`/nft/<battleId>.svg`), since the server doesn't run the 3D engine.
