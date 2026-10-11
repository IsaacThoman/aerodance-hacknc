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
  releasePoses = () => { initializing = false; };
  const timer = setInterval(() => {
    const t = Math.round(performance.now());
    if (initializing) {
      res.write(JSON.stringify({ protocolVersion: 2, type: "heartbeat", sessionId: "browser-fixture",
        producerTimeMs: t, lastPoseSeq: seq || null, pipelineState: "starting" }) + "\n");
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
        poses: [0, 1].map((playerId) => ({
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
  assert.equal(await page.getByRole("button", { name: "Live view", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "Playback", exact: true }).click();
  await page
    .getByLabel("Import pose recording")
    .setInputFiles("temp/frutiger-character/client/public/motion/dance.json");
  await page.getByText(/Imported 420 samples/).waitFor();
  await page.getByRole("button", { name: "Skeleton", exact: true }).click();
  await page.getByLabel("Song cursor").fill("2000");
  await page.getByLabel("Selected joint").selectOption("15");
  const before = Number(await page.getByLabel("Landmark X").inputValue());
  await page.getByLabel("Landmark X").fill("0.42");
  await page.getByLabel("Landmark X").blur();
  const editedJoint = page.getByLabel("Editable pose skeleton").locator("circle").nth(15);
  assert.ok(Math.abs(Number(await editedJoint.getAttribute("cx")) - 580) < 1e-5);
  // A drag in mirrored display space must write the inverse source coordinate.
  const stage = await page.getByLabel("Editable pose skeleton").boundingBox();
  const handle = await editedJoint.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width * 0.6, stage.y + stage.height * 0.45);
  await page.mouse.up();
  assert.ok(Math.abs(Number(await page.getByLabel("Landmark X").inputValue()) - 0.4) < 0.002);
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
    await freshPage.getByRole("heading", { name: "Browser-tested routine", exact: true }).waitFor();
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
  assert.equal(await page.getByRole("button", { name: "Record new take", exact: false }).isEnabled(), false);
  await page.getByRole("button", { name: "Cancel connection", exact: true }).click();
  await page.getByRole("button", { name: "Connect Android", exact: true }).click();
  await page.getByText(/Starting camera and pose tracking/).waitFor();
  assert.equal(await page.getByRole("button", { name: "Record new take", exact: false }).isEnabled(), false);
  releasePoses();
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
  await page.waitForFunction(() => document.querySelector('[aria-label="Landmark X"]').value === "0.35000");
  assert.ok(Math.abs(Number(await liveSkeleton.locator("circle").first().getAttribute("cx")) - 650) < 1e-5);
  assert.ok(Math.abs(Number(await liveSkeleton.locator("circle").nth(33).getAttribute("cx")) - 250) < 1e-5);
  const liveJoint = liveSkeleton.locator("circle").first();
  const jointBox = await liveJoint.boundingBox();
  await page.mouse.move(jointBox.x + jointBox.width / 2, jointBox.y + jointBox.height / 2);
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
  assert.equal(await page.getByLabel("Recording delay (seconds)").inputValue(), "3");
  await page.getByRole("button", { name: "Record new take", exact: false }).click();
  await page.getByRole("status").filter({ hasText: "Get ready" }).waitFor();
  await page.getByRole("button", { name: "Cancel countdown", exact: true }).click();
  await page.getByText("Recording cancelled before enough movement was captured. No take added.").waitFor();
  await page.getByLabel("Recording delay (seconds)").fill("1");
  await page
    .getByRole("button", { name: "Record new take", exact: false })
    .click();
  await page
    .getByRole("button", { name: "Stop recording", exact: false })
    .waitFor();
  assert.equal(await page.getByRole("button", { name: "Playback", exact: true }).isEnabled(), false);
  assert.equal(await page.getByRole("button", { name: "Live view", exact: true }).getAttribute("aria-pressed"), "true");
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
  assert.ok(capture.samples.length > 30);
  assert.ok(capture.offsetMs >= saved.playableStartMs);
  assert.equal(capture.samples[0].poses[1].playerId, 1);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("button", { name: "Live view", exact: true }).click();
  await page.getByText("Live view · disconnected", { exact: false }).waitFor();
  assert.equal(await page.getByLabel("Live pose skeleton").locator("circle").count(), 0);
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
  assert.deepEqual(errors, []);
  console.log(
    "Studio browser flow passed: import, joint edit, undo/redo, WAV playback, metadata, review, save/reopen, ZIP export, live pose updates, read-only preview, Frutiger rendering, timed HTTP pose recording and mobile layout.",
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
