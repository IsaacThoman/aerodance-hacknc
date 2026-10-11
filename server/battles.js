// Battle lifecycle: seats, spectators, hype and results. Settling picks the winner
// right away; the agent then writes the on-chain receipt and texts the players.
import { randomBytes } from 'node:crypto';
import { enqueueJob, pool, tx } from './db.js';
import { AgentError, agentCall } from './agent.js';
import { changes } from './events.js';
import { HttpError, explorerAddress, explorerTx, getProfile, shortId } from './profiles.js';

export const MAX_SEATS = 8;
export const HYPE_SOL = 0.005;
export const STICKERS = {
  bubble: { label: 'Bubble Hype', emoji: '🫧' },
  koi: { label: 'Koi Hype', emoji: '🐠' },
  rainbow: { label: 'Rainbow Hype', emoji: '🌈' },
};
export const isSticker = (s) => typeof s === 'string' && Object.hasOwn(STICKERS, s);
// Once the first score is in, seats that never report are dropped after this long.
const RESULT_GRACE = '90 seconds';

const round = (n) => Math.round(n * 1e6) / 1e6;

// Seats may start claimed (bot battles) or empty (claimed by scanning the QR).
export async function createBattle(seats) {
  const battle = await tx(async (db) => {
    let id;
    do {
      id = shortId();
    } while (!(await db.query('INSERT INTO battles (id) VALUES ($1) ON CONFLICT DO NOTHING', [id])).rowCount);
    const players = seats.map((profileId, seat) => ({ seat, token: randomBytes(16).toString('base64url'), profileId: profileId ?? null }));
    for (const p of players) {
      await db.query(
        'INSERT INTO battle_seats (battle_id, seat, token, profile_id) VALUES ($1, $2, $3, $4)',
        [id, p.seat, p.token, p.profileId],
      );
    }
    return { id, players };
  });
  changes.emit('battle', battle.id);
  return battle;
}

// Public view for the display and every phone: names and seats, no tokens or phones.
export async function publicBattle(id) {
  const { rows: [b] } = await pool.query(
    `SELECT *, first_result_at + $2::interval AS closes_at FROM battles WHERE id = $1`,
    [id, RESULT_GRACE],
  );
  if (!b) return undefined;
  const [{ rows: seats }, { rows: hype }, { rows: [watching] }] = await Promise.all([
    pool.query(
      `SELECT s.seat, s.score, s.pops, s.sync, s.flair, s.reported_at, p.name, w.address
         FROM battle_seats s
         LEFT JOIN profiles p ON p.id = s.profile_id
         LEFT JOIN wallets w ON w.profile_id = s.profile_id
        WHERE s.battle_id = $1 ORDER BY s.seat`,
      [id],
    ),
    pool.query(
      `SELECT seat, count(*)::int AS count, sum(sol)::float AS sol,
              count(*) FILTER (WHERE sticker = 'bubble')::int AS bubble,
              count(*) FILTER (WHERE sticker = 'koi')::int AS koi,
              count(*) FILTER (WHERE sticker = 'rainbow')::int AS rainbow
         FROM hype WHERE battle_id = $1 GROUP BY seat`,
      [id],
    ),
    pool.query('SELECT count(*)::int AS count FROM battle_spectators WHERE battle_id = $1', [id]),
  ]);
  const finished = b.status === 'finished';
  return {
    id: b.id,
    status: b.status,
    createdAt: b.created_at,
    closesAt: finished ? null : b.closes_at,
    players: seats.map((s) => {
      const h = hype.find((x) => x.seat === s.seat);
      return {
        seat: s.seat,
        name: s.name ?? null,
        wallet: s.address ?? null,
        result: s.reported_at
          ? { score: s.score, pops: s.pops, sync: s.sync, flair: s.flair, at: s.reported_at }
          : null,
        hype: {
          count: h?.count ?? 0,
          sol: round(h?.sol ?? 0),
          stickers: Object.fromEntries(Object.keys(STICKERS).map((k) => [k, h?.[k] ?? 0])),
        },
      };
    }),
    spectators: watching.count,
    winnerSeat: finished ? b.winner_seat : null, // null + finished = tie
    receipt: finished
      ? b.receipt_status === 'confirmed'
        ? { status: 'confirmed', signature: b.receipt_signature, explorer: explorerTx(b.receipt_signature) }
        : { status: 'pending', signature: null, explorer: null }
      : null,
    trophy: finished && b.trophy_status
      ? b.trophy_status === 'minted'
        ? { status: 'minted', asset: b.trophy_asset, explorer: explorerAddress(b.trophy_asset) }
        : { status: 'pending', asset: null, explorer: null }
      : null,
  };
}

// Off-chain metadata the trophy NFT's uri points to (Metaplex JSON standard).
export async function trophyMetadata(id, baseUrl) {
  const { rows: [b] } = await pool.query(
    `SELECT b.id, b.created_at, b.winner_seat, s.score, s.pops, s.sync, s.flair,
            (SELECT count(*)::int FROM battle_seats WHERE battle_id = b.id) AS dancers,
            (SELECT count(*)::int FROM hype WHERE battle_id = b.id AND seat = b.winner_seat) AS hype
       FROM battles b JOIN battle_seats s ON s.battle_id = b.id AND s.seat = b.winner_seat
      WHERE b.id = $1 AND b.trophy_status IS NOT NULL`,
    [id],
  );
  if (!b) return undefined;
  const image = `${baseUrl}/trophy.png`;
  return {
    name: `aerodance trophy #${b.id}`,
    symbol: 'AERO',
    description: `Won dance battle ${b.id} on aerodance 🫧 Frutiger Aero dance battles, scored live.`,
    image,
    external_url: baseUrl,
    attributes: [
      { trait_type: 'battle', value: b.id },
      { trait_type: 'dancers', value: b.dancers },
      { trait_type: 'score', value: b.score ?? 0 },
      { trait_type: 'pops', value: b.pops ?? 0 },
      { trait_type: 'sync', value: b.sync ?? 0 },
      { trait_type: 'flair', value: b.flair ?? 0 },
      { trait_type: 'hype', value: b.hype },
      { trait_type: 'date', value: b.created_at.toISOString().slice(0, 10) },
    ],
    properties: { category: 'image', files: [{ uri: image, type: 'image/png' }] },
  };
}

// Highest score wins; a shared top score is a tie. Idempotent: only an open battle settles.
async function settle(db, id) {
  const { rowCount } = await db.query(
    `UPDATE battles b
        SET status = 'finished', finished_at = now(), receipt_status = 'pending',
            winner_seat = (
              SELECT CASE WHEN count(*) = 1 THEN min(s.seat) END
                FROM battle_seats s
               WHERE s.battle_id = b.id
                 AND s.score = (SELECT max(score) FROM battle_seats WHERE battle_id = b.id)
            )
      WHERE b.id = $1 AND b.status = 'open'`,
    [id],
  );
  if (rowCount) await enqueueJob(db, 'battle_finished', { battleId: id });
  return rowCount > 0;
}

export async function reportResult(id, token, result) {
  await tx(async (db) => {
    const { rows: [battle] } = await db.query('SELECT status FROM battles WHERE id = $1 FOR UPDATE', [id]);
    if (!battle) throw new HttpError(404, 'battle not found');
    if (battle.status !== 'open') throw new HttpError(409, 'battle already finished');
    const { rows: [seat] } = await db.query(
      'SELECT seat, reported_at FROM battle_seats WHERE battle_id = $1 AND token = $2',
      [id, token],
    );
    if (!seat) throw new HttpError(403, 'unknown player token');
    if (seat.reported_at) throw new HttpError(409, 'result already reported');

    await db.query(
      `UPDATE battle_seats SET score = $3, pops = $4, sync = $5, flair = $6, reported_at = now()
        WHERE battle_id = $1 AND seat = $2`,
      [id, seat.seat, Math.round(result.score), Math.round(result.pops), result.sync, Math.round(result.flair)],
    );
    await db.query('UPDATE battles SET first_result_at = coalesce(first_result_at, now()) WHERE id = $1', [id]);
    const { rows: [waiting] } = await db.query(
      'SELECT count(*)::int AS count FROM battle_seats WHERE battle_id = $1 AND reported_at IS NULL',
      [id],
    );
    if (waiting.count === 0) await settle(db, id);
  });
  changes.emit('battle', id);
  return publicBattle(id);
}

// Which seat a play link's token belongs to, so the display opened from it can report.
export async function seatForToken(id, token) {
  const { rows: [seat] } = await pool.query(
    'SELECT seat FROM battle_seats WHERE battle_id = $1 AND token = $2',
    [id, token],
  );
  if (!seat) throw new HttpError(403, 'unknown player token');
  return seat.seat;
}

// First people to scan get the empty seats; everyone after spectates.
export async function joinBattle(id, profileId) {
  const joined = await tx(async (db) => {
    const { rows: [battle] } = await db.query(
      'SELECT status, first_result_at FROM battles WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!battle) throw new HttpError(404, 'battle not found');
    const { rows: [mine] } = await db.query(
      'SELECT seat FROM battle_seats WHERE battle_id = $1 AND profile_id = $2',
      [id, profileId],
    );
    if (mine) return { role: 'dancer', seat: mine.seat };
    if (battle.status === 'open' && !battle.first_result_at) {
      const { rows: [free] } = await db.query(
        `UPDATE battle_seats SET profile_id = $2
          WHERE battle_id = $1
            AND seat = (SELECT min(seat) FROM battle_seats WHERE battle_id = $1 AND profile_id IS NULL)
          RETURNING seat`,
        [id, profileId],
      );
      if (free) return { role: 'dancer', seat: free.seat };
    }
    await db.query(
      'INSERT INTO battle_spectators (battle_id, profile_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [id, profileId],
    );
    return { role: 'spectator', seat: null };
  });
  changes.emit('battle', id);
  return joined;
}

// The bot seats a challenged friend once it knows it can text them.
export async function claimSeat(id, seat, profileId) {
  const { rowCount } = await pool.query(
    'UPDATE battle_seats SET profile_id = $3 WHERE battle_id = $1 AND seat = $2 AND profile_id IS NULL',
    [id, seat, profileId],
  );
  if (!rowCount) throw new HttpError(409, 'seat not available');
  changes.emit('battle', id);
}

// A spectator tips a dancer real devnet SOL from their own wallet, or sends a sticker NFT
// minted from (and paid by) that wallet. The display shows the bubble right away ('hype'
// event); the battle's totals update once it lands. baseUrl is where sticker metadata lives.
const hyping = new Set();

export async function hypeDancer(id, from, seat, { sticker, baseUrl } = {}) {
  const { rows: [battle] } = await pool.query('SELECT status FROM battles WHERE id = $1', [id]);
  if (!battle) throw new HttpError(404, 'battle not found');
  if (battle.status === 'finished') throw new HttpError(409, 'battle already finished');
  const { rows: seats } = await pool.query('SELECT seat, profile_id FROM battle_seats WHERE battle_id = $1', [id]);
  if (seats.some((s) => s.profile_id === from.id)) throw new HttpError(403, "dancers can't hype");
  const dancer = await getProfile(seats.find((s) => s.seat === seat)?.profile_id);
  if (!dancer) throw new HttpError(409, 'that seat is empty');
  if (hyping.has(from.id)) throw new HttpError(429, 'one hype at a time');

  hyping.add(from.id);
  try {
    changes.emit('hype', { battleId: id, seat, from: from.name, sticker: sticker ?? null });
    const stickerId = sticker ? shortId(8) : null;
    let landed;
    try {
      landed = sticker
        ? await agentCall('POST', '/stickers', {
          from: from.id,
          to: dancer.id,
          name: `${STICKERS[sticker].label} #${id}`,
          uri: `${baseUrl}/nft/hype/${id}/${stickerId}.json`,
        }, 60_000)
        : await agentCall('POST', '/hype', {
          from: from.id,
          to: dancer.id,
          sol: HYPE_SOL,
          memo: JSON.stringify({ app: 'aerodance', battleId: id, hype: seat }),
        }, 30_000);
    } catch (err) {
      if (err instanceof AgentError) throw new HttpError(err.status === 402 ? 402 : 503, err.status === 402 ? 'out of hype SOL' : 'Solana is slow, try again');
      throw err;
    }
    await pool.query(
      `INSERT INTO hype (battle_id, seat, from_profile, sol, signature, sticker, sticker_id, asset)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, seat, from.id, sticker ? 0 : HYPE_SOL, landed.signature, sticker ?? null, stickerId, landed.asset ?? null],
    );
    changes.emit('battle', id);
    changes.emit('profile', from.id);
    changes.emit('profile', dancer.id);
    return sticker
      ? { asset: landed.asset, explorer: explorerAddress(landed.asset) }
      : { signature: landed.signature, explorer: explorerTx(landed.signature) };
  } finally {
    hyping.delete(from.id);
  }
}

// Off-chain metadata for a sticker NFT. Wallet addresses only: names and phones stay private.
export async function stickerMetadata(battleId, stickerId, baseUrl) {
  const { rows: [h] } = await pool.query(
    `SELECT h.time, h.sticker, w.address
       FROM hype h LEFT JOIN wallets w ON w.profile_id = h.from_profile
      WHERE h.battle_id = $1 AND h.sticker_id = $2`,
    [battleId, stickerId],
  );
  if (!h?.sticker) return undefined;
  const { label, emoji } = STICKERS[h.sticker];
  const image = `${baseUrl}/stickers/${h.sticker}.png`;
  return {
    name: `${label} #${battleId}`,
    symbol: 'AERO',
    description: `${emoji} A ${label.toLowerCase()} sticker from the crowd in aerodance battle ${battleId}.`,
    image,
    external_url: baseUrl,
    attributes: [
      { trait_type: 'sticker', value: label },
      { trait_type: 'battle', value: battleId },
      { trait_type: 'from', value: h.address ?? 'a fan' },
      { trait_type: 'date', value: h.time.toISOString().slice(0, 10) },
    ],
    properties: { category: 'image', files: [{ uri: image, type: 'image/png' }] },
  };
}

// ---------- background sweeper ----------
// Settles battles whose grace window passed with seats still silent.

async function sweep() {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM battles WHERE status = 'open' AND first_result_at < now() - $1::interval`,
      [RESULT_GRACE],
    );
    for (const { id } of rows) {
      if (await tx((db) => settle(db, id))) changes.emit('battle', id);
    }
  } catch (err) {
    console.error('battle sweep failed:', err.message);
  }
}

export function startSweeper() {
  setInterval(sweep, 5000).unref();
}
