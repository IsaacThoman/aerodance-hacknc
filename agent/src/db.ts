// Shared TimescaleDB. The app owns the schema (server/db.js); the agent owns wallets,
// receipts, iMessage columns and the jobs queue.
import pg from "pg";

const databaseUrl = new URL(process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/aerodance");
// Coolify renames Compose services in PR previews and injects the new name.
if (databaseUrl.hostname === "db" && process.env.SERVICE_NAME_DB) databaseUrl.hostname = process.env.SERVICE_NAME_DB;

export const pool = new pg.Pool({ connectionString: databaseUrl.toString() });

// The app creates the tables on boot; wait for them.
export async function waitForSchema(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query("SELECT 1 FROM jobs LIMIT 1");
      return;
    } catch (err) {
      if (attempt % 5 === 1) console.warn(`[db] waiting for the app's schema (${(err as Error).message})`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// Tells the app something changed so it can push it to displays and phones.
export async function notifyChange(change: { battle: string } | { profile: string }): Promise<void> {
  await pool.query("SELECT pg_notify('changes', $1)", [JSON.stringify(change)]);
}

// LISTEN with its own connection, reconnecting if it drops.
export function listen(channel: string, onPayload: (payload: string) => void): void {
  const connect = async () => {
    const client = new pg.Client({ connectionString: databaseUrl.toString() });
    let failed = false;
    const fail = (err?: Error) => {
      if (failed) return;
      failed = true;
      if (err) console.warn(`[db] LISTEN ${channel} lost (${err.message}), reconnecting`);
      client.end().catch(() => {});
      setTimeout(connect, 2000).unref();
    };
    client.on("error", fail);
    client.on("end", () => fail());
    client.on("notification", (msg) => onPayload(msg.payload ?? ""));
    try {
      await client.connect();
      await client.query(`LISTEN ${channel}`);
    } catch (err) {
      fail(err as Error);
    }
  };
  void connect();
}

// Returns true the first time an inbound message id is seen.
export async function markSeen(messageId: string): Promise<boolean> {
  const { rowCount } = await pool.query("INSERT INTO imessage_seen (id) VALUES ($1) ON CONFLICT DO NOTHING", [messageId]);
  if (Math.random() < 0.01) void pool.query("DELETE FROM imessage_seen WHERE at < now() - interval '7 days'").catch(() => {});
  return (rowCount ?? 0) > 0;
}

// ---------- rows the agent reads ----------

export type Profile = {
  id: string;
  name: string;
  phone: string | null;
  imessage: string | null;
  line: string | null;
  opted_in: boolean;
  decorated: boolean;
  contact_card: boolean;
};

export async function getProfile(id: string | null | undefined): Promise<Profile | undefined> {
  if (!id) return undefined;
  const { rows } = await pool.query<Profile>("SELECT * FROM profiles WHERE id = $1", [id]);
  return rows[0];
}

export async function updateProfile(id: string, fields: Partial<Omit<Profile, "id">>): Promise<void> {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  await pool.query(
    `UPDATE profiles SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`,
    [id, ...Object.values(fields)],
  );
  await notifyChange({ profile: id });
}
