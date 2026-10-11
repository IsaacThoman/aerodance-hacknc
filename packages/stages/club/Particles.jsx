import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { beat, useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { club } from './clock.js';
import { bubbleSpriteGLSL, hueGLSL } from './patch.js';

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

function seededGeometry(count, seed, fill) {
  const rand = makeRandom(seed);
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) data.set(fill(rand, i), i * 4);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(data, 4));
  return g;
}

// Twinkling four-point glints drifting in the haze above the floor.
const sparkleVertex = /* glsl */ `
uniform float uTime;
attribute vec4 aSeed;
varying float vTw;
varying float vHue;
void main() {
  float a = aSeed.x * 6.2831 + uTime * 0.05 * (aSeed.w - 0.5);
  float r = 2.0 + aSeed.y * 9.0;
  vec3 p = vec3(sin(a) * r, 0.6 + aSeed.z * 7.5 + 0.35 * sin(uTime * 0.4 + aSeed.x * 30.0), cos(a) * r - 1.5);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = pow(0.5 + 0.5 * sin(uTime * (1.5 + aSeed.w * 3.0) + aSeed.x * 50.0), 6.0);
  vTw = tw;
  vHue = aSeed.y;
  gl_PointSize = (0.18 + 0.3 * tw) * 600.0 / -mv.z;
}
`;

const sparkleFragment = /* glsl */ `
${hueGLSL}
varying float vTw;
varying float vHue;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float star = exp(-abs(d.x) * 40.0) * exp(-abs(d.y) * 6.0) + exp(-abs(d.y) * 40.0) * exp(-abs(d.x) * 6.0);
  float core = exp(-dot(d, d) * 60.0);
  vec3 c = mix(vec3(1.0), clubHue(vHue * 3.0), 0.35);
  gl_FragColor = vec4(c * (star * 0.8 + core) * vTw * 1.6, 1.0);
}
`;

// Confetti burst over the stage every eight bars: tumbling glossy flakes,
// drawn as points whose visible width flips as they spin.
const confettiVertex = /* glsl */ `
uniform float uTime;
uniform float uBurst;
attribute vec4 aSeed;
varying float vSpin;
varying float vHue;
varying float vFade;
void main() {
  float age = uBurst;
  float a = aSeed.x * 6.2831;
  float r = sqrt(aSeed.y) * 6.0;
  float fall = age * (0.9 + aSeed.z * 0.6);
  vec3 p = vec3(sin(a) * r, 9.0 + aSeed.w * 4.0 - fall, cos(a) * r - 0.5);
  p.x += sin(uTime * (1.5 + aSeed.w) + aSeed.x * 20.0) * 0.4;
  p.z += cos(uTime * (1.2 + aSeed.w) + aSeed.y * 20.0) * 0.3;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vSpin = uTime * (3.0 + aSeed.w * 5.0) + aSeed.x * 10.0;
  vHue = aSeed.z;
  vFade = smoothstep(9.5, 8.5, p.y) * smoothstep(-0.9, 0.5, p.y) * step(age, 15.0);
  gl_PointSize = 0.16 * 600.0 / -mv.z;
}
`;

const confettiFragment = /* glsl */ `
${hueGLSL}
varying float vSpin;
varying float vHue;
varying float vFade;
void main() {
  if (vFade <= 0.0) discard;
  vec2 d = gl_PointCoord - 0.5;
  float c = cos(vSpin * 0.7), s = sin(vSpin * 0.7);
  d = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  float w = 0.08 + 0.32 * abs(cos(vSpin));
  if (abs(d.x) > w || abs(d.y) > 0.4) discard;
  float shine = 0.7 + 0.6 * pow(abs(sin(vSpin)), 8.0);
  gl_FragColor = vec4(clubHue(vHue * 4.0) * shine * 1.1 * vFade, 1.0);
}
`;

// Big iridescent aero bubbles floating up through the room.
const bubbleVertex = /* glsl */ `
uniform float uTime;
attribute vec4 aSeed;
varying float vAlpha;
varying float vSeed;
void main() {
  float k = fract(aSeed.z + uTime * (0.012 + 0.01 * aSeed.w));
  float a = aSeed.x * 6.2831 + sin(uTime * 0.2 + aSeed.y * 10.0) * 0.1;
  float r = 6.5 + aSeed.y * 4.5;
  vec3 p = vec3(sin(a) * r + sin(uTime * 0.5 + aSeed.x * 40.0) * 0.5, -0.5 + k * 10.5, cos(a) * r - 3.0);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vAlpha = smoothstep(0.0, 0.1, k) * smoothstep(1.0, 0.85, k);
  vSeed = aSeed.w;
  gl_PointSize = min((0.2 + 0.3 * aSeed.w) * 600.0 / -mv.z, 26.0);
}
`;

const bubbleFragment = /* glsl */ `
uniform float uTime;
varying float vAlpha;
varying float vSeed;
${bubbleSpriteGLSL}
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (r * 0.8 + vSeed + vec3(0.0, 0.33, 0.67) + uTime * 0.05));
  float a = bubbleSprite(gl_PointCoord);
  gl_FragColor = vec4(mix(vec3(0.7, 0.95, 1.0), irid, 0.55) * a * vAlpha * 0.45, 1.0);
}
`;

const BURST_BARS = 8;

export default function Particles() {
  const res = useDisposable(() => ({
    sparkles: seededGeometry(140, 5, (r) => [r.next(), r.next(), r.next(), r.next()]),
    confetti: seededGeometry(180, 6, (r) => [r.next(), r.next(), r.next(), r.next()]),
    // Around the room's sides and back, never straight between the camera and the dancers.
    bubbles: seededGeometry(36, 7, (r) => [r.chance(0.5) ? r.sign() * r.range(0.08, 0.3) : r.range(0.2, 0.8), r.next(), r.next(), r.next()]),
    sparkleMat: new THREE.ShaderMaterial({ uniforms: { uTime: club.uTime }, vertexShader: sparkleVertex, fragmentShader: sparkleFragment, ...additive }),
    confettiMat: new THREE.ShaderMaterial({
      uniforms: { uTime: club.uTime, uBurst: { value: 100 } },
      vertexShader: confettiVertex,
      fragmentShader: confettiFragment,
      depthWrite: true,
    }),
    bubbleMat: new THREE.ShaderMaterial({ uniforms: { uTime: club.uTime }, vertexShader: bubbleVertex, fragmentShader: bubbleFragment, ...additive }),
  }));

  useFrame(() => {
    // Seconds since the latest burst bar started.
    const beats = beat.beat + beat.phase;
    const sinceBar = beats - Math.floor(beats / (BURST_BARS * 4)) * BURST_BARS * 4;
    res.confettiMat.uniforms.uBurst.value = (sinceBar * 60) / beat.bpm;
  });

  return (
    <group>
      <points geometry={res.sparkles} material={res.sparkleMat} frustumCulled={false} renderOrder={8} />
      <points geometry={res.confetti} material={res.confettiMat} frustumCulled={false} />
      <points geometry={res.bubbles} material={res.bubbleMat} frustumCulled={false} renderOrder={8} />
    </group>
  );
}
