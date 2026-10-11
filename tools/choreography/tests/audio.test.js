import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioTransport } from "../web/audio.js";

test("saved audio loads while autoplay is blocked; playback resumes on demand", async () => {
  let resumes = 0;
  const buffer = { duration: 1, getChannelData: () => new Float32Array(300) };
  const context = {
    state: "suspended",
    currentTime: 0,
    decodeAudioData: async () => buffer,
    resume: async () => { resumes++; context.state = "running"; },
    createBufferSource: () => ({
      playbackRate: {}, connect() {}, start() {}, stop() {}, disconnect() {},
    }),
  };
  const transport = new AudioTransport();
  transport.context = context;
  const decoded = await transport.load(new ArrayBuffer(8));
  assert.equal(decoded.durationMs, 1000);
  assert.equal(transport.buffer, buffer);
  assert.equal(context.state, "suspended");
  assert.equal(resumes, 0);
  await transport.play();
  assert.equal(resumes, 1);
  assert.equal(transport.active, true);
  transport.pause();
});
