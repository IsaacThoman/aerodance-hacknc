const median = v => v.sort((a,b)=>a-b)[Math.floor(v.length/2)];
const mid = (p,a,b) => ({x:(p[a].x+p[b].x)/2,y:(p[a].y+p[b].y)/2,z:(p[a].z+p[b].z)/2});
export function reliableBodyPose(pose) {
  return [11,12,23,24,27,28].every(i => {
    const j=pose.landmarks[i];
    return j && j.x>=0 && j.x<=1 && j.y>=0 && j.y<=1 &&
      j.visibility!==null && j.presence!==null && Math.min(j.visibility,j.presence)>=.5;
  });
}
export function calibratePoses(poses, input = {width:640,height:480}, {adaptiveDistance=false} = {}) {
  const reliable = poses.filter(p => [11,12,23,24,27,28].every(i => { const j=p.landmarks[i]; return j.visibility === null || j.presence === null || Math.min(j.visibility,j.presence) >= .5; }));
  const frames = (reliable.length ? reliable : poses).map(p=>p.landmarks);
  if (!frames.length) return {inputWidth:input.width,inputHeight:input.height,torsoLength:.2,baseHip:{x:.5,y:.55,z:0},floorY:.9,profileVersion:1};
  const aspect = input.width/input.height;
  const lengths = frames.map(p=>{const h=mid(p,23,24),s=mid(p,11,12); return Math.hypot((h.x-s.x)*aspect,h.y-s.y);}).filter(v=>v>.001);
  const calibration={inputWidth:input.width,inputHeight:input.height,torsoLength:lengths.length?median(lengths):.2,baseHip:mid(frames[0],23,24),floorY:median(frames.map(p=>Math.max(p[27].y,p[28].y))),profileVersion:1};
  if(adaptiveDistance) {
    const hips=frames.map(p=>mid(p,23,24));
    calibration.baseHip=Object.fromEntries(['x','y','z'].map(axis=>[axis,median(hips.map(h=>h[axis]))]));
    const lengths3d=frames.map(p=>{const h=mid(p,23,24),s=mid(p,11,12); return Math.hypot((h.x-s.x)*aspect,h.y-s.y,(h.z-s.z)*aspect);}).filter(v=>v>.001);
    calibration.cameraScaleMode='body-relative';
    calibration.bodyTorsoLength=lengths3d.length?median(lengths3d):calibration.torsoLength;
    calibration.profileVersion=2;
  }
  return calibration;
}
