import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import express from "express";
import { createStudio } from "../server/index.js";
import { readZip } from "../server/zip.js";

const dataDir = await mkdtemp(path.join(tmpdir(), "studio-browser-")),
  { app } = createStudio({ dataDir }),
  server = app.listen(4175, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
// An actual streaming HTTP fixture exercises browser capture/batching, not hardware accuracy.
const device = express();
device.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "http://127.0.0.1:4175");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
device.use(express.json());
let seq = 0;
let releasePoses;
let liveX = 0.25;
let visiblePlayers = [0, 1];
device.get("/v1/status", (_req, res) =>
  res.json({
    protocolVersion: 2,
    sessionId: "browser-fixture",
    pipelineState: "running",
    capabilities: { supportedPlayerCounts: [1, 2], poseModel: "fixture" },
  }),
);
device.post("/v1/config", (_req, res) =>
  res.json({
    playerCount: 2,
    sessionId: "browser-fixture",
    effectiveFromSeq: seq + 1,
  }),
);
device.get("/v1/stream", (req, res) => {
  res.type("application/x-ndjson");
  res.flushHeaders();
  let initializing = true;
  releasePoses = () => {
    initializing = false;
  };
  const timer = setInterval(() => {
    const t = Math.round(performance.now());
    if (initializing) {
      res.write(
        JSON.stringify({
          protocolVersion: 2,
          type: "heartbeat",
          sessionId: "browser-fixture",
          producerTimeMs: t,
          lastPoseSeq: seq || null,
          pipelineState: "starting",
        }) + "\n",
      );
      return;
    }
    res.write(
      JSON.stringify({
        protocolVersion: 2,
        type: "pose",
        sessionId: "browser-fixture",
        seq: ++seq,
        frameReceivedTimeMs: t,
        resultTimeMs: t + 20,
        playerCount: 2,
        input: { width: 640, height: 480, mirrored: false },
        poses: visiblePlayers.map((playerId) => ({
          playerId,
          landmarks: Array.from({ length: 33 }, (_, i) => ({
            x: playerId === 0 ? liveX : 0.75,
            y: i < 11 ? 0.2 : i < 23 ? 0.4 : i < 27 ? 0.6 : 0.9,
            z: 0,
            visibility: 0.95,
            presence: 0.98,
          })),
        })),
      }) + "\n",
    );
  }, 70);
  req.on("close", () => clearInterval(timer));
});
const deviceServer = device.listen(1337, "127.0.0.1");
await new Promise((r) => deviceServer.once("listening", r));
let testPage;
try {
  const page = await browser.newPage({
      viewport: { width: 1500, height: 1050 },
    }),
    errors = [];
  testPage = page;
  page.setDefaultTimeout(60000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:4175");
  await page.getByRole("heading", { name: "Make every move yours." }).waitFor();
  await page.getByRole("button", { name: "Live view", exact: true }).click();
  await page.getByText("Live view · disconnected", { exact: false }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Live view", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "Playback", exact: true }).click();
  await page
    .getByLabel("Import pose recording")
    .setInputFiles("packages/character/assets/dance.json");
  await page.getByText(/Imported 420 samples/).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Take view", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await page.getByLabel("Landmark X").isDisabled(), true);
  assert.equal(
    await page.getByText("Take offset (seconds)", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Replace selected phrase", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "Play playback", exact: true })
    .click();
  await page.waitForTimeout(150);
  assert.ok(Number(await page.getByLabel("Take cursor").inputValue()) > 0);
  await page
    .getByRole("button", { name: "Pause playback", exact: true })
    .click();
  const beforeAssign = await (
    await page.request.get(
      `http://127.0.0.1:4175/api/projects/${await page.getByLabel("Open project").inputValue()}`,
    )
  ).json();
  assert.ok(beforeAssign.tracks.every((t) => t.dataId === null));
  await page.getByLabel("Take actions: dance.json", { exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Overwrite both tracks", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Playback", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Delete P1 track", exact: true })
    .click();
  assert.equal(await page.getByLabel("P1 offset (seconds)").isEnabled(), true);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete P1 track", exact: true })
    .click();
  assert.equal(await page.getByLabel("P1 offset (seconds)").isDisabled(), true);
  assert.equal(await page.getByLabel("P2 offset (seconds)").isEnabled(), true);
  await page.getByRole("button", { name: "Undo", exact: false }).click();
  await page.getByLabel("P1 offset (seconds)").fill("-0.20");
  await page.getByLabel("P1 offset (seconds)").blur();
  assert.equal(await page.getByLabel("P2 offset (seconds)").inputValue(), "0");
  await page.getByRole("button", { name: "Undo", exact: false }).click();
  await page.getByRole("button", { name: "Skeleton", exact: true }).click();
  await page.getByLabel("Song cursor").fill("2000");
  await page.getByLabel("Selected joint").selectOption("15");
  const before = Number(await page.getByLabel("Landmark X").inputValue());
  await page.getByLabel("Landmark X").fill("0.42");
  await page.getByLabel("Landmark X").blur();
  const editedJoint = page
    .getByLabel("Editable pose skeleton")
    .locator("circle")
    .nth(15);
  assert.ok(
    Math.abs(Number(await editedJoint.getAttribute("cx")) - 580) < 1e-5,
  );
  // A drag in mirrored display space must write the inverse source coordinate.
  const stage = await page.getByLabel("Editable pose skeleton").boundingBox();
  const handle = await editedJoint.boundingBox();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    stage.x + stage.width * 0.6,
    stage.y + stage.height * 0.45,
  );
  await page.mouse.up();
  assert.ok(
    Math.abs(Number(await page.getByLabel("Landmark X").inputValue()) - 0.4) <
      0.002,
  );
  await page.getByRole("button", { name: "Undo", exact: false }).click();
  assert.ok(
    Math.abs(Number(await page.getByLabel("Landmark X").inputValue()) - 0.42) <
      1e-5,
  );
  await page.getByRole("button", { name: "Undo", exact: false }).click();
  assert.ok(
    Math.abs(
      Number(await page.getByLabel("Landmark X").inputValue()) - before,
    ) < 1e-5,
  );
  await page.getByRole("button", { name: "Redo", exact: false }).click();
  await page.getByLabel("Selected point group").selectOption("head");
  const head = page.getByLabel("Editable pose skeleton").locator("circle");
  const headBefore = await head.evaluateAll((points) =>
    points.slice(0, 12).map((p) => Number(p.getAttribute("cx"))),
  );
  const headBox = await head.first().boundingBox();
  await page.mouse.move(
    headBox.x + headBox.width / 2,
    headBox.y + headBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    headBox.x + headBox.width / 2 + 20,
    headBox.y + headBox.height / 2 + 10,
  );
  await page.mouse.up();
  const headAfter = await head.evaluateAll((points) =>
    points.slice(0, 12).map((p) => Number(p.getAttribute("cx"))),
  );
  for (let i = 1; i < 11; i++)
    assert.ok(
      Math.abs(headAfter[i] - headBefore[i] - (headAfter[0] - headBefore[0])) <
        0.01,
    );
  assert.ok(Math.abs(headAfter[0] - headBefore[0]) > 1);
  assert.equal(headAfter[11], headBefore[11]);
  await page.getByRole("button", { name: "Undo", exact: false }).click();
  assert.deepEqual(
    await head.evaluateAll((points) =>
      points.slice(0, 12).map((p) => Number(p.getAttribute("cx"))),
    ),
    headBefore,
  );
  await page.getByLabel("Selected point group").selectOption("single");
  for (const size of [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight,
      ),
    );
    assert.ok(
      await page.evaluate(() => {
        const timeline = document
          .querySelector(".timeline")
          .getBoundingClientRect();
        return timeline.bottom <= innerHeight && timeline.top >= 0;
      }),
    );
  }
  await page.setViewportSize({ width: 1500, height: 1050 });
  const startHandle = page.getByRole("slider", {
    name: "Selection start",
    exact: true,
  });
  const endHandle = page.getByRole("slider", {
    name: "Selection end",
    exact: true,
  });
  await endHandle.focus();
  await page.keyboard.press("End");
  const bounds = await page.locator(".timeline-content").boundingBox();
  const startBox = await startHandle.boundingBox();
  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + 12);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.2, startBox.y + 12);
  await page.mouse.up();
  assert.ok(Number(await startHandle.getAttribute("aria-valuenow")) > 1000);
  const endBox = await endHandle.boundingBox();
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + 12);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.8, endBox.y + 12);
  await page.mouse.up();
  assert.ok(Number(await endHandle.getAttribute("aria-valuenow")) < 13000);
  // A real, browser-decodable 14-second PCM WAV for waveform/playback/export.
  const rate = 8000,
    n = rate * 14,
    bytes = Buffer.alloc(44 + n * 2);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    bytes.writeInt16LE(
      Math.round(Math.sin((i / rate) * 440 * Math.PI * 2) * 1500),
      44 + i * 2,
    );
  await page.getByLabel("Import song audio").setInputFiles({
    name: "review.wav",
    mimeType: "audio/wav",
    buffer: bytes,
  });
  testPage = page;
  await page.getByText(/Audio imported/).waitFor();
  await page.getByRole("button", { name: "Song details", exact: true }).click();
  await page
    .getByLabel("Song name", { exact: true })
    .fill("Browser-tested routine");
  await page.getByLabel("Performing artist").fill("Fixture artist");
  await page.getByLabel("audio license", { exact: true }).fill("CC0");
  await page.getByLabel("choreography license", { exact: true }).fill("CC0");
  await page.getByRole("checkbox", { name: /reviewed audio/ }).check();
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page
    .getByRole("button", { name: "Approve selected references", exact: false })
    .click();
  await page
    .getByRole("button", { name: "Pose inspector", exact: true })
    .click();
  await page.getByLabel("Selected player").selectOption("1");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page
    .getByRole("button", { name: "Approve selected references", exact: false })
    .click();
  await page.getByText("Ready for bundle export", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(1500);
  // A fresh browser context has no prior click to unlock saved-project audio.
  const freshContext = await browser.newContext();
  try {
    const freshPage = await freshContext.newPage();
    await freshPage.goto("http://127.0.0.1:4175");
    await freshPage
      .getByRole("heading", { name: "Browser-tested routine", exact: true })
      .waitFor();
  } finally {
    await freshContext.close();
  }
  await page.reload();
  await page
    .getByRole("heading", { name: "Browser-tested routine", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Skeleton", exact: true }).click();
  await page.getByLabel("Song cursor").fill("2000");
  await page
    .getByRole("button", { name: "Play playback", exact: true })
    .click();
  await page.waitForTimeout(450);
  assert.ok(Number(await page.getByLabel("Song cursor").inputValue()) > 2100);
  await page
    .getByRole("button", { name: "Pause playback", exact: true })
    .click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export song", exact: false }).click(),
  ]);
  const file = await download.path();
  const { readFile } = await import("node:fs/promises");
  const bundle = readZip(await readFile(file));
  assert.ok([...bundle.keys()].some((k) => k.endsWith("/choreography.json")));
  await page.getByRole("button", { name: "Frutiger", exact: true }).click();
  await page.locator("canvas").waitFor();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Skeleton", exact: true }).click();
  await page.getByLabel("Android IP address").fill("127.0.0.1");
  await page
    .getByRole("button", { name: "Connect Android", exact: true })
    .click();
  await page.getByText(/Starting camera and pose tracking/).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Record new take", exact: false })
      .isEnabled(),
    false,
  );
  await page
    .getByRole("button", { name: "Cancel connection", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect Android", exact: true })
    .click();
  await page.getByText(/Starting camera and pose tracking/).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Record new take", exact: false })
      .isEnabled(),
    false,
  );
  visiblePlayers = [];
  releasePoses();
  await page.getByText("P1 waiting", { exact: false }).waitFor();
  await page
    .getByRole("button", { name: "Record new take", exact: false })
    .click();
  await page
    .getByRole("button", { name: "Cancel countdown", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Cancel countdown", exact: true })
    .click();
  visiblePlayers = [0, 1];
  await page.getByText("P1 detected", { exact: false }).waitFor();
  await page.getByText("P2 detected", { exact: false }).waitFor();
  const savedCursor = await page.getByLabel("Song cursor").inputValue();
  await page.getByRole("button", { name: "Live view", exact: true }).click();
  const liveSkeleton = page.getByLabel("Live pose skeleton");
  await liveSkeleton.waitFor();
  assert.equal(await liveSkeleton.locator("circle").count(), 66);
  assert.equal(await liveSkeleton.locator(".original-pose").count(), 0);
  assert.equal(await page.getByLabel("Landmark X").isEnabled(), false);
  await page.getByLabel("Selected player").selectOption("0");
  assert.equal(Number(await page.getByLabel("Landmark X").inputValue()), 0.25);
  liveX = 0.35;
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Landmark X"]').value === "0.35000",
  );
  assert.ok(
    Math.abs(
      Number(await liveSkeleton.locator("circle").first().getAttribute("cx")) -
        650,
    ) < 1e-5,
  );
  assert.ok(
    Math.abs(
      Number(await liveSkeleton.locator("circle").nth(33).getAttribute("cx")) -
        250,
    ) < 1e-5,
  );
  const liveJoint = liveSkeleton.locator("circle").first();
  const jointBox = await liveJoint.boundingBox();
  await page.mouse.move(
    jointBox.x + jointBox.width / 2,
    jointBox.y + jointBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(jointBox.x + 30, jointBox.y + 30);
  await page.mouse.up();
  assert.equal(await page.getByLabel("Song cursor").inputValue(), savedCursor);
  await page.getByRole("button", { name: "Frutiger", exact: true }).click();
  await page.locator("canvas").waitFor();
  await page.getByRole("button", { name: "Both", exact: true }).click();
  await liveSkeleton.waitFor();
  await page.locator("canvas").waitFor();
  await page.getByRole("button", { name: "Playback", exact: true }).click();
  await page.getByLabel("Editable pose skeleton").waitFor();
  assert.equal(await page.getByLabel("Song cursor").inputValue(), savedCursor);
  assert.equal(await page.getByLabel("Landmark X").isEnabled(), true);
  assert.equal(
    await page.getByLabel("Recording delay (seconds)").inputValue(),
    "3",
  );
  await page
    .getByRole("button", { name: "Record new take", exact: false })
    .click();
  await page.getByRole("status").filter({ hasText: "Get ready" }).waitFor();
  await page
    .getByRole("button", { name: "Cancel countdown", exact: true })
    .click();
  await page
    .getByText(
      "Recording cancelled before enough movement was captured. No take added.",
    )
    .waitFor();
  visiblePlayers = [0];
  await page.getByText("P2 waiting", { exact: false }).waitFor();
  await page
    .getByRole("button", { name: "Record new take", exact: false })
    .click();
  await page
    .getByRole("button", { name: "Cancel countdown", exact: true })
    .click();
  visiblePlayers = [];
  await page.getByText("P1 waiting", { exact: false }).waitFor();
  await page.getByLabel("Recording delay (seconds)").fill("1");
  await page
    .getByRole("button", { name: "Record new take", exact: false })
    .click();
  await page
    .getByRole("button", { name: "Cancel countdown", exact: true })
    .waitFor();
  visiblePlayers = [0, 1];
  await page
    .getByRole("button", { name: "Stop recording", exact: false })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Playback", exact: true })
      .isEnabled(),
    false,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Live view", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.waitForTimeout(2600);
  await page
    .getByRole("button", { name: "Stop recording", exact: false })
    .click();
  await page.getByText(/Imported \d+ samples/).waitFor();
  const projectId = await page.getByLabel("Open project").inputValue();
  const latest = await (
    await page.request.get(`http://127.0.0.1:4175/api/projects/${projectId}`)
  ).json();
  await page.waitForTimeout(1500);
  const saved = await (
    await page.request.get(`http://127.0.0.1:4175/api/projects/${projectId}`)
  ).json();
  assert.equal(saved.takes.length, 2);
  const capture = await (
    await page.request.get(
      `http://127.0.0.1:4175/api/projects/${projectId}/takes/${saved.takes[1].takeId}`,
    )
  ).json();
  assert.equal(
    await page
      .getByRole("button", { name: "Take view", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await page.getByLabel("Landmark X").isDisabled(), true);
  assert.deepEqual(saved.tracks, latest.tracks);
  assert.ok(capture.samples.length > 30);
  assert.ok(capture.offsetMs >= saved.playableStartMs);
  assert.equal(capture.samples[0].poses[1].playerId, 1);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("button", { name: "Live view", exact: true }).click();
  await page.getByText("Live view · disconnected", { exact: false }).waitFor();
  assert.equal(
    await page.getByLabel("Live pose skeleton").locator("circle").count(),
    0,
  );
  // Deleting either a newly recorded or assigned take preserves player tracks.
  for (const name of [saved.takes[1].name, "dance.json"]) {
    await page
      .getByRole("button", { name: `View take: ${name}`, exact: true })
      .click();
    await page.getByLabel(`Take actions: ${name}`, { exact: true }).click();
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: `View take: ${name}`, exact: true })
        .count(),
      1,
    );
    await page.getByLabel(`Take actions: ${name}`, { exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await page
      .getByRole("button", { name: `View take: ${name}`, exact: true })
      .waitFor({ state: "detached" });
    await page
      .getByText("Take deleted. Assigned tracks were preserved.", {
        exact: false,
      })
      .waitFor();
  }
  const withoutTakes = await (
    await page.request.get(`http://127.0.0.1:4175/api/projects/${projectId}`)
  ).json();
  assert.equal(withoutTakes.takes.length, 0);
  assert.deepEqual(withoutTakes.tracks, saved.tracks);
  await page.reload();
  await page
    .getByRole("heading", { name: "Browser-tested routine", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Skeleton", exact: true }).click();
  await page.getByLabel("Song cursor").fill("2000");
  assert.equal(
    await page.getByLabel("Editable pose skeleton").locator("circle").count(),
    66,
  );
  if (process.env.UI_ARTIFACTS)
    await page.screenshot({
      path: path.join(process.env.UI_ARTIFACTS, "dance-studio.png"),
    });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  if (process.env.UI_ARTIFACTS)
    await page.screenshot({
      path: path.join(process.env.UI_ARTIFACTS, "dance-studio-mobile.png"),
      fullPage: true,
    });
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Delete project/song", exact: true })
    .click();
  assert.equal(await page.getByLabel("Open project").inputValue(), projectId);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete project/song", exact: true })
    .click();
  await page.getByText("Project/song deleted.", { exact: false }).waitFor();
  assert.notEqual(
    await page.getByLabel("Open project").inputValue(),
    projectId,
  );
  assert.equal(
    (
      await page.request.get(`http://127.0.0.1:4175/api/projects/${projectId}`)
    ).status(),
    404,
  );
  const gapPose = (playerId, x) => ({
    playerId,
    landmarks: Array.from({ length: 33 }, () => ({
      x,
      y: 0.5,
      z: 0,
      visibility: 0.9,
      presence: 0.95,
    })),
  });
  const gapTake = {
    schema: "aerodance.take",
    schemaVersion: 1,
    takeId: "gap-fixture",
    input: { width: 640, height: 480, mirrored: false },
    offsetMs: 0,
    timeScale: 1,
    samples: [0, 100, 2500, 2600].map((takeTimeMs) => ({
      takeTimeMs,
      poses: [gapPose(0, takeTimeMs / 4000), gapPose(1, 0.7)],
    })),
  };
  await page.getByLabel("Import pose recording").setInputFiles({
    name: "gaps.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(gapTake)),
  });
  await page.getByText("Imported 4 samples.", { exact: false }).waitFor();
  await page.getByLabel("Take actions: gaps.json", { exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Overwrite both tracks", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Interpolate P1 missing intervals",
      exact: true,
    })
    .click();
  await page
    .getByText("Interpolated 1 missing interval for P1.", { exact: false })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", {
        name: "Interpolate P1 missing intervals",
        exact: true,
      })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("button", {
        name: "Interpolate P2 missing intervals",
        exact: true,
      })
      .isEnabled(),
    true,
  );
  await page.getByLabel("Song cursor").fill("1000");
  assert.equal(
    await page.getByLabel("Editable pose skeleton").locator("circle").count(),
    33,
  );
  await page.getByRole("button", { name: "Undo", exact: false }).click();
  assert.equal(
    await page
      .getByRole("button", {
        name: "Interpolate P1 missing intervals",
        exact: true,
      })
      .isEnabled(),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Studio browser flow passed: read-only take preview and silent playback, atomic track assignment, independent negative offsets, confirmed project/track/take deletion, track survival after deleting all takes, interpolation, joint/group edits, undo/redo, save/reopen, ZIP export, live pose updates, timed recording into Take view, and desktop/mobile layout.",
  );
} catch (error) {
  console.error(error);
  if (testPage) {
    console.error((await testPage.locator("body").innerText()).slice(-8000));
    if (process.env.UI_ARTIFACTS)
      await testPage.screenshot({
        path: path.join(process.env.UI_ARTIFACTS, "failure.png"),
      });
  }
  throw error;
} finally {
  await browser.close();
  deviceServer.closeAllConnections();
  await new Promise((r) => deviceServer.close(r));
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await rm(dataDir, { recursive: true, force: true });
}
