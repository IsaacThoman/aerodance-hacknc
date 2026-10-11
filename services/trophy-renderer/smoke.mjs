// Run inside the production renderer image; exercises real Chromium and software WebGL.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { validateTrophyPng } from '../../packages/trophy-art/index.js';

const server = spawn(process.execPath, [new URL('./index.js', import.meta.url).pathname], {
  env: { ...process.env, INTERNAL_SECRET: 'renderer-smoke-test' }, stdio: 'inherit',
});
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Renderer exited during startup');
    ready = await fetch('http://127.0.0.1:4001/health').then(r => r.ok, () => false);
    if (ready) break;
    await sleep(1000);
  }
  assert.ok(ready, 'renderer starts within a minute');
  const response = await fetch('http://127.0.0.1:4001/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': 'renderer-smoke-test' },
    body: JSON.stringify({ id: '3wegvq', created_at: '2026-10-11T18:00:00Z', score: 824, pops: 55, sync: 0.76, flair: 91 }),
    signal: AbortSignal.timeout(310_000),
  });
  if (!response.ok) throw new Error(`Render returned ${response.status}: ${(await response.text()).slice(0, 100)}`);
  assert.match(response.headers.get('content-type'), /image\/png/);
  const png = validateTrophyPng(Buffer.from(await response.arrayBuffer()));
  assert.ok(png.length > 30_000, 'render contains the stage, trophy and HUD');
  console.log(`Software WebGL trophy smoke test passed (${png.length} bytes, 1080×1080)`);
} finally {
  server.kill('SIGTERM');
}
