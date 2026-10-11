import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { beat, reducedMotion, useDisposable } from '../shared/hooks.js';
import { club, hue } from './clock.js';
import { mergeAll } from './geometry.js';
import { COLUMNS, FLOOR, ROOM_R, polar } from './layout.js';

const TRUSS = { y: 8.5, z: -5.6, half: 7.2 };
const HEADS = [-6, -3.6, -1.2, 1.2, 3.6, 6];
const HEAD_Y = TRUSS.y - 0.42;
const BEAM_LEN = 15;
const LASERS = 5;

// Soft volumetric beam: bright at the source, fading along its length and
// toward the silhouette edges, with a slow haze shimmer.
const beamVertex = /* glsl */ `
uniform float uLen;
varying float vAlong;
varying vec3 vN;
varying vec3 vV;
varying vec3 vW;
varying vec3 vColor;
void main() {
  vAlong = position.z / uLen;
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(m) * normal);
  vV = normalize(cameraPosition - w.xyz);
  vColor = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const beamFragment = /* glsl */ `
uniform float uTime;
varying float vAlong;
varying vec3 vN;
varying vec3 vV;
varying vec3 vW;
varying vec3 vColor;
void main() {
  float f = abs(dot(normalize(vN), normalize(vV)));
  float edge = pow(f, 1.8);
  float a = clamp(vAlong, 0.0, 1.0);
  float fall = pow(1.0 - a, 1.4) * 0.85 + 0.15 * (1.0 - a);
  float haze = 0.65 + 0.35 * sin(vW.y * 1.7 + vW.x * 0.9 - uTime * 0.9) * sin(vW.z * 1.3 + uTime * 0.6);
  float hot = exp(-a * 25.0) * 1.2;
  float floorFade = smoothstep(${FLOOR.toFixed(2)}, ${(FLOOR + 1.2).toFixed(2)}, vW.y);
  gl_FragColor = vec4(vColor * (edge * fall * haze + hot * edge) * floorFade, 1.0);
}
`;

const poolVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vUv = uv;
  vColor = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const poolFragment = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.55, r) * 0.6 + smoothstep(0.5, 0.0, r) * 0.4;
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

// Lasers: thin camera-facing ribbons fanning from the back pillar tops; the
// sweep is computed per laser in the shader so all of them are one draw.
const laserVertex = /* glsl */ `
uniform float uTime;
uniform float uLen;
uniform float uWidth;
uniform vec3 uSrc0;
uniform vec3 uSrc1;
attribute float aSide;
attribute float aAlong;
attribute float aId;
attribute float aSrc;
varying float vSide;
varying float vAlong;
varying float vId;
void main() {
  float sgn = aSrc < 0.5 ? 1.0 : -1.0;
  // Cross-fire: each column fans toward the far side of the room, crossing
  // above and behind the dancers rather than through them.
  float spread = (aId / ${(LASERS - 1).toFixed(1)} - 0.5) * 0.55;
  float yaw = sgn * (1.15 + sin(uTime * 0.7 + aSrc * 2.0) * 0.22 + spread);
  float pitch = 0.3 + sin(uTime * 1.1 + aId * 0.6) * 0.08;
  vec3 dir = vec3(cos(pitch) * sin(yaw), -sin(pitch), cos(pitch) * cos(yaw));
  vec3 src = aSrc < 0.5 ? uSrc0 : uSrc1;
  vec3 p = src + dir * aAlong * uLen;
  vec3 side = normalize(cross(dir, normalize(cameraPosition - p)));
  p += side * aSide * uWidth;
  vSide = aSide;
  vAlong = aAlong;
  vId = aId;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const laserFragment = /* glsl */ `
uniform float uIntensity;
varying float vSide;
varying float vAlong;
varying float vId;
void main() {
  vec3 c = mod(vId, 2.0) < 0.5 ? vec3(0.5, 1.0, 0.25) : vec3(0.2, 0.95, 1.0);
  float core = exp(-vSide * vSide * 10.0);
  gl_FragColor = vec4(c * core * (1.0 - vAlong * 0.8) * uIntensity, 1.0);
}
`;

function laserGeometry() {
  const along = [];
  const side = [];
  const id = [];
  const src = [];
  const index = [];
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < LASERS; i++) {
      const base = along.length;
      along.push(0, 0, 1, 1);
      side.push(-1, 1, -1, 1);
      id.push(i, i, i, i);
      src.push(s, s, s, s);
      index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(along.length * 3), 3));
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute('aId', new THREE.Float32BufferAttribute(id, 1));
  g.setAttribute('aSrc', new THREE.Float32BufferAttribute(src, 1));
  g.setIndex(index);
  return g;
}

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

export default function Beams() {
  const heads = useRef();
  const lenses = useRef();
  const beams = useRef();
  const pools = useRef();

  const res = useDisposable(() => {
    const fixtures = [new THREE.CylinderGeometry(0.07, 0.07, TRUSS.half * 2, 8).rotateZ(Math.PI / 2)];
    fixtures.push(fixtures[0].clone().translate(0, 0, 0.32), fixtures[0].clone().translate(0, 0.26, 0.16));
    HEADS.forEach((x) => fixtures.push(new RoundedBoxGeometry(0.55, 0.12, 0.3, 2, 0.05).translate(x, -0.12, 0.16)));
    const truss = mergeAll(fixtures).translate(0, TRUSS.y, TRUSS.z - 0.16);
    const [s0, s1] = COLUMNS.map((theta) => new THREE.Vector3(...polar(ROOM_R - 0.9, theta, 9.3)));
    return {
      truss,
      head: new RoundedBoxGeometry(0.42, 0.42, 0.52, 3, 0.12),
      lens: new THREE.CircleGeometry(0.15, 20).translate(0, 0, 0.265),
      beam: new THREE.CylinderGeometry(0.1, 1.3, BEAM_LEN, 20, 1, true).translate(0, BEAM_LEN / 2, 0).rotateX(Math.PI / 2),
      pool: new THREE.CircleGeometry(1.4, 32).rotateX(-Math.PI / 2),
      laser: laserGeometry(),
      chrome: new THREE.MeshStandardMaterial({ color: '#c9d4f0', metalness: 1, roughness: 0.2 }),
      body: new THREE.MeshPhysicalMaterial({ color: '#d7def5', roughness: 0.25, clearcoat: 1, envMapIntensity: 0.5 }),
      lensMat: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      beamMat: new THREE.ShaderMaterial({
        uniforms: { uLen: { value: BEAM_LEN }, uTime: club.uTime },
        vertexShader: beamVertex,
        fragmentShader: beamFragment,
        side: THREE.DoubleSide,
        ...additive,
      }),
      poolMat: new THREE.ShaderMaterial({ vertexShader: poolVertex, fragmentShader: poolFragment, ...additive }),
      laserMat: new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uLen: { value: 24 }, uWidth: { value: 0.06 }, uIntensity: { value: 0 }, uSrc0: { value: s0 }, uSrc1: { value: s1 } },
        vertexShader: laserVertex,
        fragmentShader: laserFragment,
        side: THREE.DoubleSide,
        ...additive,
      }),
    };
  });
  const tmp = useDisposable(() => ({ o: new THREE.Object3D(), target: new THREE.Vector3(), c: new THREE.Color() }));

  useLayoutEffect(() => {
    // Seed instance colors before the first frame so the shaders compile with them.
    HEADS.forEach((_, i) => {
      lenses.current.setColorAt(i, tmp.c.set('#ffffff'));
      beams.current.setColorAt(i, tmp.c);
      pools.current.setColorAt(i, tmp.c);
    });
  }, [tmp]);

  useFrame((state) => {
    const t = reducedMotion ? 0 : state.clock.elapsedTime;
    const { o, target, c } = tmp;
    const mode = Math.floor(beat.bar / 4) % 3;
    const pulse = 0.75 + 0.5 * beat.pulse;
    for (let i = 0; i < HEADS.length; i++) {
      const x = HEADS[i];
      const s = i % 2 ? 1 : -1;
      const follow = i === 2 || i === 3;
      let floorY = FLOOR;
      if (follow) {
        // The two inner heads cross over as follow spots on the dancers.
        floorY = 0;
        target.set((i === 2 ? 2 : -2) + Math.sin(t * 0.9 + i) * 0.5, 0, 0.3 + Math.sin(t * 0.6 + i) * 0.4);
      } else if (mode === 0) {
        // Slow fan sweeping across the crowd.
        target.set(x * 1.3 + Math.sin(t * 0.6 + i * 0.7) * 3.5, FLOOR, 4 + Math.cos(t * 0.45 + i) * 3.5);
      } else if (mode === 1) {
        // Crossing pairs.
        target.set(-x * 1.4 + Math.sin(t * 0.9) * 2 * s, FLOOR, 3 + Math.sin(t * 0.7 + i) * 2.5);
      } else {
        // Circling the stage.
        const a = t * 0.8 + (i / HEADS.length) * Math.PI * 2;
        target.set(Math.cos(a) * 7.5, FLOOR, 1 + Math.sin(a) * 6);
      }
      o.position.set(x, HEAD_Y, TRUSS.z);
      o.scale.set(1, 1, 1);
      o.lookAt(target);
      o.updateMatrix();
      heads.current.setMatrixAt(i, o.matrix);
      lenses.current.setMatrixAt(i, o.matrix);
      o.scale.set(1, 1, o.position.distanceTo(target) / BEAM_LEN);
      o.updateMatrix();
      beams.current.setMatrixAt(i, o.matrix);
      o.position.set(target.x, floorY + 0.02, target.z);
      o.rotation.set(0, 0, 0);
      o.scale.setScalar(follow ? 0 : 1); // the floor shader already pools light under the dancers
      o.updateMatrix();
      pools.current.setMatrixAt(i, o.matrix);
      hue(beat.bar * 0.17 + i * 0.06, c);
      lenses.current.setColorAt(i, c.multiplyScalar(3 + beat.pulse * 3));
      if (follow) c.setRGB(0.75, 0.9, 1.0).multiplyScalar(0.6);
      else hue(beat.bar * 0.17 + i * 0.06, c);
      beams.current.setColorAt(i, c.multiplyScalar((follow ? 0.3 : 0.55) * pulse));
      pools.current.setColorAt(i, c.multiplyScalar(0.6 / 0.55));
    }
    heads.current.instanceMatrix.needsUpdate = true;
    lenses.current.instanceMatrix.needsUpdate = true;
    beams.current.instanceMatrix.needsUpdate = true;
    pools.current.instanceMatrix.needsUpdate = true;
    lenses.current.instanceColor.needsUpdate = true;
    beams.current.instanceColor.needsUpdate = true;
    pools.current.instanceColor.needsUpdate = true;
    // Lasers fire on the second half of every four bars.
    const lu = res.laserMat.uniforms;
    lu.uTime.value = t;
    lu.uIntensity.value = (beat.bar % 4 >= 2 ? 1 : 0) * (0.5 + 0.4 * beat.pulse);
  });

  const n = HEADS.length;
  return (
    <group>
      <mesh geometry={res.truss} material={res.chrome} />
      <instancedMesh ref={heads} args={[res.head, res.body, n]} frustumCulled={false} />
      <instancedMesh ref={lenses} args={[res.lens, res.lensMat, n]} frustumCulled={false} />
      <instancedMesh ref={beams} args={[res.beam, res.beamMat, n]} frustumCulled={false} renderOrder={6} />
      <instancedMesh ref={pools} args={[res.pool, res.poolMat, n]} frustumCulled={false} renderOrder={1} />
      <mesh geometry={res.laser} material={res.laserMat} frustumCulled={false} renderOrder={7} />
    </group>
  );
}
