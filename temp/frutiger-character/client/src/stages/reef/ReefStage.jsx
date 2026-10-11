import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { StageCamera, beat } from '../shared/hooks.js';
import { StageEnvironment } from '../shared/Environment.jsx';
import { post } from '../shared/post.jsx';
import meta from './meta.js';
import { makeShared } from './shaders.js';
import { CAMERA, OPEN_CAMERA, SUN_TRAVEL, SURFACE_Y } from './constants.js';
import { Reef, VENTS, makeFloorHeight } from './Reef.jsx';
import { DOME_BUBBLES, Dome, domeSparklePoints } from './Dome.jsx';
import { Life } from './Life.jsx';
import { Bubbles, GodRays, MarineSnow, Sparkles, WaterBackground } from './Water.jsx';

const SUN_POSITION = SUN_TRAVEL.map((v) => -v * 15);

// The glass dancers mostly reflect this, so it stays bright and aqua all
// round (a dark lower half makes their gel read murky).
const ENV_LIGHTS = [
  // The bright surface overhead, a sun-shaft panel, aqua bounce from the reef
  // and a soft front fill that keeps the dancers' gel luminous.
  { position: [0, 24, 4], color: '#f2ffff', intensity: 5, size: [26, 26] },
  { position: [-14, 16, 2], color: '#fffbe8', intensity: 4, size: [6, 10] },
  { position: [-18, 3, 6], color: '#5ff0ff', intensity: 1.8, size: [8, 10] },
  { position: [18, 4, -4], color: '#7fe8ff', intensity: 1.6, size: [8, 10] },
  { position: [0, 5, 22], color: '#8feaff', intensity: 1.0, size: [14, 7] },
];

/**
 * "Coral Dome": a glass dance hall resting on a sunlit tropical reef ~10 m down.
 * With dome={false} ("Open Reef") the dancers stand on the open sand instead.
 */
export default function ReefStage({ dome = true }) {
  const shared = useMemo(() => makeShared(), []);
  const floorHeight = useMemo(() => makeFloorHeight(), []);
  const sparkles = useMemo(() => (dome ? domeSparklePoints() : null), [dome]);
  const bubbleSources = useMemo(() => [...VENTS, ...(dome ? DOME_BUBBLES : [])].map((s) => ({ top: SURFACE_Y - 0.1, ...s })), [dome]);

  useFrame((state) => {
    shared.uTime.value = state.clock.elapsedTime;
    shared.uBeat.value = beat.pulse;
    shared.uBeatPhase.value = beat.phase;
    post.bloomStrength = meta.post.bloomStrength + beat.pulse * 0.04;
  });

  return (
    <>
      <StageCamera {...(dome ? CAMERA : OPEN_CAMERA)} far={600} orbit={[0.1, 0.025]} sway={[0.12, 0.06, 0]} />
      <color attach="background" args={['#0f8cc8']} />
      <StageEnvironment top="#e6ffff" horizon="#34b2e6" bottom="#2a86bc" lights={ENV_LIGHTS} intensity={1.05} />
      <hemisphereLight args={['#b0f4ff', '#1e6f9e', 0.45]} />
      <directionalLight
        castShadow
        position={SUN_POSITION}
        intensity={3}
        color="#e2fcff"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-camera-near={2}
        shadow-camera-far={30}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <WaterBackground shared={shared} />
      <Reef shared={shared} floorHeight={floorHeight} dome={dome} />
      {dome && <Dome shared={shared} floorHeight={floorHeight} />}
      <Life shared={shared} />
      <GodRays shared={shared} />
      <Bubbles shared={shared} sources={bubbleSources} />
      <MarineSnow shared={shared} />
      {sparkles && <Sparkles shared={shared} points={sparkles} />}
    </>
  );
}
