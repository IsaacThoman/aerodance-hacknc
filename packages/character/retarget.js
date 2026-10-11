import { Vector3 } from 'three';
export { calibratePoses } from './calibration.js';
const clamp = (x,a,b) => Math.min(b,Math.max(a,x));
const mid = (p,a,b) => ({x:(p[a].x+p[b].x)/2,y:(p[a].y+p[b].y)/2,z:(p[a].z+p[b].z)/2});
/** One pose applier for recorded, edited and live Android-shaped poses. */
export function createPoseApplier(model, calibration) {
  const bones = {};
  model.traverse(o=>{if(o.isBone) bones[o.name]=o;});
  for (const name of ['Root','Body','Head','ArmL','ArmR','FootL','FootR']) if(!bones[name]) throw Error(`Missing rig bone: ${name}`);
  const {torsoLength,baseHip,floorY,inputWidth,inputHeight}=calibration;
  const aspect=inputWidth/inputHeight, scale=1.05/torsoLength;
  const target=new Vector3(),offset=new Vector3();
  function center(bone,x,y,z,ox,oy,oz) {
    target.set(x,y,z); model.localToWorld(target); bone.parent.worldToLocal(target);
    offset.set(ox,oy,oz).applyQuaternion(bone.quaternion); bone.position.copy(target.sub(offset)); bone.updateMatrixWorld(true);
  }
  return pose => {
    if(!pose) {model.visible=false;return;}
    model.visible=true;
    const p=pose.landmarks,h=mid(p,23,24),s=mid(p,11,12);
    const rootX=(h.x-baseHip.x)*aspect*scale,rootY=clamp((baseHip.y-h.y)*scale*.65,-.35,.65);
    bones.Root.position.set(rootX,rootY,0);
    const roll=clamp(-Math.atan2((s.x-h.x)*aspect,h.y-s.y),-.65,.65);
    const yaw=clamp(Math.atan2(p[11].z-p[12].z,Math.abs(p[11].x-p[12].x)*aspect),-.8,.8);
    bones.Body.rotation.set(0,yaw*.45,roll);
    const ears=mid(p,7,8),headYaw=clamp((p[0].x-ears.x)*aspect*scale*2,-.65,.65);
    const headRoll=clamp(-Math.atan2(p[7].y-p[8].y,Math.abs(p[7].x-p[8].x)*aspect),-.45,.45);
    bones.Head.rotation.set(0,headYaw-yaw*.45,headRoll-roll); model.updateMatrixWorld(true);
    for(const [side,wrist,ankle,sign] of [['L',16,28,-1],['R',15,27,1]]) {
      center(bones[`Arm${side}`],rootX+(p[wrist].x-h.x)*aspect*scale,rootY+1.1+(h.y-p[wrist].y)*scale,clamp(-(p[wrist].z-h.z)*scale*.35,-.7,.9),sign*.26,-.86,0);
      center(bones[`Foot${side}`],rootX+(p[ankle].x-h.x)*aspect*scale,Math.max(.3,.3+(floorY-p[ankle].y)*scale),clamp(-(p[ankle].z-h.z)*scale*.25,-.45,.45),0,0,.13);
    }
  };
}
