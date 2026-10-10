import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Unit-height tree models (trunk aPart = 0, canopy aPart = 1).

function part(geometry, color, aPart) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const colors = new Float32Array(n * 3);
  const parts = new Float32Array(n).fill(aPart);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(parts, 1));
  g.deleteAttribute('uv');
  return g;
}

function blob(radius, detail, center, squash = [1, 1, 1], lump = 0.12, seed = 0) {
  let g = new THREE.IcosahedronGeometry(radius, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + lump * Math.sin(v.x * 9 + seed) * Math.sin(v.y * 7 + seed * 2) * Math.sin(v.z * 8 + seed * 3);
    v.multiplyScalar(k);
    v.set(v.x * squash[0], v.y * squash[1], v.z * squash[2]).add(center);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

const TRUNK = '#7a5c43';

export function makeRoundTree() {
  const trunk = new THREE.CylinderGeometry(0.04, 0.065, 0.55, 6, 1).translate(0, 0.27, 0);
  const a = blob(0.36, 1, new THREE.Vector3(0, 0.66, 0), [1, 0.92, 1], 0.14, 1);
  const b = blob(0.25, 0, new THREE.Vector3(0.2, 0.58, 0.08), [1, 0.9, 1], 0.1, 2);
  const c = blob(0.22, 0, new THREE.Vector3(-0.12, 0.84, -0.06), [1, 0.9, 1], 0.1, 3);
  return mergeGeometries([part(trunk, TRUNK, 0), part(a, '#ffffff', 1), part(b, '#ffffff', 1), part(c, '#ffffff', 1)]);
}

export function makeConeTree() {
  const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.3, 5, 1).translate(0, 0.15, 0);
  const crown = blob(0.5, 1, new THREE.Vector3(0, 0.6, 0), [0.42, 1, 0.42], 0.06, 4);
  return mergeGeometries([part(trunk, TRUNK, 0), part(crown, '#ffffff', 1)]);
}

export function makePalm() {
  const parts = [];
  // Gently curved trunk built from stacked segments.
  const segs = 5;
  for (let i = 0; i < segs; i++) {
    const y0 = (i / segs) * 0.78;
    const seg = new THREE.CylinderGeometry(0.03, 0.04, 0.78 / segs + 0.01, 6, 1);
    seg.translate(Math.pow(i / segs, 2) * 0.1, y0 + 0.078, 0);
    parts.push(part(seg, '#9a7b55', 0));
  }
  const top = new THREE.Vector3(0.1, 0.8, 0);
  for (let k = 0; k < 7; k++) {
    const frond = new THREE.PlaneGeometry(0.5, 0.13, 5, 1);
    const p = frond.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + 0.25;
      const y = p.getY(i);
      // Taper and droop.
      p.setXYZ(i, x, -x * x * 0.9 + 0.06 * x, y * (1 - x * 1.4));
    }
    frond.computeVertexNormals();
    frond.rotateX(Math.PI / 2);
    frond.rotateY((k / 7) * Math.PI * 2 + 0.3);
    frond.translate(top.x, top.y, top.z);
    parts.push(part(frond, '#ffffff', 1));
  }
  return mergeGeometries(parts);
}

export const TREE_GREENS = ['#4fae3a', '#69c247', '#3c9a3c', '#8bd04c', '#2f8f4e', '#5dbb5a', '#7cc84a'];
export const BLOSSOMS = ['#ffc2dc', '#ffffff', '#ffe08a'];
