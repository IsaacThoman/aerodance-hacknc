import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { club } from './clock.js';
import { patchClub } from './patch.js';
import { arcBand, mergeAll } from './geometry.js';
import { FLOOR, polar } from './layout.js';

const D = Math.PI / 180;
const START = Math.PI - 77 * D;
const LEN = 31 * D;
const COUNTER_R = 11.0;
const COUNTER_TOP = 0.2;
const BACK_R = 12.95;
const SHELVES = [0.95, 1.65, 2.35];

// Stool positions, shared with the crowd so a few patrons sit at the bar.
export const BAR_STOOLS = [0.16, 0.36, 0.56, 0.76].map((f) => polar(COUNTER_R - 0.75, START + LEN * f, FLOOR));
export const STOOL_SEAT = FLOOR + 0.85;

const counterEmissive = /* glsl */ `
  float y = vClubWorld.y;
  float a = atan(vClubWorld.x, vClubWorld.z) * ${COUNTER_R.toFixed(1)};
  float top = exp(-pow((y - ${(COUNTER_TOP - 0.1).toFixed(2)}) * 28.0, 2.0));
  float low = exp(-pow((y - ${(FLOOR + 0.12).toFixed(2)}) * 22.0, 2.0));
  // Rising bubble motif on the counter front.
  vec2 g = vec2(a * 2.2, y * 2.2 - uTime * 0.5);
  vec2 cell = floor(g);
  float h = hash12(cell);
  float d = length(fract(g) - 0.5 - (hash22(cell) - 0.5) * 0.4);
  float ring = smoothstep(0.03, 0.0, abs(d - 0.12 - 0.12 * h)) * step(0.55, h) * smoothstep(${COUNTER_TOP.toFixed(2)}, -0.4, y);
  totalEmissiveRadiance += vec3(1.0, 0.3, 0.85) * top * (1.4 + uPulse) + vec3(0.55, 1.0, 0.25) * low * 1.6 + vec3(0.4, 0.9, 1.0) * ring * 0.8;
`;

// Glowing glass bottles: tinted fresnel glass with a lit liquid core.
const bottleVertex = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vColor;
varying float vY;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vV = normalize(cameraPosition - w.xyz);
  vColor = instanceColor;
  vY = position.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const bottleFragment = /* glsl */ `
uniform float uPulse;
varying vec3 vN;
varying vec3 vV;
varying vec3 vColor;
varying float vY;
void main() {
  vec3 n = normalize(vN);
  float f = abs(dot(n, normalize(vV)));
  float fr = pow(1.0 - f, 2.0);
  float liquid = step(vY, 0.28);
  vec3 col = vColor * (0.35 + 0.9 * liquid * f + 1.2 * fr) * (0.9 + 0.3 * uPulse);
  col += vec3(1.0) * pow(max(dot(n, normalize(vV + vec3(0.4, 0.5, 0.0))), 0.0), 40.0) * 1.5;
  gl_FragColor = vec4(col, 1.0);
}
`;

function bottleGeometry() {
  const pts = [[0, 0], [0.075, 0], [0.085, 0.02], [0.085, 0.27], [0.06, 0.33], [0.03, 0.38], [0.03, 0.46], [0.036, 0.47], [0, 0.48]];
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 12);
}

export default function Bar() {
  const bottles = useRef();
  const res = useDisposable(() => {
    const rand = makeRandom(515);
    const placements = [];
    SHELVES.forEach((y) => {
      for (let a = START + 1.2 * D; a < START + LEN - 1.2 * D; a += rand.range(1.0, 1.6) * D) {
        if (rand.chance(0.15)) continue;
        placements.push({ pos: polar(BACK_R - rand.range(0.1, 0.2), a, y + 0.02), s: rand.range(0.85, 1.25) });
      }
    });
    // Ring sectors: RingGeometry runs counterclockwise from +x; map to cylinder thetas.
    const sector = (r0, r1, y) =>
      new THREE.RingGeometry(r0, r1, 40, 1, 0, LEN)
        .rotateX(-Math.PI / 2)
        .rotateY(START - Math.PI / 2)
        .translate(0, y, 0);
    const stools = [];
    const lamps = [];
    const cords = [];
    BAR_STOOLS.forEach(([x, , z]) => {
      stools.push(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 8).translate(x, FLOOR + 0.42, z));
      stools.push(new THREE.CylinderGeometry(0.22, 0.26, 0.04, 16).translate(x, FLOOR + 0.03, z));
    });
    [0.2, 0.5, 0.8].forEach((f) => {
      const [x, , z] = polar(COUNTER_R + 0.6, START + LEN * f);
      lamps.push(new THREE.SphereGeometry(0.26, 20, 14).translate(x, 3.3, z));
      cords.push(new THREE.CylinderGeometry(0.012, 0.012, 6.5, 4).translate(x, 3.3 + 3.25, z));
    });
    return {
      placements,
      counter: arcBand(COUNTER_R, START, LEN, FLOOR, COUNTER_TOP, 48),
      top: sector(COUNTER_R - 0.15, COUNTER_R + 0.85, COUNTER_TOP),
      shelves: mergeAll(SHELVES.map((y) => sector(BACK_R - 0.35, BACK_R + 0.1, y))),
      shelfGlow: mergeAll(SHELVES.map((y) => sector(BACK_R - 0.37, BACK_R - 0.33, y - 0.03))),
      backCounter: arcBand(BACK_R + 0.05, START, LEN, FLOOR, 0.6, 32),
      stools: mergeAll(stools),
      seats: mergeAll(BAR_STOOLS.map(([x, , z]) => new THREE.CylinderGeometry(0.3, 0.26, 0.12, 20).translate(x, FLOOR + 0.82, z))),
      lamps: mergeAll(lamps),
      cords: mergeAll(cords),
      bottle: bottleGeometry(),
      counterMat: patchClub(new THREE.MeshPhysicalMaterial({ color: '#c8d2f2', roughness: 0.22, clearcoat: 1, envMapIntensity: 0.45, side: THREE.BackSide }), {
        key: 'bar-counter',
        emissive: counterEmissive,
        dots: 0.8,
      }),
      dark: new THREE.MeshPhysicalMaterial({ color: '#141a4a', roughness: 0.2, clearcoat: 1, envMapIntensity: 0.5, side: THREE.DoubleSide }),
      glass: new THREE.MeshPhysicalMaterial({ color: '#9fdcff', roughness: 0.1, clearcoat: 1, envMapIntensity: 0.6, side: THREE.DoubleSide }),
      shelfGlowMat: new THREE.MeshBasicMaterial({ color: new THREE.Color('#7ff0ff').multiplyScalar(2.4), side: THREE.DoubleSide }),
      chrome: new THREE.MeshStandardMaterial({ color: '#d9e2fa', metalness: 1, roughness: 0.15 }),
      seat: new THREE.MeshPhysicalMaterial({ color: '#ff4fc8', roughness: 0.2, clearcoat: 1, envMapIntensity: 0.5 }),
      lampMat: new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2f8').multiplyScalar(1.8) }),
      cordMat: new THREE.MeshBasicMaterial({ color: '#2a3060' }),
      bottleMat: new THREE.ShaderMaterial({ uniforms: { uPulse: club.uPulse }, vertexShader: bottleVertex, fragmentShader: bottleFragment }),
    };
  });

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const rand = makeRandom(77);
    const tints = ['#9dff3a', '#1ee8ff', '#ff3fd2', '#ffb43a', '#8d5cff', '#4dffc3'];
    res.placements.forEach((b, i) => {
      bottles.current.setMatrixAt(i, m.makeScale(b.s, b.s, b.s).setPosition(...b.pos));
      bottles.current.setColorAt(i, c.set(rand.pick(tints)).multiplyScalar(1.3));
    });
    bottles.current.instanceMatrix.needsUpdate = true;
    bottles.current.instanceColor.needsUpdate = true;
  }, [res]);

  return (
    <group>
      <mesh geometry={res.counter} material={res.counterMat} />
      <mesh geometry={res.top} material={res.dark} />
      <mesh geometry={res.backCounter} material={res.dark} />
      <mesh geometry={res.shelves} material={res.glass} />
      <mesh geometry={res.shelfGlow} material={res.shelfGlowMat} />
      <mesh geometry={res.stools} material={res.chrome} />
      <mesh geometry={res.seats} material={res.seat} />
      <mesh geometry={res.lamps} material={res.lampMat} />
      <mesh geometry={res.cords} material={res.cordMat} />
      <instancedMesh ref={bottles} args={[res.bottle, res.bottleMat, res.placements.length]} frustumCulled={false} />
    </group>
  );
}
