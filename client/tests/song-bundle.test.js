import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog, validateBundlePath, validateSongChoreography, sampleSong } from '../../packages/pose/song.js';
import { loadSongBundle, sha256 } from '../src/songs/loadBundle.js';
import { bundleFixture } from './fixtures/songBundle.js';
const bytes = value => new TextEncoder().encode(JSON.stringify(value));
async function server(fixture = bundleFixture()) {
  const files = new Map([['song.json',bytes(fixture.song)],['choreography.json',bytes(fixture.choreography)],['audio.wav',fixture.audio]]);
  const checksums = {schema:'aerodance.checksums',schemaVersion:1,files:await Promise.all([...files].map(async ([path,data])=>({path,bytes:data.length,sha256:await sha256(data)})))};
  files.set('checksums.json',bytes(checksums));
  const requests = [];
  const fetcher = async (url,{signal}={}) => {
    signal?.throwIfAborted(); requests.push(new URL(url));
    const file = files.get(new URL(url).pathname.split('/').at(-1));
    return new Response(file ?? '',{status:file ? 200 : 404});
  };
  return {files,fetcher,requests,fixture};
}
test('loads pinned bundle bytes, verifies integrity and selects track 0 in one player mode',async()=>{
  const {fixture,fetcher,requests} = await server();
  validateCatalog({version:1,songs:[fixture.entry]});
  const loaded = await loadSongBundle(fixture.entry,'https://game.test/songs/manifest.json',{fetcher});
  assert.equal(loaded.audio.size,fixture.audio.length);
  assert.ok(requests.every(url=>url.searchParams.get('revision')==='1'));
  const one = sampleSong(loaded,200,1), two = sampleSong(loaded,200,2);
  assert.equal(one.poses.length,1); assert.deepEqual(one.poses[0],two.poses[0]);
  for (const time of [99,900,1200]) assert.deepEqual(sampleSong(loaded,time,2).poses,[]);
  assert.ok(sampleSong(loaded,350,1).quality[0].scoreEligible.every(v=>!v));
  assert.ok(sampleSong(loaded,400,1).quality[0].scoreEligible.some(Boolean));
});
test('absence and long gaps cannot become frozen or interpolated players',()=>{
  const bundle = bundleFixture();
  bundle.choreography.samples[1].poses = [bundle.choreography.samples[1].poses[1]];
  bundle.choreography.samples[1].quality = [bundle.choreography.samples[1].quality[1]];
  assert.deepEqual(sampleSong(bundle,200,1).poses,[]);
  assert.equal(sampleSong(bundle,300,2).poses[0].playerId,1);
  bundle.choreography.samples.splice(1,1);
  assert.deepEqual(sampleSong(bundle,250,2).poses,[]);
});
test('rejects corrupted audio, missing checksums, revision mismatches and catalog hash mismatches',async()=>{
  let s = await server(); s.files.get('audio.wav')[50] ^= 1;
  await assert.rejects(loadSongBundle(s.fixture.entry,'https://game.test/songs/manifest.json',{fetcher:s.fetcher}),/integrity/);
  s = await server(); const manifest = JSON.parse(new TextDecoder().decode(s.files.get('checksums.json'))); manifest.files.pop();s.files.set('checksums.json',bytes(manifest));
  await assert.rejects(loadSongBundle(s.fixture.entry,'https://game.test/songs/manifest.json',{fetcher:s.fetcher}),/Missing/);
  s = await server();
  await assert.rejects(loadSongBundle({...s.fixture.entry,bundleRevision:2},'https://game.test/songs/manifest.json',{fetcher:s.fetcher}),/revision mismatch/);
  await assert.rejects(loadSongBundle({...s.fixture.entry,sha256:'0'.repeat(64)},'https://game.test/songs/manifest.json',{fetcher:s.fetcher}),/hash mismatch/);
});
test('validates file schemas, bounds, calibration, quality and safe relative paths',()=>{
  for (const path of ['../x','/x','a//b','https://example.com/a','a?b','a\\b','%2e%2e/x','./x']) assert.throws(()=>validateBundlePath(path));
  for (const mutate of [b=>b.choreography.songId='other',b=>b.song.playableEndMs=1100,b=>b.choreography.tracks[1].playerId=0,b=>b.choreography.samples[0].poses[0].landmarks[0].visibility=2,b=>b.choreography.samples[0].quality=[],b=>b.choreography.tracks[0].calibration.torsoLength=0]) {
    const b=bundleFixture();mutate(b);assert.throws(()=>validateSongChoreography(b.song,b.choreography));
  }
});
test('cancellation prevents loading the bundle',async()=>{
  const {fixture,fetcher}=await server();const c=new AbortController();c.abort();
  await assert.rejects(loadSongBundle(fixture.entry,'https://game.test/songs/manifest.json',{fetcher,signal:c.signal}),{name:'AbortError'});
});
