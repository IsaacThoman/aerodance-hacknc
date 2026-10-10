import * as THREE from 'three';
import { paint, xform } from './materials.js';
import { smoothstep } from '../../shared/random.js';

// Small procedural props, modelled with +Y up and their base at y = 0.
// Each builder returns an array of painted geometries ready to merge.

const ca = new THREE.Color();
const cb = new THREE.Color();
const out = new THREE.Color();

/** Vertical gradient color function between two hex colors over local y. */
export function vgrad(bottom, top, y0, y1) {
  ca.set(bottom);
  const a = ca.clone();
  cb.set(top);
  const b = cb.clone();
  return (x, y) => out.copy(a).lerp(b, smoothstep(y0, y1, y));
}

function sphere(r, color, { p = [0, 0, 0], s = 1, w = 12, h = 9, emit = 0 } = {}) {
  const g = new THREE.SphereGeometry(r, w, h);
  return xform(paint(g, typeof color === 'string' ? vgrad(shadeHex(color, 0.62), color, -r, r * 0.6) : color, emit), { p, s });
}

/** Darken (k<1) or lighten a hex color, returns hex string. */
export function shadeHex(hex, k) {
  const c = new THREE.Color(hex);
  if (k < 1) c.multiplyScalar(k);
  else c.lerp(new THREE.Color(1, 1, 1), k - 1);
  return `#${c.getHexString()}`;
}

export function roundTree(rand, { canopy = '#55c94f', trunk = '#8a5a3c', size = 1 } = {}) {
  const h = 0.42 * size;
  const parts = [xform(paint(new THREE.CylinderGeometry(0.04 * size, 0.07 * size, h, 6), trunk), { p: [0, h / 2, 0] })];
  const r = 0.3 * size;
  parts.push(sphere(r, canopy, { p: [0, h + r * 0.55, 0] }));
  const n = rand.int(2, 3);
  for (let i = 0; i < n; i++) {
    const a = rand.range(0, Math.PI * 2);
    const rr = r * rand.range(0.55, 0.72);
    parts.push(sphere(rr, canopy, { p: [Math.cos(a) * r * 0.62, h + r * rand.range(0.2, 0.9), Math.sin(a) * r * 0.62] }));
  }
  return parts;
}

export function poplarTree(rand, { canopy = '#3fb86a', trunk = '#7a4d33', size = 1 } = {}) {
  const h = 0.3 * size;
  return [
    xform(paint(new THREE.CylinderGeometry(0.035 * size, 0.06 * size, h, 6), trunk), { p: [0, h / 2, 0] }),
    sphere(0.2 * size, canopy, { p: [0, h + 0.36 * size, 0], s: [1, 2.1, 1] }),
  ];
}

export function pineTree(rand, { color = '#2fa37a', trunk = '#6e4630', size = 1 } = {}) {
  const parts = [xform(paint(new THREE.CylinderGeometry(0.035 * size, 0.05 * size, 0.2 * size, 6), trunk), { p: [0, 0.1 * size, 0] })];
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const r = (0.3 - i * 0.07) * size;
    const hh = 0.32 * size;
    const y = (0.16 + i * 0.17) * size + hh / 2;
    parts.push(xform(paint(new THREE.ConeGeometry(r, hh, 9, 1), vgrad(shadeHex(color, 0.55), shadeHex(color, 1.15), -hh / 2, hh / 2)), { p: [0, y, 0] }));
  }
  return parts;
}

export function bush(rand, { color = '#45b85a', size = 1 } = {}) {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rand.range(0, 1);
    const r = 0.13 * size * rand.range(0.8, 1.15);
    parts.push(sphere(r, color, { p: [Math.cos(a) * 0.1 * size, r * 0.7, Math.sin(a) * 0.1 * size], w: 9, h: 7 }));
  }
  return parts;
}

export function flower(rand, { color = '#ff8ccf', size = 1 } = {}) {
  const h = rand.range(0.08, 0.16) * size;
  return [
    xform(paint(new THREE.CylinderGeometry(0.008, 0.01, h, 4), '#3f9e43'), { p: [0, h / 2, 0] }),
    xform(paint(new THREE.IcosahedronGeometry(0.042 * size, 1), color, 0.35), { p: [0, h + 0.02, 0], s: [1, 0.7, 1] }),
    xform(paint(new THREE.IcosahedronGeometry(0.018 * size, 0), '#fff4a8', 0.5), { p: [0, h + 0.045, 0] }),
  ];
}

export function mushroom(rand, { cap = '#ff5a6e', size = 1 } = {}) {
  const h = 0.12 * size;
  const parts = [
    xform(paint(new THREE.CylinderGeometry(0.035 * size, 0.045 * size, h, 8), '#fff6e8'), { p: [0, h / 2, 0] }),
    xform(
      paint(new THREE.SphereGeometry(0.1 * size, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), vgrad(shadeHex(cap, 0.7), cap, 0, 0.1 * size)),
      { p: [0, h - 0.01, 0], s: [1, 0.85, 1] },
    ),
  ];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    parts.push(xform(paint(new THREE.IcosahedronGeometry(0.018 * size, 0), '#ffffff'), { p: [Math.cos(a) * 0.06 * size, h + 0.05 * size, Math.sin(a) * 0.06 * size] }));
  }
  return parts;
}

export function rock(rand, { color = '#a79fd0', size = 1 } = {}) {
  const g = new THREE.DodecahedronGeometry(0.12 * size, 0);
  return [xform(paint(g, vgrad(shadeHex(color, 0.6), color, -0.1, 0.1)), { p: [0, 0.04 * size, 0], s: [1.2, 0.75, 1], r: [rand.range(0, 3), rand.range(0, 3), 0] })];
}

/** Cosy cottage with glowing windows, a chimney, door and a lamp post. Front faces +Z. */
export function cottage() {
  const parts = [];
  const wallH = 0.58;
  const base = 0.1;
  parts.push(xform(paint(new THREE.CylinderGeometry(0.62, 0.66, base, 20), vgrad('#7f78a8', '#bdb6e0', -0.05, 0.05)), { p: [0, base / 2, 0] }));
  parts.push(xform(paint(new THREE.BoxGeometry(0.86, wallH, 0.68), vgrad('#e9d8c0', '#fff6e6', -0.3, 0.3)), { p: [0, base + wallH / 2, 0] }));
  // Timber trim.
  for (const x of [-0.43, 0.43]) {
    for (const z of [-0.34, 0.34]) {
      parts.push(xform(paint(new THREE.BoxGeometry(0.06, wallH, 0.06), '#a8714c'), { p: [x, base + wallH / 2, z] }));
    }
  }
  // Gable roof (triangular prism, ridge along X) with overhang.
  const roof = new THREE.CylinderGeometry(0.64, 0.64, 1.04, 3, 1);
  roof.rotateX(-Math.PI / 2);
  roof.rotateY(Math.PI / 2);
  roof.scale(1, 0.78, 1);
  parts.push(xform(paint(roof, vgrad('#d9405a', '#ff7a8a', -0.2, 0.45)), { p: [0, base + wallH + 0.24, 0] }));
  // Gable walls.
  const gable = new THREE.CylinderGeometry(0.5, 0.5, 1.08, 3, 1);
  gable.rotateX(-Math.PI / 2);
  gable.rotateY(Math.PI / 2);
  gable.scale(1, 0.78, 1);
  parts.push(xform(paint(gable, '#fff1dc'), { p: [0, base + wallH + 0.185, 0] }));
  // Chimney.
  parts.push(xform(paint(new THREE.BoxGeometry(0.14, 0.42, 0.14), vgrad('#9c5a4a', '#d07a62', -0.2, 0.2)), { p: [0.24, base + wallH + 0.42, -0.14] }));
  parts.push(xform(paint(new THREE.BoxGeometry(0.19, 0.05, 0.19), '#6e3b33'), { p: [0.24, base + wallH + 0.64, -0.14] }));
  // Door with a round knob.
  parts.push(xform(paint(new THREE.BoxGeometry(0.2, 0.34, 0.04), vgrad('#6b3a22', '#9a5a34', -0.17, 0.17)), { p: [0, base + 0.17, 0.345] }));
  parts.push(xform(paint(new THREE.IcosahedronGeometry(0.018, 0), '#ffd56b', 1), { p: [0.06, base + 0.16, 0.37] }));
  // Glowing windows (emissive) with white frames.
  const win = (p, r = [0, 0, 0]) => {
    parts.push(xform(paint(new THREE.BoxGeometry(0.2, 0.2, 0.03), '#ffffff'), { p: [p[0], p[1], p[2] - 0.003], r }));
    parts.push(xform(paint(new THREE.BoxGeometry(0.15, 0.15, 0.035), '#ffc861', 2.8), { p, r }));
    parts.push(xform(paint(new THREE.BoxGeometry(0.15, 0.018, 0.04), '#ffffff'), { p, r }));
    parts.push(xform(paint(new THREE.BoxGeometry(0.018, 0.15, 0.04), '#ffffff'), { p, r }));
  };
  win([-0.26, base + 0.36, 0.345]);
  win([0.26, base + 0.36, 0.345]);
  win([-0.18, base + 0.36, -0.345]);
  win([0.18, base + 0.36, -0.345]);
  win([0.435, base + 0.36, 0], [0, Math.PI / 2, 0]);
  win([-0.435, base + 0.36, 0], [0, Math.PI / 2, 0]);
  // Round attic window on the front gable.
  parts.push(xform(paint(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 14), '#ffd27a', 2.6), { p: [0.545, base + wallH + 0.17, 0], r: [0, 0, Math.PI / 2] }));
  // Flower boxes.
  for (const x of [-0.26, 0.26]) {
    parts.push(xform(paint(new THREE.BoxGeometry(0.2, 0.05, 0.06), '#8a5a3c'), { p: [x, base + 0.24, 0.37] }));
    for (let i = 0; i < 4; i++) {
      parts.push(xform(paint(new THREE.IcosahedronGeometry(0.025, 0), ['#ff7ab8', '#ffe066', '#ff9a6b', '#c98bff'][i], 0.4), { p: [x - 0.075 + i * 0.05, base + 0.28, 0.375] }));
    }
  }
  // Lamp post by the door.
  parts.push(xform(paint(new THREE.CylinderGeometry(0.014, 0.02, 0.42, 6), '#4a4570'), { p: [0.3, base + 0.21, 0.56] }));
  parts.push(xform(paint(new THREE.IcosahedronGeometry(0.045, 1), '#ffe9a6', 3.5), { p: [0.3, base + 0.45, 0.56] }));
  // Stepping stones to the door.
  for (let i = 0; i < 3; i++) {
    parts.push(xform(paint(new THREE.CylinderGeometry(0.06, 0.065, 0.03, 8), '#d9d2f0'), { p: [Math.sin(i * 1.3) * 0.04, 0.0, 0.48 + i * 0.13] }));
  }
  return parts;
}

/** Wind turbine tower + nacelle (blades are built separately so they can spin). */
export function turbineTower(height = 1.3) {
  return [
    xform(paint(new THREE.CylinderGeometry(0.03, 0.055, height, 10), vgrad('#c9d6f0', '#ffffff', -height / 2, height / 2)), { p: [0, height / 2, 0] }),
    xform(paint(new THREE.CapsuleGeometry(0.045, 0.12, 4, 8), '#f4f8ff'), { p: [0, height + 0.02, -0.02], r: [Math.PI / 2, 0, 0] }),
    xform(paint(new THREE.CylinderGeometry(0.07, 0.08, 0.04, 10), '#9fb3d9'), { p: [0, 0.02, 0] }),
  ];
}

export function turbineBlades(length = 0.62) {
  const parts = [xform(paint(new THREE.IcosahedronGeometry(0.045, 1), '#ffffff'), { s: [1, 1, 1.3] })];
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.BoxGeometry(0.055, length, 0.012);
    blade.translate(0.012, length / 2 + 0.02, 0);
    // Taper the tip.
    const pos = blade.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v);
      pos.setX(v, pos.getX(v) * (1 - 0.6 * (y / length)));
    }
    blade.rotateZ((i / 3) * Math.PI * 2);
    parts.push(paint(blade, '#ffffff'));
  }
  return parts;
}

export function palmTree(rand, { size = 1 } = {}) {
  const parts = [];
  const segs = 6;
  let x = 0;
  let y = 0;
  for (let i = 0; i < segs; i++) {
    const h = 0.11 * size;
    parts.push(xform(paint(new THREE.CylinderGeometry(0.03 * size, 0.04 * size, h, 6), i % 2 ? '#b0784a' : '#c98d58'), { p: [x, y + h / 2, 0], r: [0, 0, -0.08 * i] }));
    x += Math.sin(0.08 * i) * h;
    y += h * 0.98;
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const leaf = new THREE.SphereGeometry(0.16 * size, 8, 4);
    leaf.scale(1, 0.12, 0.38);
    leaf.translate(0.15 * size, 0, 0);
    leaf.rotateZ(-0.45);
    leaf.rotateY(a);
    parts.push(xform(paint(leaf, i % 2 ? '#3fcf6a' : '#2fb85e'), { p: [x, y + 0.02, 0] }));
  }
  parts.push(sphere(0.03 * size, '#7a4a2a', { p: [x + 0.03, y - 0.03, 0.02], w: 6, h: 4 }));
  return parts;
}
