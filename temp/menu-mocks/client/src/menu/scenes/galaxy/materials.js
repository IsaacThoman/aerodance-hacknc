import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noise } from '../../shared/glsl.js';

// Shared lighting rig for every lit object in the galaxy: a warm key light from
// the upper left (the galaxy core), a cool violet fill from the lower right,
// hemispheric cosmic ambient and a fresnel rim. All values are linear.
export const LIGHT = {
  keyDir: new THREE.Vector3(-0.72, 0.55, 0.32).normalize(),
  keyCol: new THREE.Color(1.18, 1.02, 0.88),
  fillDir: new THREE.Vector3(0.8, -0.35, 0.1).normalize(),
  fillCol: new THREE.Color(0.22, 0.16, 0.62),
  ambTop: new THREE.Color(0.16, 0.13, 0.3),
  ambBot: new THREE.Color(0.04, 0.1, 0.18),
};

const SOFTBOX = new THREE.Vector3(-0.45, 0.75, 0.5).normalize();

const VERT = /* glsl */ `
  attribute vec3 aCol;
  attribute float aEmit;
  varying vec3 vObjPos;
  varying vec3 vObjN;
  varying vec3 vWN;
  varying vec3 vWPos;
  varying vec3 vCol;
  varying float vEmit;
  void main() {
    vec4 p = vec4(position, 1.0);
    vec3 n = normal;
    vObjPos = position;
    vObjN = normal;
    #ifdef PAINTED
      vCol = aCol;
      vEmit = aEmit;
    #else
      vCol = vec3(1.0);
      vEmit = 0.0;
    #endif
    #ifdef USE_INSTANCING
      p = instanceMatrix * p;
      n = mat3(instanceMatrix) * n;
    #endif
    #ifdef USE_INSTANCING_COLOR
      vCol *= instanceColor;
    #endif
    vec4 wp = modelMatrix * p;
    vWPos = wp.xyz;
    vWN = normalize(mat3(modelMatrix) * n);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG_HEAD = /* glsl */ `
  uniform vec3 uKeyDir, uKeyCol, uFillDir, uFillCol, uAmbTop, uAmbBot, uRimCol;
  uniform float uRim, uTime, uFocus, uGloss, uShine, uAlpha, uEmitBoost, uHaze;
  uniform vec3 uHazeCol;
  uniform vec3 uSoftbox;
  varying vec3 vObjPos;
  varying vec3 vObjN;
  varying vec3 vWN;
  varying vec3 vWPos;
  varying vec3 vCol;
  varying float vEmit;
  struct Surf { vec3 albedo; float emit; float gloss; float shine; float rim; vec3 rimCol; float alpha; vec3 N; float wrap; vec3 add; };
  vec3 shade(Surf s, vec3 V) {
    vec3 N = s.N;
    float ndl = dot(N, uKeyDir);
    float lit = smoothstep(0.0, 1.0, clamp((ndl + s.wrap) / (1.0 + s.wrap), 0.0, 1.0));
    vec3 amb = mix(uAmbBot, uAmbTop, N.y * 0.5 + 0.5);
    vec3 fill = uFillCol * pow(max(dot(N, uFillDir), 0.0), 1.5);
    vec3 col = s.albedo * (uKeyCol * lit + amb + fill);
    vec3 H = normalize(uKeyDir + V);
    float spec = pow(max(dot(N, H), 0.0), s.shine) * s.gloss;
    col += uKeyCol * spec * smoothstep(-0.15, 0.25, ndl);
    // Aero softbox: a broad glossy window reflection from the upper left.
    vec3 Rv = reflect(-V, N);
    float box = smoothstep(0.78, 0.93, dot(Rv, uSoftbox)) * smoothstep(-0.2, 0.3, ndl);
    col += vec3(1.0, 0.97, 0.95) * box * s.gloss * 0.22;
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.6);
    col += s.rimCol * fres * s.rim * (1.0 + uFocus * 0.6);
    col += s.albedo * s.emit * uEmitBoost;
    col += s.add;
    return col;
  }
`;

const DEFAULT_SURFACE = /* glsl */ `
  void surface(inout Surf s, vec3 V) {}
`;

/**
 * Lit, stylised material used for planets, props and star bits.
 * surface: GLSL defining `void surface(inout Surf s, vec3 V)` that can change
 * albedo/emission/gloss/normal using vObjPos, vObjN, vCol, uTime...
 */
export function makeLit({
  surface = DEFAULT_SURFACE,
  painted = true,
  rim = '#9fb8ff',
  rimStrength = 0.8,
  gloss = 0.35,
  shine = 32,
  wrap = 0.35,
  emitBoost = 1,
  uniforms = {},
  transparent = false,
  alpha = 1,
  side = THREE.FrontSide,
  depthWrite = true,
  blending = THREE.NormalBlending,
  withNoise = false,
  haze = 0,
  hazeColor = '#2a1660',
} = {}) {
  return new THREE.ShaderMaterial({
    defines: painted ? { PAINTED: '' } : {},
    uniforms: {
      uKeyDir: { value: LIGHT.keyDir },
      uKeyCol: { value: LIGHT.keyCol },
      uFillDir: { value: LIGHT.fillDir },
      uFillCol: { value: LIGHT.fillCol },
      uAmbTop: { value: LIGHT.ambTop },
      uAmbBot: { value: LIGHT.ambBot },
      uRimCol: { value: new THREE.Color(rim) },
      uRim: { value: rimStrength },
      uTime: { value: 0 },
      uFocus: { value: 0 },
      uGloss: { value: gloss },
      uShine: { value: shine },
      uAlpha: { value: alpha },
      uEmitBoost: { value: emitBoost },
      uHaze: { value: haze },
      uSoftbox: { value: SOFTBOX },
      uHazeCol: { value: new THREE.Color(hazeColor) },
      ...uniforms,
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      ${FRAG_HEAD}
      ${withNoise ? noise : ''}
      ${surface}
      void main() {
        Surf s;
        s.albedo = vCol;
        s.emit = vEmit;
        s.gloss = uGloss;
        s.shine = uShine;
        s.rim = uRim;
        s.rimCol = uRimCol;
        s.alpha = uAlpha;
        s.wrap = ${wrap.toFixed(3)};
        s.add = vec3(0.0);
        s.N = normalize(vWN);
        if (!gl_FrontFacing) s.N = -s.N;
        vec3 V = normalize(cameraPosition - vWPos);
        surface(s, V);
        gl_FragColor = vec4(max(mix(shade(s, V), uHazeCol, uHaze), 0.0), s.alpha);
      }
    `,
    transparent,
    side,
    depthWrite,
    blending,
  });
}

/**
 * Back-face shell that adds a soft atmospheric halo around a sphere of radius
 * `inner`, drawn with additive blending.
 */
export function makeAtmosphere({ color = '#8fd8ff', inner = 1, outer = 1.18, strength = 1, power = 2.2 } = {}) {
  const ratio = inner / outer;
  const edge = Math.sqrt(1 - ratio * ratio);
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uStrength: { value: strength },
      uFocus: { value: 0 },
      uEdge: { value: edge },
      uPower: { value: power },
      uKeyDir: { value: LIGHT.keyDir },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWN;
      varying vec3 vWPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vWN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uKeyDir;
      uniform float uStrength, uFocus, uEdge, uPower;
      varying vec3 vWN;
      varying vec3 vWPos;
      void main() {
        vec3 V = normalize(cameraPosition - vWPos);
        vec3 N = normalize(vWN);
        float d = clamp(-dot(N, V) / uEdge, 0.0, 1.0);
        float glow = pow(d, uPower);
        // Brighter on the lit limb.
        float lit = 0.55 + 0.45 * clamp(dot(-N, uKeyDir) * 0.5 + 0.6, 0.0, 1.0);
        float a = glow * lit * uStrength * (1.0 + uFocus * 0.35);
        gl_FragColor = vec4(uColor * a, 1.0);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ---------------------------------------------------------------------------
// Geometry helpers. Everything is converted to non-indexed geometry carrying
// only position/normal/aCol/aEmit so pieces can be merged into one draw call.

const tmpColor = new THREE.Color();

/**
 * Bake a color (hex, THREE.Color or fn(x, y, z, nx, ny, nz, i) -> hex/Color)
 * and an emission amount into a geometry.
 */
export function paint(geo, color, emit = 0) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  g.clearGroups();
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const em = new Float32Array(n);
  const fn = typeof color === 'function';
  if (!fn) tmpColor.set(color);
  for (let i = 0; i < n; i++) {
    if (fn) tmpColor.set(color(pos.getX(i), pos.getY(i), pos.getZ(i), nrm.getX(i), nrm.getY(i), nrm.getZ(i), i));
    col[i * 3] = tmpColor.r;
    col[i * 3 + 1] = tmpColor.g;
    col[i * 3 + 2] = tmpColor.b;
    em[i] = typeof emit === 'function' ? emit(pos.getX(i), pos.getY(i), pos.getZ(i), i) : emit;
  }
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aEmit', new THREE.BufferAttribute(em, 1));
  return g;
}

export function merge(list) {
  const out = mergeGeometries(list, false);
  list.forEach((g) => g.dispose());
  return out;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Transform geometry in place: position, euler rotation, scale. */
export function xform(g, { p = [0, 0, 0], r = [0, 0, 0], s = 1 } = {}) {
  _q.setFromEuler(new THREE.Euler(r[0], r[1], r[2]));
  _s.set(...(Array.isArray(s) ? s : [s, s, s]));
  _m.compose(_p.set(...p), _q, _s);
  g.applyMatrix4(_m);
  return g;
}

/**
 * Stand a prop (modelled with +Y up, base at y=0) on a sphere of `radius`
 * at unit direction `dir`, twisted by `spin` around the local up axis.
 */
export function plant(g, radius, dir, spin = 0, sink = 0.02) {
  const d = _p.set(...dir).normalize();
  _q.setFromUnitVectors(UP, d);
  _q2.setFromAxisAngle(UP, spin);
  _q.multiply(_q2);
  _m.compose(d.clone().multiplyScalar(radius - sink), _q, _s.set(1, 1, 1));
  g.applyMatrix4(_m);
  return g;
}

/** Unit direction from latitude/longitude in degrees. */
export function dirLL(lat, lon) {
  const a = THREE.MathUtils.degToRad(lat);
  const b = THREE.MathUtils.degToRad(lon);
  return [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)];
}

/** A 5-point star shape with softly rounded tips. */
export function starShape(outer = 1, inner = 0.48, round = 0.12) {
  const shape = new THREE.Shape();
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outer : inner;
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  for (let i = 0; i < 10; i++) {
    const prev = pts[(i + 9) % 10];
    const cur = pts[i];
    const next = pts[(i + 1) % 10];
    const t = i % 2 === 0 ? round : round * 0.6;
    const a = cur.clone().lerp(prev, t);
    const b = cur.clone().lerp(next, t);
    if (i === 0) shape.moveTo(a.x, a.y);
    else shape.lineTo(a.x, a.y);
    shape.quadraticCurveTo(cur.x, cur.y, b.x, b.y);
  }
  shape.closePath();
  return shape;
}

/** Spiky crystalline "star bit": 12 points around a concave core. */
export function starBitGeometry() {
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const pos = ico.attributes.position;
  const verts = [];
  for (let f = 0; f < pos.count; f += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, f);
    const b = new THREE.Vector3().fromBufferAttribute(pos, f + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, f + 2);
    const m = a.clone().add(b).add(c).multiplyScalar(1 / 3).normalize().multiplyScalar(0.5);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) verts.push(p.x, p.y, p.z, q.x, q.y, q.z, m.x, m.y, m.z);
  }
  ico.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
}

/** Soft radial glow sprite texture (white, premultiplied-friendly). */
export function makeGlowTexture(size = 128, falloff = 2.2) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const v = Math.pow(1 - r, falloff);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(v * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Sprite-shape GLSL used by point-based effects (soft dot + 4-point flare). */
export const SPRITE_GLSL = /* glsl */ `
  float softDot(vec2 p) { return exp(-dot(p, p) * 5.0); }
  float flare4(vec2 p, float thin) {
    p = abs(p);
    float cr = exp(-p.x * thin) * exp(-p.y * 3.0) + exp(-p.y * thin) * exp(-p.x * 3.0);
    float core = exp(-dot(p, p) * 18.0);
    return cr * (1.0 - smoothstep(0.6, 1.0, length(p))) + core;
  }
`;

/** Clear glass with fresnel tint and a crisp key-light highlight. */
export function makeGlass({ tint = '#9fe6ff', base = 0.08, edge = 0.75 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTint: { value: new THREE.Color(tint) },
      uKeyDir: { value: LIGHT.keyDir },
      uBase: { value: base },
      uEdge: { value: edge },
      uFocus: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWN;
      varying vec3 vWPos;
      varying vec3 vObjPos;
      void main() {
        vObjPos = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vWN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint, uKeyDir;
      uniform float uBase, uEdge, uFocus, uTime;
      varying vec3 vWN;
      varying vec3 vWPos;
      varying vec3 vObjPos;
      void main() {
        vec3 V = normalize(cameraPosition - vWPos);
        vec3 N = normalize(vWN);
        if (!gl_FrontFacing) N = -N;
        float f = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 2.2);
        vec3 H = normalize(uKeyDir + V);
        float spec = pow(max(dot(N, H), 0.0), 90.0) * 2.5;
        // A soft diagonal streak that slides across the glass.
        float sx = (vObjPos.x + vObjPos.y * 0.6 - sin(uTime * 0.4) * 0.6) * 9.0;
        float streak = exp(-sx * sx) * 0.35;
        float a = clamp(uBase + f * uEdge + spec + streak, 0.0, 1.0);
        vec3 col = uTint * (0.45 + f * (1.0 + uFocus * 0.3)) + vec3(1.0) * (spec + streak) * 1.2;
        gl_FragColor = vec4(col * a, a);
      }
    `,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
