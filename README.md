# aerodance

React + three.js (via [@react-three/fiber](https://r3f.docs.pmnd.rs/)) rendered in a full-screen canvas, served by Express, with realtime updates over Socket.IO and events stored in a [TimescaleDB](https://www.tigerdata.com/) hypertable.

The server still records `spin` events in the `spins` hypertable, but the current client no longer sends them.

See [the Android/game integration plan](docs/android-game-integration-plan.md) for pairing, player selection, live character animation, latency-aware scoring, and choreography recording/editing work.

See [the song and dance authoring workflow](docs/song-dance-authoring-workflow.md) for the proposed Docker-hosted editor, Android-compatible pose format, raw landmark editing, Frutiger playback, and portable song bundle contract.

The editor is implemented as [Dance Studio](tools/choreography/README.md).
Run `docker compose -f tools/choreography/compose.yaml up --build -d` and open
http://localhost:8082 to record/import, edit, preview, save, and export song bundles.

## Aero background

The canvas shows a looping Frutiger Aero drone flight (glass skyline, clouds, hot-air balloons, gulls, flower meadow). The whole app is one letterboxed 16:9 frame rendered at a fixed 640x480 buffer and scaled up with `image-rendering: pixelated`; the HUD sits inside the frame.

- `client/src/aero/aeroBackground.js` builds the world. `createAeroWorld({ renderer, scene, camera, speed, quality })` returns `{ update(dt), render(), setSpeed, dispose }` for use inside an existing renderer; `createAeroBackground(canvas, options)` is a standalone full-canvas version.
- `client/src/aero/AeroWorld.jsx` plugs it into the Fiber `<Canvas>` (used by `Scene.jsx`): `<AeroWorld speed={1} quality="auto" />`. It renders the frame itself, so it uses whatever buffer size `FixedRenderResolution` sets.
- The loop starts low over the meadow facing the skyline (`start` 0.08). Downtown, the east/west districts and the north district across the lake all sit on one 70 m street grid; the lake uses a reflective water surface with boats and quays.
- `quality="low"` thins out grass, flowers and leaf detail for weaker GPUs; `auto` picks it on touch devices.

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

The public song catalog is `client/public/songs/manifest.json`. It remains empty until
an authored song is ready. Song Select now loads validated song bundles and offers
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

The menu-free two-character Frutiger demo is served at `/dance/` in production and PR previews. It replays pose tracking from the supplied dance video at the same fixed resolution and letterboxing as the main app. See [the capture guide](temp/frutiger-character/README.md) for the locked, reusable tracking script, diagnostics, retargeting details, and validation.

## Main menu mocks

Six temporary in-engine main-menu variations (Aqua Lagoon, Starlight Galaxy, Eco Metropolis, Aurora Lake, Breezy Meadow, Cloud Stage) are served at `/menu-mocks/` in production and PR previews. Switch with ← / → or 1–6, or link directly with a hash such as `/menu-mocks/#galaxy`. See [the mocks README](temp/menu-mocks/README.md).

## Stack

| Layer    | Tech                                      |
| -------- | ----------------------------------------- |
| Client   | React 19, three.js, @react-three/fiber, Vite |
| Server   | Express 5, Socket.IO                      |
| Database | TimescaleDB (Tiger Data), via `pg`        |
| Runtime  | Docker Compose                            |

## Run locally with Docker Compose

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
