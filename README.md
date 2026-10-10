# aerodance

React + three.js (via [@react-three/fiber](https://r3f.docs.pmnd.rs/)) rendered in a full-screen canvas, served by Express, with realtime updates over Socket.IO and events stored in a [TimescaleDB](https://www.tigerdata.com/) hypertable.

Click the shape to spin it. Every connected client sees the spin, and each one is recorded in the `spins` hypertable.

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
