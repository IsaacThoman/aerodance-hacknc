import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { beat, SceneCamera } from '../../shared/hooks.js';
import { CloudField, SkyDome } from '../../shared/Sky.jsx';
import { buildCity } from './city.js';
import { COLORS, FOG, SUN } from './layout.js';
import { cityUniforms, makeEnvironment } from './materials.js';
import { reactions } from './reactions.js';
import { EcoMenu } from './Menu.jsx';
import { Water, waterUniforms } from './Water.jsx';
import { Biodomes, CityMesh, Fountain, Globe, PlazaPool, Terrain, Trees } from './World.jsx';
import { AirTaxis, Birds, Blimp, Boats, BubbleBurst, FocusHalo, Pods, Sparkles, Train, Turbines } from './Life.jsx';

export const meta = {
  id: 'ecocity',
  name: 'Eco Metropolis',
  tone: 'light',
  post: {
    bloomStrength: 0.42,
    bloomRadius: 0.5,
    bloomThreshold: 0.92,
    exposure: 1.0,
    vignette: 0.2,
    saturation: 1.14,
    tint: [1.02, 1.0, 0.975],
  },
};

const TARGET = new THREE.Vector3(40, 78, -70);

function Environment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  // Effect-owned so StrictMode's mount/unmount/mount never reuses a disposed PMREM target.
  useEffect(() => {
    const env = makeEnvironment(gl, SUN);
    const prev = scene.environment;
    const prevIntensity = scene.environmentIntensity;
    scene.environment = env.texture;
    scene.environmentIntensity = 1;
    return () => {
      scene.environment = prev;
      scene.environmentIntensity = prevIntensity;
      env.dispose();
    };
  }, [gl, scene]);
  return null;
}

function Clock() {
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    cityUniforms.uTime.value = t;
    cityUniforms.uBeat.value = beat.pulse;
    waterUniforms.uTime.value = t;
    reactions.burst = Math.max(0, reactions.burst - dt * 0.8);
  });
  return null;
}

// Warm morning haze bleeding in from the sun just outside the frame (right).
function SunHaze() {
  const mesh = useRef();
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color('#ffd9a0') }, uStrength: { value: 0.42 } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uStrength;
          varying vec2 vUv;
          void main() {
            float d = length(vUv - 0.5) * 2.0;
            float g = pow(max(1.0 - d, 0.0), 2.2);
            gl_FragColor = vec4(uColor * g * uStrength, 1.0);
          }
        `,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame((state) => {
    // Keep it parked far away in a fixed direction relative to the world.
    const cam = state.camera.position;
    mesh.current.position.set(cam.x + 1900, cam.y + 650, cam.z - 2100);
    mesh.current.lookAt(cam);
  });
  return (
    <mesh ref={mesh} material={material} renderOrder={-900} frustumCulled={false}>
      <planeGeometry args={[4200, 4200]} />
    </mesh>
  );
}

// Slow cinematic orbit around the skyline.
function orbit(camera, state) {
  const t = state.clock.elapsedTime;
  const ang = Math.sin(t * 0.03) * 0.06;
  const dx = camera.position.x - TARGET.x;
  const dz = camera.position.z - TARGET.z;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  camera.position.x = TARGET.x + dx * c - dz * s;
  camera.position.z = TARGET.z + dx * s + dz * c;
  camera.position.y += Math.sin(t * 0.045) * 5;
  camera.lookAt(TARGET);
}

export default function EcoCityScene() {
  const city = useMemo(() => buildCity(), []);
  useEffect(() => () => city.geometry.dispose(), [city]);
  const sunPos = useMemo(() => SUN.clone().multiplyScalar(600).toArray(), []);
  return (
    <>
      <color attach="background" args={[COLORS.skyHorizon]} />
      <fog attach="fog" args={[COLORS.fog, FOG[0], FOG[1]]} />
      <SceneCamera position={[-20, 100, 450]} target={TARGET.toArray()} fov={42} near={1} far={6000} parallax={[6, 3]} sway={[3, 1.5, 0]} swaySpeed={0.6} onFrame={orbit} />
      <Environment />
      <Clock />
      <SkyDome top={COLORS.skyTop} horizon={COLORS.skyHorizon} bottom="#e8f7ff" exponent={0.4} sunDirection={SUN.toArray()} sunColor="#fff2d6" sunGlow={1.1} sunDisc={4} radius={4000} />
      <SunHaze />
      <CloudField count={9} center={[300, 760, -1900]} area={[4200, 500]} heightJitter={60} size={[340, 620]} speed={3} seed={23} fogColor={COLORS.skyHorizon} fogNear={1500} fogFar={4200} shade="#c3d9f0" opacity={0.6} renderOrder={-510} />
      <CloudField count={34} center={[150, 330, -1300]} area={[3600, 1200]} heightJitter={90} size={[260, 560]} speed={5} seed={11} fogColor={COLORS.skyHorizon} fogNear={900} fogFar={3600} shade="#a9c6e6" />
      <directionalLight position={sunPos} intensity={2.6} color="#ffe9cc" />
      <hemisphereLight args={['#cfe9ff', '#6f9a5a', 0.25]} />
      <CityMesh city={city} />
      <Terrain city={city} />
      <Trees city={city} />
      <Water />
      <Biodomes city={city} />
      <Globe city={city} />
      <PlazaPool city={city} />
      <Fountain city={city} />
      <Train city={city} />
      <Pods />
      <AirTaxis />
      <Blimp />
      <Birds />
      <Boats city={city} />
      <Turbines />
      <Sparkles city={city} />
      <FocusHalo />
      <BubbleBurst />
      <EcoMenu />
    </>
  );
}
