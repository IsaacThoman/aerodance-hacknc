import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, useFrame, useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import flockCameraUrl from '../aero/flock/flock-camera-world.glb?url';
import Character from '../../../packages/character/Character.jsx';
import { validateMotion } from '../../../packages/character/motion.js';
import motionUrl from '../../../packages/character/assets/dance.json?url';

/**
 * The two captured Frutiger dancers on a glass puck, pinned to the right of the screen.
 * They live in their own scene with a fixed camera, so they ride along with the drone
 * flight instead of being left behind in the city. Drawn after the world and before the
 * menu (useFrame priority 1.5); they slide off to the right while the menu is hidden.
 *
 * On Song Select the stage rises to the middle of the screen (`raised`, nothing sits above
 * it there), and in one-player mode a single dancer stands in the middle of it (`solo`).
 *
 * <MenuDancers visible raised solo />
 */

const DANCERS = [
  { x: -1.45, appearance: { color: '#078fff', gloss: 85, accessory: 'None' } },
  { x: 1.45, appearance: { color: '#b86bff', gloss: 85, accessory: 'None' } },
];
const PUCK = { r: 3.1, h: 0.26 };
// Stage placement in front of the fixed camera (looking down -Z), then turned to face it.
const STAGE = { x: 4.3, y: -2.6, z: -19, tilt: 0.2, turn: -0.22 };
const FLOCK_SCALE = 4;
// How far the stage rises when it's raised.
const RAISE = 1.5;
const SLIDE = 12;
// Easing approaches its target forever; snap once the remaining step is imperceptible.
const SPOT_EPSILON = 0.01;
const SOLO_HIDE_PROGRESS = 0.95;
const SOLO_FADE_SECONDS = 0.05;

function Environment({ scene }) {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    scene.environment = target.texture;
    room.dispose();
    pmrem.dispose();
    return () => {
      scene.environment = null;
      target.dispose();
    };
  }, [gl, scene]);
  return null;
}

function Puck() {
  return (
    <group renderOrder={-1}>
      <mesh position={[0, -PUCK.h / 2, 0]} renderOrder={-1}>
        <cylinderGeometry args={[PUCK.r, PUCK.r * 1.04, PUCK.h, 96]} />
        <meshPhysicalMaterial
          color="#c4f6ff"
          roughness={0.08}
          metalness={0.2}
          clearcoat={1}
          transparent
          opacity={0.6}
          depthWrite={false}
          envMapIntensity={1.6}
        />
      </mesh>
      <mesh position={[0, 0.002, 0]} rotation={[Math.PI / 2, 0, 0]} renderOrder={-1}>
        <torusGeometry args={[PUCK.r - 0.03, 0.045, 10, 128]} />
        <meshBasicMaterial color="#7affdc" transparent opacity={0.85} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
        <ringGeometry args={[PUCK.r * 0.8, PUCK.r * 0.81, 96]} />
        <meshBasicMaterial color="#38d7ed" transparent opacity={0.6} depthWrite={false} />
      </mesh>
    </group>
  );
}

function FlockCamera() {
  const { scene } = useLoader(GLTFLoader, flockCameraUrl);
  const model = useMemo(() => {
    const copy = scene.clone(true);
    const assembly = copy.getObjectByName('Flock_Falcon_World');
    const pole = copy.getObjectByName('Pole_|_simplified_12-foot_pole');
    const top = new THREE.Box3().setFromObject(copy, true).max.y;
    const poleHeight = new THREE.Box3().setFromObject(pole, true).max.y;
    // Enlarge the hardware uniformly and shorten the shaft to the original top height.
    const drop = top * (1 - 1 / FLOCK_SCALE);
    const upperParts = assembly.children.filter((part) => part !== pole);
    const lowerEnd = Math.min(...upperParts.map((part) => new THREE.Box3().setFromObject(part, true).min.y));
    // Give the exposed lower shaft 15% more length, raising the hardware with it.
    const extension = (lowerEnd - drop) * 0.15;
    for (const part of upperParts) part.position.y += extension - drop;
    pole.scale.y = (poleHeight - drop + extension) / poleHeight;
    pole.position.y *= pole.scale.y;
    return copy;
  }, [scene]);
  return (
    // The model faces +Z. Cancel the platform's turn to aim 30° toward screen left.
    <primitive object={model} position={[0, 0, -2.2]} rotation={[0, -Math.PI / 6 - STAGE.turn, 0]} scale={FLOCK_SCALE} dispose={null} />
  );
}

class Quiet extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.warn('Menu dancers could not load', err); }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function MenuDancers({ visible = true, raised = false, solo = false, androidConnected = false }) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const [motion, setMotion] = useState(null);
  const stage = useMemo(() => new THREE.Scene(), []);
  const cam = useMemo(() => new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 60), []);
  const rig = useRef(null);
  const playback = useRef(0);
  const shown = useRef(0);
  const lift = useRef(0);
  const spots = useRef([]);
  const purpleOpacity = useRef(1);
  const still = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(motionUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Dance capture unavailable');
        return response.json();
      })
      .then((data) => setMotion(validateMotion(data)))
      .catch((e) => { if (e.name !== 'AbortError') console.warn('Menu dancers could not load', e); });
    return () => controller.abort();
  }, []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    shown.current += ((visible ? 1 : 0) - shown.current) * Math.min(1, dt * (visible ? 2.5 : 5));
    if (!motion || !rig.current || shown.current < 0.005) return;
    if (!still) playback.current += dt;

    const t = state.clock.elapsedTime;
    const away = 1 - shown.current;
    // Rise and both dancers' steps to the middle ease in, unless the stage is off screen.
    const k = shown.current < 0.05 ? 1 : Math.min(1, dt * 4);
    lift.current += ((raised ? RAISE : 0) - lift.current) * k;
    // Converge twice as quickly while keeping the return split's existing timing.
    const move = solo ? Math.min(1, k * 2) : k;
    DANCERS.forEach((d, i) => {
      const spot = spots.current[i];
      if (!spot) return;
      const target = solo ? 0 : d.x;
      spot.position.x += (target - spot.position.x) * move;
      if (Math.abs(target - spot.position.x) < SPOT_EPSILON) spot.position.x = target;
      if (i === 1) {
        // Fade purple after convergence, and fade it back in as the dancers split out.
        const show = !solo || Math.abs(spot.position.x) > Math.abs(d.x) * (1 - SOLO_HIDE_PROGRESS);
        const targetOpacity = show ? 1 : 0;
        const fadeStep = dt / SOLO_FADE_SECONDS;
        purpleOpacity.current = Math.abs(targetOpacity - purpleOpacity.current) <= fadeStep + Number.EPSILON
          ? targetOpacity
          : purpleOpacity.current + (show ? fadeStep : -fadeStep);
        spot.visible = purpleOpacity.current > 0;
      }
    });
    rig.current.position.set(
      STAGE.x + away * away * SLIDE,
      STAGE.y + lift.current + (still ? 0 : Math.sin(t * 1.3) * 0.06),
      STAGE.z,
    );
    rig.current.rotation.set(STAGE.tilt, STAGE.turn, still ? 0 : Math.sin(t * 0.7) * 0.012);
  }, 0.5);

  useFrame(() => {
    if (!motion || !rig.current || shown.current < 0.005) return;
    // Match the world camera's aspect so the stretch to 16:9 is shared.
    if (cam.aspect !== camera.aspect) { cam.aspect = camera.aspect; cam.updateProjectionMatrix(); }
    const ac = gl.autoClear;
    const tm = gl.toneMapping;
    gl.autoClear = false;
    // The gel material was tuned under ACES in the prototype; the world itself renders untoned.
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.clearDepth();
    gl.render(stage, cam);
    gl.toneMapping = tm;
    gl.autoClear = ac;
  }, 1.5);

  if (!motion) return null;
  return createPortal(
    <>
      <Environment scene={stage} />
      <hemisphereLight args={['#d9faff', '#489789', 1.3]} />
      <directionalLight position={[-6, 12, 8]} intensity={2.5} />
      <pointLight position={[0, 1.3, 3]} color="#65f7ff" intensity={8} distance={9} />
      <group ref={rig} position={[STAGE.x + SLIDE, STAGE.y, STAGE.z]}>
        {androidConnected && (
          <Quiet>
            <Suspense fallback={null}>
              <FlockCamera />
            </Suspense>
          </Quiet>
        )}
        <Quiet>
          <Suspense fallback={null}>
            <Puck />
            {DANCERS.map((d, person) => (
              <group
                key={person}
                ref={(g) => { spots.current[person] = g; }}
                position={[d.x, 0, 0]}
                scale={[-1, 1, 1]}
              >
                <Character
                  motion={motion}
                  person={person}
                  playback={playback}
                  appearance={d.appearance}
                  opacityRef={person === 1 ? purpleOpacity : undefined}
                />
              </group>
            ))}
          </Suspense>
        </Quiet>
      </group>
    </>,
    stage,
  );
}
