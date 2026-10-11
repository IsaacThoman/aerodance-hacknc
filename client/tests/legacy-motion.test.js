import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { migrateLegacyMotion, validateMotionTake } from '../../packages/pose/legacy.js';
import { validate } from '../src/pose/protocol.js';
const legacy = () => ({version:1,duration:1,source:{width:640,height:480,sha256:'source'},times:[0,.5],poses:Array.from({length:2},()=>Array.from({length:2},()=>Array.from({length:33},()=>[1.1,.5,-.2,.75])))});
test('legacy migration preserves timing, IDs, out-of-image coordinates and combined confidence without inventing scores',()=>{
  const data=legacy(),take=migrateLegacyMotion(data);
  assert.equal(validateMotionTake(take),take);
  assert.equal(take.samples[1].takeTimeMs,500);
  assert.deepEqual(take.samples[0].poses.map(p=>p.playerId),[0,1]);
  assert.deepEqual(take.samples[0].poses[1].landmarks[0],{x:1.1,y:.5,z:-.2,visibility:null,presence:null});
  assert.equal(take.samples[0].legacyConfidence[1][0],.75);
  assert.ok(take.samples[0].quality.every(q=>q.scoreEligible.every(v=>!v)));
  assert.equal(take.provenance.source.sha256,'source'); assert.equal(data.version,1);
  assert.ok(!('seq' in take.samples[0]));
  validate({protocolVersion:2,type:'pose',sessionId:'fixture',seq:1,frameReceivedTimeMs:1,resultTimeMs:2,playerCount:2,input:take.input,poses:take.samples[0].poses});
});
test('legacy import rejects invalid tuples, timestamps, IDs and confidence',()=>{
  for (const mutate of [d=>d.times[1]=0,d=>d.poses[1].pop(),d=>d.poses[0][0][0][3]=1.1,d=>d.poses[0][0][0][0]=Infinity]) {
    const data=legacy(); mutate(data); assert.throws(()=>migrateLegacyMotion(data));
  }
});
test('committed demo is a migrated object take, with all legacy scores retained',async()=>{
  const data=JSON.parse(await readFile(new URL('../../temp/frutiger-character/client/public/motion/dance.json',import.meta.url)));
  validateMotionTake(data);assert.equal(data.samples.length,420);
  for (const sample of data.samples) {
    assert.equal(sample.legacyConfidence.length,2);
    for (const pose of sample.poses) assert.ok(pose.landmarks.every(j=>j.visibility===null&&j.presence===null));
  }
});
