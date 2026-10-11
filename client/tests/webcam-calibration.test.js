import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebcamCalibration, WEBCAM_STILL_MS, WEBCAM_FRAME_GAP_MS } from '../src/game/webcamCalibration.js';
import { standingPose } from '../src/pose/ReplayPoseSource.js';

const poses = (count = 2) => Array.from({ length: count }, (_, playerId) => ({ playerId, landmarks: standingPose(count === 1 ? 0.5 : 0.3 + playerId * 0.4) }));
function camera(count = 2) {
  const calibration = new WebcamCalibration(count);
  let seq = 0;
  const send = (time, players = poses(count), patch = {}, lag = 0) => calibration.accept({
    sessionId: 'camera', seq: ++seq, input: { width: 1280, height: 720 }, poses: players, ...patch,
  }, time, time + lag);
  const hold = (start, end, transform = p => p) => {
    for (let time = start; time <= end; time += 100) send(time, transform(poses(count), time));
  };
  return { calibration, send, hold };
}

test('both players hold together for 2.5 seconds; jitter is allowed and each stance is calibrated', () => {
  const { calibration, send, hold } = camera();
  hold(0, 2000, p => [p[0]]);
  assert.equal(calibration.status(2000).progress, 0);
  hold(2100, 4500, (p, time) => {
    p.forEach(pose => pose.landmarks.forEach(j => { j.x += Math.sin(time) * 0.002; }));
    return p;
  });
  assert.equal(calibration.status(4500).complete, false);
  assert.equal(send(4600), true);
  assert.deepEqual(calibration.status(4600), { players: ['ready', 'ready'], progress: 1, complete: true });
  assert.equal(calibration.tracks.length, 2);
  for (const [id, track] of calibration.tracks.entries()) {
    assert.equal(track.profileVersion, 2);
    assert.equal(track.cameraScaleMode, 'body-relative');
    assert.equal(track.inputWidth, 1280);
    assert.ok(Math.abs(track.baseHip.x - (0.3 + id * 0.4)) < 0.003);
    assert.equal(track.floorY, 0.88);
  }
});

test('body or wrist movement from either player resets the shared hold', () => {
  for (const joint of [23, 15]) {
    const { calibration, send, hold } = camera();
    hold(0, 1500);
    const moved = poses(); moved[1].landmarks[joint].x += 0.1;
    send(1600, moved);
    assert.equal(calibration.status(1600).progress, 0);
    assert.deepEqual(calibration.status(1600).players, ['holding', 'moving']);
    hold(1700, 4100);
    assert.equal(calibration.status(4100).complete, false);
    assert.equal(send(4200), true);
  }
});

test('slow drift is measured against the initial stance, not just the previous frame', () => {
  const { calibration, hold } = camera(1);
  hold(0, 2500, (p, time) => {
    p[0].landmarks.forEach(j => { j.x += time / 100 * 0.003; });
    return p;
  });
  assert.equal(calibration.status(2500).complete, false);
  assert.ok(calibration.status(2500).progress < 0.5);
});

test('missing players, low confidence and feet outside the image reset the hold', () => {
  for (const partial of [p => [p[0]], p => { p[1].landmarks[27].visibility = 0.1; return p; }, p => { p[1].landmarks[28].y = 1.1; return p; }]) {
    const { calibration, send, hold } = camera();
    hold(0, 1500);
    send(1600, partial(poses()));
    assert.equal(calibration.status(1600).progress, 0);
    assert.equal(calibration.tracks, null);
    hold(1700, 4100);
    assert.equal(calibration.status(4100).complete, false);
    assert.equal(send(4200), true);
  }
});

test('render ticks, duplicate and old frames cannot advance calibration', () => {
  const { calibration, send } = camera(1);
  send(0);
  const duplicate = { sessionId: 'camera', seq: 1, input: { width: 1280, height: 720 }, poses: poses(1) };
  assert.equal(calibration.accept(duplicate, 100, 100), false);
  assert.equal(calibration.status(200).progress, 0);
  assert.equal(calibration.accept({ ...duplicate, seq: 2 }, 0, 200), false);
  assert.equal(calibration.accept({ ...duplicate, seq: 3 }, 100, 600), false);
  assert.deepEqual(calibration.status(600), { players: ['missing'], progress: 0, complete: false });
  assert.equal(calibration.accept({ ...duplicate, seq: 4 }, 800, 700), false, 'future capture timestamps are ignored');
  assert.equal(calibration.status(WEBCAM_STILL_MS).complete, false);
});

test('capture gaps and camera or dimension boundaries discard previous samples', () => {
  for (const patch of [{ sessionId: 'new-camera', seq: 1 }, { input: { width: 640, height: 480 } }]) {
    const { calibration, send, hold } = camera();
    hold(0, 1500);
    send(1600, poses(), patch);
    assert.equal(calibration.status(1600).progress, 0);
    assert.equal(calibration.frames[0].length, 1);
  }
  const { calibration, send, hold } = camera(1);
  hold(0, 1500);
  send(1500 + WEBCAM_FRAME_GAP_MS + 1);
  assert.equal(calibration.status(1901).progress, 0);
  assert.equal(calibration.frames[0].length, 1);
});

test('consistent inference latency does not break an otherwise continuous hold', () => {
  const { calibration, send } = camera(1);
  for (let time = 0; time <= 2700; time += 300) {
    send(time, poses(1), {}, 200);
    calibration.status(time + 450);
  }
  assert.equal(calibration.status(2900).complete, true);
});
