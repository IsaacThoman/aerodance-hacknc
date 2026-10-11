import express from 'express';
import { validateTrophyPng } from '../../packages/trophy-art/index.js';

export function rendererApp({ render, secret = '', ready = () => true }) {
  const app = express();
  app.get('/health', (_req, res) => res.status(ready() ? 200 : 503).json({ ok: ready() }));
  app.use((req, res, next) => {
    if (secret && req.get('x-internal-secret') !== secret) return res.status(401).json({ error: 'unauthorized' });
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  let busy = false;
  app.post('/render', async (req, res) => {
    const b = req.body;
    if (!b || typeof b.id !== 'string' || !/^[a-z0-9]{6}$/.test(b.id)
        || typeof b.created_at !== 'string' || !Number.isFinite(Date.parse(b.created_at))
        || !['score', 'pops', 'sync', 'flair'].every((key) => b[key] === null || (Number.isFinite(b[key]) && b[key] >= 0))) {
      return res.status(400).json({ error: 'invalid trophy specification' });
    }
    if (busy || !ready()) return res.status(503).json({ error: 'renderer busy or restarting' });
    busy = true;
    try {
      const png = validateTrophyPng(await render(b));
      res.type('image/png').send(png);
    } catch (err) {
      console.error(`[trophy-renderer] ${b.id}: ${err.message}`);
      res.status(503).json({ error: 'trophy render failed' });
    } finally {
      busy = false;
    }
  });
  return app;
}
