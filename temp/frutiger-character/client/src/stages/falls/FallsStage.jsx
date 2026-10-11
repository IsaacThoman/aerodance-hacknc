// Emerald Falls: a white gloss stage on a clifftop meadow above a turquoise
// lake fed by tepui waterfalls, with floating islands, a rainbow in the spray
// and a gentle touch of eco-tech (solar flowers, turbines, observatory).
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { StageEnvironment } from '../shared/Environment.jsx';
import { beat, reducedMotion, StageCamera, useDisposable } from '../shared/hooks.js';
import { post } from '../shared/post.jsx';
import { CloudField, SkyDome, useSunDirection } from '../shared/Sky.jsx';
import meta from './meta.js';
import { fx, HAZE, makeNoiseTexture, SUN, tickFalls } from './fx.js';
import { Meadow, Mesas, Mountains, Valley } from './Land.jsx';
import { GrassField, makeGrassMask, Wildflowers } from './Grass.jsx';
import { FloatingIslands, islandWisps } from './Islands.jsx';
import { Birds, Butterflies, Floaters } from './Life.jsx';
import { Balloons, Observatory, Turbines } from './Props.jsx';
import { FlowerBeds, Platform, SolarFlowers } from './Platform.jsx';
import { CAMERA, fallSites, OBSERVATORY } from './terrain.js';
import { layoutTrees, Trees } from './Trees.jsx';
import { Lake, Mist, Rainbow, River, Waterfalls } from './Water.jsx';

const SCULPTURES = [
  [-7.2, -0.6, 0.35],
  [7.2, -0.6, -0.35],
];
const BEDS = SCULPTURES.map(([x, z]) => ({ x, z, r: 1.25 }));

const FLOCKS = [
  { center: [-10, -10, -165], radius: 62, count: 9, speed: 0.11, size: 2.2, color: 0, spread: 1 },
  { center: [52, -2, -118], radius: 30, count: 5, speed: -0.16, size: 1.8, color: 0, spread: 0.8 },
  { center: [-6, 21, -46], radius: 24, count: 4, speed: 0.22, size: 0.7, color: 0, spread: 0.6 },
];
// Low cloud banks drifting in the valley below the clifftop (sells the height).
const VALLEY_WISPS = [
  [-36, -20, -62, 16], [-64, -25, -98, 22], [-22, -27, -112, 18], [44, -21, -70, 16], [76, -26, -104, 22], [26, -28, -124, 18],
].map(([x, y, z, s], i) => ({ c: [x, y, z], p: [s, 2, i / 6, 0.014], aspect: 2.6 }));
// Wind turbines on the far mesa tops, standing against the sky.
const TURBINES = [
  { x: 100, z: -508, y: 31, s: 0.7 }, { x: 128, z: -516, y: 31, s: 0.62 },
  { x: -34, z: -440, y: 21, s: 0.7 }, { x: 18, z: -452, y: 21, s: 0.6 },
  { x: -238, z: -352, y: 27, s: 0.75 }, { x: -210, z: -366, y: 27, s: 0.65 },
  { x: 244, z: -400, y: 23, s: 0.75 }, { x: 274, z: -392, y: 23, s: 0.65 },
];
const BALLOONS = [
  { p: [-18, 8, -64], s: 2.2, look: 1, drift: 4 },
  { p: [-120, 40, -330], s: 3, look: 0, drift: 10 },
];

function Driver() {
  useFrame((state) => {
    tickFalls(state.clock.elapsedTime, beat.pulse);
    // A soft bloom swell on the beat, like sunlight catching the spray.
    post.bloomStrength = meta.post.bloomStrength + beat.pulse * 0.05;
  });
  return null;
}

export default function FallsStage() {
  const sun = useSunDirection(SUN.elevation, SUN.azimuth);
  const noise = useDisposable(makeNoiseTexture);
  fx.uNoise.value = noise;
  fx.uSunDir.value.set(...sun).normalize();
  const sites = useMemo(fallSites, []);
  const trees = useMemo(() => layoutTrees([{ x: OBSERVATORY[0], z: OBSERVATORY[2], r: 11 }]), []);
  const sunPos = useMemo(() => sun.map((v) => v * 30), [sun]);
  const wisps = useMemo(() => [...islandWisps(), ...VALLEY_WISPS], []);
  const free = useMemo(() => makeGrassMask([...BEDS.map((b) => ({ ...b, r: b.r + 0.25 })), ...SCULPTURES.map(([x, z]) => ({ x, z, r: 0.4 }))]), []);

  return (
    <>
      <Driver />
      <StageCamera position={CAMERA.position} target={CAMERA.target} fov={CAMERA.fov} near={0.2} far={6000} orbit={reducedMotion ? [0, 0] : [0.09, 0.02]} sway={reducedMotion ? [0, 0, 0] : [0.1, 0.05, 0]} parallax={[0.3, 0.15]} />
      <color attach="background" args={[HAZE]} />
      <fog attach="fog" args={[HAZE, 0, 1300]} />
      <StageEnvironment
        top="#3d8fe8"
        horizon="#eefaff"
        bottom="#5c9a46"
        intensity={1}
        lights={[
          { position: sun.map((v) => v * 40), color: '#fff1d6', intensity: 7, size: [10, 10] },
          { position: [0, 45, 10], color: '#ffffff', intensity: 1.4, size: [40, 16] },
          { position: [30, 10, -30], color: '#c8f4ff', intensity: 1.6, size: [20, 10] },
        ]}
      />
      <SkyDome top="#1468dc" horizon="#c2e6ff" bottom="#dff3ff" exponent={0.42} sunDirection={sun} sunColor="#fff3d6" sunDisc={5} sunGlow={0.8} radius={4500} />
      <CloudField count={26} center={[0, 230, -1900]} area={[5200, 900]} heightJitter={60} size={[380, 720]} speed={3} seed={8} shade="#a8c8ec" fogColor="#d6effd" fogNear={1200} fogFar={3600} />
      <CloudField count={18} center={[0, 120, -700]} area={[2400, 500]} heightJitter={40} size={[160, 300]} speed={4.5} seed={4} shade="#a3c4ea" fogColor="#d6effd" fogNear={500} fogFar={2200} />

      <hemisphereLight args={['#cbe6ff', '#6f9b48', 0.8]} />
      <directionalLight
        castShadow
        position={sunPos}
        intensity={2.6}
        color="#fff1d8"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-camera-near={1}
        shadow-camera-far={70}
        shadow-normalBias={0.03}
        shadow-bias={-0.0004}
      />

      <Mountains />
      <Valley />
      <Mesas />
      <Lake />
      <River />
      <Trees layout={trees} />
      <Waterfalls sites={sites} />
      <Mist sites={sites} extra={wisps} />
      <Rainbow />
      <FloatingIslands />
      <Turbines sites={TURBINES} />
      <Observatory position={OBSERVATORY} cableTo={[92, -18, -118]} />
      <Balloons balloons={BALLOONS} />
      <Birds flocks={FLOCKS} />

      <Meadow />
      <Platform />
      <SolarFlowers sites={SCULPTURES} />
      <FlowerBeds beds={BEDS} />
      <GrassField free={free} />
      <Wildflowers free={free} />
      <Butterflies />
      <Floaters />
    </>
  );
}
