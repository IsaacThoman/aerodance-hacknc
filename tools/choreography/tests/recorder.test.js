import { test } from "node:test";
import assert from "node:assert/strict";
import { Recorder } from "../web/recorder.js";

test("recorder anchors audio at browser receipt and preserves processing timestamps", async (t) => {
  let browserTime = 1050;
  t.mock.method(performance, "now", () => browserTime);
  let listener;
  let audioPosition = 2500;
  let finalized = false;
  const batches = [];
  const input = { width: 640, height: 480, mirrored: false };
  const recorder = new Recorder({
    source: {
      view: { model: "test", snapshot: { sessionId: "s", input } },
      subscribeRecords(callback) {
        listener = callback;
        return () => { listener = null; };
      },
    },
    transport: {
      active: true,
      rate: 2,
      current: () => audioPosition,
      startTime: 0,
      positionMs: 0,
    },
    projectId: "project",
    request: async (url, options) => {
      if (url.endsWith("/batches")) batches.push(options.body);
      if (url.endsWith("/finalize")) finalized = true;
      return { takeId: "take" };
    },
    onFailure: (message) => assert.fail(message),
  });
  await recorder.start();
  t.after(() => clearInterval(recorder.timer));
  const record = {
    type: "pose", sessionId: "s", playerCount: 2, input,
    frameReceivedTimeMs: 9000, resultTimeMs: 9120,
  };
  audioPosition = -1000;
  listener({ record, receivedBrowserTimeMs: 1000 });
  assert.equal(recorder.poseCount, 0);
  audioPosition = 200;
  listener({ record, receivedBrowserTimeMs: 1000 });
  assert.equal(recorder.poseCount, 0, "late results for countdown frames are skipped");
  browserTime = 61050;
  audioPosition = 340;
  listener({ record, receivedBrowserTimeMs: 61000 });
  assert.equal(recorder.poseCount, 1, "a frame at music start is accepted");
  audioPosition = 2500;
  listener({ record, receivedBrowserTimeMs: 61000 });
  await recorder.stop();
  assert.equal(finalized, true);
  const envelopes = batches.flatMap((b) => b.records).filter((e) => e.record);
  assert.equal(envelopes.length, 2);
  const envelope = envelopes[1];
  assert.equal(envelope.audioPositionAtReceiptMs, 2400);
  assert.equal(envelope.audioPlaybackRate, 2);
  assert.equal(envelope.receivedBrowserTimeMs, 61000);
  assert.deepEqual(envelope.record, record);
});

test("cancelling a countdown unsubscribes and does not finalize an empty take", async (t) => {
  let unsubscribed = false;
  const requests = [];
  const recorder = new Recorder({
    source: {
      view: { snapshot: {} },
      subscribeRecords: () => () => { unsubscribed = true; },
    },
    transport: { current: () => -3000, rate: 1, positionMs: 0 },
    projectId: "project",
    request: async (url) => {
      requests.push(url);
      return { takeId: "cancelled" };
    },
    onFailure: (message) => assert.fail(message),
  });
  await recorder.start();
  t.after(() => clearInterval(recorder.timer));
  assert.equal(await recorder.stop(), null);
  assert.equal(recorder.running, false);
  assert.equal(unsubscribed, true);
  assert.equal(requests.some((url) => url.endsWith("/finalize")), false);
});
