import { qualityFor } from '../../../packages/pose/choreography.js';
export function bundleFixture() {
  const song = {
    schema:'aerodance.song',schemaVersion:1,songId:'fixture',bundleRevision:1,title:'Fixture routine',artist:'Test artist',
    songwriters:[],choreographers:[],durationMs:1000,playableStartMs:100,playableEndMs:900,supportedPlayerCounts:[1,2],
    audio:{path:'audio.wav',mimeType:'audio/wav'},choreography:{path:'choreography.json',schemaVersion:1},
    coachMode:'mirror-player',rigProfile:'frutiger-seven-bone-v1',
    rights:{audio:{license:'test',attribution:''},choreography:{license:'test',attribution:''}},
    createdAt:'2026-10-10T00:00:00Z',publishedAt:'2026-10-10T00:00:00Z',build:{compilerVersion:'test',projectRevision:1},
  };
  const poses = [0,1].map(playerId => ({playerId,landmarks:Array.from({length:33},(_,i)=>({x:.3+playerId*.4,y:i<23?.3:.7,z:0,visibility:.9,presence:.8}))}));
  const choreography = {
    schema:'aerodance.choreography',schemaVersion:1,songId:song.songId,durationMs:1000,playableStartMs:100,playableEndMs:900,
    coordinates:{kind:'mediapipe-image',landmarkCount:33,ordering:'mediapipe-pose-33',xAxis:'right',yAxis:'down',zAxis:'away-from-camera',mirrored:false,depthUnit:'relative-image-width'},
    sampling:{targetRateHz:30,maxInterpolationGapMs:200,confidenceThreshold:.5},
    tracks:[0,1].map(playerId=>({playerId,label:`Player ${playerId+1}`,calibration:{inputWidth:640,inputHeight:480,torsoLength:.4,baseHip:{x:.3+playerId*.4,y:.7,z:0},floorY:.7,profileVersion:1},unscorableIntervals:[{startMs:300,endMs:400,reason:'Test exclusion'}]})),
    samples:[100,300,500,700,900].map(songTimeMs=>({songTimeMs,poses:structuredClone(poses),quality:qualityFor(poses)})),provenance:{},
  };
  // One second of silent PCM, solely for automated browser tests; never cataloged publicly.
  const audio = silentWav(1000);
  const entry = {id:song.songId,title:song.title,artist:song.artist,durationMs:1000,supportedPlayerCounts:[1,2],bundleRevision:1,bundle:'fixture/song.json'};
  return {song,choreography,audio,entry};
}

/** Silent 8 kHz mono 16-bit PCM WAV lasting durationMs. */
export function silentWav(durationMs) {
  const data = Math.round(durationMs * 8) * 2;
  const audio = new Uint8Array(44 + data), view = new DataView(audio.buffer);
  const write = (offset,s) => [...s].forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)));
  write(0,'RIFF');view.setUint32(4,36 + data,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,data,true);
  return audio;
}
