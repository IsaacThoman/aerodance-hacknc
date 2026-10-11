import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { BALL_POS, club } from './clock.js';
import { clubCommon } from './patch.js';
import { CEILING } from './layout.js';

const BALL_R = 0.62;

// Faceted mirror ball reflecting a fake club: dark room, colored washes and
// white glints that flash on the beat.
const ballFragment = /* glsl */ `
${clubCommon}
varying vec3 vObj;
varying vec3 vWorld;
varying mat3 vRot;
void main() {
  const float PI = 3.14159265;
  vec3 o = normalize(vObj);
  float lat = acos(clamp(o.y, -1.0, 1.0));
  float rows = 18.0;
  float row = floor(lat / PI * rows);
  float latC = (row + 0.5) / rows * PI;
  float cols = max(4.0, floor(2.0 * rows * sin(latC)));
  float lon = atan(o.z, o.x) + PI;
  float col = floor(lon / (2.0 * PI) * cols);
  float lonC = (col + 0.5) / cols * 2.0 * PI - PI;
  vec3 facet = vec3(sin(latC) * cos(lonC), cos(latC), sin(latC) * sin(lonC));
  float fr = fract(lat / PI * rows);
  float fc = fract(lon / (2.0 * PI) * cols);
  float grout = smoothstep(0.0, 0.14, min(fr, 1.0 - fr)) * smoothstep(0.0, 0.14, min(fc, 1.0 - fc));
  vec3 n = normalize(vRot * facet);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 R = reflect(-V, n);
  float id = hash12(vec2(row, col));
  vec3 env = mix(vec3(0.03, 0.05, 0.16), vec3(0.15, 0.2, 0.5), smoothstep(-0.3, 0.8, R.y));
  env += clubHue(atan(R.x, R.z) * 0.3 + uTime * 0.05) * smoothstep(0.2, 1.0, hash12(vec2(row * 1.3, col + floor(uBeat)))) * 0.9;
  float glint = step(0.94, hash12(vec2(col * 1.7, row + floor(uBeat * 2.0)))) * (0.6 + uPulse * 1.2);
  env += vec3(1.0, 0.97, 0.95) * glint * 1.4;
  env += vec3(0.9, 0.97, 1.0) * pow(max(dot(R, normalize(vec3(0.2, 0.3, 1.0))), 0.0), 30.0) * 1.5;
  gl_FragColor = vec4(env * mix(0.15, 1.0, grout) * (0.8 + 0.4 * id), 1.0);
}
`;

const ballVertex = /* glsl */ `
varying vec3 vObj;
varying vec3 vWorld;
varying mat3 vRot;
void main() {
  vObj = normalize(position);
  vRot = mat3(modelMatrix);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

// Soap-bubble glass orbs: iridescent fresnel rim, a sharp highlight and a
// faint inner glow, all additive.
const bubbleVertex = /* glsl */ `
attribute float aGlow;
varying vec3 vN;
varying vec3 vV;
varying float vGlow;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vV = normalize(cameraPosition - w.xyz);
  vGlow = aGlow;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const bubbleFragment = /* glsl */ `
uniform float uTime;
uniform float uPulse;
varying vec3 vN;
varying vec3 vV;
varying float vGlow;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vV);
  float fr = 1.0 - abs(dot(n, v));
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (fr * 1.4 + vec3(0.0, 0.33, 0.67) + uTime * 0.05));
  vec3 r = reflect(-v, n);
  float spec = pow(max(dot(r, normalize(vec3(0.3, 0.7, 0.6))), 0.0), 50.0);
  float spec2 = pow(max(dot(r, normalize(vec3(-0.6, 0.2, 0.7))), 0.0), 20.0);
  vec3 col = irid * pow(fr, 2.2) * 0.7 + vec3(1.0) * spec * 1.4 + vec3(0.6, 0.9, 1.0) * spec2 * 0.35;
  col += vec3(0.35, 0.85, 1.0) * vGlow * (1.0 - fr) * (0.2 + 0.2 * uPulse);
  gl_FragColor = vec4(col, 1.0);
}
`;

const haloFragment = /* glsl */ `
uniform float uPulse;
varying vec2 vUv;
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  float g = exp(-r * r * 6.0) * 0.45 + exp(-r * 10.0) * 0.4;
  float star = exp(-abs(d.x) * 70.0) * exp(-abs(d.y) * 5.0) + exp(-abs(d.y) * 70.0) * exp(-abs(d.x) * 5.0);
  float a = (g + star * 0.5) * (0.4 + 0.3 * uPulse) * smoothstep(1.0, 0.6, r);
  gl_FragColor = vec4(vec3(0.75, 0.92, 1.0) * a, 1.0);
}
`;

const billboardVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy;
  gl_Position = projectionMatrix * mv;
}
`;

function useBubbles() {
  return useDisposable(() => {
    const rand = makeRandom(31);
    const list = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + rand.range(-0.15, 0.15);
      const ring = i % 2;
      const r = ring ? rand.range(1.0, 1.35) : rand.range(1.55, 2.0);
      const y = rand.range(-0.35, 0.45) - (ring ? 0.25 : 0.15);
      list.push({ pos: [Math.cos(a) * r, y, Math.sin(a) * r], size: rand.range(0.14, 0.34), glow: rand.chance(0.4) ? 1 : 0 });
    }
    return list;
  });
}

export default function Chandelier() {
  const group = useRef();
  const ball = useRef();
  const bubbles = useBubbles();
  const res = useDisposable(() => {
    const sphere = new THREE.SphereGeometry(1, 24, 16);
    const bubbleGeo = new THREE.InstancedBufferGeometry().copy(sphere);
    sphere.dispose();
    bubbleGeo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array(bubbles.map((b) => b.glow)), 1));
    // Wires from the canopy to each bubble and the ball.
    const top = CEILING - BALL_POS.y - 0.1;
    const wire = [0, top, 0, 0, BALL_R, 0];
    bubbles.forEach((b) => wire.push(b.pos[0] * 0.7, top, b.pos[2] * 0.7, b.pos[0], b.pos[1] + b.size, b.pos[2]));
    const wires = new THREE.BufferGeometry();
    wires.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    return {
      bubbleGeo,
      wires,
      ballGeo: new THREE.SphereGeometry(BALL_R, 48, 32),
      canopy: new THREE.CylinderGeometry(1.5, 1.1, 0.14, 48),
      canopyRing: new THREE.TorusGeometry(1.5, 0.04, 6, 64).rotateX(Math.PI / 2),
      halo: new THREE.PlaneGeometry(BALL_R * 6, BALL_R * 6),
      ballMat: new THREE.ShaderMaterial({ uniforms: club, vertexShader: ballVertex, fragmentShader: ballFragment }),
      bubbleMat: new THREE.ShaderMaterial({
        uniforms: club,
        vertexShader: bubbleVertex,
        fragmentShader: bubbleFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      haloMat: new THREE.ShaderMaterial({
        uniforms: club,
        vertexShader: billboardVertex,
        fragmentShader: haloFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      chrome: new THREE.MeshStandardMaterial({ color: '#e8efff', metalness: 1, roughness: 0.15 }),
      ringMat: new THREE.MeshBasicMaterial({ color: new THREE.Color('#7ff3ff').multiplyScalar(2.2) }),
      wireMat: new THREE.LineBasicMaterial({ color: '#8aa2d8', transparent: true, opacity: 0.5 }),
    };
  });

  const spin = useRef();
  const inst = useRef();
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    bubbles.forEach((b, i) => inst.current.setMatrixAt(i, m.makeScale(b.size, b.size, b.size).setPosition(...b.pos)));
    inst.current.instanceMatrix.needsUpdate = true;
  }, [bubbles]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    spin.current.rotation.y = t * 0.08;
    group.current.position.y = BALL_POS.y + Math.sin(t * 0.6) * 0.04;
    // Matches the rotation used for the projected light dots.
    ball.current.rotation.y = -club.uBallRot.value;
  });

  return (
    <group ref={group} position={[BALL_POS.x, BALL_POS.y, BALL_POS.z]}>
      <mesh ref={ball} geometry={res.ballGeo} material={res.ballMat} />
      <group ref={spin}>
        <instancedMesh ref={inst} args={[res.bubbleGeo, res.bubbleMat, bubbles.length]} frustumCulled={false} renderOrder={4} />
        <lineSegments geometry={res.wires} material={res.wireMat} />
      </group>
      <mesh geometry={res.canopy} material={res.chrome} position={[0, CEILING - BALL_POS.y - 0.08, 0]} />
      <mesh geometry={res.canopyRing} material={res.ringMat} position={[0, CEILING - BALL_POS.y - 0.16, 0]} />
      <mesh geometry={res.halo} material={res.haloMat} renderOrder={5} />
    </group>
  );
}
