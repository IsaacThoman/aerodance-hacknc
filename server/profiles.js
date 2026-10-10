// Profiles (the person), the browsers signed in as them, and their stats.
// Wallets and iMessage linking are the agent's side; this module only queues that work.
import { randomBytes } from 'node:crypto';
import { enqueueJob, pool, tx } from './db.js';
import { agentCall } from './agent.js';
import { changes } from './events.js';

export const explorerAddress = (address) => `https://explorer.solana.com/address/${address}?cluster=devnet`;
export const explorerTx = (signature) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

// ---------- names & phones ----------

const ADJECTIVES = ['Bubbly', 'Glassy', 'Aqua', 'Sunny', 'Dewy', 'Glossy', 'Breezy', 'Crystal', 'Misty', 'Lagoon', 'Shimmer', 'Azure'];
const NOUNS = ['Koi', 'Dolphin', 'Orca', 'Jellyfish', 'Seahorse', 'Fern', 'Raindrop', 'Cloud', 'Bubble', 'Lily', 'Manta', 'Sprout'];
const pick = (xs) => xs[randomBytes(1)[0] % xs.length];
export const aeroName = () => `${pick(ADJECTIVES)} ${pick(NOUNS)}`;

export function cleanName(raw) {
  if (typeof raw !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24);
  return name || undefined;
}

// "(919) 555-0123" → "+19195550123". US default for 10-digit numbers.
export function normalizePhone(raw) {
  const s = raw.trim();
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return undefined;
}

// ---------- ids ----------

const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i

export function shortId(length = 6) {
  return Array.from(randomBytes(length), (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- profiles ----------

export async function getProfile(id, db = pool) {
  if (!id) return undefined;
  const { rows } = await db.query('SELECT * FROM profiles WHERE id = $1', [id]);
  return rows[0];
}

export async function profileByDevice(token, db = pool) {
  if (!token) return undefined;
  const { rows } = await db.query(
    'SELECT p.* FROM devices d JOIN profiles p ON p.id = d.profile_id WHERE d.token = $1',
    [token],
  );
  return rows[0];
}

async function profileByPhone(phone, db = pool) {
  const { rows } = await db.query('SELECT * FROM profiles WHERE phone = $1', [phone]);
  return rows[0];
}

// New profiles get a devnet wallet from the agent; until it lands the wallet shows as pending.
// texted: they reached the bot themselves, so the line can already reach them.
async function newProfile(db, { name, phone, texted = false }) {
  for (;;) {
    const { rows } = await db.query(
      `INSERT INTO profiles (id, name, phone, imessage, opted_in) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING RETURNING *`,
      [shortId(8), name ?? aeroName(), phone ?? null, texted ? 'registered' : null, texted],
    );
    if (!rows[0]) continue;
    await enqueueJob(db, 'wallet', { profileId: rows[0].id });
    if (phone && !texted) await enqueueJob(db, 'link_phone', { profileId: rows[0].id });
    return rows[0];
  }
}

// The phone view: create or update the profile behind a device token.
// No phone verification by design: entering a number links this device to it.
export async function upsertProfile(deviceToken, { name, phone }) {
  const result = await tx(async (db) => {
    let profile = await profileByDevice(deviceToken, db);
    const token = profile ? deviceToken : randomBytes(18).toString('base64url');

    if (phone && phone !== profile?.phone) {
      const owner = await profileByPhone(phone, db);
      if (owner) {
        // Returning player on a new device: switch this device to their profile.
        profile = owner;
      } else if (profile) {
        ({ rows: [profile] } = await db.query(
          `UPDATE profiles SET phone = $2, imessage = NULL, line = NULL, opted_in = false,
                  decorated = false, contact_card = false
            WHERE id = $1 RETURNING *`,
          [profile.id, phone],
        ));
        await enqueueJob(db, 'link_phone', { profileId: profile.id });
      } else {
        profile = await newProfile(db, { name, phone });
      }
    }
    profile ??= await newProfile(db, { name });
    if (name && name !== profile.name) {
      ({ rows: [profile] } = await db.query('UPDATE profiles SET name = $2 WHERE id = $1 RETURNING *', [profile.id, name]));
    }
    await db.query(
      `INSERT INTO devices (token, profile_id) VALUES ($1, $2)
       ON CONFLICT (token) DO UPDATE SET profile_id = EXCLUDED.profile_id`,
      [token, profile.id],
    );
    return { profile, deviceToken: token };
  });
  changes.emit('profile', result.profile.id);
  return result;
}

// The bot side: whoever texts us gets a profile keyed by their number.
// justOptedIn: they linked on the phone view and this is their first text, which opts them in.
export async function profileForPhone(phone) {
  return tx(async (db) => {
    const existing = await profileByPhone(phone, db);
    if (existing) {
      if (existing.opted_in) return { profile: existing, isNew: false, justOptedIn: false };
      const { rows: [profile] } = await db.query(
        "UPDATE profiles SET opted_in = true, imessage = 'registered' WHERE id = $1 RETURNING *",
        [existing.id],
      );
      changes.emit('profile', profile.id);
      return { profile, isNew: false, justOptedIn: true };
    }
    const profile = await newProfile(db, { phone, texted: true });
    return { profile, isNew: true, justOptedIn: false };
  });
}

export async function renameProfile(id, name) {
  const { rows } = await pool.query('UPDATE profiles SET name = $2 WHERE id = $1 RETURNING *', [id, name]);
  if (!rows[0]) throw new HttpError(404, 'profile not found');
  changes.emit('profile', id);
  return rows[0];
}

// Lifetime stats, computed from finished battles and confirmed hype.
export async function profileStats(id, db = pool) {
  const [{ rows: [battles] }, { rows: [hype] }] = await Promise.all([
    db.query(
      `SELECT count(*)::int AS battles,
              count(*) FILTER (WHERE b.winner_seat = s.seat)::int AS wins,
              coalesce(max(s.score), 0)::int AS "bestScore",
              coalesce(sum(s.pops), 0)::int AS pops
         FROM battle_seats s JOIN battles b ON b.id = s.battle_id
        WHERE s.profile_id = $1 AND b.status = 'finished'`,
      [id],
    ),
    db.query(
      `SELECT count(*)::int AS "hypeCount", coalesce(sum(h.sol), 0)::float AS "hypeSol"
         FROM hype h JOIN battle_seats s ON s.battle_id = h.battle_id AND s.seat = h.seat
        WHERE s.profile_id = $1`,
      [id],
    ),
  ]);
  return { ...battles, ...hype, hypeSol: Math.round(hype.hypeSol * 1e6) / 1e6 };
}

// The agent knows balances; if it's unreachable, show the address without one.
async function walletView(profileId) {
  try {
    const w = await agentCall('GET', `/wallets/${encodeURIComponent(profileId)}`, undefined, 4000);
    return { address: w.address, balance: w.balance, explorer: explorerAddress(w.address) };
  } catch {
    const { rows } = await pool.query('SELECT address FROM wallets WHERE profile_id = $1', [profileId]);
    return rows[0] ? { address: rows[0].address, balance: null, explorer: explorerAddress(rows[0].address) } : null;
  }
}

// What the owner sees about themselves.
export async function selfView(profile) {
  const [stats, wallet] = await Promise.all([profileStats(profile.id), walletView(profile.id)]);
  let imessage = 'none';
  if (profile.phone) {
    // "optin": on the allowlist, waiting for their first text to `line`.
    imessage = profile.imessage === 'registered' && !profile.opted_in ? 'optin' : (profile.imessage ?? 'pending');
  }
  return {
    id: profile.id,
    name: profile.name,
    phone: profile.phone ?? null,
    imessage,
    line: profile.opted_in ? null : (profile.line ?? null),
    stats,
    wallet,
  };
}
