// Display-only smoothing; the caller's landmarks and confidence are untouched.
export class LivePoseFilter {
  constructor(timeConstant=.12) { this.timeConstant=timeConstant; this.reset(); }
  reset() { this.current=null; this.settling=false; }
  update(pose,delta) {
    if(!pose) { this.reset(); return pose; }
    if(!this.current || this.current.playerId!==pose.playerId) {
      this.current={...pose,landmarks:pose.landmarks.map(p=>({...p}))};
      return this.current;
    }
    const alpha=1-Math.exp(-Math.max(0,delta)/this.timeConstant);
    this.settling=false;
    pose.landmarks.forEach((p,i)=>{
      const current=this.current.landmarks[i];
      for(const axis of ['x','y','z']) {
        current[axis]+=(p[axis]-current[axis])*alpha;
        if(Math.abs(p[axis]-current[axis])>.0002) this.settling=true;
      }
      current.visibility=p.visibility; current.presence=p.presence;
    });
    return this.current;
  }
}
