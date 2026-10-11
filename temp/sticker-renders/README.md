# Sticker renders

In-engine renders of the three hype sticker NFTs (`bubble`, `koi`, `rainbow`). Each one is built as a real three.js object and rendered on a transparent background into `client/public/stickers/<id>.png` (**512×512**). The phone and the display draw these files in-engine (`client/src/ui/stickers.js`), and the sticker NFT metadata points at them (`server/battles.js`).

## What's in a sticker

Each sticker is a domed candy-glass badge with a 3D subject floating just above it. The badge is a lathe-turned coin with a top-lit gradient, a pearly iridescent bezel and an aero gloss. The subject casts a soft shadow onto it.

| Sticker | Badge | Subject |
| --- | --- | --- |
| `bubble` | Sky blue | Soap bubbles: a thin-film shader that's clear in the middle with a rainbow rim and window highlights |
| `koi` | Peach | A kohaku koi seen from above. Its tail swims out over the rim and a few bubbles rise from its mouth |
| `rainbow` | Lime | A glossy six-band candy rainbow between two puffy clouds |

The old flat art had a "KOI HYPE" style label. The new art has no text because a label is unreadable at the ~40–80 px the phone draws stickers at, and the NFT's name already says which sticker it is.

Reflections come from a studio light box (`RoomEnvironment`), like the trophy renders. The frame is drawn at 1024 px and scaled down to 512 px.

## Render

From the repository root, after `npm ci`:

```sh
node temp/sticker-renders/scripts/render.mjs                    # all three, into client/public/stickers/
node temp/sticker-renders/scripts/render.mjs --only koi
node temp/sticker-renders/scripts/render.mjs --out /tmp/stickers
```

The renders need Google Chrome or Microsoft Edge with GPU WebGL (`CHROME_PATH` picks another browser). There's nothing extra to install: the script drives the browser over the DevTools protocol with Node's own WebSocket.

To look at one live, start the capture page (`npx vite --config temp/sticker-renders/vite.config.js`, port 5181) and open `?sticker=koi`. A checkerboard behind the canvas shows the transparency.

## Code

- `client/src/Sticker.jsx`: the badge and the three subjects.
- `client/src/App.jsx`: the capture page: lights, shadow, camera and `window.__sticker.render()`.
- `scripts/render.mjs`: builds the page, renders each sticker and writes the PNGs.
