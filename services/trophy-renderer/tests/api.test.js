import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rendererApp } from '../app.js';

const png = await readFile(new URL('../../../temp/trophy-renders/renders/3wegvq.png', import.meta.url));
const spec = { id: '3wegvq', created_at: '2026-10-11T18:00:00Z', score: 824, pops: 55, sync: 0.76, flair: 91 };

async function api(t, render) {
  const server = rendererApp({ render, secret: 'test-secret' }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  return (body = spec, secret = 'test-secret') => fetch(`${url}/render`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': secret }, body: JSON.stringify(body),
  });
}

test('requires the internal secret and a valid result before running WebGL', async t => {
  let calls = 0;
  const post = await api(t, async () => { calls++; return png; });
  assert.equal((await post(spec, 'wrong-secret')).status, 401);
  assert.equal((await post({ ...spec, id: '../escape' })).status, 400);
  assert.equal((await post({ ...spec, score: '824' })).status, 400);
  assert.equal(calls, 0);
  const result = await post();
  assert.equal(result.status, 200);
  assert.match(result.headers.get('content-type'), /image\/png/);
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), png);
});

test('rejects concurrent renders for retry, then accepts the next battle', async t => {
  let finish;
  let started;
  const running = new Promise(resolve => { started = resolve; });
  const post = await api(t, () => { started(); return new Promise(resolve => { finish = resolve; }); });
  const first = post();
  await running;
  assert.equal((await post()).status, 503);
  finish(png);
  assert.equal((await first).status, 200);
  const startedAgain = new Promise(resolve => { started = resolve; });
  const next = post();
  await startedAgain;
  finish(png);
  assert.equal((await next).status, 200);
});

test('failed renders return a retryable response and release their slot', async t => {
  let calls = 0;
  const post = await api(t, async () => { if (++calls === 1) throw new Error('WebGL unavailable'); return png; });
  assert.equal((await post()).status, 503);
  assert.equal((await post()).status, 200);
});
