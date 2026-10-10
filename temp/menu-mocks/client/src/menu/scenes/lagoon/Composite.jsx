import { useDisposable } from '../../shared/hooks.js';
import * as THREE from 'three';
import { hash } from './shaders.js';

// Full-screen composite: above-water view on top, underwater view below,
// joined by a living meniscus at the lens (refraction film, mirrored band,
// droplets, chromatic fringing) plus a soft lens flare from the sun.
const fragmentShader = /* glsl */ `
uniform sampler2D tAbove;
uniform sampler2D tBelow;
uniform float uTime;
uniform float uLineBase;
uniform float uLineTilt;
uniform vec4 uRipples[4];
uniform vec3 uSun;
uniform float uBeat;
varying vec2 vUv;
${hash}

const float ASPECT = 1.7777778;

float waterline(float x) {
  float X = (x - 0.5) * ASPECT;
  float y = uLineBase + uLineTilt * X;
  y += 0.0075 * sin(X * 3.1 + uTime * 0.95);
  y += 0.0045 * sin(X * 7.3 - uTime * 1.55 + 1.0);
  y += 0.0018 * sin(X * 17.0 + uTime * 2.7 + 2.0);
  y += 0.0007 * sin(X * 41.0 - uTime * 4.1);
  for (int i = 0; i < 4; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.y;
    if (age > 0.0 && age < 5.0) {
      float dx = abs(X - (r.x - 0.5) * ASPECT);
      float front = age * 0.42;
      float env = exp(-pow((dx - front) / 0.14, 2.0)) * exp(-age * 0.85);
      y += r.z * env * cos((dx - front) * 36.0);
    }
  }
  return y;
}

void droplets(vec2 uv, float s, inout vec2 auv, inout float shade, inout vec3 add) {
  vec2 P = vec2(uv.x * ASPECT, uv.y);
  for (int layer = 0; layer < 2; layer++) {
    float cs = layer == 0 ? 0.085 : 0.05;
    vec2 g = P / cs;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash12(id + float(layer) * 31.7);
    float dens = (layer == 0 ? 0.2 : 0.26) * exp(-s * 13.0);
    if (h > dens) continue;
    vec2 off = (hash22(id + 7.0) - 0.5) * 0.45;
    float r = mix(0.14, 0.3, hash12(id + 3.3));
    off.y += sin(uTime * 0.6 + h * 40.0) * 0.015;
    vec2 q = (f - off) / r;
    q.y *= 1.0 + 0.3 * step(q.y, 0.0);
    float dd = length(q);
    if (dd < 1.0) {
      vec2 center = (id + 0.5 + off) * cs;
      vec2 src = center - q * r * cs * 1.8;
      auv = vec2(src.x / ASPECT, src.y);
      float edge = smoothstep(0.62, 1.0, dd);
      shade *= mix(1.08, 0.5, edge);
      add += vec3(1.8) * smoothstep(0.34, 0.05, length(q - vec2(-0.32, 0.42)));
      add += vec3(0.5, 0.8, 0.85) * smoothstep(0.18, 0.0, abs(dd - 0.78)) * smoothstep(-0.1, -0.6, q.y) * 0.5;
    }
  }
}

float ghost(vec2 uv, vec2 c, float r) {
  float l = length((uv - c) * vec2(ASPECT, 1.0));
  return smoothstep(r, r * 0.7, l) * (0.55 + 0.45 * smoothstep(r * 0.3, r * 0.95, l));
}

vec3 flare(vec2 uv) {
  if (uSun.z <= 0.001) return vec3(0.0);
  vec2 sp = uSun.xy;
  vec2 axis = vec2(0.5) - sp;
  vec3 acc = vec3(0.0);
  acc += vec3(0.25, 0.75, 0.55) * ghost(uv, sp + axis * 0.42, 0.03) * 0.3;
  acc += vec3(0.55, 0.85, 1.0) * ghost(uv, sp + axis * 0.7, 0.065) * 0.12;
  acc += vec3(1.0, 0.8, 0.45) * ghost(uv, sp + axis * 1.12, 0.024) * 0.32;
  acc += vec3(0.45, 1.0, 0.85) * ghost(uv, sp + axis * 1.45, 0.1) * 0.07;
  acc += vec3(0.8, 0.6, 1.0) * ghost(uv, sp + axis * 1.75, 0.045) * 0.14;
  float l = length((uv - sp) * vec2(ASPECT, 1.0));
  // Faint rainbow halo ring around the sun.
  float ring = exp(-pow((l - 0.2) / 0.012, 2.0));
  vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (l * 4.0 + vec3(0.0, 0.33, 0.67)));
  acc += rainbow * ring * 0.05;
  // Starburst rays.
  vec2 d = (uv - sp) * vec2(ASPECT, 1.0);
  float ang = atan(d.y, d.x);
  float rays = pow(abs(cos(ang * 3.0 + 0.3)), 60.0) + 0.6 * pow(abs(cos(ang * 4.0 + 1.1)), 90.0);
  acc += vec3(1.0, 0.95, 0.8) * rays * exp(-l * 10.0) * 0.45;
  return acc * uSun.z;
}

void main() {
  vec2 uv = vUv;
  float t = uTime;
  float L = waterline(uv.x);
  float s = uv.y - L;
  vec3 col;
  const float FILM = 0.021;
  if (s >= 0.0) {
    vec2 auv = uv;
    float f = s / FILM;
    if (f < 1.0) {
      // The water film clinging to the port: a cylindrical lens that shows a
      // flipped, magnified strip of the sea right above it.
      auv.y = L + FILM * (1.0 + 1.7 * (1.0 - f));
      auv.x += (f - 0.5) * 0.003 * sin(uv.x * 26.0 + t * 1.3);
    }
    float shade = 1.0;
    vec3 add = vec3(0.0);
    droplets(uv, s, auv, shade, add);
    float ca = 0.0016 * exp(-s * 22.0) + 0.0005;
    col.r = texture2D(tAbove, auv + vec2(0.0, ca)).r;
    col.g = texture2D(tAbove, auv).g;
    col.b = texture2D(tAbove, auv - vec2(0.0, ca)).b;
    col = col * shade + add;
    if (f < 1.0) {
      col = mix(col, col * vec3(0.78, 1.0, 1.04) + vec3(0.03, 0.09, 0.1), 0.65);
      col += vec3(1.0, 1.05, 1.1) * exp(-pow((f - 0.97) * 7.0, 2.0)) * 0.6;
    }
    col += flare(uv);
  } else {
    float d = -s;
    float near = exp(-d * 7.0);
    vec2 wob = vec2(
      sin(uv.y * 58.0 + t * 1.6 + sin(uv.x * 11.0 + t)),
      cos(uv.x * 43.0 - t * 1.25 + uv.y * 7.0)
    ) * (0.0009 + 0.0024 * near);
    vec2 buv = uv + wob;
    float ca = 0.0012 * near + 0.0004;
    col.r = texture2D(tBelow, buv + vec2(ca, 0.0)).r;
    col.g = texture2D(tBelow, buv).g;
    col.b = texture2D(tBelow, buv - vec2(ca, 0.0)).b;
    // Total internal reflection band just under the surface.
    const float BAND = 0.055;
    float mb = 1.0 - smoothstep(0.0, BAND, d);
    if (mb > 0.0) {
      vec2 ruv = vec2(buv.x + sin(d * 150.0 - t * 2.4 + uv.x * 9.0) * 0.004 * mb, L - BAND * 2.0 + d);
      vec3 mir = texture2D(tBelow, ruv).rgb * 1.3 + vec3(0.06, 0.16, 0.18);
      col = mix(col, mir, smoothstep(BAND, BAND * 0.2, d) * 0.55);
      float streak = pow(0.5 + 0.5 * sin(uv.x * 140.0 + sin(uv.x * 13.0 + t * 0.8) * 5.0 - t * 2.6), 10.0);
      col += vec3(0.7, 1.0, 1.0) * streak * mb * mb * 0.35;
    }
    // Slanted sun shafts fanning down from the surface.
    vec2 q = vec2((uv.x - 0.5) * ASPECT, -d);
    float coord = q.x - q.y * 0.42 + q.x * q.y * 0.35;
    float sh = pow(0.5 + 0.5 * sin(coord * 21.0 + t * 0.23 + sin(coord * 6.0 - t * 0.17) * 2.2), 5.0) * 0.65;
    sh += pow(0.5 + 0.5 * sin(coord * 37.0 - t * 0.31 + 1.7), 9.0) * 0.45;
    sh *= 0.55 + 0.45 * sin(coord * 3.0 + t * 0.12);
    col += vec3(0.55, 0.95, 1.0) * sh * exp(-d * 4.2) * smoothstep(0.0, 0.03, d) * (0.24 + uBeat * 0.03);
    // Dark meniscus edge then a bright lip right at the line.
    col *= 1.0 - 0.62 * exp(-pow((d - 0.0055) / 0.0032, 2.0));
    col += flare(uv) * 0.2;
  }
  // Specular lip along the waterline.
  float lip = exp(-pow(s / 0.0032, 2.0));
  col += vec3(1.6, 1.85, 1.95) * lip * (0.8 + 0.2 * sin(uv.x * 80.0 - t * 2.2)) * (1.0 + uBeat * 0.15);
  // Soft-clamp extreme HDR (sun core, glints) so bloom stays a glow, not a fog.
  float peak = max(max(col.r, col.g), col.b);
  col *= peak > 1.6 ? (1.6 + (peak - 1.6) / (1.0 + (peak - 1.6) * 0.8)) / peak : 1.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export function useCompositeMaterial(shared, aboveTexture, belowTexture) {
  return useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          tAbove: { value: aboveTexture },
          tBelow: { value: belowTexture },
          uTime: shared.uTime,
          uBeat: shared.uBeat,
          uLineBase: { value: 0.55 },
          uLineTilt: { value: 0 },
          uRipples: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0.5, -100, 0, 0)) },
          uSun: { value: new THREE.Vector3(0.2, 0.9, 1) },
        },
        vertexShader,
        fragmentShader,
        depthTest: false,
        depthWrite: false,
      }),
    [aboveTexture, belowTexture],
  );
}

export function CompositeQuad({ material }) {
  return (
    <mesh material={material} frustumCulled={false} renderOrder={-10}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}
