import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  newProject,
  addTake,
  importMotion,
  compileProject,
  appendOperation,
  reviewReport,
  takeFromRecords,
  replaceRange,
  validateProject,
} from "../core.js";
import {
  sampleSnapshot,
  mirrorPose,
  validateChoreography,
} from "../../../packages/pose/choreography.js";
const pose = (playerId, x = 0.2) => ({
  playerId,
  landmarks: Array.from({ length: 33 }, (_, i) => ({
    x: x + (i % 2) * 0.02,
    y: i < 11 ? 0.15 : i < 23 ? 0.4 : i < 27 ? 0.6 : 0.9,
    z: 0,
    visibility: 0.9,
    presence: 0.95,
  })),
});
function fixture() {
  const take = {
    schema: "aerodance.take",
    schemaVersion: 1,
    takeId: "take-a",
    name: "A",
    source: "android",
    input: { width: 640, height: 480, mirrored: false },
    offsetMs: 0,
    timeScale: 1,
    samples: Array.from({ length: 11 }, (_, i) => ({
      takeTimeMs: i * 100,
      poses: [pose(0), pose(1, 0.7)],
    })),
  };
  let p = addTake(newProject("project-a"), take);
  p.durationMs = 1000;
  p.playableEndMs = 1000;
  p.audio = { sha256: "a".repeat(64), extension: "wav", mimeType: "audio/wav" };
  p.metadata.artist = "Artist";
  p.metadata.rights.audio.license = "CC0";
  p.metadata.rights.choreography.license = "CC0";
  p.alignmentReviewed = true;
  return { p, take, takes: new Map([[take.takeId, take]]) };
}
test("finite playback preserves explicit identity and never bridges missing snapshots", () => {
  const samples = [
    { songTimeMs: 0, poses: [pose(1)] },
    { songTimeMs: 100, poses: [] },
    { songTimeMs: 200, poses: [pose(1, 0.8)] },
  ];
  assert.deepEqual(sampleSnapshot(samples, 50).poses, []);
  assert.deepEqual(sampleSnapshot(samples, 150).poses, []);
  assert.equal(sampleSnapshot(samples, 200).poses[0].playerId, 1);
  assert.deepEqual(sampleSnapshot(samples, 201).poses, []);
  assert.deepEqual(
    sampleSnapshot(
      [
        { songTimeMs: 0, poses: [pose(0)] },
        { songTimeMs: 501, poses: [pose(0)] },
      ],
      250,
    ).poses,
    [],
  );
});
test("pose edit is reversible, preserves measured confidence and needs review", () => {
  const { p, takes, take } = fixture(),
    raw = JSON.stringify(take);
  const edited = appendOperation(p, {
    type: "joint",
    playerId: 0,
    startMs: 300,
    endMs: 700,
    timeMs: 500,
    joint: 15,
    value: { x: 0.44, y: 0.23, z: -0.1 },
  });
  const data = compileProject(edited, takes),
    s = data.samples.find((s) => s.songTimeMs === 500);
  assert.equal(s.poses[0].landmarks[15].x, 0.44);
  assert.equal(s.poses[0].landmarks[15].visibility, 0.9);
  assert.equal(s.quality[0].scoreEligible[15], false);
  assert.equal(JSON.stringify(take), raw);
  edited.operationCursor = 0;
  assert.equal(
    compileProject(edited, takes).samples.find((s) => s.songTimeMs === 500)
      .poses[0].landmarks[15].x,
    take.samples[5].poses[0].landmarks[15].x,
  );
});
test("exclusions override approvals and single-player track 0 matches the two-player track", () => {
  const { p, takes } = fixture();
  let edited = appendOperation(p, {
    type: "exclude",
    playerId: 0,
    startMs: 400,
    endMs: 600,
    reason: "occlusion",
  });
  edited = appendOperation(edited, {
    type: "approve",
    playerId: 0,
    startMs: 0,
    endMs: 1000,
    reason: "reviewed",
  });
  const data = compileProject(edited, takes);
  assert.ok(
    data.samples
      .find((s) => s.songTimeMs === 500)
      .quality[0].scoreEligible.every((v) => !v),
  );
  const reference = sampleSnapshot(data.samples, 250).poses.find(
    (p) => p.playerId === 0,
  );
  assert.deepEqual(reference, sampleSnapshot(data.samples, 250).poses[0]);
  assert.equal(reviewReport(edited, data).blockers.length, 0);
});
test("mirror swaps every anatomical pair and is an involution, without changing player ID", () => {
  const p = pose(1);
  p.landmarks[15].x = 0.13;
  p.landmarks[16].x = 0.77;
  const mirrored = mirrorPose(p);
  assert.equal(mirrored.playerId, 1);
  assert.ok(Math.abs(mirrored.landmarks[15].x - 0.23) < 1e-10);
  const twice = mirrorPose(mirrored);
  p.landmarks.forEach((j, i) =>
    assert.ok(Math.abs(j.x - twice.landmarks[i].x) < 1e-10),
  );
});
test("phrase replacement splits previous clips and mapping remains explicit", () => {
  const { p, take, takes } = fixture();
  const b = {
    ...take,
    takeId: "take-b",
    samples: take.samples.map((s) => ({
      ...s,
      poses: [pose(0, 0.4), pose(1, 0.8)],
    })),
  };
  takes.set(b.takeId, b);
  p.takes.push({ takeId: b.takeId });
  const edited = replaceRange(p, 0, b, 300, 600, 100, 400),
    data = compileProject(edited, takes);
  assert.equal(edited.tracks[0].clips.length, 3);
  assert.equal(sampleSnapshot(data.samples, 450).poses[0].landmarks[0].x, 0.4);
  assert.equal(sampleSnapshot(data.samples, 250).poses[0].landmarks[0].x, 0.2);
  assert.equal(sampleSnapshot(data.samples, 700).poses[0].landmarks[0].x, 0.2);
});
test("legacy migration keeps both original confidence fields unknown", async () => {
  const legacy = {
    version: 1,
    duration: 0.2,
    source: { width: 640, height: 480 },
    times: [0, 0.1],
    poses: [0, 1].map(() =>
      [pose(0), pose(1)].map((p) =>
        p.landmarks.map((j) => [j.x, j.y, j.z, 0.9]),
      ),
    ),
  };
  const take = importMotion(legacy, "demo", "demo-take");
  assert.equal(take.samples[0].poses[0].landmarks[0].visibility, null);
  assert.equal(take.samples[0].poses[0].landmarks[0].presence, null);
  assert.equal(take.samples[1].takeTimeMs, legacy.times[1] * 1000);
  assert.ok(take.samples[0].legacyConfidence[0].length === 33);
});
test("Android capture retains mode identity, distinguishes clocks, and rejects restarts", () => {
  const record = (seq, t, poses) => ({
    protocolVersion: 2,
    type: "pose",
    sessionId: "s",
    seq,
    frameReceivedTimeMs: t,
    resultTimeMs: t + 100,
    playerCount: 2,
    input: { width: 640, height: 480, mirrored: false },
    poses,
  });
  const records = [
    { record: record(1, 9000, [pose(1)]), audioPositionAtReceiptMs: -3000 },
    { record: record(3, 9600, [pose(1)]) },
  ];
  const take = takeFromRecords(records, { takeId: "capture-a" });
  assert.equal(take.samples[0].takeTimeMs, 0);
  assert.equal(take.offsetMs, -3100);
  assert.equal(take.provenance.processingDelayMs, 100);
  assert.equal(
    take.provenance.alignmentMethod,
    "processing-delay-compensated-receipt-estimate",
  );
  assert.equal(take.samples[0].poses[0].playerId, 1);
  assert.equal(take.samples[1].poses.length, 0);
  assert.equal(take.provenance.sequenceGaps, 1);
  records[1].record.sessionId = "restarted";
  assert.throws(
    () => takeFromRecords(records, { takeId: "capture-b" }),
    /session/,
  );
});
test("capture compensates processing delay without distorting frame intervals", () => {
  const records = [100, 180, 260].map((time, i) => ({
    audioPositionAtReceiptMs: 1000 + (time - 100) * 2,
    audioPlaybackRate: 2,
    record: {
      type: "pose",
      sessionId: "s",
      seq: i + 1,
      frameReceivedTimeMs: time,
      resultTimeMs: time + [120, 30, 180][i],
      playerCount: 2,
      input: { width: 640, height: 480, mirrored: false },
      poses: [pose(0), pose(1)],
    },
  }));
  const take = takeFromRecords(records, { takeId: "timed" });
  assert.equal(take.offsetMs, 760);
  assert.equal(take.timeScale, 2);
  assert.deepEqual(take.samples.map((s) => s.takeTimeMs), [0, 80, 160]);
  for (const e of records) {
    delete e.audioPositionAtReceiptMs;
    delete e.audioPlaybackRate;
  }
  const raw = takeFromRecords(records, { takeId: "raw" });
  assert.equal(raw.offsetMs, 0);
  assert.equal(raw.timeScale, 1);
  assert.equal(raw.provenance.alignmentMethod, "unanchored-frame-timing");
  records[1].record.resultTimeMs = 179;
  assert.throws(() => takeFromRecords(records, { takeId: "bad" }), /timestamps/);
});
test("runtime validation rejects corrupt payloads and timestamps", () => {
  const { p, takes } = fixture(),
    data = compileProject(p, takes);
  data.samples[1].poses[0].landmarks[0].x = Infinity;
  assert.throws(() => validateChoreography(data), /finite/);
  const bad = compileProject(p, takes);
  bad.samples[1].songTimeMs = bad.samples[0].songTimeMs;
  assert.throws(() => validateChoreography(bad), /times/);
});
test("gap repair requires bounded endpoints and never invents measured confidence", () => {
  const { p, takes, take } = fixture();
  take.samples[4].poses = [];
  take.samples[5].poses = [];
  const edited = appendOperation(p, {
    type: "repair",
    playerId: 0,
    startMs: 300,
    endMs: 600,
  });
  const data = compileProject(edited, takes),
    s = data.samples.find((s) => s.songTimeMs === 500);
  assert.equal(s.poses[0].playerId, 0);
  assert.equal(s.poses[0].landmarks[0].visibility, null);
  assert.ok(s.quality[0].landmarkOrigins.every((v) => v === "gap-repaired"));
  assert.ok(s.quality[0].scoreEligible.every((v) => !v));
  const unbounded = appendOperation(p, {
    type: "repair",
    playerId: 0,
    startMs: 0,
    endMs: 2000,
  });
  assert.throws(() => compileProject(unbounded, takes), /at most one second/);
});

test("grouped keyframes translate points together, preserve confidence and undo as one edit", () => {
  const { p, takes } = fixture();
  const original = compileProject(p, takes).samples.find((s) => s.songTimeMs === 500);
  const indices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const targets = indices.map((joint) => ({ joint, value: {
    x: original.poses[0].landmarks[joint].x + 0.1,
    y: original.poses[0].landmarks[joint].y + 0.05,
    z: original.poses[0].landmarks[joint].z,
  } }));
  const edited = appendOperation(p, { type: "joint", playerId: 0, joint: 0,
    value: targets[0].value, targets, timeMs: 500, startMs: 350, endMs: 650 });
  const compiled = compileProject(edited, takes);
  const frame = compiled.samples.find((s) => s.songTimeMs === 500);
  for (const i of indices) {
    assert.ok(Math.abs(frame.poses[0].landmarks[i].x - original.poses[0].landmarks[i].x - 0.1) < 1e-6);
    assert.equal(frame.poses[0].landmarks[i].visibility, original.poses[0].landmarks[i].visibility);
    assert.equal(frame.quality[0].scoreEligible[i], false);
  }
  assert.deepEqual(frame.poses[0].landmarks[15], original.poses[0].landmarks[15]);
  assert.deepEqual(frame.poses[1], original.poses[1]);
  assert.deepEqual(compileProject({ ...edited, operationCursor: 0 }, takes).samples, compileProject(p, takes).samples);
});

test("songs dance on Open Reef unless the project picks another stage", () => {
  const p = newProject("stage-test");
  assert.equal(p.metadata.stage, "openreef");
  p.metadata.stage = "club";
  validateProject(p);
  p.metadata.stage = "moon";
  assert.throws(() => validateProject(p), /dance stages/);
  // Projects saved before songs had stages pick up the default.
  delete p.metadata.stage;
  validateProject(p);
  assert.equal(p.metadata.stage, "openreef");
});
