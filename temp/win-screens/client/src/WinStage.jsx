import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Character from '../../../frutiger-character/client/src/Character.jsx';
import { DANCER_LOOKS } from '../../../frutiger-character/client/src/stages/shared/Dancers.jsx';
import modelUrl from '../../../frutiger-character/client/public/models/aero-character.glb?url';
import { PLAYERS, REVEAL, easeOut, timeline } from './results.js';

/*
 * The 3D side of a win screen, on top of one of the dance stages:
 *   - win: the winner steps up to centre stage under a light column, on a glowing halo in
 *     their colour, with confetti; the other dancer steps back and shrinks a little.
 *   - tie: both dancers stay side by side on gold halos.
 *   - solo: the one dancer takes centre stage.
 * Everything animates from the dance-floor positions to the result at the reveal.
 */

const FOOT_CLEARANCE = 0.015;
const GOLD = '#ffd34d';

function Halo({ color, intensity }) {
  const ring = useRef();
  const glow = useRef();
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: 0 }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 uColor; uniform float uK, uTime; varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float disc = smoothstep(1.0, 0.0, r) * 0.55;
        float rings = smoothstep(0.08, 0.0, abs(fract(r * 2.0 - uTime * 0.6) - 0.5) - 0.38) * smoothstep(1.0, 0.6, r);
        gl_FragColor = vec4(uColor * (disc + rings * 0.8) * uK * 1.0, 1.0);
      }
    `,
  }), [color]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame((s) => {
    const k = intensity.current;
    material.uniforms.uK.value = k;
    material.uniforms.uTime.value = s.clock.elapsedTime;
    ring.current.scale.setScalar(0.6 + 0.4 * k);
    ring.current.material.opacity = k;
    glow.current.visible = k > 0.01;
  });
  return (
    <group position={[0, 0.02, 0]}>
      <mesh ref={glow} rotation={[-Math.PI / 2, 0, 0]} material={material} renderOrder={3}>
        <planeGeometry args={[3.6, 3.6]} />
      </mesh>
      <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]} renderOrder={4}>
        <torusGeometry args={[1.25, 0.05, 10, 96]} />
        <meshBasicMaterial color={color} transparent opacity={0} toneMapped={false} />
      </mesh>
    </group>
  );
}

function LightColumn({ color, intensity }) {
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    // Back faces only: the column glows behind the dancer instead of washing over them.
    side: THREE.BackSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: 0 } },
    vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main() { vY = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = mv.xyz; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uColor; uniform float uK; varying float vY; varying vec3 vN; varying vec3 vV; void main() { float edge = pow(abs(dot(normalize(vN), normalize(-vV))), 1.4); gl_FragColor = vec4(uColor * edge * (1.0 - vY) * 0.24 * uK, 1.0); }',
  }), [color]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => { material.uniforms.uK.value = intensity.current; });
  return (
    <mesh material={material} position={[0, 6, 0]} renderOrder={5}>
      <cylinderGeometry args={[1.5, 1.1, 12, 40, 1, true]} />
    </mesh>
  );
}

const CONFETTI = 160;
function Confetti({ colors, show }) {
  const mesh = useRef();
  const pieces = useMemo(() => Array.from({ length: CONFETTI }, () => ({
    x: (Math.random() - 0.5) * 9,
    z: (Math.random() - 0.5) * 4,
    y0: 6 + Math.random() * 6,
    v: 1.2 + Math.random() * 1.4,
    sway: Math.random() * 6.28,
    spin: (Math.random() - 0.5) * 8,
    delay: Math.random() * 2.5,
  })), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const geometry = useMemo(() => new THREE.PlaneGeometry(0.12, 0.2), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useEffect(() => {
    const c = new THREE.Color();
    for (let i = 0; i < CONFETTI; i++) mesh.current.setColorAt(i, c.set(colors[i % colors.length]));
    mesh.current.instanceColor.needsUpdate = true;
  }, [colors]);
  useFrame((state) => {
    const s = show.current;
    const t = timeline(s, state.clock.elapsedTime).t - REVEAL;
    pieces.forEach((p, i) => {
      const age = t - p.delay * 0.4;
      // Falls from above after the reveal, then keeps drifting down on a loop.
      const fall = age < 0 ? -100 : (age * p.v) % 14;
      dummy.position.set(p.x + Math.sin(age * 1.7 + p.sway) * 0.4, p.y0 - fall - 2, p.z);
      dummy.rotation.set(age * p.spin, age * p.spin * 0.7, age * 0.9);
      dummy.scale.setScalar(age < 0 ? 0 : 1);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, CONFETTI]} frustumCulled={false} />;
}

/**
 * show: ref of { start, results, winner, mode }
 * floor: the stage's meta.dancers ({ position, rotationY, spacing, scale })
 */
export default function WinStage({ motion, playback, show, floor, accent }) {
  const { position = [0, 0, 0], rotationY = 0, spacing = 4, scale = 1 } = floor;
  const s0 = show.current;
  const solo = s0.results.length === 1;
  const seats = solo ? [0] : [0, 1];
  const groups = [useRef(), useRef()];
  const halo = [useRef(0), useRef(0)];
  const column = useRef(0);
  const winColor = s0.winner === null ? GOLD : PLAYERS[s0.winner].color;
  const confettiColors = useMemo(() => (s0.winner === null ? [GOLD, '#ffffff', accent[0]] : [PLAYERS[s0.winner].color, PLAYERS[s0.winner].light, '#ffffff', accent[0], GOLD]), [s0.winner, accent]);

  useFrame((state) => {
    const s = show.current;
    // k: the walk to the result spots (slow, eased at both ends); glow: halo and column fade-in.
    const { reveal, step: k } = timeline(s, state.clock.elapsedTime);
    const glow = easeOut(reveal);
    seats.forEach((seat) => {
      const g = groups[seat].current;
      if (!g) return;
      const start = solo ? 0 : (seat === 0 ? -1 : 1) * (spacing / 2);
      let x = start;
      let z = 0;
      let sc = 1;
      if (solo) z = 0.6 * k;
      else if (s.winner === seat) { x = start * (1 - k); z = 0.8 * k; }
      else if (s.winner !== null) { x = start * (1 + 0.55 * k); z = -1.6 * k; sc = 1 - 0.15 * k; }
      g.position.set(x, 0, z);
      g.scale.setScalar(sc);
      const lit = solo || s.winner === null || s.winner === seat;
      halo[seat].current = lit ? glow : 0;
    });
    column.current = (solo || s.winner !== null ? 1 : 0) * glow;
  });

  // The halo, column and confetti follow the featured dancer (or sit between them on a tie).
  const featured = solo ? 0 : s0.winner;

  return (
    <group position={[position[0], position[1] + FOOT_CLEARANCE * scale, position[2]]} rotation={[0, rotationY, 0]} scale={scale}>
      <Suspense fallback={null}>
        {seats.map((seat) => (
          <group key={seat} ref={groups[seat]}>
            <Character url={modelUrl} motion={motion} person={seat} playback={playback} appearance={DANCER_LOOKS[seat]} />
            <Halo color={featured === null ? GOLD : PLAYERS[seat].color} intensity={halo[seat]} />
          </group>
        ))}
      </Suspense>
      {featured !== null && (
        <group position={[0, 0, solo ? 0.6 : 0.8]}>
          <LightColumn color={winColor} intensity={column} />
        </group>
      )}
      <Confetti colors={confettiColors} show={show} />
    </group>
  );
}
