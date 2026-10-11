# aerodance

React + three.js (via [@react-three/fiber](https://r3f.docs.pmnd.rs/)) rendered in a full-screen canvas, served by Express, with realtime updates over Socket.IO and events stored in a [TimescaleDB](https://www.tigerdata.com/) hypertable.

Dance battles: the display shows a QR code, the first phones to scan it take the dancer seats, and everyone after that is the crowd, who can hype a dancer with real Solana devnet SOL. Results are written on-chain and texted over iMessage by the [agent](agent/README.md).

The server still records `spin` events in the `spins` hypertable, but the current client no longer sends them.

See [the Android/game integration plan](docs/android-game-integration-plan.md) for pairing, player selection, live character animation, latency-aware scoring, and choreography recording/editing work, [how scores are calculated](docs/scoring.md), and [the plan for finishing the game](docs/game-completion-plan.md).

See [the browser webcam plan](docs/browser-webcam-plan.md) for shared game/editor webcam input and selectable in-browser MediaPipe Lite, Full, and Heavy models.

See [the song and dance authoring workflow](docs/song-dance-authoring-workflow.md) for the proposed Docker-hosted editor, Android-compatible pose format, raw landmark editing, Frutiger playback, and portable song bundle contract.

The editor is implemented as [Dance Studio](tools/choreography/README.md).
Run `docker compose -f tools/choreography/compose.yaml up --build -d` and open
http://localhost:8082 to record/import, edit, preview, save, and export song bundles.

## Aero background

The canvas shows a looping Frutiger Aero drone flight (glass skyline, clouds, hot-air balloons, gulls, flower meadow). The display is one letterboxed 16:9 frame rendered at a fixed 640x480 buffer and scaled up with `image-rendering: pixelated`; the HUD sits inside the frame. The phone view (`/join`) is a portrait frame filling the screen, 360 px wide with a height that follows the screen.

- `client/src/aero/aeroBackground.js` builds the world. `createAeroWorld({ renderer, scene, camera, speed, quality })` returns `{ update(dt), render(), setSpeed, dispose }` for use inside an existing renderer; `createAeroBackground(canvas, options)` is a standalone full-canvas version.
- `client/src/aero/AeroWorld.jsx` plugs it into the Fiber `<Canvas>` (used by `Scene.jsx`): `<AeroWorld speed={1} quality="auto" />`. It renders the frame itself, so it uses whatever buffer size `FixedRenderResolution` sets.
- The loop starts low over the meadow facing the skyline (`start` 0.08). Downtown, the east/west districts and the north district across the lake all sit on one 70 m street grid; the lake uses a reflective water surface with boats and quays.
- `quality="low"` thins out grass, flowers and leaf detail for weaker GPUs, and drops the district Flock cameras; `auto` picks it on touch devices.
- About 100 Flock licence-plate camera poles stand on the kerb before roughly half the intersections, downtown and in the districts, each aimed down the nearside lane at traffic heading into the junction. They use the 991-triangle World LOD and its instancing helper in `client/src/aero/flock/` (built by [`temp/flock-camera`](temp/flock-camera/README.md)), load after the rest of the world, and are drawn as one instanced batch per district. At their real 12 ft height they show up as small details on the low downtown pass.
- The display plays "Pod Lounge" (`client/public/music/pod-lounge.mp3`) on a continuous loop under the background. It loops independently of the flight: `client/src/audio/loopingMusic.js` decodes it with Web Audio, trims the silent padding, and starts each play-through as the previous one fades out so the music never drops out. Browsers hold audio until the first click or key press, so it starts then.

### Sound

`client/src/audio/mixer.js` runs all audio through one Web Audio context. Settings → Sound drives it: **Master** (everything), **Music** (all music, menu and in-game), **Effects** (button sounds), **Menu music** (switches off just the menu's background track; in-game songs go straight to the music channel) and **Mute all** (silences everything). Settings are saved per browser (`menu/soundSettings.js`).

Every in-game button (menus, battle screens, the phone view, the debug strip) makes Wii-menu-style sounds through `useCanvasUI`: a soft tick when the mouse or remote cursor reaches a button, a bubbly pop on press, a falling pop for back, chimes for switches, and ticks as a slider moves. They're synthesised in `client/src/audio/uiSounds.js` rather than recorded, and a widget can override its press sound with `sound`.

## Main UI flow

**Start → One Player / Two Players → Song Select → song preview → Dance! → results**, all drawn in-engine. Back (or Escape, or the phone remote's B) from Song Select returns to the player count, and every screen works with the mouse, touch, the keyboard (arrows and Enter) and the phone remote.

- **Connect Client** (`client/src/connect/`): the status pill in the top-right corner of Settings opens a card for the pose input. **Android Client** takes the board's IP on an on-screen keypad (or the keyboard), defaulting to `192.168.43.1` and remembering the last address that connected; the card shows the origin to set as Android's allowed origin and every connection message, and connects, cancels or disconnects. **Webcam** offers camera selection and in-browser MediaPipe **Lite / Full / Heavy** tracking for both player modes. Start camera requests permission; the mirrored setup preview shows player placement. Model/camera changes restart tracking and release the old camera. For a scored run without a board, open the game with `?input=ghost`: an autoplay ghost copies each routine (`&ghostLagMs=300` dances late).
- **Android:** the game reads Android protocol v2 directly (`client/src/pose/`), applies the player count at the stream's sequence boundary and clears missing or stale tracking. Connecting starts the board's camera and pose tracker; the card shows the camera starting until the first pose, allowing up to 90 seconds on each connection or reconnect, and the ready check before a song waits for every player to be tracked and calibrated. While Android is connected, the menus show the 991-triangle Flock camera at the rear center of the dancers' glass platform, aimed 30° toward screen left. Its hardware and pole diameter are enlarged 4×, with a shorter shaft and a 49.5% longer exposed lower section ([visual baseline](docs/visual-baselines/menu-android-connected.webp), captured with a simulated Android stream). Disconnecting releases the camera to save battery. Browsers block the board's plain-http stream from an https page, so pair from a local http deploy for now.
- **Song Select** (`client/src/game/SongSelect.jsx`) lists the published songs four to a page. Extract Dance Studio's song ZIPs into `client/public/songs/`: Song Select finds the exported folders without manifest edits (`server/songCatalog.js`), and builds generate the catalog for static hosting, so rebuild or redeploy to publish changes. The repo ships Austin's “Rockefeller Street Bad Test” routine. Bundles are fully verified before they play ([game song bundles](docs/game-song-bundles.md)).
- **Preview:** a song's music plays through the mixer (the menu music ducks) with its reference dancers on the song's **dance stage**, rendered inside the game canvas (`client/src/stage/StageView.jsx`, stages from `packages/stages`). The music loops on its own while the stage camera slowly circles the dancers (Club Aquarium swings side to side instead), and swings back to the front when Dance! starts. Each song picks its stage in Dance Studio (players can't change it) and defaults to Open Reef. Best scores show on the list.
- **Dance!** (`client/src/game/GameScreen.jsx`, `GameSession.js`): a ready check (every player tracked and calibrated for a second, or **Start now**), then **3, 2, 1** from the song's scheduled start, with the music and reference dancers starting together at zero. Each player's own glass character copies them live in a top corner (player 1 left, player 2 right; `client/src/stage/LivePanels.jsx`) with their score, combo and a Perfect / Good / OK / Miss pop-up every second. Escape, the pause button, the remote's B or a hidden tab pauses; Resume counts down again at the same spot. The results screen (promoted from the win-screen mock) shows the winner or the solo score, grade, judgements and a new best, then **Play again** or **Song select**.
- **Timing and scoring:** everything runs on the song's audible clock (`client/src/audio/songPlayer.js`). Each live pose is placed at the song position audible when the camera captured it, using Android's `GET /v1/time` clock sync (`client/src/pose/clockSync.js`) or the webcam frame's browser timestamp, and scored 750 ms behind the song so late poses still count. The scorer (`packages/score/`) compares limb directions and movement every 100 ms against the player's own track; [docs/scoring.md](docs/scoring.md) has the details. `?record` downloads each song's live poses as a recording, and `?input=recording&recording=<url>` replays one.

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

## Main menu mocks

Six temporary in-engine main-menu variations (Aqua Lagoon, Starlight Galaxy, Eco Metropolis, Aurora Lake, Breezy Meadow, Cloud Stage) are served at `/menu-mocks/` in production and PR previews. Switch with ← / → or 1–6, or link directly with a hash such as `/menu-mocks/#galaxy`. See [the mocks README](temp/menu-mocks/README.md).

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
| Agent    | Solana devnet (`@solana/web3.js`), iMessage via [Photon Spectrum](https://photon.codes/docs/spectrum-ts) |
| Runtime  | Docker Compose                            |

## Battles

Compose runs three services: `app` (Express, Socket.IO, the client), `db` (TimescaleDB) and `agent` (Solana + iMessage worker, internal only).

- **The app owns battle state.** `server/battles.js` handles seats, spectators, results and settlement; `server/profiles.js` handles profiles and stats. Each battle has a Socket.IO room, so displays and phones get every change pushed.
- **The agent holds every Solana key.** The app hands it work through the `jobs` table (wallet funding, phone linking, receipts, result texts) and calls its internal API for things that need an answer right away (hype transfers, balances). It reports back with `NOTIFY changes`. See the [agent README](agent/README.md).
- A battle settles when every seat has reported a score, or 90 s after the first report. The highest score wins and an equal top score is a tie. The agent then writes a memo receipt on-chain, texts linked players and mints the winner a trophy NFT (metadata at `/nft/<id>.json`).
- The app's internal API listens on port `3001` for the bot (create battles, profiles by phone). Only the Compose network reaches it; the domain routes to `3000`.

To make a devnet treasury for funding wallets and signing receipts, run `npm run treasury` in `agent/` and put the printed `SOLANA_TREASURY_SECRET` in `.env`.

### In-engine UI

All menus, Song Select, Connect Client and battle screens are drawn on 2D canvases that share the render buffer, so they get the same pixels and stretch as the world. `client/src/ui/useCanvasUI.js` handles the overlay (canvas texture, design-unit layout, hit testing, press/hover/drag, scrolling, opt-in arrow-key navigation) and `client/src/ui/draw.js` holds the aero drawing kit (bubble pills, glass panels, headers, the title, icons, text fields, chips, links, status lights, progress bars, a pixel-snapped QR code).

- **Corner controls:** The main menu shows a fullscreen bubble above the Wii remote bubble; both controls slide off the right edge on submenus and battle screens, and slide back in on return to the main menu. The remote pairing card hides on those screens. A paired remote's cursor still works there. Click the fullscreen bubble on the display itself (phone remote input cannot activate browser fullscreen), or press Esc to exit. Safari on macOS is supported, and the existing 16:9 letterboxing and fixed render resolution are preserved.
- **Cursor:** The display's cursor is the Wii remote's player-1 hand (`client/src/ui/wiiCursor.js`), for both the phone remote and the mouse. It's redrawn from the Wii Menu's 43×62 pointer sprite at 1:1 Wii pixels: the render buffer is 640×480 stretched to 16:9, like a Wii in widescreen, so the hand is 62 buffer pixels tall and takes up the same share of the screen as on a Wii. The system cursor is hidden over the display canvas. When the mouse and remote are both in use, the mouse's hand shows until the remote moves.
- **Display:** Battle on the main menu opens the lobby (`client/src/battle/BattleScreen.jsx`): a QR code to `/join/<id>`, seat tags over the dancers, the crowd count, and hype rising as bubbles from the dancer it was sent to. Start opens Song Select for two players; the song plays like any other, and its results report each seat's score, Perfect count (`pops`), timing (`sync`) and best combo (`flair`). Battles use that same stage celebration screen, with hype totals, live Solana receipt/trophy links, **Run it back**, and **Continue** to the main menu. Finished `/battle/<id>` links also use the stage celebration; this tab remembers the song's stage and detailed grades, while other tabs show the public score summary on Open Reef. Phones follow the dance's progress from `startedAt` and `danceMs`. `/battle/<id>?p=<token>`, the link the bot texts, opens the same lobby with that seat's token.
- **Phones:** `/join/<id>` (`client/src/phone/`) has the profile form, your seat or crowd role, Hype buttons, the receipt, your stats and wallet, and the iMessage opt-in. The text fields are invisible real `<input>`s over the drawn fields so the phone keyboard opens. It's installable to the Home Screen (`client/public/manifest.webmanifest`).
- **Debug:** a debug strip can fake a random winner, a tie or a no-show without dancing. It's on in dev, with `?debug` in the URL, or after pressing `` ` ``.
- Phones can't open `localhost`. To try the phone view from a real phone in dev, run `node --watch server/index.js` and `npx vite --host` instead of `npm run dev`, then open the display by the LAN address Vite prints (or use a tunnel). The QR code uses whatever address the display was opened with.

## Run locally with Docker Compose

To rebuild and deploy the main app locally in the background:

```sh
./deploy.sh
```

The script runs from any working directory, uses Podman when available (otherwise
Docker), starts the database and agent, and checks app/database health after startup. Create `.env` from
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
   For battles, also set `INTERNAL_SECRET` (any random string), `SOLANA_TREASURY_SECRET`, and `PUBLIC_URL` (e.g. `https://aerodance.tech`, used in links the bot texts). Set `PROJECT_ID`, `PROJECT_SECRET` and `PHOTON_TOKEN` in production only, so a single deployment runs the iMessage bot. Don't give service `agent` a domain.
3. Assign the domain to service `app` with internal port `3000`, for example `https://aerodance.example.com:3000`. Coolify routes HTTPS through Traefik on public port `443` to the app's internal port.
4. Deploy using only the base Compose file. Include `compose.local.yaml` only for local development.

See [Coolify's Docker Compose documentation](https://coolify.io/docs/applications/builds/docker-compose) for deployment and domain configuration.

### Pull request previews

Bee Coolify deploys `main` at https://aerodance.tech. Its GitHub App automatically builds previews for repository members' pull requests targeting `main`, updates them when commits are pushed, and removes them when the PR is closed or merged.

The preview URL template is `{{pr_id}}-aerodance.deathgrips.org`, so PR #3 is available at https://3-aerodance.deathgrips.org. Wildcard DNS for `*.deathgrips.org` routes these hosts to Bee through Cloudflare. Set service `app` domains to internal port `3000` in Coolify; previews inherit that port from the production domain configuration.

Each preview uses a separate Coolify network and database volume. The database connection uses Coolify's `SERVICE_NAME_DB` (for example, `db-pr-3`), falling back to `db` for local Compose; the app and agent find each other the same way through `SERVICE_NAME_AGENT` and `SERVICE_NAME_APP`. Keep database credentials in Coolify's separate preview environment variables, and do not point previews at the production database. Previews without Photon credentials run with iMessage off (texts are only logged), and battles still work.

## Local development

```sh
npm install
cp .env.example .env
docker compose -f compose.yaml -f compose.local.yaml up -d db
npm run dev
```

- Vite dev server: http://localhost:5173 (proxies `/api` and `/socket.io` to Express on `:3000`)
- Battles also need the agent: run `npm install && npm run dev` in `agent/` in a second terminal (it reads the same `.env`).
- `npm run build` builds the client into `dist/`; `npm start` serves it from Express.
- `npm run bench:performance` reproduces the CPU comparisons in the [performance audit](docs/performance-audit.md).

## Database

The server applies its schema on startup (idempotent), so it works against the compose database or a hosted [Tiger Cloud](https://console.cloud.timescale.com/) service. To use Tiger Cloud, set `DATABASE_URL` to your service URL with `?sslmode=require`.

```sql
CREATE TABLE spins (time TIMESTAMPTZ NOT NULL DEFAULT now(), socket_id TEXT NOT NULL);
SELECT create_hypertable('spins', by_range('time'));
```

Battle tables: `profiles`, `devices` (browsers signed in as a profile), `wallets` (devnet keys; only the agent reads secrets), `battles`, `battle_seats`, `battle_spectators`, `hype` (a hypertable of confirmed tips), `jobs` (the agent's queue) and `imessage_seen`. See `server/db.js`.

## API

| Endpoint                  | Description                                     |
| ------------------------- | ----------------------------------------------- |
| `GET /api/health`         | DB connectivity check                           |
| `GET /api/spins/history`  | Spins per minute over the last hour (`time_bucket`) |

| `POST /api/battles`              | Start a battle (`{ players: 2 }`, max 8). Returns the id and each seat's secret `token` for reporting results |
| `GET /api/battles/:id`           | Public battle state: seats, names, results, hype totals, spectators, winner, receipt |
| `POST /api/battles/:id/start`    | `{ playerToken, danceMs? }`: the dance started (countdown and song last `danceMs`), so phones can follow it |
| `POST /api/battles/:id/result`   | `{ playerToken, score, pops?, sync?, flair? }`, once per seat |
| `GET /api/me`, `POST /api/me`    | The phone's profile (`x-device-token` header). `POST` takes `{ name?, phone? }` and returns a `deviceToken` |
| `POST /api/battles/:id/join`     | Take a free dancer seat, or join the crowd. Returns `{ role, seat }` |
| `POST /api/battles/:id/hype`     | `{ seat }`: send that dancer 0.005 devnet SOL from your wallet. `{ seat, sticker }` (`bubble`, `koi`, `rainbow`) mints a sticker NFT into their wallet instead, paid by yours |

Socket.IO events: client emits `spin`; server broadcasts `spin` and `stats` (`{ online, spinsLastMinute }`).
Battles: emit `battle:watch` with an id to get `battle` (full public state) on every change and `hype` (`{ seat, from, sticker }`) the moment a tip starts. Phones emit `me:watch` with their device token to get `me:changed`.
