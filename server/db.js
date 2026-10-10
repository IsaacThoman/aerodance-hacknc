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
