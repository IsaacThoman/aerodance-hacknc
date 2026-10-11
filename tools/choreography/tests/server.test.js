import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStudio } from "../server/index.js";
import { makeZip, readZip, safePath } from "../server/zip.js";
import { sha } from "../server/store.js";
import { addTake } from "../core.js";
import { poseModel, MEDIAPIPE_VERSION } from '../../../packages/pose/browser/models.js';
const pose = (id) => ({
  playerId: id,
  landmarks: Array.from({ length: 33 }, (_, i) => ({
    x: id === 0 ? 0.25 : 0.75,
    y: i < 23 ? 0.4 : 0.8,
    z: 0,
    visibility: 1,
    presence: 1,
  })),
});
const take = () => ({
  schema: "aerodance.take",
  schemaVersion: 1,
  takeId: crypto.randomUUID(),
  name: "Fixture",
  source: "android",
  input: { width: 640, height: 480, mirrored: false },
  offsetMs: 0,
  timeScale: 1,
  samples: Array.from({ length: 11 }, (_, i) => ({
    takeTimeMs: i * 100,
    poses: [pose(0), pose(1)],
  })),
});
test('webcam batches reject Android records and preserve a finalized take through export and backup', async t => {
  const { api, base } = await setup(t);
  let p = await (await api('/api/projects', {})).json();
  const model = poseModel('lite');
  const status = { modelId: model.id, modelHash: model.sha256, packageVersion: MEDIAPIPE_VERSION, delegate: 'CPU' };
  const capture = await (await api(`/api/projects/${p.projectId}/takes`, { sourceKind: 'webcam', status })).json();
  const url = `/api/projects/${p.projectId}/takes/${capture.takeId}`;
  const records = Array.from({ length: 11 }, (_, i) => ({ ordinal: i, receivedBrowserTimeMs: 1000 + i * 100 + 20,
    audioPositionAtReceiptMs: i * 100 + 20, audioPositionAtFrameMs: i * 100, audioPlaybackRate: 1,
    record: { schema: 'aerodance.webcam-record', schemaVersion: 1, type: 'pose', sessionId: 'webcam', seq: i + 1,
      playerCount: 2, input: { width: 640, height: 480, mirrored: false }, modelId: 'lite',
      frameBrowserTimeMs: 1000 + i * 100, resultBrowserTimeMs: 1000 + i * 100 + 20,
      mediaTimeMs: i * 100, timingMethod: 'browser-frame-observation', poses: [pose(0), pose(1)] } }));
  const mixed = structuredClone(records); mixed[0].record = { protocolVersion: 2, type: 'pose' };
  assert.equal((await api(`${url}/batches`, { batchId: 0, records: mixed })).status, 400);
  assert.equal((await api(`${url}/batches`, { batchId: 0, records })).status, 200);
  assert.equal((await api(`${url}/batches`, { batchId: 0, records })).status, 200);
  const response = await api(`${url}/finalize`, { batchCount: 1, recordCount: records.length });
  assert.equal(response.status, 200, await response.clone().text());
  const webcamTake = await response.json();
  assert.equal(webcamTake.source, 'webcam'); assert.equal(webcamTake.offsetMs, 0);
  assert.equal(webcamTake.provenance.modelHash, model.sha256);
  p = addTake(p, webcamTake);
  p.metadata.artist = 'Fixture artist'; p.metadata.rights.audio.license = 'CC0'; p.metadata.rights.choreography.license = 'CC0';
  p = await (await api(`/api/projects/${p.projectId}`, p, 'PUT')).json();
  p = await (await fetch(`${base}/api/projects/${p.projectId}/audio?durationMs=1000&revision=${p.revision}`, {
    method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: Buffer.from('fixture audio'),
  })).json();
  p.alignmentReviewed = true; p = await (await api(`/api/projects/${p.projectId}`, p, 'PUT')).json();
  const exported = await fetch(`${base}/api/projects/${p.projectId}/export`);
  assert.equal(exported.status, 200, await exported.clone().text());
  const files = readZip(Buffer.from(await exported.arrayBuffer()));
  const choreography = JSON.parse(files.get(`${p.songId}/choreography.json`));
  assert.equal(choreography.provenance.sources[0].provenance.modelId, 'lite');
  assert.equal(choreography.tracks[0].calibration.cameraScaleMode,'body-relative');
  assert.ok(choreography.tracks[0].calibration.bodyTorsoLength>0);
  const backup = await fetch(`${base}/api/projects/${p.projectId}/backup`);
  const restored = await fetch(`${base}/api/restore`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: await backup.arrayBuffer() });
  assert.equal(restored.status, 201); const rp = await restored.json();
  const saved = await (await fetch(`${base}/api/projects/${rp.projectId}/takes/${rp.takes[0].takeId}`)).json();
  assert.equal(saved.source, 'webcam'); assert.equal(saved.provenance.modelHash, model.sha256);
});
async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), "dance-studio-")),
    studio = createStudio({ dataDir: root }),
    server = studio.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = (url, body, method = "POST") =>
    fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return { ...studio, api, base };
}
test("project revisions, persisted audio, bundle integrity and backup restore survive a new store", async (t) => {
  const { api, base, store } = await setup(t);
  let p = await (await api("/api/projects", {})).json();
  const uploaded = take();
  assert.equal(
    (await api(`/api/projects/${p.projectId}/import`, uploaded)).status,
    201,
  );
  p = addTake(p, uploaded);
  p.metadata.artist = "Artist";
  p.metadata.stage = "club";
  p.metadata.rights.audio.license = "CC0";
  p.metadata.rights.choreography.license = "CC0";
  p = await (await api(`/api/projects/${p.projectId}`, p, "PUT")).json();
  const old = structuredClone(p);
  p.metadata.title = "Saved routine";
  p = await (await api(`/api/projects/${p.projectId}`, p, "PUT")).json();
  assert.equal(
    (await api(`/api/projects/${p.projectId}`, old, "PUT")).status,
    409,
  );
  const audio = Buffer.from("fixture audio bytes"),
    uploadedAudio = await fetch(
      `${base}/api/projects/${p.projectId}/audio?durationMs=1000&revision=${p.revision}`,
      { method: "POST", headers: { "Content-Type": "audio/wav" }, body: audio },
    );
  assert.equal(uploadedAudio.status, 200);
  p = await uploadedAudio.json();
  p.alignmentReviewed = true;
  p = await (await api(`/api/projects/${p.projectId}`, p, "PUT")).json();
  const fresh = createStudio({ dataDir: store.root }).store;
  assert.equal(
    (await fresh.read(p.projectId, "project.json")).metadata.title,
    "Saved routine",
  );
  const exported = await fetch(`${base}/api/projects/${p.projectId}/export`);
  assert.equal(exported.status, 200, await exported.clone().text());
  const files = readZip(Buffer.from(await exported.arrayBuffer()));
  const checks = JSON.parse(files.get(`${p.songId}/checksums.json`));
  // The song carries its stage, so the game opens it on Club Aquarium.
  assert.equal(JSON.parse(files.get(`${p.songId}/song.json`)).stage, "club");
  for (const file of checks.files) {
    const bytes = files.get(`${p.songId}/${file.path}`);
    assert.equal(bytes.length, file.bytes);
    assert.equal(sha(bytes), file.sha256);
  }
  const second = await fetch(`${base}/api/projects/${p.projectId}/export`);
  assert.deepEqual(Buffer.from(await second.arrayBuffer()), makeZip(files));
  const backup = await fetch(`${base}/api/projects/${p.projectId}/backup`),
    restored = await fetch(`${base}/api/restore`, {
      method: "POST",
      body: await backup.arrayBuffer(),
      headers: { "Content-Type": "application/zip" },
    });
  assert.equal(restored.status, 201);
  const rp = await restored.json();
  assert.notEqual(rp.projectId, p.projectId);
  assert.equal(rp.metadata.title, p.metadata.title);
  assert.equal(
    (
      await (
        await fetch(`${base}/api/projects/${rp.projectId}/audio`)
      ).arrayBuffer()
    ).byteLength,
    audio.length,
  );
});
test('stored unsupported projects remain listed but cannot be opened or mutated by this editor', async t => {
  const {api,base,store}=await setup(t);
  const p=await (await api('/api/projects',{})).json();
  p.schemaVersion=2;
  p.tracks=p.tracks.map(({playerId,label})=>({playerId,label,dataId:'edited',originalDataId:'original',offsetMs:0}));
  const bytes=Buffer.from(JSON.stringify(p));
  await store.atomic(store.location(p.projectId,'project.json'),bytes);
  const list=await (await fetch(base+'/api/projects')).json();
  assert.equal(list[0].schemaVersion,2);
  const opened=await fetch(`${base}/api/projects/${p.projectId}`);
  assert.equal(opened.status,400);
  assert.match((await opened.json()).error,/Unsupported project format 2/);
  const audio=await fetch(`${base}/api/projects/${p.projectId}/audio?durationMs=1000&revision=${p.revision}`,{
    method:'POST',headers:{'Content-Type':'audio/wav'},body:Buffer.from('audio'),
  });
  assert.equal(audio.status,400);
  assert.equal((await api(`/api/projects/${p.projectId}/takes`,{})).status,400);
  assert.equal((await api(`/api/projects/${p.projectId}`,p,'PUT')).status,400);
  assert.deepEqual(await store.read(p.projectId,'project.json'),p);
});
test("record batches are idempotent and finalization rejects missing ordinals", async (t) => {
  const { api } = await setup(t),
    p = await (await api("/api/projects", {})).json();
  const capture = await (
    await api(`/api/projects/${p.projectId}/takes`, {})
  ).json();
  const url = `/api/projects/${p.projectId}/takes/${capture.takeId}`;
  const records = [0, 1].map((i) => ({
    ordinal: i,
    receivedBrowserTimeMs: i * 100,
    audioPositionAtReceiptMs: i * 100,
    record: {
      protocolVersion: 2,
      type: "pose",
      sessionId: "s",
      seq: i + 1,
      frameReceivedTimeMs: i * 100,
      resultTimeMs: i * 100 + 20,
      playerCount: 2,
      input: { width: 640, height: 480, mirrored: false },
      poses: [pose(0), pose(1)],
    },
  }));
  const body = { batchId: 0, records };
  assert.equal((await api(`${url}/batches`, body)).status, 200);
  assert.equal((await api(`${url}/batches`, body)).status, 200);
  assert.equal(
    (await api(`${url}/finalize`, { batchCount: 1, recordCount: 3 })).status,
    400,
  );
  const done = await api(`${url}/finalize`, { batchCount: 1, recordCount: 2 });
  assert.equal(done.status, 200);
  const take = await done.json();
  assert.equal(take.samples.length, 2);
  assert.equal(take.offsetMs, -20);
  assert.equal(take.provenance.processingDelayMs, 20);
  assert.equal((await api(`${url}/batches`, body)).status, 400);
});
test("write API rejects cross-origin requests and ZIP reader rejects corruption/traversal", async (t) => {
  const { base } = await setup(t);
  assert.equal(
    (
      await fetch(base + "/api/projects", {
        method: "POST",
        headers: {
          Origin: "https://untrusted.example",
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(safePath("../project.json"), false);
  assert.equal(safePath("/data/project.json"), false);
  assert.throws(
    () => makeZip(new Map([["../bad", Buffer.from("bad")]])),
    /Unsafe/,
  );
  const zip = makeZip(new Map([["test.txt", Buffer.from("hello")]]));
  zip[38] ^= 1;
  assert.throws(() => readZip(zip), /checksum/);
});
