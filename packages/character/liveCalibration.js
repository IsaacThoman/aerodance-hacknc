import { calibratePoses, reliableBodyPose } from './calibration.js';

// A new camera/framing session owns its own full-body stance samples per player.
export class LiveCalibration {
  constructor(sampleLimit=20) { this.sampleLimit=sampleLimit; this.reset(); }
  reset() { this.session=null; this.seq=null; this.frames=[[],[]]; this.tracks=[]; }
  accept(snapshot) {
    if(!snapshot) { this.reset(); return false; }
    if(snapshot.sessionId!==this.session) { this.reset(); this.session=snapshot.sessionId; }
    if(snapshot.seq===this.seq) return false;
    this.seq=snapshot.seq;
    let changed=false;
    for(const pose of snapshot.poses) {
      if(this.frames[pose.playerId].length>=this.sampleLimit ||
        snapshot.sourceKind==='webcam' && !reliableBodyPose(pose)) continue;
      this.frames[pose.playerId].push(pose); changed=true;
    }
    if(!changed) return false;
    this.tracks=[0,1].filter(id=>this.frames[id].length).map(playerId=>({ playerId,
      calibration:calibratePoses(this.frames[playerId],snapshot.input,{adaptiveDistance:snapshot.sourceKind==='webcam'}),
    }));
    return true;
  }
  get counts() { return this.frames.map(frames=>frames.length); }
}
