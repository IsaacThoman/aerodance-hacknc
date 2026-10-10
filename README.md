# aerodance

React + three.js (via [@react-three/fiber](https://r3f.docs.pmnd.rs/)) rendered in a full-screen canvas, served by Express, with realtime updates over Socket.IO and events stored in a [TimescaleDB](https://www.tigerdata.com/) hypertable.

Dance battles: the display shows a QR code, the first phones to scan it take the dancer seats, and everyone after that is the crowd, who can hype a dancer with real Solana devnet SOL. Results are written on-chain and texted over iMessage by the [agent](agent/README.md).

The server still records `spin` events in the `spins` hypertable, but the current client no longer sends them.

## Aero background

The canvas shows a looping Frutiger Aero drone flight (glass skyline, clouds, hot-air balloons, gulls, flower meadow). The whole app is one letterboxed 16:9 frame rendered at a fixed 640x480 buffer and scaled up with `image-rendering: pixelated`; the HUD sits inside the frame.

- `client/src/aero/aeroBackground.js` builds the world. `createAeroWorld({ renderer, scene, camera, speed, quality })` returns `{ update(dt), render(), setSpeed, dispose }` for use inside an existing renderer; `createAeroBackground(canvas, options)` is a standalone full-canvas version.
- `client/src/aero/AeroWorld.jsx` plugs it into the Fiber `<Canvas>` (used by `Scene.jsx`): `<AeroWorld speed={1} quality="auto" />`. It renders the frame itself, so it uses whatever buffer size `FixedRenderResolution` sets.
- The loop starts low over the meadow facing the skyline (`start` 0.08). Downtown, the east/west districts and the north district across the lake all sit on one 70 m street grid; the lake uses a reflective water surface with boats and quays.
- `quality="low"` thins out grass, flowers and leaf detail for weaker GPUs; `auto` picks it on touch devices.

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
| Agent    | Solana devnet (`@solana/web3.js`), iMessage via [Photon Spectrum](https://photon.codes/docs/spectrum-ts) |
| Runtime  | Docker Compose                            |

## Battles

Compose runs three services: `app` (Express, Socket.IO, the client), `db` (TimescaleDB) and `agent` (Solana + iMessage worker, internal only).

- **The app owns battle state.** `server/battles.js` handles seats, spectators, results and settlement; `server/profiles.js` handles profiles and stats. Each battle has a Socket.IO room, so displays and phones get every change pushed.
- **The agent holds every Solana key.** The app hands it work through the `jobs` table (wallet funding, phone linking, receipts, result texts) and calls its internal API for things that need an answer right away (hype transfers, balances). It reports back with `NOTIFY changes`. See the [agent README](agent/README.md).
- A battle settles when every seat has reported a score, or 90 s after the first report. The highest score wins and an equal top score is a tie. The agent then writes a memo receipt on-chain and texts linked players.
- The app's internal API listens on port `3001` for the bot (create battles, profiles by phone). Only the Compose network reaches it; the domain routes to `3000`.

To make a devnet treasury for funding wallets and signing receipts, run `npm run treasury` in `agent/` and put the printed `SOLANA_TREASURY_SECRET` in `.env`.

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
| `POST /api/battles/:id/hype`     | `{ seat }`: send that dancer 0.005 devnet SOL from your wallet |

Socket.IO events: client emits `spin`; server broadcasts `spin` and `stats` (`{ online, spinsLastMinute }`).
Battles: emit `battle:watch` with an id to get `battle` (full public state) on every change and `hype` (`{ seat, from }`) the moment a tip starts. Phones emit `me:watch` with their device token to get `me:changed`.
