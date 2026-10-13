# aerodance

React + three.js (via [@react-three/fiber](https://r3f.docs.pmnd.rs/)) rendered in a full-screen canvas, served by Express, with realtime updates over Socket.IO and events stored in a [TimescaleDB](https://www.tigerdata.com/) hypertable.

The server still records `spin` events in the `spins` hypertable, but the current client no longer sends them.

See [how scores are calculated](docs/scoring.md) and [the plan for finishing the game](docs/game-completion-plan.md).

See [the browser webcam plan](docs/browser-webcam-plan.md) for shared game/editor webcam input and selectable in-browser MediaPipe Lite, Full, and Heavy models.

See [the song and dance authoring workflow](docs/song-dance-authoring-workflow.md) for the proposed Docker-hosted editor, pose format, raw landmark editing, Frutiger playback, and portable song bundle contract.

The editor is implemented as [Dance Studio](tools/choreography/README.md).
Run `docker compose -f tools/choreography/compose.yaml up --build -d` and open
http://localhost:8082 to record/import, edit, preview, save, and export song bundles.

## Aero background

The canvas shows a looping Frutiger Aero drone flight (glass skyline, clouds, hot-air balloons, gulls, flower meadow). The display is one letterboxed 16:9 frame rendered at a fixed 640x480 buffer and scaled up with `image-rendering: pixelated`; the HUD sits inside the frame.

- `client/src/aero/aeroBackground.js` builds the world. `createAeroWorld({ renderer, scene, camera, speed, quality })` returns `{ update(dt), render(), setSpeed, dispose }` for use inside an existing renderer; `createAeroBackground(canvas, options)` is a standalone full-canvas version.
- `client/src/aero/AeroWorld.jsx` plugs it into the Fiber `<Canvas>` (used by `Scene.jsx`): `<AeroWorld speed={1} quality="auto" />`. It renders the frame itself, so it uses whatever buffer size `FixedRenderResolution` sets.
- The loop starts low over the meadow facing the skyline (`start` 0.08). Downtown, the east/west districts and the north district across the lake all sit on one 70 m street grid; the lake uses a reflective water surface with boats and quays.
- `quality="low"` thins out grass, flowers and leaf detail for weaker GPUs; `auto` picks it on touch devices.

### Sound

`client/src/audio/mixer.js` runs all audio through one Web Audio context. Settings → Sound drives it: **Master** (everything), **Music** (all music, menu and in-game), **Effects** (sound effects), **Menu music** (switches off just the menu's background track; in-game songs go straight to the music channel) and **Mute all** (silences everything). Settings are saved per browser (`menu/soundSettings.js`). The game currently ships no menu music or sound effects, so only songs play through it; `client/src/audio/loopingMusic.js` can loop a menu track on the Menu music channel.

## Main UI flow

**Start → One Player / Two Players → Song Select → song preview → Dance! → results**, all drawn in-engine. Back (or Escape) from Song Select returns to the player count, and every screen works with the mouse, touch and the keyboard (arrows and Enter).

- **Connect Client** (`client/src/connect/`): the status pill in the top-right corner of Settings opens a card for the webcam pose input: camera selection and in-browser MediaPipe **Lite / Full / Heavy** tracking for both player modes. Start camera requests permission; the mirrored setup preview shows player placement. Model/camera changes restart tracking and release the old camera. For a scored run without a camera, open the game with `?input=ghost`: an autoplay ghost copies each routine (`&ghostLagMs=300` dances late).
- **Song Select** (`client/src/game/SongSelect.jsx`) lists the published songs four to a page. Extract Dance Studio's song ZIPs into `client/public/songs/`: Song Select finds the exported folders without manifest edits (`server/songCatalog.js`), and builds generate the catalog for static hosting, so rebuild or redeploy to publish changes. The repo ships no songs, so the list stays empty until you add some. Bundles are fully verified before they play ([game song bundles](docs/game-song-bundles.md)).
- **Preview:** a song's music plays through the mixer (ducking any menu music) with its reference dancers on the song's **dance stage**, rendered inside the game canvas (`client/src/stage/StageView.jsx`, stages from `packages/stages`). The music loops on its own while the stage camera slowly circles the dancers (Club Aquarium swings side to side instead), and swings back to the front when Dance! starts. Each song picks its stage in Dance Studio (players can't change it) and defaults to Open Reef. Best scores show on the list.
- **Dance!** (`client/src/game/GameScreen.jsx`, `GameSession.js`): a ready check (every player tracked and calibrated for a second, or **Start now**), then **3, 2, 1** from the song's scheduled start, with the music and reference dancers starting together at zero. Each player's own glass character copies them live in a top corner (player 1 left, player 2 right; `client/src/stage/LivePanels.jsx`) with their score, combo and a Perfect / Good / OK / Miss pop-up every second. Escape, the pause button or a hidden tab pauses; Resume counts down again at the same spot. The results screen (promoted from the win-screen mock) shows the winner or the solo score, grade, judgements and a new best, then **Play again** or **Song select**.
- **Timing and scoring:** everything runs on the song's audible clock (`client/src/audio/songPlayer.js`). Each live pose is placed at the song position audible when the camera captured it, using the webcam frame's browser timestamp, and scored 750 ms behind the song so late poses still count. The scorer (`packages/score/`) compares limb directions and movement every 100 ms against the player's own track; [docs/scoring.md](docs/scoring.md) has the details. `?record` downloads each song's live poses as a recording, and `?input=recording&recording=<url>` replays one.

Containerized build, unit and browser-flow checks (use `podman` in place of `docker`
when using Podman):

```sh
docker build --target test -t aerodance-ui-test .
docker build --target ui-test -t aerodance-ui-browser-test .
docker run --rm aerodance-ui-browser-test
docker build --target webcam-test -t aerodance-webcam-test .
docker run --rm aerodance-webcam-test
```

The browser flow (`client/tests/ui-flow.browser.mjs`) clicks the canvas in design units and reads the state each overlay reports on its `data-*` attributes. It skips GPU rasterization in software-only containers; set `UI_RENDER=1` for a full rendered check on a capable GPU.

Webcam requires **HTTPS or localhost**; a plain HTTP LAN address cannot request
camera access. Models and the matching WASM runtime are prepared during development
startup/build and served locally by both apps. The first preparation downloads
about 46 MB of pinned models; later local builds reuse verified `.cache/` assets.
Only the chosen model loads in the browser. Frames stay local; Dance Studio uploads
pose records when recording. Stop, switching source, leaving the page, or hiding
the webcam tab releases the camera. Inference uses a worker and prefers CPU when
WebGL is rendered in software; the status shows the active model, delegate, and
tracking rate. Heavy needs more processing capacity; slow results never count as
fresh player detection.

After both builds, `node client/tests/webcam.browser.mjs` (with Playwright installed)
checks the actual models, a synthetic two-person camera stream, Studio recording,
export, and game bundle preview. Physical duet accuracy, hardware performance,
and browser/device coverage still need manual validation.

## Captured dance demo

The menu-free two-character Frutiger demo is served at `/dance/` in production and PR previews. It replays pose tracking from the supplied dance video at the same fixed resolution and letterboxing as the main app, on six switchable in-engine stages: Skyline Sanctuary, Coral Dome, Open Reef, Emerald Falls, Club Aquarium and Sugarsand Sunset. Switch with ← / →, 1–6, or a hash such as `/dance/#club`. The stages live in [`packages/stages`](packages/stages) and the glass character in [`packages/character`](packages/character), shared by the game, `/dance/` and `/win-screens/`. See [the capture guide](temp/frutiger-character/README.md) for the locked, reusable tracking script, diagnostics, retargeting details, and validation.

## Win screens

End-of-song screens on each dance stage (Player 1 wins, Player 2 wins, a tie, or a solo end screen, all with placeholder scores) are served at `/win-screens/` in production and PR previews. The game's results screen was promoted from this mock (`client/src/stage/ResultsDancers.jsx`, `client/src/game/results.js`). Switch stage with 1–6, the result with M, or link directly with a hash such as `/win-screens/#club/p2`. See [its README](temp/win-screens/README.md).

## Thumbnails

27 in-engine 3:2 thumbnails (2160×1440) of the six dance stages, with and without the "aerodance." wordmark, are in `temp/thumbnails/with-logo/` and `temp/thumbnails/no-logo/`. They use the game's own pixel grid, each pixel an exact 4×3 block. See [its README](temp/thumbnails/README.md) to re-render them or add shots.

## Stack

| Layer    | Tech                                      |
| -------- | ----------------------------------------- |
| Client   | React 19, three.js, @react-three/fiber, Vite |
| Server   | Express 5, Socket.IO                      |
| Database | TimescaleDB (Tiger Data), via `pg`        |
| Runtime  | Docker Compose                            |

## In-engine UI

All menus, Song Select, Connect Client and the game screens are drawn on 2D canvases that share the render buffer, so they get the same pixels and stretch as the world. `client/src/ui/useCanvasUI.js` handles the overlay (canvas texture, design-unit layout, hit testing, press/hover/drag, scrolling, opt-in arrow-key navigation) and `client/src/ui/draw.js` holds the aero drawing kit (bubble pills, glass panels, headers, the title, icons, status lights, progress bars).

- **Fullscreen:** the main menu shows a fullscreen bubble in the bottom-right corner (`client/src/menu/FullscreenButton.jsx`). It slides off the right edge on submenus and slides back in on return to the main menu. Press Esc to exit fullscreen. Safari on macOS is supported, and the existing 16:9 letterboxing and fixed render resolution are preserved.

## Run locally with Docker Compose

To rebuild and deploy the main app locally in the background:

```sh
./deploy.sh
```

The script runs from any working directory, uses Podman when available (otherwise
Docker), starts the database, and checks app/database health after startup. Create `.env` from
`.env.example` before the first run. Set `CONTAINER_ENGINE=docker` or
`CONTAINER_ENGINE=podman` to choose the runtime explicitly. Existing database
data is retained. Each deployment rebuilds the app image and replaces the app
container so Podman Compose serves the new build. This script deploys locally;
public hosting uses Coolify below.

```sh
cp .env.example .env
docker compose -f compose.yaml -f compose.local.yaml up --build
```

Open http://localhost:3000. The local Compose file publishes the app on `127.0.0.1:3000` (override with `PORT`) and Postgres/TimescaleDB on `127.0.0.1:5432` (override with `DB_PORT`). The app always listens on port `3000` inside its container.

## Deploy with Coolify

The base `compose.yaml` publishes no host ports. The app serves the frontend, API, and Socket.IO on container port `3000`, and connects to TimescaleDB privately at `db:5432`.

1. Create a Git-based application in Coolify with the Docker Compose build strategy, using `compose.yaml` at the repository root. Use normal Compose deployment so Coolify generates the proxy labels and networking.
2. Set `POSTGRES_PASSWORD` to a strong, URL-safe password in Coolify's environment variables. This value is required; the credentials in `.env.example` are for local development. Optionally set `POSTGRES_USER` and `POSTGRES_DB`.
3. Assign the domain to service `app` with internal port `3000`, for example `https://aerodance.example.com:3000`. Coolify routes HTTPS through Traefik on public port `443` to the app's internal port.
4. Deploy using only the base Compose file. Include `compose.local.yaml` only for local development.

See [Coolify's Docker Compose documentation](https://coolify.io/docs/applications/builds/docker-compose) for deployment and domain configuration.

### Pull request previews

Bee Coolify deploys `main` at https://aerodance.tech. Its GitHub App automatically builds previews for repository members' pull requests targeting `main`, updates them when commits are pushed, and removes them when the PR is closed or merged.

The preview URL template is `{{pr_id}}-aerodance.deathgrips.org`, so PR #3 is available at https://3-aerodance.deathgrips.org. Wildcard DNS for `*.deathgrips.org` routes these hosts to Bee through Cloudflare. Set service `app` domains to internal port `3000` in Coolify; previews inherit that port from the production domain configuration.

Each preview uses a separate Coolify network and database volume. The database connection uses Coolify's `SERVICE_NAME_DB` (for example, `db-pr-3`), falling back to `db` for local Compose. Keep database credentials in Coolify's separate preview environment variables, and do not point previews at the production database.

## Local development

```sh
npm install
cp .env.example .env
docker compose -f compose.yaml -f compose.local.yaml up -d db
npm run dev
```

- Vite dev server: http://localhost:5173 (proxies `/api` and `/socket.io` to Express on `:3000`)
- `npm run build` builds the client into `dist/`; `npm start` serves it from Express.
- `npm run bench:performance` reproduces the CPU comparisons in the [performance audit](docs/performance-audit.md).

## Database

The server applies its schema on startup (idempotent), so it works against the compose database or a hosted [Tiger Cloud](https://console.cloud.timescale.com/) service. To use Tiger Cloud, set `DATABASE_URL` to your service URL with `?sslmode=require`.

```sql
CREATE TABLE spins (time TIMESTAMPTZ NOT NULL DEFAULT now(), socket_id TEXT NOT NULL);
SELECT create_hypertable('spins', by_range('time'));
```

## API

| Endpoint                  | Description                                     |
| ------------------------- | ----------------------------------------------- |
| `GET /api/health`         | DB connectivity check                           |
| `GET /api/spins/history`  | Spins per minute over the last hour (`time_bucket`) |

Socket.IO events: client emits `spin`; server broadcasts `spin` and `stats` (`{ online, spinsLastMinute }`).
