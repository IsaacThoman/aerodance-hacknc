import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { listen, migrate, pool, recordSpin, spinHistory, spinsSince } from './db.js';
import { publicBattle, startSweeper, stickerMetadata, trophyMetadata } from './battles.js';
import { changes } from './events.js';
import { profileByDevice } from './profiles.js';
import { attachRemote } from './remote.js';
import { internalApp, publicRoutes, requestBaseUrl } from './routes.js';

const PORT = Number(process.env.PORT) || 3000;
const INTERNAL_PORT = Number(process.env.INTERNAL_PORT) || 3001;
const distDir = path.resolve(fileURLToPath(import.meta.url), '../../dist');

const app = express();
// Behind Coolify's proxy: req.protocol reflects the public https URL.
app.set('trust proxy', true);
const httpServer = createServer(app);
const io = new Server(httpServer);

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

app.get('/api/spins/history', async (_req, res, next) => {
  try {
    res.json(await spinHistory());
  } catch (err) {
    next(err);
  }
});

app.use('/api', publicRoutes());

// NFT metadata (the assets' on-chain uris point here): hype stickers and battle trophies.
app.get('/nft/hype/:id/:stickerId.json', async (req, res) => {
  const meta = await stickerMetadata(req.params.id, req.params.stickerId, requestBaseUrl(req));
  if (!meta) return res.status(404).json({ error: 'no such sticker' });
  res.json(meta);
});
app.get('/nft/:id.json', async (req, res) => {
  const meta = await trophyMetadata(req.params.id, requestBaseUrl(req));
  if (!meta) return res.status(404).json({ error: 'no trophy for that battle' });
  res.json(meta);
});

// In production Express serves the Vite build; in dev Vite serves the client.
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

async function broadcastStats() {
  try {
    io.emit('stats', {
      online: io.engine.clientsCount,
      spinsLastMinute: await spinsSince('1 minute'),
    });
  } catch (err) {
    console.error('failed to broadcast stats:', err.message);
  }
}

// ---------- battles ----------
// Displays and phones watch a battle's room; every change pushes the full public state.

const battleRoom = (id) => `battle:${id}`;
const profileRoom = (id) => `profile:${id}`;

changes.on('battle', async (id) => {
  try {
    const battle = await publicBattle(id);
    if (battle) io.to(battleRoom(id)).emit('battle', battle);
  } catch (err) {
    console.error('failed to broadcast battle:', err.message);
  }
});
// Instant feedback while the transfer confirms; the totals follow in the next 'battle'.
changes.on('hype', ({ battleId, seat, from, sticker }) => io.to(battleRoom(battleId)).emit('hype', { battleId, seat, from, sticker }));
// Phones refetch /api/me (it includes a live wallet balance).
changes.on('profile', (id) => io.to(profileRoom(id)).emit('me:changed'));

// The agent reports receipts and iMessage linking here: { battle: id } or { profile: id }.
listen('changes', (payload) => {
  try {
    const { battle, profile } = JSON.parse(payload);
    if (battle) changes.emit('battle', battle);
    if (profile) changes.emit('profile', profile);
  } catch {
    console.warn('ignoring malformed change notification');
  }
});

attachRemote(io);

io.on('connection', (socket) => {
  broadcastStats();

  socket.on('battle:watch', async (id) => {
    if (typeof id !== 'string' || id.length > 32) return;
    socket.join(battleRoom(id));
    try {
      socket.emit('battle', (await publicBattle(id)) ?? { id, missing: true });
    } catch (err) {
      console.error('failed to load battle:', err.message);
    }
  });
  socket.on('battle:unwatch', (id) => { if (typeof id === 'string') socket.leave(battleRoom(id)); });

  // Acks once joined, so the phone can refetch anything that changed before then.
  socket.on('me:watch', async (deviceToken, ack) => {
    if (typeof deviceToken !== 'string') return;
    for (const room of socket.rooms) if (room.startsWith('profile:')) socket.leave(room);
    try {
      const profile = await profileByDevice(deviceToken);
      if (profile) socket.join(profileRoom(profile.id));
    } catch (err) {
      console.error('failed to watch profile:', err.message);
    }
    if (typeof ack === 'function') ack();
  });

  socket.on('spin', async () => {
    io.emit('spin');
    try {
      await recordSpin(socket.id);
    } catch (err) {
      console.error('failed to record spin:', err.message);
    }
    broadcastStats();
  });

  socket.on('disconnect', broadcastStats);
});

// Keep the rolling "last minute" count fresh even when nobody is clicking.
setInterval(broadcastStats, 5000).unref();

await migrate();
startSweeper();
httpServer.listen(PORT, () => {
  console.log(`aerodance listening on http://localhost:${PORT}`);
});
const internalServer = internalApp().listen(INTERNAL_PORT, () => {
  console.log(`internal API (agent only) on port ${INTERNAL_PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    io.close();
    internalServer.close();
    pool.end().finally(() => process.exit(0));
  });
}
