import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { patchClub } from './patch.js';
import { mergeAll } from './geometry.js';
import { CEILING, FLOOR, PILLARS, ROOM_R, TANK, TANK_CENTERS, polar } from './layout.js';

// Dark glossy club floor with glowing inlay rings around the stage.
const floorEmissive = /* glsl */ `
  float r = length(vClubWorld.xz);
  float a = atan(vClubWorld.z, vClubWorld.x);
  float ring1 = exp(-pow((r - 7.2) * 9.0, 2.0));
  float ring2 = exp(-pow((r - 10.4) * 9.0, 2.0));
  float flow = 0.6 + 0.4 * sin(a * 10.0 - uTime * 1.6);
  totalEmissiveRadiance += vec3(0.15, 0.75, 1.0) * ring1 * flow * (0.7 + 0.6 * uPulse);
  totalEmissiveRadiance += vec3(0.55, 0.3, 1.0) * ring2 * (0.8 - 0.3 * flow);
  // Faint glow pooling around the lit stage.
  totalEmissiveRadiance += vec3(0.05, 0.12, 0.3) * exp(-max(r - 5.6, 0.0) * 0.8) * 0.6;
`;

// Indigo wall panels with vertical light fins that fade upward.
const wallEmissive = /* glsl */ `
  vec3 w = vClubWorld;
  float a = atan(w.x, w.z) / 6.2831853;
  float k = fract(a * 48.0);
  float fin = smoothstep(0.08, 0.0, abs(k - 0.5) - 0.02);
  float up = smoothstep(${FLOOR.toFixed(2)}, 8.0, w.y);
  vec3 col = clubHue(a * 2.0 + uBeat * 0.02);
  totalEmissiveRadiance += col * fin * (1.0 - up) * 0.55;
  totalEmissiveRadiance += vec3(0.1, 0.12, 0.4) * smoothstep(0.5, 0.0, abs(k - 0.5)) * 0.08;
`;

// Ceiling: fibre-optic star field plus two cove rings.
const ceilingEmissive = /* glsl */ `
  vec2 p = vClubWorld.xz;
  float r = length(p);
  vec2 cell = floor(p * 2.2);
  float h = hash12(cell);
  vec2 f = fract(p * 2.2) - 0.5 - (hash22(cell) - 0.5) * 0.6;
  float star = smoothstep(0.09, 0.0, length(f)) * step(0.82, h);
  float tw = 0.5 + 0.5 * sin(uTime * (1.0 + h * 3.0) + h * 40.0);
  totalEmissiveRadiance += mix(vec3(0.6, 0.9, 1.0), clubHue(h * 4.0), 0.4) * star * tw * 1.6;
  totalEmissiveRadiance += vec3(0.2, 0.85, 1.0) * exp(-pow((r - 6.5) * 6.0, 2.0)) * 1.5;
  totalEmissiveRadiance += vec3(0.7, 0.3, 1.0) * exp(-pow((r - 11.5) * 6.0, 2.0)) * 1.1;
`;

const pillarEmissive = /* glsl */ `
  // Neon strip on the room-facing side, brightest near the floor.
  vec3 n = normalize(vClubNormal);
  vec3 inward = normalize(vec3(-vClubWorld.x, 0.0, -vClubWorld.z));
  float face = smoothstep(0.93, 0.99, dot(n, inward));
  float y = vClubWorld.y;
  float run = 0.6 + 0.4 * sin(y * 1.5 - uTime * 3.0);
  totalEmissiveRadiance += clubHue(uBeat * 0.03 + y * 0.03) * face * run * 2.2;
`;

export default function Room() {
  const mats = useDisposable(() => ({
    floor: patchClub(new THREE.MeshPhysicalMaterial({ color: '#070a26', roughness: 0.35, metalness: 0.2, clearcoat: 0.7, clearcoatRoughness: 0.08, envMapIntensity: 0.2 }), {
      key: 'room-floor',
      emissive: floorEmissive,
      dots: 1,
    }),
    wall: patchClub(new THREE.MeshStandardMaterial({ color: '#151a55', roughness: 0.5, metalness: 0.2, side: THREE.BackSide }), {
      key: 'room-wall',
      emissive: wallEmissive,
      dots: 1.2,
    }),
    ceiling: patchClub(new THREE.MeshStandardMaterial({ color: '#0a0d30', roughness: 0.6 }), {
      key: 'room-ceiling',
      emissive: ceilingEmissive,
      dots: 1,
    }),
    pillar: patchClub(new THREE.MeshPhysicalMaterial({ color: '#7883b4', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0.35 }), {
      key: 'room-pillar',
      emissive: pillarEmissive,
      dots: 0.6,
    }),
  }));

  const geo = useDisposable(() => {
    const h = CEILING - FLOOR;
    const wall = (start, length) =>
      new THREE.CylinderGeometry(ROOM_R, ROOM_R, h, 96, 1, true, start, length).translate(0, FLOOR + h / 2, 0);
    const back = TANK_CENTERS[1] + TANK.half;
    const sideStart = TANK_CENTERS[0] + TANK.half;
    return {
      floor: new THREE.CircleGeometry(ROOM_R + 3, 96).rotateX(-Math.PI / 2),
      ceiling: new THREE.CircleGeometry(ROOM_R + 3, 64).rotateX(Math.PI / 2),
      back: wall(back, 2 * Math.PI - 2 * back),
      side: wall(sideStart, 2 * Math.PI - (sideStart - (TANK_CENTERS[1] - TANK.half))),
      pillars: mergeAll(
        PILLARS.map((theta) => {
          const [x, , z] = polar(ROOM_R - 0.35, theta);
          return new THREE.CylinderGeometry(0.55, 0.6, h, 32).translate(x, FLOOR + h / 2, z);
        }),
      ),
    };
  });

  return (
    <group>
      <mesh geometry={geo.floor} material={mats.floor} position={[0, FLOOR, 0]} receiveShadow />
      <mesh geometry={geo.ceiling} material={mats.ceiling} position={[0, CEILING, 0]} />
      <mesh geometry={geo.back} material={mats.wall} />
      <mesh geometry={geo.side} material={mats.wall} />
      <mesh geometry={geo.pillars} material={mats.pillar} />
    </group>
  );
}
