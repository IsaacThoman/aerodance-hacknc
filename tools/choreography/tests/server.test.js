import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStudio } from "../server/index.js";
import { makeZip, readZip, safePath } from "../server/zip.js";
import { sha } from "../server/store.js";
import { addTake } from "../core.js";
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
