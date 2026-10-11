import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import {
  MAX_SEATS, claimSeat, createBattle, hypeDancer, isSticker, joinBattle, publicBattle, reportResult, seatForToken,
  startBattle,
} from './battles.js';
import {
  HttpError, cleanName, getProfile, normalizePhone, profileByDevice, profileForPhone, profileStats,
  renameProfile, selfView, upsertProfile,
} from './profiles.js';

// Where battle links in texts point. Pages opened in a browser build their own links from location.
export const publicUrl = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
export const battleUrl = (id, token) => `${publicUrl}/battle/${id}?p=${encodeURIComponent(token)}`;
// Base for NFT metadata and images: PUBLIC_URL, else the address this request came in on.
export const requestBaseUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

// Express 5 forwards rejected promises to the error handler, so handlers can just throw.
function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
  console.error('[http]', err.message);
  res.status(500).json({ error: 'internal error' });
}

async function requireProfile(req) {
  const profile = await profileByDevice(req.get('x-device-token'));
  if (!profile) throw new HttpError(401, 'join first');
  return profile;
}

function readResult(body) {
  const { score, pops = 0, sync = 0, flair = 0 } = body ?? {};
  const nums = { score, pops, sync, flair };
  for (const [k, v] of Object.entries(nums)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e9) {
      throw new HttpError(400, `${k} must be a non-negative number`);
    }
  }
  return nums;
}

async function battleOr404(id) {
  const battle = await publicBattle(id);
  if (!battle) throw new HttpError(404, 'battle not found');
  return battle;
}

// Public API under /api, served on the app's public port.
export function publicRoutes() {
  const api = express.Router();
  api.use(express.json({ limit: '16kb' }));

  // Start a battle from the game display. The display keeps the seat tokens to report results.
  api.post('/battles', async (req, res) => {
    const count = Math.min(Math.max(Number(req.body?.players) || 2, 1), MAX_SEATS);
    const battle = await createBattle(Array(count).fill(null));
    res.status(201).json({ id: battle.id, players: battle.players.map(({ seat, token }) => ({ seat, token })) });
  });

  api.get('/battles/:id', async (req, res) => {
    res.json(await battleOr404(req.params.id));
  });

  api.post('/battles/:id/result', async (req, res) => {
    const { playerToken } = req.body ?? {};
    if (typeof playerToken !== 'string') throw new HttpError(400, 'playerToken required');
    res.json(await reportResult(req.params.id, playerToken, readResult(req.body)));
  });

  // The display pressed Start: phones follow the dance from battle.startedAt.
  api.post('/battles/:id/start', async (req, res) => {
    const { playerToken } = req.body ?? {};
    if (typeof playerToken !== 'string') throw new HttpError(400, 'playerToken required');
    await startBattle(req.params.id, playerToken);
    res.json({ ok: true });
  });

  // A play link (/battle/:id?p=<token>) opened on a display: which seat is it?
  api.post('/battles/:id/seat', async (req, res) => {
    const { playerToken } = req.body ?? {};
    if (typeof playerToken !== 'string') throw new HttpError(400, 'playerToken required');
    res.json({ seat: await seatForToken(req.params.id, playerToken) });
  });

  // ---------- phones ----------

  api.get('/me', async (req, res) => {
    res.json(await selfView(await requireProfile(req)));
  });

  // Create or update your profile. Name defaults to a Frutiger Aero name; phone is optional.
  api.post('/me', async (req, res) => {
    const name = cleanName(req.body?.name);
    const rawPhone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
    const phone = rawPhone ? normalizePhone(rawPhone) : undefined;
    if (rawPhone && !phone) throw new HttpError(400, "that phone number doesn't look right");
    const { profile, deviceToken } = await upsertProfile(req.get('x-device-token'), { name, phone });
    res.json({ deviceToken, me: await selfView(profile) });
  });

  api.post('/battles/:id/join', async (req, res) => {
    res.json(await joinBattle(req.params.id, (await requireProfile(req)).id));
  });

  // { seat } tips devnet SOL; { seat, sticker } mints a sticker NFT into the dancer's wallet.
  api.post('/battles/:id/hype', async (req, res) => {
    const seat = Number(req.body?.seat);
    if (!Number.isInteger(seat) || seat < 0) throw new HttpError(400, 'seat required');
    const sticker = req.body?.sticker;
    if (sticker !== undefined && !isSticker(sticker)) throw new HttpError(400, 'unknown sticker');
    res.json(await hypeDancer(req.params.id, await requireProfile(req), seat, { sticker, baseUrl: requestBaseUrl(req) }));
  });

  api.use((_req, _res, next) => next(new HttpError(404, 'not found')));
  api.use(errorHandler);
  return api;
}

// Internal API for the agent's iMessage bot. Listens on its own port, which only the
// Compose network can reach (Coolify routes the domain to port 3000 only).
export function internalApp() {
  const app = express();
  app.use(express.json({ limit: '16kb' }));

  const secret = process.env.INTERNAL_SECRET ? Buffer.from(process.env.INTERNAL_SECRET) : null;
  app.use((req, _res, next) => {
    const given = Buffer.from(req.get('x-internal-secret') ?? '');
    if (secret && (given.length !== secret.length || !timingSafeEqual(given, secret))) {
      return next(new HttpError(401, 'bad internal secret'));
    }
    next();
  });

  app.post('/internal/phone-profile', async (req, res) => {
    const phone = typeof req.body?.phone === 'string' ? normalizePhone(req.body.phone) : undefined;
    if (!phone) throw new HttpError(400, 'phone required');
    res.json(await profileForPhone(phone));
  });

  app.get('/internal/profiles/:id', async (req, res) => {
    const profile = await getProfile(req.params.id);
    if (!profile) throw new HttpError(404, 'profile not found');
    res.json({ ...profile, stats: await profileStats(profile.id) });
  });

  app.post('/internal/profiles/:id/name', async (req, res) => {
    const name = cleanName(req.body?.name);
    if (!name) throw new HttpError(400, 'name required');
    res.json(await renameProfile(req.params.id, name));
  });

  // seats: [profileId | null, ...]. Returns a play link per seat.
  app.post('/internal/battles', async (req, res) => {
    const seats = req.body?.seats;
    if (!Array.isArray(seats) || seats.length < 1 || seats.length > MAX_SEATS) {
      throw new HttpError(400, `seats must list 1-${MAX_SEATS} profile ids or nulls`);
    }
    const battle = await createBattle(seats.map((s) => (typeof s === 'string' ? s : null)));
    res.status(201).json({
      id: battle.id,
      players: battle.players.map(({ seat, token }) => ({ seat, token, url: battleUrl(battle.id, token) })),
    });
  });

  app.post('/internal/battles/:id/claim', async (req, res) => {
    const { seat, profileId } = req.body ?? {};
    if (!Number.isInteger(seat) || typeof profileId !== 'string') throw new HttpError(400, 'seat and profileId required');
    await claimSeat(req.params.id, seat, profileId);
    res.json({ ok: true });
  });

  app.use((_req, _res, next) => next(new HttpError(404, 'not found')));
  app.use(errorHandler);
  return app;
}
