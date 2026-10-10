import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { SceneCamera, useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { SkyDome, useSunDirection } from '../../shared/Sky.jsx';
import { MeadowClouds } from './Clouds.jsx';
import { lightUniforms, makeNoiseTexture, tickMeadow, windUniforms } from './fx.js';
import { Birds, Butterflies, DandelionSeeds, LensFlare } from './Critters.jsx';
import { Ground } from './Ground.jsx';
import { GrassField, Wildflowers } from './Grass.jsx';
import { MeadowMenu } from './Menu.jsx';
import { Balloon, Gazebo, MusicNotes, SkyEnvironment, Turbines, turbineSites } from './Props.jsx';
import { CAMERA_POS, GAZEBO, heightAt, TREE } from './terrain.js';
import { Tree, TreeClumps } from './Tree.jsx';

export const meta = {
  id: 'meadow',
  name: 'Breezy Meadow',
  tone: 'light',
  post: {
    bloomStrength: 0.36,
    bloomRadius: 0.38,
    bloomThreshold: 0.93,
    exposure: 1.0,
    vignette: 0.1,
    saturation: 1.12,
  },
};

const HAZE = '#cde9fb';

function Driver({ sun }) {
  useFrame((state) => {
    tickMeadow(state.clock.elapsedTime);
    lightUniforms.uSunView.value.set(...sun);
  });
  return null;
}

function backgroundTrees() {
  const rand = makeRandom(404);
  const trees = [];
  let guard = 0;
  while (trees.length < 46 && guard++ < 2000) {
    const x = rand.range(-260, 220);
    const z = rand.range(-270, -120);
    const y = heightAt(x, z);
    if (y < 8) continue;
    // Keep clear of the turbine line and the hero tree.
    if (Math.abs(x - TREE.x) < 25 && Math.abs(z - TREE.z) < 30) continue;
    trees.push({ x, y: y - 0.3, z, s: rand.range(0.9, 1.6), shade: rand.next() });
    // Little clusters.
    if (rand.chance(0.5)) trees.push({ x: x + rand.range(3, 6), y: heightAt(x + 4, z + 2) - 0.3, z: z + rand.range(-2, 3), s: rand.range(0.7, 1.2), shade: rand.next() });
  }
  return trees;
}

export default function MeadowScene() {
  const sun = useSunDirection(15.7, -28.4);
  const noiseTex = useDisposable(makeNoiseTexture);
  windUniforms.uNoise.value = noiseTex;
  const sites = useMemo(turbineSites, []);
  const trees = useMemo(backgroundTrees, []);
  return (
    <>
      <color attach="background" args={[HAZE]} />
      <fogExp2 attach="fog" args={[HAZE, 0.0016]} />
      <SceneCamera
        position={CAMERA_POS}
        target={[0, CAMERA_POS[1] + 4.5, -70]}
        fov={45}
        near={0.1}
        far={5000}
        parallax={[0.5, 0.18]}
        sway={[0.12, 0.05, 0]}
      />
      <Driver sun={sun} />
      <SkyEnvironment />
      <SkyDome
        top="#1561d6"
        horizon="#bfe6ff"
        bottom="#d9f1ff"
        exponent={0.6}
        sunDirection={sun}
        sunColor="#fff3d1"
        sunDisc={4}
        sunGlow={0.45}
        sunSize={1.1}
        radius={3000}
      />
      <MeadowClouds
        sun={sun}
        count={22}
        center={[0, 95, -1500]}
        area={[3400, 500]}
        heightJitter={30}
        size={[320, 620]}
        speed={2.5}
        seed={12}
        shade="#a9c9ea"
        fogColor="#d4eeff"
        fogNear={900}
        fogFar={2400}
        opacity={0.95}
      />
      <MeadowClouds
        sun={sun}
        count={30}
        center={[0, 175, -700]}
        area={[2200, 600]}
        heightJitter={45}
        size={[170, 360]}
        speed={4}
        seed={5}
        shade="#9dbfe6"
        fogColor="#d4eeff"
        fogNear={500}
        fogFar={1900}
      />
      <hemisphereLight args={['#cfe9ff', '#90a874', 1.1]} />
      <directionalLight position={[-45, 72, 25]} intensity={2.4} color="#fff1d6" />
      <Ground />
      <GrassField />
      <Wildflowers />
      <Tree position={[TREE.x, TREE.y - 0.5, TREE.z]} scale={1.25} />
      <TreeClumps trees={trees} />
      <Gazebo position={[GAZEBO.x, GAZEBO.y - 0.15, GAZEBO.z]} rotation={0.4} />
      <MusicNotes origin={[GAZEBO.x, GAZEBO.y + 4.2, GAZEBO.z]} />
      <Turbines sites={sites} />
      <Balloon />
      <Butterflies />
      <Birds />
      <DandelionSeeds />
      <LensFlare sun={sun} />
      <MeadowMenu />
    </>
  );
}
