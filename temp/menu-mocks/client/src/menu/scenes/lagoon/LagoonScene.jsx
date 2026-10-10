import { useMemo } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Hud } from '../../hud.jsx';
import { RENDER_HEIGHT, RENDER_WIDTH } from '../../post.jsx';
import { ASPECT, SceneCamera, beat, useDisposable } from '../../shared/hooks.js';
import { useSunDirection } from '../../shared/Sky.jsx';
import { makeSharedUniforms } from './shaders.js';
import { AboveWorld } from './Above.jsx';
import { BelowWorld, makeFloorHeight } from './Below.jsx';
import { CompositeQuad, useCompositeMaterial } from './Composite.jsx';
import { LagoonMenu } from './Menu.jsx';

export const meta = {
  id: 'lagoon',
  name: 'Aqua Lagoon',
  tone: 'light',
  post: {
    bloomStrength: 0.32,
    bloomRadius: 0.2,
    bloomThreshold: 1.2,
    saturation: 1.22,
    exposure: 0.97,
    vignette: 0.16,
  },
};

// Fraction of the frame height the projection is shifted down by, so the
// horizon sits above center while cameras stay level (no keystoning).
const LENS_SHIFT = 0.16;
const LINE_BASE = 0.55;
const CAMERA_HEIGHT = 1.8;
const UNDER_DROP = 3.4;

/**
 * "Aqua Lagoon": a half-submerged camera at a tropical lagoon. The world is
 * rendered twice (above + below water) into HDR targets and joined by a
 * living meniscus in a full-screen composite.
 */
export default function LagoonScene() {
  const gl = useThree((s) => s.gl);
  const shared = useMemo(() => makeSharedUniforms(), []);
  const scenes = useMemo(() => ({ above: new THREE.Scene(), below: new THREE.Scene() }), []);
  const targets = useDisposable(() => ({
    above: new THREE.WebGLRenderTarget(RENDER_WIDTH, RENDER_HEIGHT, { type: THREE.HalfFloatType, samples: 4 }),
    below: new THREE.WebGLRenderTarget(RENDER_WIDTH, RENDER_HEIGHT, { type: THREE.HalfFloatType, samples: 4 }),
  }));
  const belowCam = useMemo(() => {
    const c = new THREE.PerspectiveCamera(50, ASPECT, 0.1, 400);
    // Note: setViewOffset also sets aspect = fullWidth / fullHeight, so use 16:9 sizes.
    c.setViewOffset(1280, 720, 0, LENS_SHIFT * 720, 1280, 720);
    return c;
  }, []);
  const floorHeight = useMemo(() => makeFloorHeight(), []);
  const sunDirection = useSunDirection(13, -37);
  const composite = useCompositeMaterial(shared, targets.above.texture, targets.below.texture);
  const lagoon = useMemo(
    () => ({
      bob: 0,
      roll: 0,
      shared,
      composite,
      belowCam,
      ripIndex: 0,
      ripple(xUv, amplitude = 0.012) {
        const r = composite.uniforms.uRipples.value[this.ripIndex++ % 4];
        r.set(xUv, shared.uTime.value, amplitude, 0);
      },
      // HUD px (origin center) -> world point `dist` meters along the underwater view ray.
      hudToWorld(x, y, dist, out) {
        const v = this._v ?? (this._v = new THREE.Vector3());
        v.set(x / 640, y / 360, 0.5).unproject(belowCam).sub(belowCam.position).normalize();
        out.x = belowCam.position.x + v.x * dist;
        out.y = belowCam.position.y + v.y * dist;
        out.z = belowCam.position.z + v.z * dist;
        return out;
      },
      scatterAt(x, y) {
        const r = shared.uRepel.value;
        this.hudToWorld(x, y, 10, r);
        r.w = 1;
      },
    }),
    [shared, composite, belowCam],
  );
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useMemo(() => shared.uSunDir.value.set(...sunDirection).normalize(), [shared, sunDirection]);

  const rig = (camera, state) => {
    const t = state.clock.elapsedTime;
    const bob = 0.06 * Math.sin(t * 0.73) + 0.025 * Math.sin(t * 1.31 + 1);
    const roll = 0.016 * Math.sin(t * 0.52) + 0.007 * Math.sin(t * 1.07 + 2);
    camera.position.y += bob;
    camera.rotateZ(roll);
    lagoon.bob = bob;
    lagoon.roll = roll;
  };

  useFrame((state) => {
    const cam = state.camera;
    const shift = LENS_SHIFT * 720;
    if (!cam.view || !cam.view.enabled || cam.view.offsetY !== shift || cam.aspect !== ASPECT) {
      cam.setViewOffset(1280, 720, 0, shift, 1280, 720);
    }
    cam.updateMatrixWorld();
    shared.uTime.value = state.clock.elapsedTime;
    shared.uBeat.value = beat.pulse;

    belowCam.position.copy(cam.position);
    belowCam.position.y -= UNDER_DROP;
    belowCam.quaternion.copy(cam.quaternion);
    belowCam.rotateX(-0.035);
    belowCam.updateMatrixWorld();

    const u = composite.uniforms;
    u.uLineBase.value = LINE_BASE - lagoon.bob * 0.12;
    // Camera roll tilts the horizon down toward +x; the waterline is the same plane.
    u.uLineTilt.value = -Math.tan(lagoon.roll);
    tmp.set(...sunDirection).multiplyScalar(1000).add(cam.position).project(cam);
    const onScreen = tmp.z < 1 && Math.abs(tmp.x) < 1.3 && Math.abs(tmp.y) < 1.3 ? 1 : 0;
    u.uSun.value.set(tmp.x * 0.5 + 0.5, tmp.y * 0.5 + 0.5, onScreen);

    const before = gl.info.render.calls;
    const tris = gl.info.render.triangles;
    gl.setRenderTarget(targets.above);
    gl.render(scenes.above, cam);
    gl.setRenderTarget(targets.below);
    gl.render(scenes.below, belowCam);
    gl.setRenderTarget(null);
    if (import.meta.env.DEV) {
      // The shared __aeroStats only sees the composite pass; these are the two world renders.
      window.__lagoonStats = { calls: gl.info.render.calls - before, triangles: gl.info.render.triangles - tris };
    }
  }, 0.5);

  return (
    <>
      <SceneCamera
        position={[0, CAMERA_HEIGHT, 0]}
        target={[0, CAMERA_HEIGHT, -100]}
        fov={50}
        near={0.5}
        far={6000}
        parallax={[0.6, 0.18]}
        sway={[0.25, 0.05, 0]}
        onFrame={rig}
      />
      {createPortal(<AboveWorld shared={shared} sunDirection={sunDirection} />, scenes.above)}
      {createPortal(<BelowWorld shared={shared} camera={belowCam} floorHeight={floorHeight} />, scenes.below)}
      <CompositeQuad material={composite} />
      <Hud>
        <LagoonMenu ctx={lagoon} />
      </Hud>
    </>
  );
}
