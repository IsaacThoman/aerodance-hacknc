import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { beatCount } from './clock.js';
import { patchClub } from './patch.js';
import { FLOOR } from './layout.js';

const STAGE_R = 4.9;
const STAGE_TOP = 0;
const TIER_R = STAGE_R + 0.75;
const TIER_Y = -0.55;

// Glass LED tiles: four beat-driven patterns (ripples from the center, checker
// flashes, a rotating color sweep, random sparkle) crossfaded every two bars.
const ledEmissive = /* glsl */ `
  vec2 p = vClubWorld.xz;
  float T = 0.6;
  vec2 cell = floor(p / T);
  vec2 f = fract(p / T) - 0.5;
  vec2 cc = (cell + 0.5) * T;
  float r = length(cc);
  float rp = length(p);
  float a = atan(cc.y, cc.x);
  float inside = step(r, uRadius - 0.42);
  float sq = max(abs(f.x), abs(f.y));
  float tileMask = smoothstep(0.47, 0.39, sq);
  float core = 0.55 + 0.45 * (1.0 - smoothstep(0.0, 0.55, length(f)));
  float b = uBeat;
  float ph = fract(b);
  float id = hash12(cell);

  float span = uRadius + 1.0;
  float r0 = r - ph * span;
  float r1 = r - fract(ph + 0.5) * span;
  float ripple = exp(-r0 * r0 * 5.0) + 0.3 * exp(-r1 * r1 * 5.0);
  vec3 cRipple = clubHue(floor(b) * 0.21 + r * 0.04);

  float chk = mod(cell.x + cell.y + floor(b), 2.0);
  float checker = chk * (0.08 + 0.92 * uPulse) * step(0.25, hash12(cell + floor(b * 0.5))) + (1.0 - chk) * 0.03;
  vec3 cChk = clubHue(floor(b) * 0.25 + chk * 0.5);

  float sw = fract(a / 6.2831853 - b * 0.25);
  float sweep = pow(sw, 3.0) * smoothstep(0.6, 1.4, r);
  vec3 cSweep = clubHue(a / 6.2831853 * 2.0 + b * 0.06);

  float sb = floor(b * 2.0);
  float spk = step(0.7, hash12(cell + sb * 7.13)) * (0.3 + 0.7 * exp(-fract(b * 2.0) * 3.5));
  vec3 cSpk = clubHue(id + b * 0.1);

  vec3 led = cRipple * ripple * uMix.x + cChk * checker * uMix.y + cSweep * sweep * uMix.z + cSpk * spk * uMix.w;
  vec3 base = vec3(0.006, 0.02, 0.06) * (0.6 + 0.6 * id);
  totalEmissiveRadiance += (base + led * 1.6) * tileMask * core * inside;

  // Follow-spot pools around each dancer; the key light's shadow cuts into them.
  vec2 c1 = vec2(-2.0 + 0.3 * sin(uTime * 0.7), 0.15);
  vec2 c2 = vec2(2.0 + 0.3 * sin(uTime * 0.6 + 2.0), 0.15);
  float s1 = smoothstep(2.1, 0.5, length((p - c1) * vec2(1.0, 0.85)));
  float s2 = smoothstep(2.1, 0.5, length((p - c2) * vec2(1.0, 0.85)));
  totalEmissiveRadiance += vec3(0.35, 0.85, 1.0) * s1 * 0.3 + vec3(1.0, 0.5, 0.92) * s2 * 0.3;

  float ring = exp(-pow((rp - (uRadius - 0.2)) * 12.0, 2.0));
  float chase = 0.55 + 0.45 * sin(atan(p.y, p.x) * 18.0 - uTime * 5.0);
  totalEmissiveRadiance += vec3(0.35, 0.95, 1.0) * ring * (1.0 + 0.35 * uPulse) * chase * 1.3;
`;

// Chasing bulb band around a cylinder side, between y0 and y1.
const bulbEmissive = (y0, y1, n, color) => /* glsl */ `
  vec3 w = vClubWorld;
  float a = atan(w.z, w.x) / 6.2831853 + 0.5;
  float k = a * ${n.toFixed(1)};
  float idx = floor(k);
  float fx = fract(k) - 0.5;
  float yc = ${((y0 + y1) / 2).toFixed(3)};
  float fy = (w.y - yc) / ${((y1 - y0) / 2).toFixed(3)};
  float bulb = smoothstep(0.32, 0.12, length(vec2(fx, fy * 0.5)));
  float on = mod(idx - floor(uBeat * 2.0), 3.0) < 0.5 ? 1.0 : 0.25;
  float stripe = exp(-fy * fy * 1.2) * 0.12;
  vec3 col = ${color};
  totalEmissiveRadiance += col * (bulb * on * (1.1 + 0.45 * uPulse) + stripe);
`;

export default function DanceFloor() {
  const mats = useDisposable(() => {
    const mix = new THREE.Vector4(1, 0, 0, 0);
    const led = patchClub(
      new THREE.MeshPhysicalMaterial({ color: '#060a22', roughness: 0.35, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.05, envMapIntensity: 0.18 }),
      {
        key: 'led-floor',
        uniforms: { uRadius: { value: STAGE_R }, uMix: { value: mix } },
        head: 'uniform float uRadius; uniform vec4 uMix;',
        emissive: ledEmissive,
        dots: 0.5,
        shadowEmissive: 0.85,
      },
    );
    const side = patchClub(
      new THREE.MeshPhysicalMaterial({ color: '#8f9cc8', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.4 }),
      { key: 'stage-side', emissive: bulbEmissive(TIER_Y, STAGE_TOP, 140, 'mix(vec3(0.3, 0.95, 1.0), clubHue(idx * 0.11 + uBeat * 0.125), 0.6)'), dots: 0.8 },
    );
    const tier = patchClub(
      new THREE.MeshPhysicalMaterial({ color: '#1a2366', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.35 }),
      { key: 'stage-tier', emissive: bulbEmissive(FLOOR, TIER_Y, 170, 'clubHue(a * 2.0 + uBeat * 0.05)'), dots: 0.8 },
    );
    const step = patchClub(
      new THREE.MeshPhysicalMaterial({ color: '#1a2366', roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
      {
        key: 'stage-step',
        emissive: /* glsl */ `
          float rr = length(vClubWorld.xz);
          totalEmissiveRadiance += vec3(0.6, 0.35, 1.0) * exp(-pow((rr - ${(TIER_R - 0.08).toFixed(3)}) * 18.0, 2.0)) * (1.0 + uPulse);
        `,
        dots: 0.8,
      },
    );
    const chrome = new THREE.MeshStandardMaterial({ color: '#dfe9ff', metalness: 1, roughness: 0.12 });
    return { led, side, tier, step, chrome, mix };
  });

  const geo = useDisposable(() => ({
    top: new THREE.CircleGeometry(STAGE_R, 96).rotateX(-Math.PI / 2),
    side: new THREE.CylinderGeometry(STAGE_R, STAGE_R, STAGE_TOP - TIER_Y, 128, 1, true).translate(0, (STAGE_TOP + TIER_Y) / 2, 0),
    tier: new THREE.CylinderGeometry(TIER_R, TIER_R + 0.1, TIER_Y - FLOOR, 128, 1, true).translate(0, (TIER_Y + FLOOR) / 2, 0),
    step: new THREE.RingGeometry(STAGE_R - 0.01, TIER_R, 128, 1).rotateX(-Math.PI / 2).translate(0, TIER_Y, 0),
    lip: new THREE.TorusGeometry(STAGE_R, 0.05, 8, 128).rotateX(Math.PI / 2),
  }));

  useFrame(() => {
    // Pattern crossfade every two bars.
    const m = beatCount() / 8;
    const i = Math.floor(m) % 4;
    const f = THREE.MathUtils.smoothstep(m - Math.floor(m), 0, 0.12);
    mats.mix.set(0, 0, 0, 0).setComponent(i, f).setComponent((i + 3) % 4, 1 - f);
  });

  return (
    <group>
      <mesh geometry={geo.top} material={mats.led} position={[0, STAGE_TOP, 0]} receiveShadow />
      <mesh geometry={geo.side} material={mats.side} receiveShadow />
      <mesh geometry={geo.lip} material={mats.chrome} position={[0, STAGE_TOP - 0.02, 0]} />
      <mesh geometry={geo.step} material={mats.step} receiveShadow />
      <mesh geometry={geo.tier} material={mats.tier} receiveShadow />
    </group>
  );
}
