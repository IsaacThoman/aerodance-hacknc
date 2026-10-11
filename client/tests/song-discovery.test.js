import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { discoverSongs, songCatalogMiddleware } from '../../server/songCatalog.js';
import { bundleFixture } from './fixtures/songBundle.js';

async function directory(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'aerodance-songs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function install(root, revision = 1) {
  const { song, choreography, audio } = bundleFixture();
  song.bundleRevision = revision;
  const folder = path.join(root, song.songId);
  await mkdir(folder, { recursive: true });
  const files = { 'song.json': Buffer.from(JSON.stringify(song)), 'choreography.json': Buffer.from(JSON.stringify(choreography)), 'audio.wav': audio };
  for (const [name, bytes] of Object.entries(files)) await writeFile(path.join(folder, name), bytes);
  await writeFile(path.join(folder, 'checksums.json'), JSON.stringify({
    schema: 'aerodance.checksums', schemaVersion: 1,
    files: Object.entries(files).map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })),
  }));
  return folder;
}

test('discovers exports, uses current metadata, and reflects replacement/removal without a manifest', async t => {
  const root = await directory(t);
  assert.deepEqual(await discoverSongs(root), { version: 1, songs: [] });
  await install(root);
  const catalog = await discoverSongs(root);
  assert.equal(catalog.songs[0].bundle, 'fixture/song.json');
  assert.equal(catalog.songs[0].title, 'Fixture routine');
  assert.match(catalog.songs[0].sha256, /^[a-f0-9]{64}$/);
  await install(root, 2);
  assert.equal((await discoverSongs(root)).songs[0].bundleRevision, 2);
  await rm(path.join(root, 'fixture'), { recursive: true });
  assert.equal((await discoverSongs(root)).songs.length, 0);
  assert.deepEqual(await discoverSongs(path.join(root, 'absent')), { version: 1, songs: [] });
});

test('skips incomplete, malformed, mismatched, and escaped bundles while retaining valid songs', async t => {
  const root = await directory(t);
  const folder = await install(root);
  await mkdir(path.join(root, 'unfinished'));
  const warnings = [];
  const scan = () => discoverSongs(root, { warn: message => warnings.push(message) });
  assert.equal((await scan()).songs.length, 1);
  assert.ok(warnings.some(message => message.includes('unfinished')));
  await rm(path.join(folder, 'audio.wav'));
  assert.equal((await scan()).songs.length, 0);
  await install(root);
  await writeFile(path.join(folder, 'song.json'), '{}');
  assert.equal((await scan()).songs.length, 0);
  await install(root);
  await rm(path.join(folder, 'audio.wav'));
  const outside = path.join(root, 'outside.wav');
  await writeFile(outside, bundleFixture().audio);
  await symlink(outside, path.join(folder, 'audio.wav'));
  assert.equal((await scan()).songs.length, 0);
  await rm(folder, { recursive: true });
  await install(root);
  const { rename } = await import('node:fs/promises');
  await rename(folder, path.join(root, 'wrong-id'));
  assert.equal((await scan()).songs.length, 0);
});

test('catalog HTTP response is uncached and discovers songs added after server startup', async t => {
  const root = await directory(t);
  const middleware = songCatalogMiddleware(root);
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 500; res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/songs/manifest.json`;
  const response = await fetch(url);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).songs.length, 0);
  await install(root);
  assert.equal((await (await fetch(url)).json()).songs.length, 1);
});
