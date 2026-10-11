import {
  copy,
  finite,
  clamp,
  validatePoses,
  qualityFor,
  sampleSnapshot,
  mirrorPose,
  PAIRS,
  validateChoreography,
} from "../../packages/pose/choreography.js";
import { calibratePoses } from "../../packages/character/calibration.js";

export function newProject(id = crypto.randomUUID()) {
  const now = new Date().toISOString();
  return {
    schema: "aerodance.project",
    schemaVersion: 1,
    projectId: id,
    songId: `song-${id.slice(0, 8)}`,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    metadata: {
      title: "Untitled routine",
      artist: "",
      songwriters: [],
      choreographers: [],
      difficulty: "normal",
      tags: [],
      bpm: null,
      description: "",
      rights: {
        audio: { license: "unknown", attribution: "" },
        choreography: { license: "unknown", attribution: "" },
      },
    },
    audio: null,
    durationMs: 0,
    playableStartMs: 0,
    playableEndMs: 0,
    takes: [],
    tracks: [
      { playerId: 0, label: "Player 1", clips: [] },
      { playerId: 1, label: "Player 2", clips: [] },
    ],
    operations: [],
    operationCursor: 0,
    markers: [],
    alignmentReviewed: false,
  };
}
const assert = (ok, message) => {
  if (!ok) throw Error(message);
};
export function validateProject(p) {
  assert(
    p?.schema === "aerodance.project" && p.schemaVersion === 1,
    "Unsupported project",
  );
  assert(/^[a-zA-Z0-9-]{1,80}$/.test(p.projectId), "Invalid project ID");
  assert(
    /^[a-z0-9][a-z0-9-]{0,79}$/.test(p.songId),
    "Song ID must use lowercase letters, digits and hyphens",
  );
  assert(
    Number.isSafeInteger(p.revision) && p.revision >= 0,
    "Invalid revision",
  );
  assert(
    p.metadata &&
      typeof p.metadata.title === "string" &&
      typeof p.metadata.artist === "string",
    "Missing title/artist",
  );
  assert(
    ["normal", "easy", "hard"].includes(p.metadata.difficulty),
    "Invalid difficulty",
  );
  assert(
    ["songwriters", "choreographers", "tags"].every(
      (k) =>
        Array.isArray(p.metadata[k]) &&
        p.metadata[k].every((v) => typeof v === "string"),
    ),
    "Invalid credits/tags",
  );
  assert(
    p.metadata.bpm === null || (finite(p.metadata.bpm) && p.metadata.bpm > 0),
    "Invalid BPM",
  );
  if (p.audio)
    assert(
      /^[a-f0-9]{64}$/.test(p.audio.sha256) &&
        ["mp3", "wav", "ogg", "m4a", "flac"].includes(p.audio.extension),
      "Invalid audio asset reference",
    );
  assert(
    finite(p.durationMs) && p.durationMs >= 0 && p.durationMs <= 3600000,
    "Duration must be between zero and one hour",
  );
  assert(
    finite(p.playableStartMs) &&
      finite(p.playableEndMs) &&
      p.playableStartMs >= 0 &&
      p.playableEndMs >= p.playableStartMs &&
      p.playableEndMs <= p.durationMs,
    "Invalid playable range",
  );
  assert(
    Array.isArray(p.tracks) &&
      p.tracks.length === 2 &&
      p.tracks[0].playerId === 0 &&
      p.tracks[1].playerId === 1,
    "Two ordered tracks required",
  );
  assert(
    Array.isArray(p.takes) &&
      new Set(p.takes.map((t) => t.takeId)).size === p.takes.length,
    "Invalid takes",
  );
  const ids = new Set(p.takes.map((t) => t.takeId));
  for (const track of p.tracks) {
    assert(Array.isArray(track.clips), "Invalid clips");
    const clips = [...track.clips].sort(
      (a, b) => a.songStartMs - b.songStartMs,
    );
    let end = -Infinity;
    for (const c of clips) {
      assert(
        ids.has(c.takeId) &&
          [0, 1].includes(c.sourcePlayerId) &&
          ["sourceStartMs", "sourceEndMs", "songStartMs", "timeScale"].every(
            (k) => finite(c[k]),
          ) &&
          c.sourceEndMs > c.sourceStartMs &&
          c.timeScale > 0,
        "Invalid source clip",
      );
      assert(c.songStartMs >= end, "Overlapping clips must be split first");
      end = c.songStartMs + (c.sourceEndMs - c.sourceStartMs) * c.timeScale;
    }
  }
  assert(
    Array.isArray(p.operations) &&
      Number.isInteger(p.operationCursor) &&
      p.operationCursor >= 0 &&
      p.operationCursor <= p.operations.length,
    "Invalid edit history",
  );
  for (const op of p.operations) {
    assert(
      [
        "joint",
        "swap",
        "mirror",
        "smooth",
        "repair",
        "exclude",
        "approve",
      ].includes(op.type),
      "Unknown edit operation",
    );
    assert(
      finite(op.startMs) && finite(op.endMs) && op.endMs >= op.startMs,
      "Invalid edit range",
    );
    assert(
      op.playerId === null || [0, 1].includes(op.playerId),
      "Invalid edit track",
    );
    if (op.type === "joint")
      assert(
        Number.isInteger(op.joint) &&
          op.joint >= 0 &&
          op.joint < 33 &&
          ["x", "y", "z"].every((k) => finite(op.value?.[k])) &&
          finite(op.timeMs) &&
          op.timeMs >= op.startMs &&
          op.timeMs <= op.endMs,
        "Invalid joint keyframe",
      );
    if (op.type === "joint" && op.targets !== undefined)
      assert(
        Array.isArray(op.targets) && op.targets.length > 0 && op.targets.length <= 33 &&
        new Set(op.targets.map((t) => t.joint)).size === op.targets.length &&
        op.targets.every((t) => Number.isInteger(t.joint) && t.joint >= 0 && t.joint < 33 &&
          ["x", "y", "z"].every((k) => finite(t.value?.[k]))),
        "Invalid grouped joint keyframe",
      );
    if (op.type === "smooth")
      assert(
        finite(op.windowMs) && op.windowMs > 0 && op.windowMs <= 1000,
        "Invalid smoothing window",
      );
    if (op.type === "repair")
      assert(
        op.endMs - op.startMs <= 1000,
        "Repair at most one second; replace longer gaps with another take",
      );
    if (["exclude", "approve"].includes(op.type))
      assert(
        typeof op.reason === "string" && op.reason.trim(),
        "Review decisions require a reason",
      );
  }
  assert(
    Array.isArray(p.markers) &&
      p.markers.every(
        (m) =>
          finite(m.songTimeMs) &&
          ["beat", "phrase", "note"].includes(m.kind) &&
          typeof m.label === "string",
      ),
    "Invalid markers",
  );
  return p;
}
export function validateTake(take) {
  assert(
    take?.schema === "aerodance.take" && take.schemaVersion === 1,
    "Unsupported take schema",
  );
  assert(
    typeof take.takeId === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(take.takeId),
    "Invalid take ID",
  );
  assert(
    take.input &&
      ["width", "height"].every(
        (k) => Number.isInteger(take.input[k]) && take.input[k] > 0,
      ) &&
      take.input.mirrored === false,
    "Takes must use unmirrored inference geometry",
  );
  assert(
    Array.isArray(take.samples) &&
      take.samples.length >= 2 &&
      take.samples.length <= 150000,
    "Expected between 2 and 150000 take samples",
  );
  let last = -Infinity;
  for (const s of take.samples) {
    assert(
      finite(s.takeTimeMs) && s.takeTimeMs > last,
      "Take times must increase",
    );
    last = s.takeTimeMs;
    validatePoses(s.poses);
  }
  assert(
    finite(take.offsetMs) && finite(take.timeScale) && take.timeScale > 0,
    "Invalid take alignment",
  );
  return take;
}
export function importMotion(
  data,
  name = "Imported take",
  id = crypto.randomUUID(),
) {
  let samples, input, source;
  if (data.version === 1 && data.times && data.poses) {
    assert(
      data.times.length === data.poses.length && data.times.length >= 2,
      "Invalid legacy arrays",
    );
    input = {
      width: data.source?.width,
      height: data.source?.height,
      mirrored: false,
    };
    source = "legacy-demo";
    samples = data.times.map((time, i) => {
      assert(data.poses[i]?.length === 2, "Legacy recording needs two people");
      const poses = data.poses[i].map((points, playerId) => ({
        playerId,
        landmarks: points.map((j) => {
          assert(j.length === 4 && j.every(finite), "Invalid legacy joint");
          return {
            x: j[0],
            y: j[1],
            z: j[2],
            visibility: null,
            presence: null,
          };
        }),
      }));
      return {
        takeTimeMs: time * 1000,
        poses,
        quality: qualityFor(poses),
        legacyConfidence: data.poses[i].map((p) => p.map((j) => j[3])),
      };
    });
  } else if (data.schema === "aerodance.choreography") {
    validateChoreography(data);
    const c = data.tracks[0].calibration;
    assert(
      data.tracks.every(
        (t) =>
          t.calibration.inputWidth === c.inputWidth &&
          t.calibration.inputHeight === c.inputHeight,
      ),
      "Import requires matching track dimensions",
    );
    input = { width: c.inputWidth, height: c.inputHeight, mirrored: false };
    source = "choreography";
    samples = data.samples.map((s) => ({
      takeTimeMs: s.songTimeMs,
      poses: copy(s.poses),
      quality: copy(s.quality),
    }));
  } else if (data.schema === "aerodance.take") {
    const take = copy(data);
    take.takeId = id;
    take.name = name;
    return validateTake(take);
  } else
    throw Error(
      "Import a legacy dance.json, choreography.json, take.json, or Android NDJSON",
    );
  return validateTake({
    schema: "aerodance.take",
    schemaVersion: 1,
    takeId: id,
    name,
    source,
    input,
    samples,
    offsetMs: 0,
    timeScale: 1,
    createdAt: new Date().toISOString(),
    provenance: {
      source: data.source || null,
      model: data.model || null,
      legacySmoothed: source === "legacy-demo",
    },
  });
}
export function takeFromRecords(records, metadata) {
  const poses = records.filter((e) => e.record?.type === "pose");
  assert(poses.length >= 2, "Take needs at least two pose records");
  const first = poses[0],
    session = first.record.sessionId,
    input = first.record.input;
  assert(input.mirrored === false, "Unmirrored capture is required");
  const audioRate = first.audioPlaybackRate ?? 1;
  assert(finite(audioRate) && audioRate > 0, "Invalid capture audio rate");
  const hasAudioAnchor = first.audioPositionAtReceiptMs != null;
  assert(
    !hasAudioAnchor || finite(first.audioPositionAtReceiptMs),
    "Invalid capture audio position",
  );
  const processingDelayMs =
    first.record.resultTimeMs - first.record.frameReceivedTimeMs;
  let lastSeq = 0,
    lastTime = -Infinity;
  const samples = [];
  let sequenceGaps = 0;
  for (const e of poses) {
    const r = e.record;
    assert(
      finite(r.frameReceivedTimeMs) &&
        finite(r.resultTimeMs) &&
        r.resultTimeMs >= r.frameReceivedTimeMs,
      "Invalid capture processing timestamps",
    );
    assert(
      (e.audioPlaybackRate ?? audioRate) === audioRate,
      "Capture audio rate changed",
    );
    assert(
      r.sessionId === session &&
        r.playerCount === 2 &&
        r.input.width === input.width &&
        r.input.height === input.height &&
        r.input.mirrored === false,
      "Capture session/mode/geometry changed",
    );
    assert(
      r.seq > lastSeq && r.frameReceivedTimeMs > lastTime,
      "Capture sequence/time must increase",
    );
    if (lastSeq) sequenceGaps += Math.max(0, r.seq - lastSeq - 1);
    const t = r.frameReceivedTimeMs - first.record.frameReceivedTimeMs;
    // Insert absence on silence; never interpolate over an inference/receipt gap.
    if (samples.length && t - samples.at(-1).takeTimeMs > 200)
      samples.push({
        takeTimeMs:
          samples.at(-1).takeTimeMs +
          Math.min(200, (t - samples.at(-1).takeTimeMs) / 2),
        poses: [],
        quality: [],
      });
    samples.push({
      takeTimeMs: t,
      poses: copy(r.poses),
      quality: qualityFor(r.poses),
      sourceSeq: r.seq,
    });
    lastSeq = r.seq;
    lastTime = r.frameReceivedTimeMs;
  }
  return validateTake({
    schema: "aerodance.take",
    schemaVersion: 1,
    takeId: metadata.takeId,
    name: metadata.name || "Android take",
    source: "android",
    input,
    samples,
    // The audio anchor was measured after inference. Both device timestamps
    // share a clock, so their difference needs no browser/device clock sync.
    // Keep frame deltas for subsequent samples: variable inference latency
    // must not change the timing of the captured movement.
    offsetMs: hasAudioAnchor
      ? first.audioPositionAtReceiptMs - processingDelayMs * audioRate
      : 0,
    timeScale: audioRate,
    createdAt: metadata.createdAt,
    status: metadata.status || null,
    interruptionReason: metadata.interruptionReason || null,
    provenance: {
      sessionId: session,
      sequenceGaps,
      synthetic: metadata.status?.poseModel === "synthetic",
      alignmentMethod: hasAudioAnchor
        ? "processing-delay-compensated-receipt-estimate"
        : "unanchored-frame-timing",
      processingDelayMs: hasAudioAnchor ? processingDelayMs : null,
      timingUncertaintyMs: null,
    },
  });
}
export function addTake(project, take) {
  const p = copy(project);
  p.takes.push({
    takeId: take.takeId,
    name: take.name,
    source: take.source,
    input: take.input,
  });
  const first = take.samples[0].takeTimeMs,
    last = take.samples.at(-1).takeTimeMs;
  if (!p.durationMs) {
    p.durationMs = Math.ceil(last);
    p.playableEndMs = p.durationMs;
  }
  for (const track of p.tracks)
    if (!track.clips.length)
      track.clips.push({
        clipId: crypto.randomUUID(),
        takeId: take.takeId,
        sourcePlayerId: track.playerId,
        sourceStartMs: first,
        sourceEndMs: last,
        songStartMs: take.offsetMs + first * take.timeScale,
        timeScale: take.timeScale,
      });
  p.alignmentReviewed = false;
  return p;
}
export function appendOperation(project, operation) {
  const p = copy(project);
  p.operations = p.operations.slice(0, p.operationCursor);
  p.operations.push({ operationId: crypto.randomUUID(), ...operation });
  p.operationCursor = p.operations.length;
  return p;
}
function rawSample(p, takes, time) {
  const poses = [],
    quality = [];
  for (const track of p.tracks) {
    const clip = track.clips.find(
      (c) =>
        time >= c.songStartMs &&
        time <= c.songStartMs + (c.sourceEndMs - c.sourceStartMs) * c.timeScale,
    );
    if (!clip) continue;
    const take = takes.get(clip.takeId);
    if (!take) throw Error("Missing source take");
    const sourceTime =
      clip.sourceStartMs + (time - clip.songStartMs) / clip.timeScale;
    const s = sampleSnapshot(take.samples, sourceTime, "takeTimeMs");
    const pose = s.poses.find((v) => v.playerId === clip.sourcePlayerId);
    if (!pose) continue;
    pose.playerId = track.playerId;
    const q = s.quality.find((v) => v.playerId === clip.sourcePlayerId);
    q.playerId = track.playerId;
    poses.push(pose);
    quality.push(q);
  }
  return { songTimeMs: time, poses, quality };
}
export function compileProject(project, takes) {
  validateProject(project);
  const p = project,
    ops = p.operations.slice(0, p.operationCursor),
    start = p.playableStartMs,
    end = p.playableEndMs;
  if (!(end > start)) throw Error("Import a recording or audio first");
  const times = new Set([start, end]);
  for (let i = 1; start + (i * 1000) / 30 < end; i++)
    times.add(Number((start + (i * 1000) / 30).toFixed(6)));
  for (const track of p.tracks)
    for (const clip of track.clips) {
      const take = takes.get(clip.takeId);
      assert(take, "Missing take");
      validateTake(take);
      for (const s of take.samples)
        if (
          s.takeTimeMs >= clip.sourceStartMs &&
          s.takeTimeMs <= clip.sourceEndMs
        )
          times.add(
            Number(
              (
                clip.songStartMs +
                (s.takeTimeMs - clip.sourceStartMs) * clip.timeScale
              ).toFixed(6),
            ),
          );
    }
  for (const op of ops)
    for (const t of [op.startMs, op.endMs, op.timeMs])
      if (finite(t)) times.add(t);
  let samples = [...times]
    .filter((t) => t >= start && t <= end)
    .sort((a, b) => a - b)
    .map((t) => rawSample(p, takes, t));
  for (const op of ops) {
    const before = op.type === "smooth" ? copy(samples) : null;
    let repairEndpoints;
    if (op.type === "repair") {
      const a = [...samples]
        .reverse()
        .find(
          (s) =>
            s.songTimeMs <= op.startMs &&
            s.poses.some((v) => v.playerId === op.playerId),
        );
      const b = samples.find(
        (s) =>
          s.songTimeMs >= op.endMs &&
          s.poses.some((v) => v.playerId === op.playerId),
      );
      assert(
        a &&
          b &&
          b.songTimeMs > a.songTimeMs &&
          b.songTimeMs - a.songTimeMs <= 1000,
        "Gap repair needs two endpoint poses within one second",
      );
      repairEndpoints = [a, b];
    }
    for (let si = 0; si < samples.length; si++) {
      const s = samples[si],
        time = s.songTimeMs;
      if (
        time < op.startMs ||
        (time >= op.endMs && !(op.type === "joint" && time === op.timeMs))
      )
        continue;
      if (op.type === "swap") {
        s.poses.forEach((v) => {
          v.playerId = 1 - v.playerId;
        });
        s.quality.forEach((v) => {
          v.playerId = 1 - v.playerId;
        });
        s.poses.sort((a, b) => a.playerId - b.playerId);
        s.quality.sort((a, b) => a.playerId - b.playerId);
        continue;
      }
      if (op.type === "repair") {
        const [a, b] = repairEndpoints,
          alpha = (time - a.songTimeMs) / (b.songTimeMs - a.songTimeMs),
          left = a.poses.find((v) => v.playerId === op.playerId),
          right = b.poses.find((v) => v.playerId === op.playerId);
        const repaired = {
          playerId: op.playerId,
          landmarks: left.landmarks.map((j, i) => ({
            x: j.x + (right.landmarks[i].x - j.x) * alpha,
            y: j.y + (right.landmarks[i].y - j.y) * alpha,
            z: j.z + (right.landmarks[i].z - j.z) * alpha,
            visibility: null,
            presence: null,
          })),
        };
        const index = s.poses.findIndex((v) => v.playerId === op.playerId),
          q = {
            playerId: op.playerId,
            landmarkOrigins: Array(33).fill("gap-repaired"),
            scoreEligible: Array(33).fill(false),
            reviewed: false,
          };
        if (index < 0) {
          s.poses.push(repaired);
          s.quality.push(q);
        } else {
          s.poses[index] = repaired;
          s.quality[index] = q;
        }
        s.poses.sort((a, b) => a.playerId - b.playerId);
        s.quality.sort((a, b) => a.playerId - b.playerId);
        continue;
      }
      for (let i = 0; i < s.poses.length; i++) {
        const pose = s.poses[i],
          q = s.quality[i];
        if (op.playerId !== null && pose.playerId !== op.playerId) continue;
        if (op.type === "joint") {
          const weight =
            time === op.timeMs
              ? 1
              : time < op.timeMs
                ? (time - op.startMs) / (op.timeMs - op.startMs)
                : (op.endMs - time) / (op.endMs - op.timeMs);
          for (const target of op.targets || [{ joint: op.joint, value: op.value }]) {
            for (const k of ["x", "y", "z"])
              pose.landmarks[target.joint][k] +=
                (target.value[k] - pose.landmarks[target.joint][k]) * clamp(weight, 0, 1);
            q.landmarkOrigins[target.joint] = "edited";
            q.scoreEligible[target.joint] = false;
          }
          q.reviewed = false;
        }
        if (op.type === "mirror") {
          s.poses[i] = mirrorPose(pose);
          for (const [a, b] of PAIRS)
            for (const key of ["landmarkOrigins", "scoreEligible"])
              [q[key][a], q[key][b]] = [q[key][b], q[key][a]];
          q.landmarkOrigins.fill("edited");
          q.scoreEligible.fill(false);
          q.reviewed = false;
        }
        if (op.type === "exclude") q.scoreEligible.fill(false);
        if (op.type === "approve") {
          q.scoreEligible.fill(true);
          q.reviewed = true;
        }
        if (op.type === "smooth") {
          const neighbors = [];
          for (let n = si; n >= 0; n--) {
            if (time - before[n].songTimeMs > op.windowMs / 2) break;
            const v = before[n].poses.find((v) => v.playerId === pose.playerId);
            if (!v) break;
            neighbors.push(v);
          }
          for (let n = si + 1; n < before.length; n++) {
            if (before[n].songTimeMs - time > op.windowMs / 2) break;
            const v = before[n].poses.find((v) => v.playerId === pose.playerId);
            if (!v) break;
            neighbors.push(v);
          }
          pose.landmarks.forEach((j, index) => {
            for (const key of ["x", "y", "z"])
              j[key] =
                neighbors.reduce((sum, v) => sum + v.landmarks[index][key], 0) /
                neighbors.length;
          });
          q.landmarkOrigins.fill("edited");
          q.scoreEligible.fill(false);
          q.reviewed = false;
        }
      }
    }
  }
  // Exclusions always override approvals, irrespective of edit command order.
  for (const s of samples)
    for (const q of s.quality)
      if (
        ops.some(
          (o) =>
            o.type === "exclude" &&
            (o.playerId === null || o.playerId === q.playerId) &&
            s.songTimeMs >= o.startMs &&
            s.songTimeMs < o.endMs,
        )
      )
        q.scoreEligible.fill(false);
  const tracks = p.tracks.map((t) => {
    const inputs = t.clips.map((c) => takes.get(c.takeId).input);
    const input = inputs[0] || { width: 640, height: 480 };
    assert(
      inputs.every((v) => v.width === input.width && v.height === input.height),
      "Replacement takes must use the same camera dimensions",
    );
    return {
      playerId: t.playerId,
      label: t.label,
      calibration: calibratePoses(
        samples.flatMap((s) =>
          s.poses.filter((v) => v.playerId === t.playerId),
        ),
        input,
      ),
      unscorableIntervals: ops
        .filter(
          (o) =>
            o.type === "exclude" &&
            (o.playerId === null || o.playerId === t.playerId) &&
            o.endMs > start &&
            o.startMs < end,
        )
        .map((o) => ({
          startMs: Math.max(start, o.startMs),
          endMs: Math.min(end, o.endMs),
          reason: o.reason,
        })),
    };
  });
  return validateChoreography({
    schema: "aerodance.choreography",
    schemaVersion: 1,
    songId: p.songId,
    durationMs: p.durationMs,
    playableStartMs: start,
    playableEndMs: end,
    coordinates: {
      kind: "mediapipe-image",
      landmarkCount: 33,
      ordering: "mediapipe-pose-33",
      xAxis: "right",
      yAxis: "down",
      zAxis: "away-from-camera",
      mirrored: false,
      depthUnit: "relative-image-width",
    },
    sampling: {
      targetRateHz: 30,
      maxInterpolationGapMs: 200,
      confidenceThreshold: 0.5,
    },
    tracks,
    samples,
    markers: p.markers,
    provenance: {
      compilerVersion: "1.0.0",
      projectRevision: p.revision,
      qualityPolicyVersion: 1,
      sources: p.takes.map((t) => ({
        takeId: t.takeId,
        source: t.source,
        sha256: takes.get(t.takeId)?.sha256 || null,
        provenance: takes.get(t.takeId)?.provenance || null,
      })),
    },
  });
}
export function reviewReport(project, data) {
  const blockers = [],
    warnings = [],
    coverage = [];
  if (!project.audio) blockers.push("Import song audio");
  if (!project.metadata.artist.trim() || !project.metadata.title.trim())
    blockers.push("Add song title and artist");
  if (!project.alignmentReviewed)
    blockers.push("Review and confirm audio alignment");
  if (data.provenance.sources.some((s) => s.provenance?.synthetic === true))
    blockers.push(
      "Synthetic tracking takes cannot be published as song choreography",
    );
  for (const k of ["audio", "choreography"])
    if (
      !project.metadata.rights?.[k]?.license?.trim() ||
      project.metadata.rights[k].license === "unknown"
    )
      blockers.push(`Resolve ${k} distribution rights`);
  for (const id of [0, 1]) {
    let missing = 0,
      eligible = 0,
      edited = 0,
      gapStart = null,
      unreviewedGap = 0;
    const excludes = data.tracks[id].unscorableIntervals;
    for (let i = 0; i < data.samples.length - 1; i++) {
      const s = data.samples[i],
        dt = data.samples[i + 1].songTimeMs - s.songTimeMs,
        pose = s.poses.find((v) => v.playerId === id),
        q = s.quality.find((v) => v.playerId === id);
      if (!pose) {
        missing += dt;
        if (gapStart === null) gapStart = s.songTimeMs;
        if (
          !excludes.some(
            (x) => x.startMs <= s.songTimeMs && x.endMs >= s.songTimeMs + dt,
          )
        )
          unreviewedGap += dt;
      } else {
        if (
          gapStart !== null &&
          s.songTimeMs - gapStart > 200 &&
          unreviewedGap > 0
        )
          blockers.push(
            `Player ${id + 1}: review/exclude missing interval ${Math.round(gapStart)}–${Math.round(s.songTimeMs)} ms`,
          );
        gapStart = null;
        unreviewedGap = 0;
        if (q.scoreEligible.filter(Boolean).length >= 8) eligible += dt;
        if (q.landmarkOrigins.includes("edited")) edited += dt;
      }
    }
    if (
      gapStart !== null &&
      data.playableEndMs - gapStart > 200 &&
      unreviewedGap > 0
    )
      blockers.push(
        `Player ${id + 1}: review/exclude trailing missing interval`,
      );
    if (!eligible)
      blockers.push(
        `Player ${id + 1}: no eligible reference poses; review/approve references`,
      );
    coverage.push({
      playerId: id,
      missingMs: Math.round(missing),
      eligibleMs: Math.round(eligible),
      editedMs: Math.round(edited),
    });
    if (edited)
      warnings.push(
        `Player ${id + 1}: edited coordinates require visual review`,
      );
  }
  if (project.takes.some((t) => t.source === "legacy-demo"))
    warnings.push(
      "Legacy confidence fields cannot be reconstructed; approvals are explicit reference decisions",
    );
  if (
    data.provenance.sources.some(
      (s) => s.provenance?.alignmentMethod === "receipt-estimate",
    )
  )
    warnings.push(
      "Android timing is manually aligned; calibrated device-to-audio mapping is unavailable",
    );
  return { blockers: [...new Set(blockers)], warnings, coverage };
}
export function replaceRange(
  project,
  playerId,
  take,
  start,
  end,
  sourceStart,
  sourceEnd,
) {
  assert(
    end > start && sourceEnd > sourceStart,
    "Choose nonempty source and destination ranges",
  );
  const p = copy(project),
    track = p.tracks[playerId],
    clips = [];
  for (const c of track.clips) {
    const cend =
      c.songStartMs + (c.sourceEndMs - c.sourceStartMs) * c.timeScale;
    if (cend <= start || c.songStartMs >= end) {
      clips.push(c);
      continue;
    }
    if (c.songStartMs < start)
      clips.push({
        ...c,
        clipId: crypto.randomUUID(),
        sourceEndMs: c.sourceStartMs + (start - c.songStartMs) / c.timeScale,
      });
    if (cend > end)
      clips.push({
        ...c,
        clipId: crypto.randomUUID(),
        sourceStartMs: c.sourceStartMs + (end - c.songStartMs) / c.timeScale,
        songStartMs: end,
      });
  }
  clips.push({
    clipId: crypto.randomUUID(),
    takeId: take.takeId,
    sourcePlayerId: playerId,
    sourceStartMs: sourceStart,
    sourceEndMs: sourceEnd,
    songStartMs: start,
    timeScale: (end - start) / (sourceEnd - sourceStart),
  });
  track.clips = clips.sort((a, b) => a.songStartMs - b.songStartMs);
  p.alignmentReviewed = false;
  return p;
}
