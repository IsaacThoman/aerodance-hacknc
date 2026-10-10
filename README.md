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

## Run with Docker Compose

```sh
docker compose up --build
```

Open http://localhost:3000. Postgres/TimescaleDB is exposed on `localhost:5432` (override with `DB_PORT`).

## Local development

```sh
npm install
cp .env.example .env          # optional, defaults match compose
docker compose up -d db       # just the database
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
