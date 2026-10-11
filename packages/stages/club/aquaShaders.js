// Aquarium shaders: water light, coral silhouettes, sand, glass, fish and bubbles.
import { bubbleSpriteGLSL, clubCommon } from './patch.js';
import { FLOOR, TANK } from './layout.js';

export const SAND = FLOOR + 0.6;
export const TOP = TANK.y1 - 0.3;
const SPAN = TANK.half * 2 + 0.3; // fish wrap out of sight behind the walls
export const CURTAIN_R = 15.6;

export const vertexWorld = /* glsl */ `
varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

// Shared water look: bright aqua light from above fading to deep blue, sun rays
// and a caustic shimmer near the surface.
const waterGLSL = /* glsl */ `
vec3 tankWater(float s, float y) {
  float h = clamp((y - ${SAND.toFixed(2)}) / ${(TOP - SAND + 1.5).toFixed(2)}, 0.0, 1.0);
  vec3 col = mix(vec3(0.003, 0.02, 0.1), vec3(0.0, 0.16, 0.46), smoothstep(0.0, 0.7, h));
  col = mix(col, vec3(0.06, 0.55, 1.0), smoothstep(0.7, 1.0, h));
  float rays = pow(0.5 + 0.5 * sin(s * 1.1 + y * 0.22 + uTime * 0.35), 6.0)
             + pow(0.5 + 0.5 * sin(s * 1.9 - y * 0.15 - uTime * 0.27 + 1.7), 9.0);
  col += vec3(0.2, 0.75, 1.0) * rays * 0.2 * smoothstep(0.2, 0.95, h);
  float c = sin(s * 3.0 + sin(y * 2.0 + uTime)) * sin(y * 3.1 + sin(s * 2.0 - uTime * 1.3));
  col += vec3(0.5, 1.0, 1.0) * pow(abs(c), 8.0) * 0.45 * smoothstep(0.55, 1.0, h);
  return col;
}

// Coral silhouettes on a strip: boulders, sea fans and staghorn.
float coral(vec2 q, float seed, out float cid, out float ty) {
  float cell = floor(q.x);
  float m = 0.0;
  cid = 0.0;
  ty = 0.0;
  for (int k = -1; k <= 1; k++) {
    float c = cell + float(k);
    float h1 = hash11(c * 1.37 + seed);
    float h2 = hash11(c * 2.71 + seed + 5.0);
    float h3 = hash11(c * 4.13 + seed + 9.0);
    vec2 d = q - vec2(c + 0.5 + (h1 - 0.5) * 0.6, 0.0);
    float shape = 0.0;
    float hgt = 0.0;
    if (h2 < 0.35) {
      float r = 0.32 + 0.3 * h3;
      shape = smoothstep(r + 0.03, r - 0.03, length(d * vec2(1.0, 1.25) - vec2(0.0, r * 0.35)));
      hgt = r * 1.1;
    } else if (h2 < 0.7) {
      float r = 0.55 + 0.45 * h3;
      float l = length(d);
      float ang = atan(d.y, d.x);
      float veins = max(smoothstep(0.3, 0.12, abs(fract(ang * 5.0) - 0.5)), smoothstep(0.3, 0.12, abs(fract(l * 6.0) - 0.5)));
      shape = smoothstep(r, r - 0.05, l) * step(0.0, d.y) * (0.35 + 0.65 * veins);
      hgt = r;
    } else {
      for (int j = 0; j < 3; j++) {
        float fj = float(j) - 1.0;
        float hh = 0.55 + 0.55 * hash11(c + float(j) * 3.3 + seed);
        float yy = clamp(d.y / hh, 0.0, 1.0);
        float x = d.x - fj * 0.2 - fj * 0.35 * yy * yy;
        float w = 0.08 * (1.0 - yy * 0.45);
        shape = max(shape, smoothstep(w, w * 0.5, abs(x)) * step(0.0, d.y) * step(d.y, hh));
        shape = max(shape, smoothstep(0.11, 0.08, length(vec2(x, d.y - hh))));
        hgt = max(hgt, hh);
      }
    }
    if (shape > m) { m = shape; cid = h3; ty = d.y / max(hgt, 0.01); }
  }
  return m;
}

vec3 coralColor(float cid) {
  vec3 a = vec3(1.0, 0.36, 0.62);
  vec3 b = vec3(1.0, 0.55, 0.2);
  vec3 c = vec3(0.62, 0.38, 1.0);
  vec3 d = vec3(0.55, 1.0, 0.35);
  return cid < 0.25 ? a : cid < 0.5 ? b : cid < 0.75 ? c : d;
}
`;

export const backFragment = /* glsl */ `
${clubCommon}
${waterGLSL}
varying vec3 vW;
#include <fog_pars_fragment>
void main() {
  float uSeed = vW.x < 0.0 ? 2.0 : 15.7;
  float s = atan(vW.x, vW.z) * ${TANK.back.toFixed(2)};
  float y = vW.y;
  vec3 col = tankWater(s, y);
  // Distant rock ridge and coral, hazy blue.
  float ridge = ${SAND.toFixed(2)} + 0.9 + 0.5 * sin(s * 0.45 + uSeed) + 0.3 * sin(s * 1.3 + uSeed * 2.0);
  col = mix(col, vec3(0.02, 0.16, 0.36), smoothstep(ridge + 0.05, ridge - 0.05, y));
  float cid, ty;
  float far = coral(vec2(s / 1.3, (y - ridge + 0.2) / 1.3), uSeed + 11.0, cid, ty);
  col = mix(col, mix(vec3(0.05, 0.25, 0.5), coralColor(cid) * 0.45, 0.35) * (0.7 + 0.5 * ty), far);
  // Kelp swaying in the current.
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float kx = s * 0.8 + fi * 0.37 + uSeed;
    float kc = floor(kx);
    float kh = hash11(kc + fi * 7.0);
    float kTop = ridge + 2.0 + kh * 4.0;
    float sway = 0.25 * sin(y * 0.9 + uTime * 0.8 + kc) * smoothstep(ridge, kTop, y);
    float kd = abs(fract(kx) - 0.5 - sway * 0.8) ;
    float kelp = smoothstep(0.07, 0.04, kd) * step(y, kTop) * step(0.45, kh);
    col = mix(col, vec3(0.08, 0.42, 0.3) * (0.6 + 0.6 * smoothstep(ridge, kTop, y)), kelp * 0.85);
  }
  // Ball dots reach the tank too.
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

// Nearer coral reef curtain (cut-out) for parallax in front of the back wall.
export const curtainFragment = /* glsl */ `
${clubCommon}
${waterGLSL}
varying vec3 vW;
#include <fog_pars_fragment>
void main() {
  float uSeed = vW.x < 0.0 ? 1.0 : 6.3;
  float s = atan(vW.x, vW.z) * ${CURTAIN_R.toFixed(2)};
  float y = vW.y;
  float base = ${SAND.toFixed(2)} + 0.15 + 0.25 * sin(s * 0.7 + uSeed);
  float cid, ty;
  float m = coral(vec2(s / 0.95, (y - base) / 0.95), uSeed, cid, ty);
  float rock = smoothstep(base + 0.05, base - 0.05, y);
  m = max(m, rock);
  if (m < 0.5) discard;
  vec3 c = mix(coralColor(cid), vec3(0.3, 0.4, 0.6), rock);
  float light = 0.35 + 0.75 * clamp(ty, 0.0, 1.0);
  vec3 water = tankWater(s, y);
  vec3 col = c * light * 0.75 + water * 0.2;
  col += vec3(0.5, 1.0, 1.0) * pow(0.5 + 0.5 * sin(s * 4.0 + uTime * 1.3) * sin(y * 5.0 - uTime), 6.0) * 0.25 * light;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

export const sandFragment = /* glsl */ `
${clubCommon}
varying vec3 vW;
#include <fog_pars_fragment>
void main() {
  vec2 p = vW.xz;
  float c = sin(p.x * 3.0 + sin(p.y * 2.0 + uTime)) * sin(p.y * 3.1 + sin(p.x * 2.0 - uTime * 1.3));
  vec3 col = vec3(0.06, 0.2, 0.36) + vec3(0.3, 0.8, 0.9) * pow(abs(c), 6.0) * 0.35;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

// Aero glass: faint cyan tint, fresnel and diagonal gloss streaks, additive.
export const glassFragment = /* glsl */ `
${clubCommon}
varying vec3 vW;
void main() {
  float s = atan(vW.x, vW.z) * ${TANK.glass.toFixed(2)};
  float y = vW.y;
  vec3 v = normalize(cameraPosition - vW);
  vec3 n = normalize(vec3(-vW.x, 0.0, -vW.z));
  float fr = pow(1.0 - abs(dot(v, n)), 3.0);
  float streak = smoothstep(0.25, 0.0, abs(fract((s * 0.55 + y * 0.35) * 0.18) - 0.5) - 0.18);
  float streak2 = smoothstep(0.06, 0.0, abs(fract((s * 0.55 + y * 0.35) * 0.18 + 0.12) - 0.5) - 0.02);
  vec3 col = vec3(0.6, 0.95, 1.0) * (0.02 + fr * 0.18) + vec3(0.8, 0.95, 1.0) * (streak * 0.05 + streak2 * 0.08);
  col *= smoothstep(${TOP.toFixed(2)}, ${(TOP - 3).toFixed(2)}, y) * 0.6 + 0.4;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const fishVertex = /* glsl */ `
uniform float uTime;
attribute float aU;
attribute float aFin;
attribute vec4 aSeed;   // phase, depth, height, speed
attribute vec4 aLook;   // pattern, size, tank theta, direction
attribute vec3 aBody;
attribute vec3 aAccent;
varying vec3 vN;
varying vec3 vW;
varying vec3 vLocal;
varying float vU;
varying float vFin;
varying vec3 vBody;
varying vec3 vAccent;
varying float vPattern;
#include <fog_pars_vertex>

vec3 path(float t) {
  float r = 14.2 + aSeed.y * 1.2 + 0.12 * sin(t * 0.5 + aSeed.x * 20.0);
  float th = aLook.z + aLook.w * (fract(aSeed.x + t * aSeed.w / (r * ${SPAN.toFixed(4)})) - 0.5) * ${SPAN.toFixed(4)};
  float y = ${(SAND + 0.5).toFixed(2)} + aSeed.z * ${(TOP - SAND - 1.4).toFixed(2)} + 0.35 * sin(t * 0.37 + aSeed.x * 31.0);
  return vec3(r * sin(th), y, r * cos(th));
}

void main() {
  vec3 p0 = path(uTime);
  vec3 fwd = path(uTime + 0.05) - p0;
  float len = length(fwd);
  fwd = len > 1e-5 ? fwd / len : vec3(1.0, 0.0, 0.0);
  fwd.y = clamp(fwd.y, -0.4, 0.4);
  fwd = normalize(fwd);
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, side);
  vec3 lp = position;
  float tail = smoothstep(0.25, 1.0, aU);
  float ph = uTime * (7.0 + aSeed.w * 3.0) + aSeed.x * 40.0;
  lp.x += sin(ph - aU * 5.0) * tail * tail * 0.16;
  vLocal = position;
  vU = aU;
  vFin = aFin;
  vBody = aBody;
  vAccent = aAccent;
  vPattern = aLook.x;
  vec3 wp = p0 + (side * lp.x + up * lp.y + fwd * lp.z) * aLook.y;
  vN = normalize(side * normal.x + up * normal.y + fwd * normal.z);
  vW = wp;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const fishFragment = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
varying vec3 vLocal;
varying float vU;
varying float vFin;
varying vec3 vBody;
varying vec3 vAccent;
varying float vPattern;
#include <fog_pars_fragment>
void main() {
  vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 v = normalize(cameraPosition - vW);
  vec3 base = vBody;
  if (vPattern > 0.5 && vPattern < 1.5) {
    float band = smoothstep(0.05, 0.03, abs(fract(vU * 3.2 + 0.15) - 0.5) - 0.08) * step(vU, 0.75);
    base = mix(base, vAccent, band);
  } else if (vPattern > 1.5) {
    base = mix(base, vAccent, smoothstep(0.03, 0.0, abs(vLocal.y - 0.02 * sin(vU * 9.0)) - 0.03) * step(vU, 0.7));
  } else {
    base = mix(vAccent, base, smoothstep(-0.12, 0.05, vLocal.y));
  }
  base = mix(base, vAccent, vFin * 0.5);
  float eye = smoothstep(0.035, 0.022, length(vec2(vLocal.z - 0.38, vLocal.y - 0.04))) * (1.0 - vFin);
  base = mix(base, vec3(0.02), eye);
  float h = clamp((vW.y + 0.5) / 10.0, 0.0, 1.0);
  vec3 light = vec3(0.45, 0.95, 1.1) * (0.35 + 0.65 * h);
  float diff = 0.45 + 0.55 * max(n.y, 0.0);
  vec3 col = base * (vec3(0.08, 0.2, 0.4) + light * diff);
  vec3 hv = normalize(vec3(0.0, 1.0, 0.0) + v);
  col += light * pow(max(dot(n, hv), 0.0), 40.0) * 0.6 * (1.0 - vFin);
  float fr = pow(1.0 - abs(dot(n, v)), 2.0);
  col += vec3(0.4, 0.9, 1.0) * fr * 0.25;
  // Water between the glass and the fish.
  float depth = length(vW.xz) - ${TANK.glass.toFixed(2)};
  col = mix(col, vec3(0.03, 0.3, 0.6) * (0.4 + 0.8 * h), clamp(depth * 0.18, 0.0, 0.6));
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

export const bubbleVertex = /* glsl */ `
uniform float uTime;
attribute vec4 aSeed; // theta, radius, phase, speed
varying float vAlpha;
void main() {
  float hgt = ${(TOP - SAND).toFixed(2)};
  float k = fract(aSeed.z + uTime * aSeed.w / hgt);
  float th = aSeed.x + 0.012 * sin(uTime * 3.0 + aSeed.z * 30.0) * k;
  vec3 p = vec3(aSeed.y * sin(th), ${SAND.toFixed(2)} + k * hgt, aSeed.y * cos(th));
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.07 + 0.08 * fract(aSeed.z * 7.0)) * (1.0 + k * 0.6) * 600.0 / -mv.z;
  vAlpha = smoothstep(0.0, 0.05, k) * smoothstep(1.0, 0.92, k);
}
`;


export const bubbleFragment = /* glsl */ `
varying float vAlpha;
${bubbleSpriteGLSL}
void main() {
  float a = bubbleSprite(gl_PointCoord) * vAlpha;
  gl_FragColor = vec4(vec3(0.6, 0.95, 1.0) * a * 0.9, 1.0);
}
`;
