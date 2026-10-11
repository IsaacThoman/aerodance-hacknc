import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeTagged } from './geometry.js';

// Unit-height tree models: trunk (aPart = 0) keeps its color, canopy (aPart = 1)
// is tinted per instance and sways in the wind.

const TRUNK = [0.36, 0.24, 0.15];

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

const leaf = (geometry) => ({ geometry, color: [1, 1, 1], extra: { aPart: 1 } });
const wood = (geometry, color = TRUNK) => ({ geometry, color, extra: { aPart: 0 } });

function build(parts) {
  const g = mergeTagged(parts);
  parts.forEach((p) => p.geometry.dispose());
  return g;
}

export function makeRoundTree(detail = 1) {
  return build([
    wood(new THREE.CylinderGeometry(0.04, 0.065, 0.55, 6, 1).translate(0, 0.27, 0)),
    leaf(blob(0.36, detail, new THREE.Vector3(0, 0.66, 0), [1, 0.92, 1], 0.14, 1)),
    leaf(blob(0.25, 0, new THREE.Vector3(0.2, 0.58, 0.08), [1, 0.9, 1], 0.1, 2)),
    leaf(blob(0.22, 0, new THREE.Vector3(-0.12, 0.84, -0.06), [1, 0.9, 1], 0.1, 3)),
  ]);
}

export function makeConeTree() {
  return build([
    wood(new THREE.CylinderGeometry(0.035, 0.05, 0.3, 5, 1).translate(0, 0.15, 0)),
    leaf(blob(0.5, 1, new THREE.Vector3(0, 0.6, 0), [0.42, 1, 0.42], 0.06, 4)),
  ]);
}

export function makePalm() {
  const parts = [];
  const segs = 5;
  for (let i = 0; i < segs; i++) {
    const seg = new THREE.CylinderGeometry(0.03, 0.04, 0.78 / segs + 0.01, 6, 1);
    seg.translate(Math.pow(i / segs, 2) * 0.1, (i / segs) * 0.78 + 0.078, 0);
    parts.push(wood(seg, [0.6, 0.48, 0.33]));
  }
  for (let k = 0; k < 7; k++) {
    const frond = new THREE.PlaneGeometry(0.5, 0.13, 5, 1);
    const p = frond.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + 0.25;
      p.setXYZ(i, x, -x * x * 0.9 + 0.06 * x, p.getY(i) * (1 - x * 1.4));
    }
    frond.computeVertexNormals();
    frond.rotateX(Math.PI / 2);
    frond.rotateY((k / 7) * Math.PI * 2 + 0.3);
    frond.translate(0.1, 0.8, 0);
    parts.push(leaf(frond));
  }
  return build(parts);
}

export const TREE_GREENS = ['#4fae3a', '#69c247', '#3c9a3c', '#8bd04c', '#2f8f4e', '#5dbb5a', '#7cc84a', '#a3d957'];
