import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { migrate, pool, recordSpin, spinHistory, spinsSince } from './db.js';
import { songCatalogMiddleware } from './songCatalog.js';

const PORT = Number(process.env.PORT) || 3000;
const distDir = path.resolve(fileURLToPath(import.meta.url), '../../dist');

const app = express();
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

// In production Express serves the Vite build; in dev Vite serves the client.
app.get('/songs/manifest.json', songCatalogMiddleware(path.join(distDir, 'songs')));
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

io.on('connection', (socket) => {
  broadcastStats();

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
httpServer.listen(PORT, () => {
  console.log(`aerodance listening on http://localhost:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    io.close();
    pool.end().finally(() => process.exit(0));
  });
}
