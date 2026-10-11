import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { beat, useDisposable } from '../shared/hooks.js';
import { patchClub } from './patch.js';
import { gelMaterial } from './gel.js';
import { arcTube, blobGeometry } from './geometry.js';
import { FLOOR } from './layout.js';

const BOOTH = [0, 0, -8.3];
const RISER_TOP = 0.45;
const DESK_R = 2.3;
const DESK_TOP = 1.8;
const DJ_W = 1.45;
const DJ_H = 2.3;
const DJ_Z = BOOTH[2] - 0.6;
const DESK_ARC = (130 * Math.PI) / 180;

const deskEmissive = /* glsl */ `
  vec3 l = vClubWorld - vec3(${BOOTH[0].toFixed(2)}, 0.0, ${BOOTH[2].toFixed(2)});
  float a = atan(l.x, l.z);
  float y = vClubWorld.y;
  float s = a * ${DESK_R.toFixed(2)};
  float band = exp(-pow((y - 0.75) * 26.0, 2.0));
  float top = exp(-pow((y - ${(DESK_TOP - 0.15).toFixed(2)}) * 30.0, 2.0));
  float chase = 0.5 + 0.5 * sin(s * 9.0 - uTime * 6.0);
  // Aero bubble logo on the front.
  vec2 q = vec2(s, y - 1.22);
  float r = length(q);
  float ring = exp(-pow((r - 0.3) * 26.0, 2.0)) + smoothstep(0.2, 0.14, length(q - vec2(-0.07, 0.07))) * 0.5;
  // Swoosh either side of the logo.
  float sw = exp(-pow((y - 1.22 - 0.15 * sin(s * 2.4 + uTime)) * 20.0, 2.0)) * smoothstep(0.4, 0.7, abs(s));
  vec3 c = vec3(0.2, 0.9, 1.0) * band * (0.6 + 0.8 * chase) + vec3(1.0, 0.35, 0.85) * top * (0.8 + 0.6 * uPulse);
  c += mix(vec3(0.3, 1.0, 1.0), vec3(0.6, 1.0, 0.3), smoothstep(-0.2, 0.2, q.y)) * ring * (0.9 + uPulse);
  c += clubHue(s * 0.2 + uTime * 0.05) * sw * 0.7;
  totalEmissiveRadiance += c * 1.6;
`;

// Position on the desk top at an angle (degrees) around the booth.
function deskAt(deg, r = DESK_R - 0.42) {
  const a = (deg * Math.PI) / 180;
  return [BOOTH[0] + Math.sin(a) * r, BOOTH[2] + Math.cos(a) * r, -a];
}

function makeDeskGeometry() {
  const start = -DESK_ARC / 2;
  return {
    front: new THREE.CylinderGeometry(DESK_R, DESK_R + 0.12, DESK_TOP - RISER_TOP, 64, 1, true, start, DESK_ARC).translate(0, (DESK_TOP + RISER_TOP) / 2, 0),
    top: new THREE.RingGeometry(DESK_R - 0.75, DESK_R + 0.06, 48, 1, 0, DESK_ARC).rotateX(-Math.PI / 2).rotateY(start - Math.PI / 2).translate(0, DESK_TOP, 0),
    lip: arcTube(DESK_R + 0.04, start, DESK_ARC, 0.05, DESK_TOP, 48),
    riser: new THREE.CylinderGeometry(2.9, 3.0, RISER_TOP - FLOOR, 64, 1, false).translate(0, (RISER_TOP + FLOOR) / 2, 0),
    riserRim: new THREE.TorusGeometry(2.92, 0.04, 6, 64).rotateX(Math.PI / 2).translate(0, RISER_TOP, 0),
  };
}

function Turntable({ parts, x, z, angle, flip }) {
  const platter = useRef();
  useFrame((_, delta) => {
    platter.current.rotation.y -= delta * 3.6 * flip;
  });
  return (
    <group position={[x, DESK_TOP, z]} rotation={[0, angle, 0]}>
      <mesh geometry={parts.geo.deck} material={parts.mats.deck} position={[0, 0.05, 0]} />
      <group ref={platter} position={[0, 0.12, 0]}>
        <mesh geometry={parts.geo.platter} material={parts.mats.platter} />
        <mesh geometry={parts.geo.strobe} material={parts.mats.strobe} position={[0.34, 0.03, 0]} />
        <mesh geometry={parts.geo.strobe} material={parts.mats.strobe} position={[-0.34, 0.03, 0]} />
      </group>
      <mesh geometry={parts.geo.arm} material={parts.mats.chrome} position={[0.36, 0.19, -0.22]} rotation={[0, 0.5, 0]} />
    </group>
  );
}

function DJ({ parts }) {
  const body = useRef();
  const handL = useRef();
  const handR = useRef();
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const p = beat.pulse;
    const b = body.current;
    b.scale.set(1 + p * 0.05, 1 - p * 0.07, 1 + p * 0.05);
    b.rotation.x = 0.12 * p;
    b.rotation.z = Math.sin(t * 1.3) * 0.05;
    b.position.y = RISER_TOP + 0.05 * Math.sin(beat.phase * Math.PI);
    // One hand scratches, the other pumps the air every other bar.
    handL.current.position.set(-0.75 + Math.sin(t * 9) * 0.07, DESK_TOP + 0.12, 0.85);
    const hype = beat.bar % 2 === 1 ? 1 : 0;
    handR.current.position.set(0.8, DESK_TOP + 0.15 + hype * (0.75 + 0.3 * p), 0.7 - hype * 0.3);
  });
  const head = DJ_H * 0.74;
  return (
    <group position={[BOOTH[0], 0, DJ_Z]}>
      <group ref={body}>
        <mesh geometry={parts.geo.blob} material={parts.mats.dj} scale={[DJ_W, DJ_H, DJ_W * 0.9]} />
        {/* Visor shades and headphones. */}
        <mesh geometry={parts.geo.visor} material={parts.mats.visor} position={[0, head, 0.5]} />
        <mesh geometry={parts.geo.band} material={parts.mats.white} position={[0, head, 0]} />
        <mesh geometry={parts.geo.cup} material={parts.mats.white} position={[-0.6, head, 0]} rotation={[0, 0, Math.PI / 2]} />
        <mesh geometry={parts.geo.cup} material={parts.mats.white} position={[0.6, head, 0]} rotation={[0, 0, -Math.PI / 2]} />
      </group>
      <mesh ref={handL} geometry={parts.geo.hand} material={parts.mats.dj} />
      <mesh ref={handR} geometry={parts.geo.hand} material={parts.mats.dj} />
    </group>
  );
}

export default function DJBooth() {
  const parts = useDisposable(() => {
    const mats = {
      desk: patchClub(new THREE.MeshPhysicalMaterial({ color: '#c9d3f2', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0.45 }), {
        key: 'dj-desk',
        emissive: deskEmissive,
        dots: 0.6,
      }),
      top: new THREE.MeshPhysicalMaterial({ color: '#141a4a', roughness: 0.2, clearcoat: 1 }),
      riser: patchClub(new THREE.MeshPhysicalMaterial({ color: '#10175a', roughness: 0.25, clearcoat: 1, envMapIntensity: 0.5 }), {
        key: 'dj-riser',
        emissive: /* glsl */ `
          float y = vClubWorld.y;
          float a = atan(vClubWorld.x - ${BOOTH[0].toFixed(2)}, vClubWorld.z - ${BOOTH[2].toFixed(2)});
          float k = fract(a * 6.0 - uBeat * 0.5);
          totalEmissiveRadiance += vec3(0.5, 0.35, 1.0) * exp(-pow((y - ${(FLOOR + 0.35).toFixed(2)}) * 20.0, 2.0)) * (0.6 + 0.8 * step(0.5, k));
        `,
        dots: 0.8,
      }),
      chrome: new THREE.MeshStandardMaterial({ color: '#e4ecff', metalness: 1, roughness: 0.12 }),
      deck: new THREE.MeshPhysicalMaterial({ color: '#d9e3f7', roughness: 0.25, clearcoat: 1 }),
      platter: patchClub(new THREE.MeshPhysicalMaterial({ color: '#0b0e22', roughness: 0.2, clearcoat: 1 }), {
        key: 'dj-platter',
        emissive: 'totalEmissiveRadiance += vec3(0.2, 0.9, 1.0) * (1.0 - abs(normalize(vClubNormal).y)) * (1.2 + uPulse);',
      }),
      strobe: new THREE.MeshBasicMaterial({ color: new THREE.Color('#bff8ff').multiplyScalar(3) }),
      mixer: patchClub(new THREE.MeshPhysicalMaterial({ color: '#1a2050', roughness: 0.3, clearcoat: 1 }), {
        key: 'dj-mixer',
        emissive: /* glsl */ `
          vec2 g = fract(vClubWorld.xy * vec2(14.0, 18.0)) - 0.5;
          float led = smoothstep(0.3, 0.1, length(g)) * step(0.5, hash12(floor(vClubWorld.xy * vec2(14.0, 18.0)) + floor(uBeat * 2.0)));
          totalEmissiveRadiance += clubHue(vClubWorld.x * 0.8 + 0.2) * led * 2.0;
        `,
      }),
      lid: new THREE.MeshPhysicalMaterial({ color: '#dfe6f5', metalness: 0.6, roughness: 0.2, clearcoat: 1 }),
      logo: new THREE.MeshBasicMaterial({ color: new THREE.Color('#c8fbff').multiplyScalar(2.4) }),
      dj: gelMaterial({ key: 'dj', color: '#7dff4a', rim: 1.6 }),
      visor: new THREE.MeshPhysicalMaterial({ color: '#05060f', roughness: 0.05, metalness: 0.4, clearcoat: 1, envMapIntensity: 2 }),
      white: new THREE.MeshPhysicalMaterial({ color: '#f4f8ff', roughness: 0.2, clearcoat: 1 }),
    };
    const geo = {
      ...makeDeskGeometry(),
      deck: new RoundedBoxGeometry(1.0, 0.14, 0.8, 2, 0.05),
      platter: new THREE.CylinderGeometry(0.37, 0.37, 0.06, 32),
      strobe: new THREE.SphereGeometry(0.025, 6, 4),
      arm: new THREE.BoxGeometry(0.03, 0.03, 0.34),
      mixer: new RoundedBoxGeometry(0.6, 0.2, 0.62, 2, 0.05),
      laptopBase: new RoundedBoxGeometry(0.75, 0.035, 0.52, 2, 0.014),
      lid: new RoundedBoxGeometry(0.75, 0.5, 0.03, 2, 0.012),
      blob: blobGeometry(24),
      visor: new THREE.CapsuleGeometry(0.13, 0.6, 4, 12).rotateZ(Math.PI / 2).scale(1, 0.9, 0.5),
      band: new THREE.TorusGeometry(0.62, 0.045, 8, 32, Math.PI),
      cup: new THREE.CylinderGeometry(0.2, 0.2, 0.14, 20),
      hand: new THREE.SphereGeometry(0.16, 16, 12),
      logo: new THREE.CircleGeometry(0.06, 20),
    };
    return { mats, geo };
  });
  const { mats, geo } = parts;
  const [lx, lz] = deskAt(56);
  // Lid on the far side from the DJ, its glowing logo facing the room.
  const lidYaw = Math.atan2(lx - BOOTH[0], lz - DJ_Z);

  return (
    <group>
      <mesh geometry={geo.riser} material={mats.riser} position={[BOOTH[0], 0, BOOTH[2]]} receiveShadow />
      <mesh geometry={geo.riserRim} material={mats.chrome} position={[BOOTH[0], 0, BOOTH[2]]} />
      <group position={[BOOTH[0], 0, BOOTH[2]]}>
        <mesh geometry={geo.front} material={mats.desk} />
        <mesh geometry={geo.top} material={mats.top} />
        <mesh geometry={geo.lip} material={mats.chrome} />
      </group>
      {[-26, 26].map((deg, i) => {
        const [x, z, a] = deskAt(deg);
        return <Turntable key={deg} parts={parts} x={x} z={z} angle={a} flip={i ? -1 : 1} />;
      })}
      <mesh geometry={geo.mixer} material={mats.mixer} position={[BOOTH[0], DESK_TOP + 0.08, BOOTH[2] + DESK_R - 0.42]} />
      <group position={[lx, DESK_TOP, lz]} rotation={[0, lidYaw, 0]}>
        <mesh geometry={geo.laptopBase} material={mats.lid} position={[0, 0.02, 0]} />
        <group position={[0, 0.03, 0.24]} rotation={[0.25, 0, 0]}>
          <mesh geometry={geo.lid} material={mats.lid} position={[0, 0.25, 0]} />
          <mesh geometry={geo.logo} material={mats.logo} position={[0, 0.27, 0.017]} />
        </group>
      </group>
      <DJ parts={parts} />
    </group>
  );
}
