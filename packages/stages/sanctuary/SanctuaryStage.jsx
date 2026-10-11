import { useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { beat, StageCamera, useDisposable } from '../shared/hooks.js';
import { StageEnvironment } from '../shared/Environment.jsx';
import { CloudField, SkyDome } from '../shared/Sky.jsx';
import { post } from '../shared/post.jsx';
import meta from './meta.js';
import { buildCity } from './city.js';
import { CAMERA, COLORS, FOG, LIGHT_DIR, SUN_DIR } from './layout.js';
import { makeCityEnv, stageUniforms } from './materials.js';
import { Terrace } from './Terrace.jsx';
import { Biodome, CityMesh, Ground, Hills, Trees, Waterfalls } from './World.jsx';
import { Balloons, Birds, Blimp, Pods, Sailboats, Trains, Turbines } from './Life.jsx';
import { Bubbles, Butterflies, FountainSpray, Glints, LensFlare } from './Sparkle.jsx';

// Skyline Sanctuary: a glossy sky-garden terrace on top of a white eco-tower,
// high above a gleaming glass city at bright midday.

const SUN = SUN_DIR.toArray();
const LIGHT = LIGHT_DIR.clone().multiplyScalar(40).toArray();
// Reflections for the dancers only (every other material has its own map):
// their gel is mostly metallic and 28% see-through, so a pale environment in
// front of this bright scene greys them out. Saturated blues keep them vivid.
const ENV_LIGHTS = [
  { position: [0, 24, 6], color: '#e8f6ff', intensity: 4, size: [26, 26] },
  { position: SUN_DIR.clone().multiplyScalar(40).toArray(), color: '#fff2d8', intensity: 6, size: [6, 6] },
  { position: [-18, 4, 8], color: '#5fe8ff', intensity: 2, size: [8, 10] },
  { position: [18, 5, 4], color: '#7fd0ff', intensity: 1.8, size: [8, 10] },
  { position: [0, 2, 30], color: '#3fb0ff', intensity: 1.2, size: [24, 6] },
];

function Clock() {
  useFrame((state) => {
    stageUniforms.uTime.value = state.clock.elapsedTime;
    stageUniforms.uBeat.value = beat.pulse;
    stageUniforms.uBeatPhase.value = beat.phase;
    post.bloomStrength = meta.post.bloomStrength + beat.pulse * 0.04;
  });
  return null;
}

// Cloudy-sky reflection maps: a sunny one for the distant city glass, a soft
// one for the glossy terrace. Effect-owned so a remount never reuses a
// disposed PMREM target.
function useReflectionMaps() {
  const gl = useThree((s) => s.gl);
  const [maps, setMaps] = useState(null);
  useEffect(() => {
    const city = makeCityEnv(gl, SUN_DIR, 25);
    const near = makeCityEnv(gl, SUN_DIR, 1.5);
    setMaps({ city: city.texture, near: near.texture });
    return () => {
      city.dispose();
      near.dispose();
    };
  }, [gl]);
  return maps;
}

export default function SanctuaryStage() {
  const city = useDisposable(() => buildCity());
  const maps = useReflectionMaps();
  stageUniforms.uSunDir.value.copy(SUN_DIR);

  return (
    <>
      <StageCamera
        position={CAMERA.position}
        target={CAMERA.target}
        fov={CAMERA.fov}
        near={0.5}
        far={9000}
        orbit={[0.07, 0.015]}
        sway={[0.18, 0.06, 0]}
        parallax={[0.45, 0.2]}
      />
      <Clock />
      <color attach="background" args={[COLORS.skyHorizon]} />
      <fog attach="fog" args={[COLORS.fog, FOG[0], FOG[1]]} />
      <StageEnvironment top="#bfe6ff" horizon="#1a7fd8" bottom="#0a3a5e" lights={ENV_LIGHTS} intensity={2.2} />
      <hemisphereLight args={['#d4ecff', '#7fae74', 0.5]} />
      <directionalLight
        castShadow
        position={LIGHT}
        intensity={2.7}
        color="#fff4e2"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
        shadow-camera-near={1}
        shadow-camera-far={100}
        shadow-normalBias={0.03}
        shadow-bias={-0.0004}
      />
      <SkyDome top={COLORS.skyTop} horizon={COLORS.skyHorizon} bottom="#dcf3ff" exponent={0.3} sunDirection={SUN} sunColor="#fff1d0" sunDisc={2.4} sunGlow={0.35} sunSize={0.45} radius={4500} />
      <CloudField count={24} center={[0, 640, -4300]} area={[10000, 1600]} heightJitter={300} size={[650, 1250]} speed={6} seed={3} fogColor={COLORS.skyHorizon} fogNear={2500} fogFar={7000} shade="#a9c7ea" />
      {/* Wisps drifting below the terrace on both flanks sell the height. */}
      <CloudField count={3} center={[-580, -82, -760]} area={[320, 260]} heightJitter={8} size={[70, 120]} speed={2.5} seed={21} fogColor={COLORS.skyHorizon} fogNear={400} fogFar={3000} shade="#bcd6ef" opacity={0.8} renderOrder={-480} />
      <CloudField count={3} center={[600, -86, -800]} area={[340, 260]} heightJitter={8} size={[70, 120]} speed={2.5} seed={27} fogColor={COLORS.skyHorizon} fogNear={400} fogFar={3000} shade="#bcd6ef" opacity={0.8} renderOrder={-480} />
      <CloudField count={10} center={[0, -12, -950]} area={[2600, 700]} heightJitter={25} size={[140, 300]} speed={4} seed={9} fogColor={COLORS.skyHorizon} fogNear={600} fogFar={3200} shade="#b8d3ee" opacity={0.85} renderOrder={-490} />
      {maps && (
        <>
          <CityMesh city={city} envMap={maps.city} />
          <Ground envMap={maps.city} />
          <Trees city={city} envMap={maps.near} />
          <Hills envMap={maps.city} />
          <Biodome city={city} />
          <Waterfalls city={city} />
          <Trains city={city} envMap={maps.city} />
          <Pods envMap={maps.city} />
          <Blimp envMap={maps.near} />
          <Balloons envMap={maps.near} />
          <Sailboats envMap={maps.near} />
          <Turbines envMap={maps.city} />
          <Terrace envMap={maps.near} />
        </>
      )}
      <Birds />
      <FountainSpray />
      <Butterflies />
      <Bubbles />
      <Glints />
      <LensFlare />
    </>
  );
}
