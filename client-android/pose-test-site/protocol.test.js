import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MAX_BYTES, NdjsonDecoder, PoseState, validate, deviceEndpoint} from './dist/protocol.js';
const pose = (seq = 1, sessionId = 'session') => ({protocolVersion:1,type:'pose',sessionId,seq,frameReceivedTimeMs:10,resultTimeMs:20,input:{width:480,height:640,mirrored:false},poses:[{landmarks:Array.from({length:33},()=>({x:.5,y:.4,z:-.1,visibility:.99,presence:null}))}]});
const heartbeat = {protocolVersion:1,type:'heartbeat',sessionId:'session',producerTimeMs:30,lastPoseSeq:1,pipelineState:'running'};
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
  assert.throws(()=>validate({...pose(),poses:[{landmarks:[]}]}));
});
test('empty results clear immediately, heartbeat does not extend freshness', () => {
  const state=new PoseState(); state.accept(pose(),100);
  assert.equal(state.current(599).poses.length,1);
  state.accept(heartbeat,599); assert.equal(state.current(600),null);
  state.accept({...pose(2),poses:[]},601); assert.equal(state.current(601).poses.length,0);
});
test('gaps, duplicates, restart and reconnect snapshot', () => {
  const state=new PoseState(); assert.equal(state.accept(pose(4),0),true);
  assert.equal(state.accept(pose(4),10),false); assert.equal(state.accept(pose(3),10),false);
  assert.equal(state.accept(pose(9),20),true); assert.equal(state.accept(pose(1,'new'),30),true);
  assert.equal(state.seq,1); assert.equal(new PoseState().accept(pose(9),40),true);
});
test('heartbeat session restart clears old skeleton before first result', () => {
  const state=new PoseState(); state.accept(pose(),1);
  state.accept({...heartbeat,sessionId:'new',lastPoseSeq:null},2); assert.equal(state.current(2),null);
});
test('device input cannot inject paths, ports, credentials or hostnames', () => {
  assert.equal(deviceEndpoint(' 192.168.43.1 '),'http://192.168.43.1:1337');
  for(const input of ['192.168.43.1:1337','example.com','999.1.2.3','1.2.3.4/x','1.2.3.04','http://1.2.3.4']) assert.throws(()=>deviceEndpoint(input));
});
