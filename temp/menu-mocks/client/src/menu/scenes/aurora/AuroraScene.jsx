import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Hud } from '../../hud.jsx';
import { SceneCamera } from '../../shared/hooks.js';
import { damp } from '../../shared/random.js';
import { CAMERA, env, fx, NO_REFLECT, PALETTES } from './state.js';
import { NightSky, ShootingStar, Stars } from './Sky.jsx';
import { Aurora } from './Aurora.jsx';
import { Mountains, Rocks, Shore, Trees } from './Landscape.jsx';
import { Lake, Mist } from './Lake.jsx';
import { Cabin } from './Cabin.jsx';
import { Bokeh, Snow } from './Snow.jsx';
import { AuroraMenu } from './Menu.jsx';

export const meta = {
  id: 'aurora',
  name: 'Aurora Lake',
  tone: 'dark',
  post: {
    bloomStrength: 0.9,
    bloomRadius: 0.62,
    bloomThreshold: 0.55,
    exposure: 1.05,
    vignette: 0.34,
    saturation: 1.08,
    tint: [0.98, 1.0, 1.04],
  },
};

function addScaled(color, other, k) {
  color.r += other.r * k;
  color.g += other.g * k;
  color.b += other.b * k;
  return color;
}

const target = { low: new THREE.Color(), mid: new THREE.Color(), high: new THREE.Color() };

/** Drives shared uniforms: time, aurora palette blending, surges from the menu. */
function EnvDriver() {
  const init = useRef(false);
  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20);
    env.uTime.value = state.clock.elapsedTime;
    state.camera.layers.enable(NO_REFLECT);

    const pal = PALETTES[fx.focus] ?? PALETTES[0];
    target.low.set(pal.low).multiplyScalar(1.7);
    target.mid.set(pal.mid).multiplyScalar(1.1);
    target.high.set(pal.high).multiplyScalar(0.9);
    const k = init.current ? 1 - Math.exp(-1.6 * dt) : 1;
    init.current = true;
    env.uAurora0.value.lerp(target.low, k);
    env.uAurora1.value.lerp(target.mid, k);
    env.uAurora2.value.lerp(target.high, k);

    // Light the world faintly with the aurora's color.
    addScaled(env.uAuroraGlow.value.copy(env.uAurora0.value).multiplyScalar(0.012), env.uAurora1.value, 0.01);
    addScaled(addScaled(env.uHazeCol.value.copy(env.uHorizon.value), env.uAurora0.value, 0.012), env.uAurora1.value, 0.01);

    // Surge: a bright wave sweeping along the curtains.
    env.uSurge.value = fx.surge;
    env.uSurgePos.value = -0.15 + fx.surgeAge * 0.55;
    fx.boost = damp(fx.boost, 0, 1.5, dt);
    env.uBoost.value = fx.boost;
  });
  return null;
}

export default function AuroraScene() {
  return (
    <>
      <color attach="background" args={['#050b20']} />
      <SceneCamera
        position={CAMERA.position}
        target={CAMERA.target}
        fov={CAMERA.fov}
        near={0.5}
        far={9000}
        parallax={[1.7, 0.75]}
        sway={[1.1, 0.35, 0.7]}
        swaySpeed={0.55}
      />
      <EnvDriver />
      <NightSky />
      <Stars />
      <ShootingStar />
      <Aurora />
      <Mountains />
      <Shore />
      <Trees />
      <Rocks />
      <Cabin />
      <Lake />
      <Mist />
      <Snow />
      <Bokeh />
      <Hud>
        <AuroraMenu />
      </Hud>
    </>
  );
}
