import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRandom } from '../shared/random.js';

// Small procedural toolkit: builders return non-indexed geometry with
// position, normal, color (linear) and aSway so pieces merge into few draw calls.

const _c = new THREE.Color();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();

export const color = (hex) => new THREE.Color(hex);

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
  const mix = (a, b, t) => a + (b - a) * t;
  const h = (x, y, z) => vals[perm[perm[perm[x & 255] + (y & 255)] + (z & 255)]];
  return (x, y, z = 0) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = fade(x - xi);
    const yf = fade(y - yi);
    const zf = fade(z - zi);
    const x0 = mix(h(xi, yi, zi), h(xi + 1, yi, zi), xf);
    const x1 = mix(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), xf);
    const x2 = mix(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), xf);
    const x3 = mix(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), xf);
    return mix(mix(x0, x1, yf), mix(x2, x3, yf), zf);
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
 * paint: hex, THREE.Color or fn(p, n, outColor); sway: number or fn(p).
 */
export function finalize(geo, { paint = '#ffffff', sway = 0, smooth = false } = {}) {
  let g = geo;
  if (smooth && !g.index) g = mergeVertices(g);
  if (!g.attributes.normal || smooth) g.computeVertexNormals();
  if (g.index) g = g.toNonIndexed();
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
        arr.set([_c.r, _c.g, _c.b], i * 3);
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
      for (let i = 0; i < count; i++) arr[i] = sway(_p.fromBufferAttribute(pos, i));
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

/** Apply a transform built from position / euler / scale. */
export function place(geo, { position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 } = {}) {
  _m.compose(
    _t.set(...position),
    _q.setFromEuler(_e.set(...rotation)),
    typeof scale === 'number' ? _s.set(scale, scale, scale) : _s.set(...scale),
  );
  geo.applyMatrix4(_m);
  return geo;
}

/** Tube along a curve with a radius function and optional color / sway per ring. */
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

/** Noise-displaced, squashed sphere for rocks, bushes, hills. */
export function blob({ radius = 1, detail = 3, squash = [1, 1, 1], amount = 0.18, freq = 1.4, seed = 1, flatBottom = false } = {}) {
  const noise = makeNoise3(seed);
  let g = new THREE.IcosahedronGeometry(radius, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    _n.copy(_p).normalize();
    const d = 1 + amount * fbm3(noise, _n.x * freq + 3.1, _n.y * freq, _n.z * freq, 3);
    _p.copy(_n).multiplyScalar(radius * d);
    _p.set(_p.x * squash[0], _p.y * squash[1], _p.z * squash[2]);
    if (flatBottom && _p.y < 0) _p.y *= 0.2;
    pos.setXYZ(i, _p.x, _p.y, _p.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Lathe from [radius, height] pairs. */
export function lathe(points, segments = 24, phiStart = 0, phiLength = Math.PI * 2) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segments, phiStart, phiLength);
}

/** Smoothly shaded indexed triangle list from flat arrays. */
export function mesh(positions, indices, colors = null, sways = null) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  if (sways) g.setAttribute('aSway', new THREE.Float32BufferAttribute(sways, 1));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
