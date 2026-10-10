import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { beat, SceneCamera } from '../../shared/hooks.js';
import { post } from '../../post.jsx';
import { SkyStageMenu } from './Menu.jsx';
import { GoldenSky, useSkyEnvironment } from './GoldenSky.jsx';
import { CloudSea } from './CloudSea.jsx';
import { CloudPuffs } from './CloudPuffs.jsx';
import { Stage } from './Stage.jsx';
import { Dancer } from './Dancer.jsx';
import { DiscoOrb, Equalizer, Speakers } from './Fixtures.jsx';
import { Notes, Ribbons, Sparkles } from './Effects.jsx';
import { Airship, Balloons, Birds, Islands } from './Environment.jsx';
import { SunFlare } from './SunFlare.jsx';
import { resetShow, show, SUN_DIR, tickShow } from './palette.js';

export const meta = {
  id: 'skystage',
  name: 'Cloud Stage',
  tone: 'light',
  post: {
    bloomStrength: 0.38,
    bloomRadius: 0.38,
    bloomThreshold: 1.0,
    exposure: 0.94,
    toneMapping: THREE.NeutralToneMapping,
    vignette: 0.3,
    saturation: 1.15,
    tint: [1, 0.99, 0.98],
  },
};

function ShowClock() {
  useEffect(() => {
    resetShow();
    return resetShow;
  }, []);
  useFrame((_, delta) => {
    tickShow(Math.min(delta, 0.1));
    // Gentle bloom breathing on the kick, a flash when DANCE! is pressed.
    const flash = Math.max(0, 1 - show.burst / 0.5);
    post.bloomStrength = meta.post.bloomStrength + beat.pulse * 0.07 + show.hype * 0.06 + flash * flash * 0.22;
  });
  return null;
}

const SUN_POS = SUN_DIR.clone().multiplyScalar(60).toArray();

function FloatingStage({ env }) {
  const group = useRef();
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const g = group.current;
    g.position.y = Math.sin(t * 0.55) * 0.12;
    g.rotation.z = Math.sin(t * 0.37) * 0.008;
    g.rotation.x = Math.sin(t * 0.29 + 1.0) * 0.006;
  });
  return (
    <group ref={group}>
      <group scale={0.8}>
        <Stage env={env} />
        <Dancer env={env} position={[0, 0, 0.3]} scale={1.375} />
        <Speakers env={env} />
        <Equalizer />
        <DiscoOrb />
        <Ribbons />
        <Notes count={18} />
        <Sparkles count={100} />
      </group>
    </group>
  );
}

export default function SkyStageScene() {
  const env = useSkyEnvironment();
  return (
    <>
      <ShowClock />
      <SceneCamera position={[0, 3.6, 17.5]} target={[0, 1.4, 0]} fov={40} parallax={[0.8, 0.35]} sway={[0.25, 0.12, 0.1]} />
      <color attach="background" args={['#ffc8a8']} />
      <GoldenSky />
      <CloudSea />
      <CloudPuffs />
      <directionalLight position={SUN_POS} color="#ffc490" intensity={2.2} />
      <directionalLight position={[-14, 16, 26]} color="#fff0fa" intensity={0.7} />
      <hemisphereLight args={['#c4d2ff', '#ffd2c4', 0.6]} />
      <Islands />
      <Balloons />
      <Birds />
      <Airship env={env} />
      <FloatingStage env={env} />
      <SunFlare />
      <SkyStageMenu />
    </>
  );
}
