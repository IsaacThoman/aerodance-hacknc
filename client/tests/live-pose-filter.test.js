import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LivePoseFilter } from '../../packages/character/livePoseFilter.js';
const pose=x=>({playerId:0,landmarks:Array.from({length:33},()=>({x,y:.5,z:0,visibility:.8,presence:.9}))});
test('live display smoothing reduces jitter, follows movement, and preserves source confidence and coordinates',()=>{
  const filter=new LivePoseFilter(); filter.update(pose(.5),.05);
  let rawMotion=0,displayMotion=0,lastRaw=.5,lastDisplay=.5;
  for(let i=0;i<20;i++) {
    const input=pose(.5+(i%2?.01:-.01)), original=structuredClone(input);
    const result=filter.update(input,.05);
    rawMotion+=Math.abs(input.landmarks[0].x-lastRaw);
    displayMotion+=Math.abs(result.landmarks[0].x-lastDisplay);
    lastRaw=input.landmarks[0].x; lastDisplay=result.landmarks[0].x;
    assert.deepEqual(input,original); assert.equal(result.landmarks[0].presence,.9);
  }
  assert.ok(displayMotion<rawMotion/3);
  for(let i=0;i<5;i++) filter.update(pose(.7),.05);
  assert.ok(filter.current.landmarks[0].x>.67,'intentional movement reaches the new position promptly');
  filter.update(null,.05); assert.equal(filter.current,null); assert.equal(filter.settling,false);
  assert.equal(filter.update(pose(.2),.05).landmarks[0].x,.2,'reacquisition does not blend across a tracking gap');
});
test('live smoothing converges at the same rate across render frame rates',()=>{
  const a=new LivePoseFilter(),b=new LivePoseFilter();
  a.update(pose(.2),0); b.update(pose(.2),0);
  for(let i=0;i<10;i++) a.update(pose(.8),.02);
  for(let i=0;i<4;i++) b.update(pose(.8),.05);
  assert.ok(Math.abs(a.current.landmarks[0].x-b.current.landmarks[0].x)<1e-10);
});
