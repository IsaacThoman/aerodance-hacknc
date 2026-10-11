import { test } from "node:test";
import assert from "node:assert/strict";
import { Recorder } from "../web/recorder.js";

test("recorder anchors audio at browser receipt and preserves processing timestamps", async (t) => {
  t.mock.method(performance, "now", () => 1050);
  let listener;
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
      current: () => 2500,
      startTime: 0,
      positionMs: 0,
    },
    projectId: "project",
    request: async (url, options) => {
      if (url.endsWith("/batches")) batches.push(options.body);
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
  listener({ record, receivedBrowserTimeMs: 1000 });
  await recorder.stop();
  const envelope = batches.flatMap((b) => b.records).find((e) => e.record);
  assert.equal(envelope.audioPositionAtReceiptMs, 2400);
  assert.equal(envelope.audioPlaybackRate, 2);
  assert.equal(envelope.receivedBrowserTimeMs, 1000);
  assert.deepEqual(envelope.record, record);
});
