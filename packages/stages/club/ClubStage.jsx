import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { StageCamera, beat } from '../shared/hooks.js';
import { StageEnvironment } from '../shared/Environment.jsx';
import { post } from '../shared/post.jsx';
import meta from './meta.js';
import { C, tickClub } from './clock.js';
import Room from './Room.jsx';
import DanceFloor from './DanceFloor.jsx';
import VideoWall from './VideoWall.jsx';
import Aquarium from './Aquarium.jsx';
import DJBooth from './DJBooth.jsx';
import Speakers from './Speakers.jsx';
import Crowd from './Crowd.jsx';
import Chandelier from './Chandelier.jsx';
import Beams from './Beams.jsx';
import BubbleColumns from './BubbleColumns.jsx';
import Bar from './Bar.jsx';
import Particles from './Particles.jsx';

// Drives the shared club uniforms; bloom breathes with the kick.
function ClubClock() {
  useFrame((state) => {
    tickClub(state.clock.elapsedTime);
    post.bloomStrength = meta.post.bloomStrength * (1 + beat.pulse * 0.2);
  });
  return null;
}

const ENV_LIGHTS = [
  { position: [0, 7, 22], color: '#eef8ff', intensity: 5, size: [18, 7] },
  { position: [-13, 6, -12], color: '#3ff0ff', intensity: 3.5, size: [6, 10] },
  { position: [13, 6, -12], color: '#ff5ae0', intensity: 3.5, size: [6, 10] },
  { position: [-9, 12, 14], color: '#c9f6ff', intensity: 2.2, size: [6, 4] },
  { position: [-18, 5, -2], color: '#1ee8ff', intensity: 4, size: [8, 12] },
  { position: [18, 5, -2], color: '#ff3fd2', intensity: 3.5, size: [8, 12] },
  { position: [0, 20, 0], color: '#b9d8ff', intensity: 2, size: [14, 14] },
  { position: [0, 4, -22], color: '#5a6bff', intensity: 1.6, size: [22, 8] },
  { position: [-10, -4, 14], color: '#9dff3a', intensity: 1.6, size: [6, 4] },
];

// Spot light whose target lives in the scene so its direction updates.
function Spot({ target, aimRef, lightRef, ...props }) {
  const light = useRef();
  const aim = useRef();
  useEffect(() => {
    light.current.target = aim.current;
    lightRef.current = light.current;
    aimRef.current = aim.current;
  }, [aimRef, lightRef]);
  return (
    <>
      <spotLight ref={light} {...props} />
      <object3D ref={aim} position={target} />
    </>
  );
}

const RIM = [new THREE.Color(C.aqua), new THREE.Color(C.magenta), new THREE.Color(C.lime), new THREE.Color(C.violet)];

function Lights() {
  const lights = [useRef(), useRef()];
  const aims = [useRef(), useRef()];
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Rim spots drift with the dancers and trade colors every four bars.
    const swap = Math.floor(beat.bar / 4) % 4;
    for (let i = 0; i < 2; i++) {
      const light = lights[i].current;
      const aim = aims[i].current;
      if (!light || !aim) continue;
      const side = i ? 1 : -1;
      aim.position.set(side * 2 + Math.sin(t * 0.7 + i * 2) * 0.6, 1.4, Math.sin(t * 0.5 + i) * 0.5);
      light.color.copy(RIM[(i + swap) % RIM.length]);
      light.intensity = 230 + beat.pulse * 70;
    }
  });
  return (
    <>
      <hemisphereLight args={['#4a46b8', '#080a24', 0.35]} />
      <directionalLight
        castShadow
        position={[6, 12, 5]}
        intensity={1.4}
        color="#dcecff"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-normalBias={0.02}
        shadow-bias={-0.0004}
      />
      {/* Narrow front key so the dancers' gel bodies read against the bright floor. */}
      <spotLight position={[0, 8.5, 9]} angle={0.3} penumbra={0.55} intensity={260} color="#eef6ff" />
      <Spot position={[-7, 8, -6]} target={[-2, 1.4, 0]} angle={0.42} penumbra={0.6} intensity={180} color={C.aqua} lightRef={lights[0]} aimRef={aims[0]} />
      <Spot position={[7, 8, -6]} target={[2, 1.4, 0]} angle={0.42} penumbra={0.6} intensity={180} color={C.magenta} lightRef={lights[1]} aimRef={aims[1]} />
    </>
  );
}

export default function ClubStage() {
  return (
    <>
      <StageCamera position={[0, 3.1, 12.6]} target={[0, 2.0, -1]} fov={44} orbit={[0.1, 0.025]} sway={[0.1, 0.06, 0]} />
      <color attach="background" args={[C.night]} />
      <fogExp2 attach="fog" args={['#080a2c', 0.032]} />
      <StageEnvironment top="#1c1f66" horizon="#2a2272" bottom="#05071c" lights={ENV_LIGHTS} intensity={1} />
      <ClubClock />
      <Lights />
      <Room />
      <DanceFloor />
      <VideoWall />
      <Aquarium />
      <DJBooth />
      <Speakers />
      <Crowd />
      <Chandelier />
      <Beams />
      <BubbleColumns />
      <Bar />
      <Particles />
    </>
  );
}
