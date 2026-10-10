import { useMemo } from 'react';
import * as THREE from 'three';
import { SceneCamera } from '../../shared/hooks.js';
import { damp } from '../../shared/random.js';
import { OVERVIEW, TARGETS, targetPosition } from './layout.js';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Galaxy-map camera: drifts gently over the hub, and when a menu entry is
 * focused glides to re-frame its planet on the right side of the screen.
 */
export function GalaxyCamera({ state }) {
  const rig = useMemo(
    () => ({
      pos: OVERVIEW.position.clone(),
      look: OVERVIEW.target.clone(),
      wantPos: new THREE.Vector3(),
      wantLook: new THREE.Vector3(),
      p: new THREE.Vector3(),
      f: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      pointer: new THREE.Vector2(),
      speed: 0,
    }),
    [],
  );

  const onFrame = (camera, s, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const t = s.clock.elapsedTime;
    const focus = state.focus;
    for (let i = 0; i < TARGETS.length; i++) {
      state.glow[i] = damp(state.glow[i], i === focus ? 1 : 0, 3.5, dt);
    }

    if (focus < 0) {
      rig.wantPos.copy(OVERVIEW.position);
      rig.wantPos.x += Math.sin(t * 0.06) * 1.6;
      rig.wantPos.y += Math.sin(t * 0.045 + 1) * 0.8;
      rig.wantPos.z += Math.sin(t * 0.035 + 2) * 1.2;
      rig.wantLook.copy(OVERVIEW.target);
    } else {
      const tg = TARGETS[focus];
      targetPosition(focus, t, rig.p);
      rig.f.set(...tg.view).normalize();
      rig.wantPos.copy(rig.p).addScaledVector(rig.f, tg.radius * tg.distance);
      // Slow orbit while framed so the planet keeps turning toward us.
      rig.wantPos.x += Math.sin(t * 0.12) * tg.radius * 0.25;
      rig.f.copy(rig.p).sub(rig.wantPos).normalize();
      rig.right.crossVectors(rig.f, UP).normalize();
      rig.up.crossVectors(rig.right, rig.f);
      rig.wantLook.copy(rig.p).addScaledVector(rig.right, -tg.radius * 0.95).addScaledVector(rig.up, tg.radius * 0.28);
    }

    // Glide: ease harder when far away so long trips still feel smooth.
    const k = 2.0;
    rig.pos.x = damp(rig.pos.x, rig.wantPos.x, k, dt);
    rig.pos.y = damp(rig.pos.y, rig.wantPos.y, k, dt);
    rig.pos.z = damp(rig.pos.z, rig.wantPos.z, k, dt);
    rig.look.x = damp(rig.look.x, rig.wantLook.x, k * 1.25, dt);
    rig.look.y = damp(rig.look.y, rig.wantLook.y, k * 1.25, dt);
    rig.look.z = damp(rig.look.z, rig.wantLook.z, k * 1.25, dt);

    // Pointer parallax in camera space, scaled by how far we are from the look point.
    rig.pointer.x = damp(rig.pointer.x, s.pointer.x, 2.5, dt);
    rig.pointer.y = damp(rig.pointer.y, s.pointer.y, 2.5, dt);
    rig.f.copy(rig.look).sub(rig.pos);
    const dist = rig.f.length();
    rig.f.divideScalar(dist);
    rig.right.crossVectors(rig.f, UP).normalize();
    rig.up.crossVectors(rig.right, rig.f);
    const par = dist * 0.03;
    camera.position
      .copy(rig.pos)
      .addScaledVector(rig.right, rig.pointer.x * par + Math.sin(t * 0.21) * dist * 0.004)
      .addScaledVector(rig.up, rig.pointer.y * par * 0.6 + Math.sin(t * 0.17 + 1.3) * dist * 0.003);
    camera.lookAt(rig.look);
  };

  return <SceneCamera position={[0, 0, 30]} target={[0, 0, 0]} fov={40} near={0.1} far={3000} parallax={[0, 0]} sway={[0, 0, 0]} onFrame={onFrame} />;
}
