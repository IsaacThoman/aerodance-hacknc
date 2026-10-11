import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRandom } from '../shared/random.js';

// Small procedural toolkit: builders return non-indexed geometry with
// position, normal, color (linear) and aSway so pieces merge into few draws.

const _c = new THREE.Color();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();

export const ss = THREE.MathUtils.smoothstep;

export function color(hex) {
  return new THREE.Color(hex);
}

/** Smooth 3D value noise in [-1, 1]. */
export function makeNoise3(seed = 1) {
  const rand = makeRandom(seed);
  const perm = new Uint16Array(512);
  const vals = new Float32Array(256);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand.next() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) vals[i] = rand.next() * 2 - 1;
  const fade = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const h = (x, y, z) => vals[perm[perm[perm[x & 255] + (y & 255)] + (z & 255)]];
  return (x, y, z = 0) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = fade(x - xi);
    const yf = fade(y - yi);
    const zf = fade(z - zi);
    const x0 = lerp(h(xi, yi, zi), h(xi + 1, yi, zi), xf);
    const x1 = lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), xf);
    const x2 = lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), xf);
    const x3 = lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), xf);
    return lerp(lerp(x0, x1, yf), lerp(x2, x3, yf), zf);
  };
}

export function fbm3(noise, x, y, z, octaves = 3) {
  let v = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    v += a * noise(x * f, y * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return v;
}

/**
 * Normalise a geometry for merging: non-indexed, position/normal/color/aSway.
 * paint: hex string, THREE.Color, or fn(p, n, outColor) in object space.
 * sway: number or fn(p) -> weight (0 = rigid).
 */
export function finalize(geo, { paint = '#ffffff', sway = 0 } = {}) {
  let g = geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (g.index) {
    const flat = g.toNonIndexed();
    g.dispose();
    g = flat;
  }
  for (const name of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'color', 'aSway'].includes(name)) g.deleteAttribute(name);
  }
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const count = pos.count;
  if (!g.attributes.color) {
    const arr = new Float32Array(count * 3);
    if (typeof paint === 'function') {
      for (let i = 0; i < count; i++) {
        _p.fromBufferAttribute(pos, i);
        _n.fromBufferAttribute(nrm, i);
        paint(_p, _n, _c);
        arr[i * 3] = _c.r;
        arr[i * 3 + 1] = _c.g;
        arr[i * 3 + 2] = _c.b;
      }
    } else {
      _c.set(paint);
      for (let i = 0; i < count; i++) arr.set([_c.r, _c.g, _c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  if (!g.attributes.aSway) {
    const arr = new Float32Array(count);
    if (typeof sway === 'function') {
      for (let i = 0; i < count; i++) {
        _p.fromBufferAttribute(pos, i);
        arr[i] = sway(_p);
      }
    } else arr.fill(sway);
    g.setAttribute('aSway', new THREE.BufferAttribute(arr, 1));
  }
  g.groups = [];
  return g;
}

export function merge(list) {
  const g = mergeGeometries(list, false);
  list.forEach((x) => x.dispose());
  g.computeBoundingSphere();
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _t = new THREE.Vector3();

/** Apply a matrix built from position / euler / scale. */
export function place(geo, { position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 } = {}) {
  _m.compose(
    _t.set(...position),
    _q.setFromEuler(_e.set(...rotation)),
    typeof scale === 'number' ? _s.setScalar(scale) : _s.set(...scale),
  );
  geo.applyMatrix4(_m);
  return geo;
}

/**
 * Tube along a curve with a radius function; colorFn(t, angle, outColor) and
 * swayFn(t) give per-vertex color and sway.
 */
export function taperedTube(curve, tubular, radial, radiusFn, { colorFn = null, swayFn = null } = {}) {
  const frames = curve.computeFrenetFrames(tubular, false);
  const positions = [];
  const normals = [];
  const colors = [];
  const sways = [];
  const indices = [];
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, P);
    const r = radiusFn(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      N.set(0, 0, 0).addScaledVector(frames.normals[i], -Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a)).normalize();
      positions.push(P.x + r * N.x, P.y + r * N.y, P.z + r * N.z);
      normals.push(N.x, N.y, N.z);
      if (colorFn) {
        colorFn(t, a, _c);
        colors.push(_c.r, _c.g, _c.b);
      }
      sways.push(swayFn ? swayFn(t) : 0);
    }
  }
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = (i + 1) * (radial + 1) + j;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (colorFn) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sways, 1));
  g.setIndex(indices);
  return g;
}

/** Noise-displaced, squashed sphere ("blob") for rocks and coral heads. */
export function blob({ radius = 1, detail = 3, squash = [1, 1, 1], amount = 0.18, freq = 1.4, seed = 1, flatBottom = false } = {}) {
  const noise = makeNoise3(seed);
  const ico = new THREE.IcosahedronGeometry(radius, detail);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const g = mergeVertices(ico);
  ico.dispose();
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    _n.copy(_p).normalize();
    const d = 1 + amount * fbm3(noise, _n.x * freq + 3.1, _n.y * freq, _n.z * freq, 3);
    _p.copy(_n).multiplyScalar(radius * d);
    _p.set(_p.x * squash[0], _p.y * squash[1], _p.z * squash[2]);
    if (flatBottom && _p.y < 0) _p.y *= 0.25;
    pos.setXYZ(i, _p.x, _p.y, _p.z);
  }
  g.computeVertexNormals();
  return g;
}
