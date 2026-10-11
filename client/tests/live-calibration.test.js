import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveCalibration } from '../../packages/character/liveCalibration.js';

const pose=playerId=>({playerId,landmarks:Array.from({length:33},(_,i)=>({
  x:playerId===0?.25:.75,y:i<23?.3:i<27?.55:.9,z:0,visibility:1,presence:1,
}))});
const snapshot=(seq,poses,sessionId='camera')=>({sourceKind:'webcam',sessionId,seq,input:{width:1280,height:720},poses});
test('live webcam calibration waits for full-body evidence and calibrates each player independently', () => {
  const history=new LiveCalibration(2), partial=pose(0);
  partial.landmarks[27].visibility=.1;
  assert.equal(history.accept(snapshot(1,[partial])),false);
  assert.deepEqual(history.tracks,[]);
  assert.deepEqual(history.counts,[0,0]);
  history.accept(snapshot(2,[pose(0)])); history.accept(snapshot(3,[pose(0)]));
  assert.deepEqual(history.counts,[2,0]);
  history.accept(snapshot(4,[pose(0),pose(1)])); history.accept(snapshot(5,[pose(0),pose(1)]));
  assert.deepEqual(history.counts,[2,2]);
  for(const track of history.tracks) {
    assert.equal(track.calibration.cameraScaleMode,'body-relative');
    assert.equal(track.calibration.inputWidth,1280);
    assert.ok(track.calibration.bodyTorsoLength>0);
  }
});
test('recalibration and camera boundaries clear the old stance and sampling ignores duplicate frames', () => {
  const history=new LiveCalibration();
  history.accept(snapshot(1,[pose(0)])); history.accept(snapshot(1,[pose(0)]));
  assert.deepEqual(history.counts,[1,0]);
  history.reset(); assert.deepEqual(history.counts,[0,0]);
  history.accept(snapshot(1,[pose(1)])); assert.deepEqual(history.counts,[0,1]);
  history.accept(snapshot(2,[pose(0)],'new-camera')); assert.deepEqual(history.counts,[1,0]);
  history.accept(null); assert.deepEqual(history.tracks,[]);
});
