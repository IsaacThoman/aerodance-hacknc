import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Horizontal tube following a circular arc around the y axis, using cylinder
// thetas (x = r sin(theta), z = r cos(theta)).
export function arcTube(r, thetaStart, length, tube, y = 0, segments = 64) {
  const g = new THREE.TorusGeometry(r, tube, 10, segments, length);
  g.rotateX(Math.PI / 2);
  g.rotateY(thetaStart - (Math.PI / 2 - length));
  g.translate(0, y, 0);
  return g;
}

// Open cylinder band (a slice of wall) between y0 and y1.
export function arcBand(r, thetaStart, length, y0, y1, segments = 64) {
  return new THREE.CylinderGeometry(r, r, y1 - y0, segments, 1, true, thetaStart, length).translate(0, (y0 + y1) / 2, 0);
}

// Teardrop gumdrop body for aeroling blobs, base at y = 0, height 1.
export function blobGeometry(segments = 20) {
  const pts = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = -Math.PI / 2 + t * Math.PI;
    // Wide soft base narrowing to a round head.
    const w = Math.cos(a) * (0.5 - 0.1 * t);
    const y = (Math.sin(a) * 0.5 + 0.5) * 1.0;
    pts.push(new THREE.Vector2(Math.max(w, 0.0001), y));
  }
  return new THREE.LatheGeometry(pts, segments);
}

// Merge geometries into one, reconciling indexed/non-indexed inputs and
// attribute sets, and dispose of the inputs.
export function mergeAll(list) {
  const mixed = list.some((g) => g.index) && list.some((g) => !g.index);
  const prepared = mixed ? list.map((g) => (g.index ? g.toNonIndexed() : g)) : list;
  const names = Object.keys(prepared[0].attributes).filter((n) => prepared.every((g) => g.attributes[n]));
  for (const g of prepared) for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
  const merged = mergeGeometries(prepared);
  new Set([...list, ...prepared]).forEach((g) => g.dispose());
  return merged;
}
