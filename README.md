# aerodance

React + three.js (via [@react-three/fiber](https://r3f.docs.pmnd.rs/)) rendered in a full-screen canvas, served by Express, with realtime updates over Socket.IO and events stored in a [TimescaleDB](https://www.tigerdata.com/) hypertable.

Dance battles: the display shows a QR code, the first phones to scan it take the dancer seats, and everyone after that is the crowd, who can hype a dancer with real Solana devnet SOL. Results are written on-chain and texted over iMessage by the [agent](agent/README.md).

The server still records `spin` events in the `spins` hypertable, but the current client no longer sends them.

See [the Android/game integration plan](docs/android-game-integration-plan.md) for pairing, player selection, live character animation, latency-aware scoring, and choreography recording/editing work.

See [the song and dance authoring workflow](docs/song-dance-authoring-workflow.md) for the proposed Docker-hosted editor, Android-compatible pose format, raw landmark editing, Frutiger playback, and portable song bundle contract.

The editor is implemented as [Dance Studio](tools/choreography/README.md).
Run `docker compose -f tools/choreography/compose.yaml up --build -d` and open
http://localhost:8082 to record/import, edit, preview, save, and export song bundles.

## Aero background

The canvas shows a looping Frutiger Aero drone flight (glass skyline, clouds, hot-air balloons, gulls, flower meadow). The display is one letterboxed 16:9 frame rendered at a fixed 640x480 buffer and scaled up with `image-rendering: pixelated`; the HUD sits inside the frame. The phone view (`/join`) is a portrait frame filling the screen, 360 px wide with a height that follows the screen.

- `client/src/aero/aeroBackground.js` builds the world. `createAeroWorld({ renderer, scene, camera, speed, quality })` returns `{ update(dt), render(), setSpeed, dispose }` for use inside an existing renderer; `createAeroBackground(canvas, options)` is a standalone full-canvas version.
- `client/src/aero/AeroWorld.jsx` plugs it into the Fiber `<Canvas>` (used by `Scene.jsx`): `<AeroWorld speed={1} quality="auto" />`. It renders the frame itself, so it uses whatever buffer size `FixedRenderResolution` sets.
- The loop starts low over the meadow facing the skyline (`start` 0.08). Downtown, the east/west districts and the north district across the lake all sit on one 70 m street grid; the lake uses a reflective water surface with boats and quays.
- `quality="low"` thins out grass, flowers and leaf detail for weaker GPUs; `auto` picks it on touch devices.
- The display plays "Pod Lounge" (`client/public/music/pod-lounge.mp3`) on a continuous loop under the background. It loops independently of the flight: `client/src/audio/loopingMusic.js` decodes it with Web Audio, trims the silent padding, and starts each play-through as the previous one fades out so the music never drops out. Browsers hold audio until the first click or key press, so it starts then.

### Sound

`client/src/audio/mixer.js` runs all audio through one Web Audio context. Settings → Sound drives it: **Master** (everything), **Music** (all music, menu and in-game), **Effects** (button sounds), **Menu music** (switches off just the menu's background track; in-game songs go straight to the music channel) and **Mute all** (silences everything). Settings are saved per browser (`menu/soundSettings.js`).

Every in-game button (menus, battle screens, the phone view, the debug strip) makes Wii-menu-style sounds through `useCanvasUI`: a soft tick when the mouse or remote cursor reaches a button, a bubbly pop on press, a falling pop for back, chimes for switches, and ticks as a slider moves. They're synthesised in `client/src/audio/uiSounds.js` rather than recorded, and a widget can override its press sound with `sound`.

## Main UI flow

**Start → One Player / Two Players → Song Select** is now wired into the main app.
Back from Song Select returns to player selection. The bottom-right **Connect Client**
opens an Android IP field defaulting to `192.168.43.1`, with Ok, Cancel, connection
status, and Disconnect. Successfully connected addresses are remembered. The server
HUD describes the separate backend connection. Choose **Webcam (dummy)** in
Connect Client to test both player modes without Android. It skips device pairing
and does not request camera access or provide tracking.

The game consumes Android protocol v2 directly, applies player count at the stream's
sequence boundary, and clears missing/stale tracking. Set the Android allowed origin
to the exact origin shown in the connection panel. Real-device pairing from deployed
HTTPS still needs validation.

Connecting opens the stream and starts the Android camera and pose tracker.
The game shows **Camera starting…** until the first pose result, allowing up to
90 seconds on each connection/reconnect. Disconnect releases capture to save
battery, so reconnecting includes initialization again. The authoring tool uses
the same startup state and keeps recording disabled while it waits.

Extract Studio song ZIPs into `client/public/songs/`; Song Select discovers the
exported folders automatically, with no manual manifest edits. Builds generate
the catalog for static hosting. Rebuild/redeploy to publish source folder changes.
The local catalog includes the exported “Rockefeller Street Bad Test” routine.
Song Select loads
validated song bundles and offers
a finite music/reference-character preview in either player mode. Countdown, live
characters, calibrated timing, scoring, and results remain future integration work.
See [game song bundles and pose migration](docs/game-song-bundles.md) for installation,
loader behavior, and the migrated Android-shaped silent capture.

Containerized build and protocol/adapter checks (use `podman` in place of `docker`
when using Podman):

```sh
docker build --target test -t aerodance-ui-test .
docker build --target ui-test -t aerodance-ui-browser-test .
docker run --rm aerodance-ui-browser-test
```

Browser flow checks skip GPU rasterization in software-only containers. Set
`UI_RENDER=1` for a full rendered check on a capable GPU.

## Captured dance demo

The menu-free two-character Frutiger demo is served at `/dance/` in production and PR previews. It replays pose tracking from the supplied dance video at the same fixed resolution and letterboxing as the main app, on six switchable in-engine stages: Skyline Sanctuary, Coral Dome, Open Reef, Emerald Falls, Club Aquarium and Sugarsand Sunset. Switch with ← / →, 1–6, or a hash such as `/dance/#club`. See [the capture guide](temp/frutiger-character/README.md) for the locked, reusable tracking script, diagnostics, retargeting details, and validation.

## Main menu mocks

Six temporary in-engine main-menu variations (Aqua Lagoon, Starlight Galaxy, Eco Metropolis, Aurora Lake, Breezy Meadow, Cloud Stage) are served at `/menu-mocks/` in production and PR previews. Switch with ← / → or 1–6, or link directly with a hash such as `/menu-mocks/#galaxy`. See [the mocks README](temp/menu-mocks/README.md).

## Win screens

End-of-song screens on each dance stage (Player 1 wins, Player 2 wins, a tie, or a solo end screen, all with placeholder scores) are served at `/win-screens/` in production and PR previews. Switch stage with 1–6, the result with M, or link directly with a hash such as `/win-screens/#club/p2`. See [its README](temp/win-screens/README.md).

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

All menus and battle screens are drawn on 2D canvases that share the render buffer, so they get the same pixels and stretch as the world. `client/src/ui/useCanvasUI.js` handles the overlay (canvas texture, design-unit layout, hit testing, press/hover/drag, scrolling) and `client/src/ui/draw.js` holds the aero drawing kit (bubble pills, glass panels, headers, the title, icons, a pixel-snapped QR code).

- **Corner controls:** The main menu shows a fullscreen bubble above the Wii remote bubble; both controls and the remote pairing card hide on submenus and battle screens. A paired remote's cursor still works there. Click the fullscreen bubble on the display itself (phone remote input cannot activate browser fullscreen), or press Esc to exit. Safari on macOS is supported, and the existing 16:9 letterboxing and fixed render resolution are preserved.
- **Display:** Battle on the main menu opens the lobby (`client/src/battle/BattleScreen.jsx`): a QR code to `/join/<id>`, seat tags over the dancers, the crowd count, and hype rising as bubbles from the dancer it was sent to. Start hands off to the dance; the results screen shows the winner, scores, hype, the on-chain receipt and the winner's trophy NFT. `/battle/<id>?p=<token>`, the link the bot texts, opens the same lobby with that seat's token.
- **Phones:** `/join/<id>` (`client/src/phone/`) has the profile form, your seat or crowd role, Hype buttons, the receipt, your stats and wallet, and the iMessage opt-in. The text fields are invisible real `<input>`s over the drawn fields so the phone keyboard opens. It's installable to the Home Screen (`client/public/manifest.webmanifest`).
- **Debug:** the dance doesn't report scores yet, so the display shows a debug strip that fakes a random winner, a tie or a no-show. It's on in dev, with `?debug` in the URL, or after pressing `` ` ``. When the dance is ready it should report each seat with `reportResult` from `client/src/battle/api.js`, using the tokens in `seatTokens`.
- Phones can't open `localhost`. To try the phone view from a real phone in dev, run `node --watch server/index.js` and `npx vite --host` instead of `npm run dev`, then open the display by the LAN address Vite prints (or use a tunnel). The QR code uses whatever address the display was opened with.

## Run locally with Docker Compose

To rebuild and deploy the main app locally in the background:

```sh
./deploy.sh
```

The script runs from any working directory, uses Podman when available (otherwise
Docker), and checks app/database health after startup. Create `.env` from
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
| `POST /api/battles/:id/result`   | `{ playerToken, score, pops?, sync?, flair? }`, once per seat |
| `GET /api/me`, `POST /api/me`    | The phone's profile (`x-device-token` header). `POST` takes `{ name?, phone? }` and returns a `deviceToken` |
| `POST /api/battles/:id/join`     | Take a free dancer seat, or join the crowd. Returns `{ role, seat }` |
| `POST /api/battles/:id/hype`     | `{ seat }`: send that dancer 0.005 devnet SOL from your wallet. `{ seat, sticker }` (`bubble`, `koi`, `rainbow`) mints a sticker NFT into their wallet instead, paid by yours |

Socket.IO events: client emits `spin`; server broadcasts `spin` and `stats` (`{ online, spinsLastMinute }`).
Battles: emit `battle:watch` with an id to get `battle` (full public state) on every change and `hype` (`{ seat, from, sticker }`) the moment a tip starts. Phones emit `me:watch` with their device token to get `me:changed`.
