import { useFrame } from '@react-three/fiber';
import { StageCamera, beat, reducedMotion } from '../shared/hooks.js';
import { post } from '../shared/post.jsx';
import { StageEnvironment } from '../shared/Environment.jsx';
import { SUN_DIR, WATER_Y, world } from './palette.js';
import { SunFlare, SunsetClouds, SunsetSky } from './Sky.jsx';
import { Sea } from './Sea.jsx';
import { Beach } from './Beach.jsx';
import { Torches } from './Torches.jsx';
import { Vista } from './Vista.jsx';
import { Life } from './Life.jsx';
import meta from './meta.js';

const BLOOM = meta.post.bloomStrength;

const sunPanel = SUN_DIR.clone().multiplyScalar(40).toArray();

// Warm sunset reflections for the glass dancers: the sun low ahead of them,
// a soft pink-white sky behind the camera for front fill.
const ENV_LIGHTS = [
  { position: sunPanel, color: '#ffc878', intensity: 9, size: [9, 5] },
  { position: [0, 16, 34], color: '#ffe0ea', intensity: 2.8, size: [48, 18] },
  // Low, wide warm glow behind the camera: what the dancers' torsos reflect.
  { position: [0, 4, 34], color: '#ffe4cc', intensity: 5.5, size: [80, 16] },
  { position: [-32, 8, 6], color: '#ffa8c4', intensity: 1.3, size: [14, 10] },
  { position: [30, 10, 4], color: '#bfa8ff', intensity: 1.1, size: [14, 10] },
];

function Clock() {
  useFrame((state) => {
    const t = reducedMotion ? 0 : state.clock.elapsedTime;
    world.uTime.value = t;
    world.uBeat.value = beat.pulse;
    // The sea breathes up and down so the swash laps at the sand.
    world.uWaterY.value = WATER_Y + 0.035 * Math.sin(t * 0.95 + 0.4) + 0.012 * Math.sin(t * 2.1);
    // Bloom breathes a little with the beat.
    post.bloomStrength = BLOOM * (1 + 0.18 * beat.pulse);
  });
  return null;
}

export default function BeachStage() {
  return (
    <>
      <Clock />
      <StageCamera position={[0, 1.79, 16]} target={[0, 1.24, 1]} fov={35} near={0.3} far={3000} orbit={[0.04, 0.012]} sway={[0.12, 0.05, 0]} />
      <StageEnvironment top="#7286d8" horizon="#ffb48c" bottom="#d8b083" lights={ENV_LIGHTS} intensity={1} />
      <hemisphereLight args={['#b8a0f0', '#c98a5f', 0.36]} />
      <directionalLight
        castShadow
        position={[2.5, 8, -12]}
        color="#ff9a50"
        intensity={2.3}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-camera-near={1}
        shadow-camera-far={45}
        shadow-normalBias={0.03}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-4, 6, 12]} color="#ffbfd2" intensity={0.48} />
      <SunsetSky />
      <SunsetClouds count={18} center={[0, 125, -1250]} area={[3000, 500]} heightJitter={45} size={[170, 360]} speed={3} seed={5} />
      <SunsetClouds count={12} center={[0, 215, -950]} area={[2400, 300]} heightJitter={35} size={[110, 230]} speed={4.5} seed={19} opacity={0.9} renderOrder={-499} />
      <Sea />
      <Vista />
      <Beach />
      <Torches />
      <Life />
      <SunFlare />
    </>
  );
}
