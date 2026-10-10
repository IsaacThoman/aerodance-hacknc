import { existsSync } from 'node:fs';
import pg from 'pg';

if (existsSync('.env')) process.loadEnvFile();

// Works with the local compose TimescaleDB or a Tiger Cloud service
// (append ?sslmode=require to the connection string for Tiger Cloud).
const databaseUrl = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/aerodance');
// Coolify injects the renamed Compose service at runtime for PR previews.
// Resolve it here because its Compose parser substitutes the production name.
if (databaseUrl.hostname === 'db' && process.env.SERVICE_NAME_DB) {
  databaseUrl.hostname = process.env.SERVICE_NAME_DB;
}

export const pool = new pg.Pool({
  connectionString: databaseUrl.toString(),
});

const schema = `
  CREATE EXTENSION IF NOT EXISTS timescaledb;

  CREATE TABLE IF NOT EXISTS spins (
    time      TIMESTAMPTZ NOT NULL DEFAULT now(),
    socket_id TEXT        NOT NULL
  );

  SELECT create_hypertable('spins', by_range('time'), if_not_exists => TRUE);

  -- A person. Phone is optional; the id is the identity. The agent owns the iMessage columns.
  CREATE TABLE IF NOT EXISTS profiles (
    id           TEXT        PRIMARY KEY,
    name         TEXT        NOT NULL,
    phone        TEXT        UNIQUE,            -- E.164; only ever shown back to its owner
    imessage     TEXT,                          -- NULL while linking, then registered | failed | off
    line         TEXT,                          -- the Photon number assigned to text this player
    opted_in     BOOLEAN     NOT NULL DEFAULT false, -- has texted the bot; Photon only delivers after that
    decorated    BOOLEAN     NOT NULL DEFAULT false, -- got the chat background
    contact_card BOOLEAN     NOT NULL DEFAULT false, -- got the "aerodance" contact card
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Browsers signed in as a profile (the phone view keeps its token in localStorage).
  CREATE TABLE IF NOT EXISTS devices (
    token      TEXT        PRIMARY KEY,
    profile_id TEXT        NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- One Solana devnet wallet per profile, created and funded by the agent. Only the agent reads secret_key.
  CREATE TABLE IF NOT EXISTS wallets (
    profile_id TEXT        PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
    address    TEXT        NOT NULL UNIQUE,
    secret_key BYTEA       NOT NULL,
    funded_sig TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS battles (
    id                 TEXT        PRIMARY KEY,
    status             TEXT        NOT NULL DEFAULT 'open', -- open | finished
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    first_result_at    TIMESTAMPTZ,
    finished_at        TIMESTAMPTZ,
    winner_seat        INT,                                 -- NULL once finished = tie
    -- On-chain memo receipt, written by the agent. The signed tx is kept so retries resend the same signature.
    receipt_status     TEXT,                                -- pending | confirmed
    receipt_signature  TEXT,
    receipt_tx         TEXT,
    receipt_last_valid BIGINT,
    receipt_attempts   INT         NOT NULL DEFAULT 0,
    -- The winner's trophy NFT (Metaplex Core), minted by the agent. The asset key is kept
    -- until the mint lands, so a retry finds the asset instead of minting a second one.
    trophy_status       TEXT,                               -- pending | minted; NULL for ties and unclaimed seats
    trophy_owner        TEXT,                               -- winner's wallet address
    trophy_asset_secret BYTEA,
    trophy_asset        TEXT,
    trophy_attempts     INT         NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS battle_seats (
    battle_id   TEXT        NOT NULL REFERENCES battles (id) ON DELETE CASCADE,
    seat        INT         NOT NULL,
    token       TEXT        NOT NULL UNIQUE, -- result-reporting credential, held by the game display
    profile_id  TEXT        REFERENCES profiles (id) ON DELETE SET NULL,
    score       INT,
    pops        INT,
    sync        REAL,
    flair       INT,
    reported_at TIMESTAMPTZ,
    PRIMARY KEY (battle_id, seat)
  );
  CREATE INDEX IF NOT EXISTS battle_seats_profile ON battle_seats (profile_id);

  CREATE TABLE IF NOT EXISTS battle_spectators (
    battle_id  TEXT        NOT NULL REFERENCES battles (id) ON DELETE CASCADE,
    profile_id TEXT        NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (battle_id, profile_id)
  );

  -- Confirmed spectator → dancer tips of devnet SOL.
  CREATE TABLE IF NOT EXISTS hype (
    time         TIMESTAMPTZ      NOT NULL DEFAULT now(),
    battle_id    TEXT             NOT NULL,
    seat         INT              NOT NULL,
    from_profile TEXT             NOT NULL,
    sol          DOUBLE PRECISION NOT NULL,
    signature    TEXT             NOT NULL
  );

  SELECT create_hypertable('hype', by_range('time'), if_not_exists => TRUE);
  CREATE INDEX IF NOT EXISTS hype_battle ON hype (battle_id, time DESC);

  -- Work for the agent (wallets, iMessage, receipts). It LISTENs on 'jobs' and retries with backoff.
  CREATE TABLE IF NOT EXISTS jobs (
    id         BIGSERIAL   PRIMARY KEY,
    kind       TEXT        NOT NULL,
    payload    JSONB       NOT NULL DEFAULT '{}',
    run_after  TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts   INT         NOT NULL DEFAULT 0,
    last_error TEXT,
    done_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS jobs_due ON jobs (run_after) WHERE done_at IS NULL;

  -- Inbound iMessage ids the bot already handled, so a redelivery gets no second reply.
  CREATE TABLE IF NOT EXISTS imessage_seen (
    id TEXT        PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

export async function migrate({ retries = 10, delayMs = 2000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query(schema);
      return;
    } catch (err) {
      if (attempt >= retries) throw err;
      console.warn(`database not ready (${err.message}), retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// Runs fn(client) in a transaction. NOTIFYs sent inside it are delivered on commit.
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Hands work to the agent; `db` may be a transaction client so the job commits with the change.
export async function enqueueJob(db, kind, payload) {
  await db.query('INSERT INTO jobs (kind, payload) VALUES ($1, $2)', [kind, payload]);
  await db.query("SELECT pg_notify('jobs', $1)", [kind]);
}

// LISTEN on a channel with its own connection, reconnecting if it drops.
// Notifications sent while disconnected are lost, so callers also poll or refetch.
export function listen(channel, onPayload) {
  let stopped = false;
  let current = null;
  const connect = async () => {
    const client = new pg.Client({ connectionString: databaseUrl.toString() });
    current = client;
    let failed = false;
    const fail = (err) => {
      if (failed) return;
      failed = true;
      if (err && !stopped) console.warn(`LISTEN ${channel} lost (${err.message}), reconnecting...`);
      client.end().catch(() => {});
      if (!stopped) setTimeout(connect, 2000).unref();
    };
    client.on('error', fail);
    client.on('end', () => fail());
    client.on('notification', (msg) => onPayload(msg.payload ?? ''));
    try {
      await client.connect();
      await client.query(`LISTEN ${channel}`);
    } catch (err) {
      fail(err);
    }
  };
  connect();
  return () => {
    stopped = true;
    current?.end().catch(() => {});
  };
}

export async function recordSpin(socketId) {
  await pool.query('INSERT INTO spins (socket_id) VALUES ($1)', [socketId]);
}

export async function spinsSince(interval) {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS count FROM spins WHERE time > now() - $1::interval',
    [interval],
  );
  return rows[0].count;
}

export async function spinHistory({ bucket = '1 minute', range = '1 hour' } = {}) {
  const { rows } = await pool.query(
    `SELECT time_bucket($1::interval, time) AS bucket, count(*)::int AS spins
       FROM spins
      WHERE time > now() - $2::interval
      GROUP BY bucket
      ORDER BY bucket`,
    [bucket, range],
  );
  return rows;
}
