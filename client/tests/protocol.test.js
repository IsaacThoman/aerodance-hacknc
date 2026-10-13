import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MAX_BYTES, NdjsonDecoder, validate} from '../src/pose/protocol.js';
const pose = (seq = 1, sessionId = 'session') => ({protocolVersion:2,type:'pose',sessionId,seq,frameReceivedTimeMs:10,resultTimeMs:20,playerCount:1,input:{width:480,height:640,mirrored:false},poses:[{playerId:0,landmarks:Array.from({length:33},()=>({x:.5,y:.4,z:-.1,visibility:.99,presence:null}))}]});
const heartbeat = {protocolVersion:2,type:'heartbeat',sessionId:'session',producerTimeMs:30,lastPoseSeq:1,pipelineState:'running'};
const bytes = value => new TextEncoder().encode(value);
test('arbitrary byte splits, multiple records and multibyte session names', () => {
  const source = bytes(JSON.stringify(pose(1,'测试'))+'\n'+JSON.stringify(heartbeat)+'\n');
  for (let split=0;split<=source.length;split++) {
    const records=[]; const decoder = new NdjsonDecoder(r=>records.push(r));
    decoder.push(source.subarray(0,split)); decoder.push(source.subarray(split)); decoder.finish();
    assert.equal(records.length,2); assert.equal(records[0].sessionId,'测试');
  }
});
test('bounded incomplete lines and records, broken UTF-8, truncated EOF', () => {
  const decoder = new NdjsonDecoder(()=>{});
  decoder.push(new Uint8Array(MAX_BYTES).fill(32));
  assert.throws(()=>decoder.push(bytes(' ')),/16 KiB/);
  assert.throws(()=>new NdjsonDecoder(()=>{}).push(new Uint8Array(MAX_BYTES+1).fill(32)),/16 KiB/);
  const partial = new NdjsonDecoder(()=>{}); partial.push(bytes('{')); assert.throws(()=>partial.finish(),/Incomplete/);
  assert.throws(()=>new NdjsonDecoder(()=>{}).push(new Uint8Array([255,10])));
});
test('reject malformed landmarks and preserve finite out-of-image coordinates', () => {
  const record=pose(); record.poses[0].landmarks[0].x=1.2; assert.equal(validate(record),record);
  record.poses[0].landmarks[0].z=Infinity; assert.throws(()=>validate(record));
  assert.throws(()=>validate({...pose(),seq:0}));
  assert.throws(()=>validate({...pose(),poses:[{playerId:0,landmarks:[]}]}));
});
test('two-player snapshots and omissions', () => {
  const right = {...pose(),playerCount:2,poses:[{...pose().poses[0],playerId:1}]};
  assert.equal(validate(right),right);
  const both = {...right,poses:[pose().poses[0],right.poses[0]]};
  assert.equal(validate(both),both);
  for (const invalid of [{...right,playerCount:1},{...both,poses:[...both.poses].reverse()},
      {...both,poses:[pose().poses[0],pose().poses[0]]},{...pose(),playerCount:3},
      {...pose(),protocolVersion:1},{...pose(),poses:[{...pose().poses[0],playerId:.5}]}]) assert.throws(()=>validate(invalid));
});
test('full two-person record fits byte budget', () => {
  const record = {...pose(),playerCount:2,poses:[pose().poses[0],{...pose().poses[0],playerId:1}]};
  assert.ok(bytes(JSON.stringify(record)).length <= MAX_BYTES);
  new NdjsonDecoder(()=>{}).push(bytes(JSON.stringify(record)+'\n'));
});
