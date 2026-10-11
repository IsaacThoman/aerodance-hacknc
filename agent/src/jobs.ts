// Works through the app's jobs table. The app NOTIFYs 'jobs' when it adds one; a slow
// poll catches anything missed. Failed jobs retry with backoff, so a restart or a slow
// Solana RPC never loses a receipt or a text.
import { listen, pool } from "./db.ts";

type Job = { id: string; kind: string; payload: any; attempts: number };
type Handler = (payload: any, job: Job) => Promise<void>;

// Throw to retry after a specific delay instead of the default backoff.
export class Retry extends Error {
  constructor(message: string, readonly delayMs: number) {
    super(message);
  }
}

const MAX_ATTEMPTS = 40;
const MAX_IN_FLIGHT = 8;
const LEASE = "2 minutes"; // a crashed handler's job runs again after this
const handlers = new Map<string, Handler>();
const log = (...args: unknown[]) => console.log("[jobs]", ...args);

export function handle(kind: string, fn: Handler): void {
  handlers.set(kind, fn);
}

export async function enqueue(kind: string, payload: unknown, delayMs = 0): Promise<void> {
  await pool.query("INSERT INTO jobs (kind, payload, run_after) VALUES ($1, $2, now() + $3 * interval '1 millisecond')", [
    kind,
    payload,
    delayMs,
  ]);
}

async function claim(limit: number): Promise<Job[]> {
  if (limit <= 0) return [];
  const { rows } = await pool.query<Job>(
    `UPDATE jobs SET run_after = now() + $1::interval, attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM jobs WHERE done_at IS NULL AND run_after <= now()
         ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED)
      RETURNING id, kind, payload, attempts`,
    [LEASE, limit],
  );
  return rows;
}

async function run(job: Job): Promise<void> {
  const handler = handlers.get(job.kind);
  try {
    if (!handler) throw new Error(`no handler for ${job.kind}`);
    await handler(job.payload, job);
    await pool.query("UPDATE jobs SET done_at = now(), last_error = NULL WHERE id = $1", [job.id]);
  } catch (err) {
    const message = (err as Error).message.split("\n")[0]!;
    const giveUp = !handler || job.attempts >= MAX_ATTEMPTS;
    const delayMs = err instanceof Retry ? err.delayMs : Math.min(15_000 * 2 ** (job.attempts - 1), 10 * 60_000);
    log(`${job.kind} #${job.id} attempt ${job.attempts} failed${giveUp ? " (giving up)" : ""}:`, message);
    await pool.query(
      `UPDATE jobs SET last_error = $2,
              done_at = CASE WHEN $3 THEN now() END,
              run_after = now() + $4 * interval '1 millisecond'
        WHERE id = $1`,
      [job.id, message, giveUp, delayMs],
    );
  }
}

// Jobs run concurrently (a receipt can wait ~20 s on Solana); finishing one looks for more.
let inFlight = 0;
let claiming = false;
let again = false;

async function tick(): Promise<void> {
  if (claiming) {
    again = true;
    return;
  }
  claiming = true;
  try {
    do {
      again = false;
      for (const job of await claim(MAX_IN_FLIGHT - inFlight)) {
        inFlight++;
        void run(job)
          .catch((err) => log(`${job.kind} #${job.id} bookkeeping failed:`, (err as Error).message))
          .finally(() => {
            inFlight--;
            void tick();
          });
      }
    } while (again);
  } catch (err) {
    log("claim failed:", (err as Error).message);
  } finally {
    claiming = false;
  }
}

export function startJobs(): void {
  listen("jobs", () => void tick());
  setInterval(() => void tick(), 5_000).unref();
  // Finished jobs are only useful for debugging; keep a week of them.
  setInterval(() => {
    pool.query("DELETE FROM jobs WHERE done_at < now() - interval '7 days'").catch((err) => log("cleanup failed:", err.message));
  }, 60 * 60_000).unref();
  void tick();
}
