import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { clubCommon, fogUniforms, patchClub } from './patch.js';
import { arcBand, arcTube } from './geometry.js';
import { FLOOR, SCREEN } from './layout.js';

const W = SCREEN.r * SCREEN.length;
const H = SCREEN.y1 - SCREEN.y0;

// Procedural LED wall: an aero orb throwing rings on the kick, glossy swooshes,
// a spectrum that hangs from the top edge, and a calm lower band so the
// dancers' heads stay readable against it.
const screenFragment = /* glsl */ `
${clubCommon}
uniform vec2 uSize;
varying vec2 vUv;
#include <fog_pars_fragment>

float ribbon(vec2 p, float y0, float amp, float k, float speed, float phase, float width) {
  float y = y0 + amp * sin(p.x * k + uTime * speed + phase) + amp * 0.5 * sin(p.x * k * 2.3 - uTime * speed * 0.7 + phase * 1.7);
  float w = width * (0.6 + 0.4 * sin(p.x * 0.35 + phase + uTime * 0.3));
  float d = abs(p.y - y);
  return exp(-d * d / (w * w)) + 0.35 * exp(-d / (w * 3.0));
}

void main() {
  vec2 p = vec2((0.5 - vUv.x) * uSize.x, vUv.y * uSize.y);   // centered x, y from bottom
  vec2 q = vec2(p.x, p.y - uSize.y * 0.52);
  float b = uBeat;
  float ph = fract(b);

  // Deep gradient with slow aurora-like color waves.
  float wave = sin(p.x * 0.35 + uTime * 0.25) * 0.5 + sin(p.x * 0.17 - p.y * 0.3 + uTime * 0.18) * 0.5;
  vec3 col = mix(vec3(0.015, 0.03, 0.12), vec3(0.06, 0.04, 0.2), vUv.y);
  col += clubHue(0.35 + wave * 0.15 + uTime * 0.01) * (0.05 + 0.05 * wave) * smoothstep(0.0, 0.6, vUv.y);

  // Aero orb with rings radiating on each beat.
  float r = length(q);
  float orb = smoothstep(1.15, 1.05, r);
  vec3 orbCol = mix(vec3(0.1, 0.55, 1.0), vec3(0.75, 1.0, 1.0), smoothstep(-1.4, 1.2, q.y));
  float shine = smoothstep(0.7, 0.15, length((q - vec2(-0.27, 0.5)) * vec2(1.0, 1.7)));
  col = mix(col, orbCol * (0.45 + 0.35 * uPulse) + shine * 0.7, orb);
  col += vec3(0.4, 0.9, 1.0) * exp(-pow((r - 1.12) * 9.0, 2.0)) * 1.2;
  for (int i = 0; i < 3; i++) {
    float rr = 1.2 + fract(ph + float(i) / 3.0) * 6.0;
    float fade = 1.0 - fract(ph + float(i) / 3.0);
    col += clubHue(floor(b) * 0.2 + float(i) * 0.15) * exp(-pow((r - rr) * 5.0, 2.0)) * fade * fade * 0.9;
  }

  // Glossy swooshes.
  float calm = smoothstep(0.8, 2.6, p.y);
  float r1 = ribbon(p, uSize.y * 0.55, 1.1, 0.32, 0.6, 0.0, 0.16);
  float r2 = ribbon(p, uSize.y * 0.45, 1.3, 0.25, -0.45, 2.1, 0.12);
  float r3 = ribbon(p, uSize.y * 0.68, 0.8, 0.41, 0.8, 4.2, 0.1);
  col += vec3(0.15, 0.9, 1.0) * r1 * 0.9 * calm * (1.0 - orb);
  col += vec3(0.62, 1.0, 0.25) * r2 * 0.75 * calm * (1.0 - orb);
  col += vec3(1.0, 0.3, 0.85) * r3 * 0.75 * calm * (1.0 - orb);

  // Spectrum hanging from the top edge, mirrored around the center.
  float bars = 56.0;
  float bx = (p.x / uSize.x + 0.5) * bars;
  float bi = floor(bx);
  float bf = fract(bx);
  float xm = abs(bi + 0.5 - bars * 0.5) / (bars * 0.5);
  float lvl = 0.25 + 0.35 * uPulse * exp(-xm * 2.0)
    + 0.25 * (0.5 + 0.5 * sin(uTime * (2.0 + hash11(floor(xm * 28.0)) * 5.0) + xm * 9.0))
    + 0.18 * exp(-fract(b * 2.0) * 4.0) * xm;
  float depth = (uSize.y - p.y) / 1.7;
  float seg = fract(depth * 9.0);
  float lit = step(depth, lvl) * smoothstep(0.08, 0.2, bf) * smoothstep(0.92, 0.8, bf) * smoothstep(0.1, 0.25, seg);
  col += clubHue(xm * 0.9 + 0.1) * lit * 1.3;

  // Waveform in the calm band.
  float wy = 1.25 + (0.2 + 0.35 * uPulse) * sin(p.x * 2.2 - uTime * 6.0) * sin(p.x * 0.4 + uTime);
  col += vec3(0.4, 0.95, 1.0) * exp(-pow((p.y - wy) * 18.0, 2.0)) * 0.9;

  // LED pixel texture and a soft edge falloff.
  vec2 px = fract(p / 0.12) - 0.5;
  col *= 0.82 + 0.18 * smoothstep(0.5, 0.25, max(abs(px.x), abs(px.y)));
  col *= smoothstep(0.0, 0.08, vUv.y) * 0.4 + 0.6;

  gl_FragColor = vec4(col * 0.85, 1.0);
  #include <fog_fragment>
}
`;

const screenVertex = /* glsl */ `
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export default function VideoWall() {
  const mats = useDisposable(() => ({
    screen: new THREE.ShaderMaterial({
      uniforms: fogUniforms({ uSize: { value: new THREE.Vector2(W, H) } }),
      vertexShader: screenVertex,
      fragmentShader: screenFragment,
      side: THREE.BackSide,
      fog: true,
    }),
    bezel: new THREE.MeshPhysicalMaterial({ color: '#f1f6ff', roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04 }),
    plinth: patchClub(new THREE.MeshPhysicalMaterial({ color: '#0e1650', roughness: 0.25, clearcoat: 1, side: THREE.BackSide }), {
      key: 'screen-plinth',
      emissive: /* glsl */ `
        float y = vClubWorld.y;
        float l1 = exp(-pow((y - ${(SCREEN.y0 - 0.35).toFixed(2)}) * 22.0, 2.0));
        float l2 = exp(-pow((y + 0.2) * 22.0, 2.0));
        float a = atan(vClubWorld.x, vClubWorld.z);
        float run = 0.55 + 0.45 * sin(a * 60.0 + uTime * 4.0);
        totalEmissiveRadiance += vec3(0.25, 0.9, 1.0) * l1 * 1.8 + vec3(0.6, 0.35, 1.0) * l2 * run * 1.4;
      `,
      dots: 1,
    }),
  }));

  const geo = useDisposable(() => {
    const { r, theta, length, y0, y1 } = SCREEN;
    return {
      screen: arcBand(r, theta, length, y0, y1, 96),
      plinth: arcBand(r + 0.05, theta, length, FLOOR, y0, 64),
      top: arcTube(r - 0.05, theta, length, 0.16, y1, 96),
      bottom: arcTube(r - 0.05, theta, length, 0.16, y0, 96),
      end: new THREE.CylinderGeometry(0.16, 0.16, y1 - y0, 12).translate(0, (y0 + y1) / 2, 0),
    };
  });
  const ends = [SCREEN.theta, SCREEN.theta + SCREEN.length].map((t) => [(SCREEN.r - 0.05) * Math.sin(t), 0, (SCREEN.r - 0.05) * Math.cos(t)]);

  return (
    <group>
      <mesh geometry={geo.screen} material={mats.screen} />
      <mesh geometry={geo.plinth} material={mats.plinth} />
      <mesh geometry={geo.top} material={mats.bezel} />
      <mesh geometry={geo.bottom} material={mats.bezel} />
      {ends.map((p, i) => (
        <mesh key={i} geometry={geo.end} material={mats.bezel} position={p} />
      ))}
    </group>
  );
}
