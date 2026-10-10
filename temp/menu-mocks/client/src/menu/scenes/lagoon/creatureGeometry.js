import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { blob, color, finalize, place } from './geometry.js';

const ss = THREE.MathUtils.smoothstep;

/**
 * Stylised reef fish, nose at +z (z = 0.5), tail fin behind z = -0.3.
 * Attributes: position, normal, aU (0 nose -> 1 tail tip), aFin (0 body, 1 fin).
 */
export function fishGeometry({
  height = 0.42,
  width = 0.14,
  tailH = 0.46,
  tailLen = 0.24,
  fork = 0.35,
  dorsalH = 0.16,
  dorsalSpan = [0.18, 0.78],
  analH = 0.1,
  analSpan = [0.5, 0.8],
  rings = 14,
  segs = 10,
} = {}) {
  const positions = [];
  const normals = [];
  const fins = [];
  const indices = [];
  const total = 0.8 + tailLen;
  const profile = (u) => (u < 0.32 ? Math.sqrt(Math.max(0, 1 - ((0.32 - u) / 0.32) ** 2)) : 1 - 0.82 * ss((u - 0.32) / 0.68, 0, 1));
  const zAt = (u) => 0.5 - u * 0.8;
  const halfH = (u, lower) => (height / 2) * profile(u) * (lower ? 0.9 : 1);
  // Body.
  for (let i = 0; i <= rings; i++) {
    const u = i / rings;
    const p = profile(u);
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const sy = Math.sin(a);
      const x = Math.cos(a) * (width / 2) * p;
      const y = sy * (height / 2) * p * (sy < 0 ? 0.9 : 1);
      positions.push(x, y, zAt(u));
      const n = new THREE.Vector3(Math.cos(a) / Math.max(width, 0.01), sy / height, (0.5 - u) * 0.8).normalize();
      normals.push(n.x, n.y, n.z);
      fins.push(0);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const b = a + segs + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const addVert = (x, y, z, nx = 1, ny = 0, nz = 0) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    fins.push(1);
    return positions.length / 3 - 1;
  };
  // Caudal fin.
  const pedH = halfH(1, false);
  const z0 = zAt(1) + 0.02;
  const zt = z0 - tailLen;
  const bt = addVert(0, pedH, z0);
  const bb = addVert(0, -pedH, z0);
  const tt = addVert(0, tailH / 2, zt);
  const tm = addVert(0, 0, zt + tailLen * fork);
  const tb = addVert(0, -tailH / 2, zt);
  const mt = addVert(0, tailH * 0.3, z0 - tailLen * 0.55);
  const mb = addVert(0, -tailH * 0.3, z0 - tailLen * 0.55);
  indices.push(bt, mt, tm, mt, tt, tm, bt, tm, bb, bb, tm, mb, mb, tm, tb);
  // Dorsal / anal fins as strips along the ridge.
  const finStrip = (span, h, lower) => {
    const n = 7;
    let prevBase = -1;
    let prevTip = -1;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const u = span[0] + (span[1] - span[0]) * t;
      const z = zAt(u);
      const yb = halfH(u, lower) * 0.92 * (lower ? -1 : 1);
      const shape = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.7) * (1 - t * 0.25);
      const yt = yb + (lower ? -1 : 1) * h * shape;
      const b = addVert(0, yb, z);
      const tp = addVert(0, yt, z - h * 0.35 * t);
      if (prevBase >= 0) indices.push(prevBase, b, prevTip, prevTip, b, tp);
      prevBase = b;
      prevTip = tp;
    }
  };
  finStrip(dorsalSpan, dorsalH, false);
  finStrip(analSpan, analH, true);
  // Pectoral fins.
  for (const s of [-1, 1]) {
    const u = 0.34;
    const z = zAt(u);
    const x = (width / 2) * profile(u) * 0.9 * s;
    const a = addVert(x, -height * 0.05, z);
    const b = addVert(x + s * 0.06, -height * 0.12, z - 0.16);
    const c = addVert(x + s * 0.02, -height * 0.02, z - 0.13);
    indices.push(a, b, c);
  }
  const aU = new Float32Array(positions.length / 3);
  for (let i = 0; i < aU.length; i++) aU[i] = Math.min(1, Math.max(0, (0.5 - positions[i * 3 + 2]) / total));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('aU', new THREE.BufferAttribute(aU, 1));
  g.setAttribute('aFin', new THREE.Float32BufferAttribute(fins, 1));
  g.setIndex(indices);
  return g;
}

function setAU(g, zHead, length) {
  const pos = g.attributes.position;
  const a = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) a[i] = Math.min(1, Math.max(0, (zHead - pos.getZ(i)) / length));
  g.setAttribute('aU', new THREE.BufferAttribute(a, 1));
  return g;
}

/** Loft along z through elliptical sections: [u, halfWidth, halfHeight, yCenter]. */
function loft(sections, length, segs = 16, rings = 40) {
  const positions = [];
  const indices = [];
  const sample = (u) => {
    let i = 0;
    while (i < sections.length - 2 && sections[i + 1][0] < u) i++;
    const a = sections[i];
    const b = sections[i + 1];
    const t = ss((u - a[0]) / (b[0] - a[0]), 0, 1);
    return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
  };
  for (let i = 0; i <= rings; i++) {
    const u = i / rings;
    const [w, h, yc] = sample(u);
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      positions.push(Math.cos(a) * w, yc + Math.sin(a) * h, length / 2 - u * length);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const b = a + segs + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Bottlenose dolphin, ~2.4 m, nose at +z. Countershaded vertex colors + aU. */
export function dolphinGeometry() {
  const L = 2.4;
  const body = loft(
    [
      [0.0, 0.015, 0.015, -0.02],
      [0.06, 0.045, 0.04, -0.03],
      [0.11, 0.09, 0.1, 0.0],
      [0.17, 0.17, 0.2, 0.04],
      [0.3, 0.24, 0.29, 0.03],
      [0.45, 0.25, 0.3, 0.02],
      [0.62, 0.19, 0.25, 0.03],
      [0.8, 0.09, 0.16, 0.04],
      [0.93, 0.045, 0.07, 0.03],
      [1.0, 0.03, 0.04, 0.02],
    ],
    L,
    16,
    44,
  );
  const back = color('#4f7091');
  const side = color('#93aec4');
  const belly = color('#f2f6f8');
  const paintBody = (p, n, out) => {
    out.copy(belly).lerp(side, ss(p.y + n.y * 0.08, -0.12, 0.02)).lerp(back, ss(p.y + n.y * 0.1, 0.02, 0.2));
    // Eye.
    if (Math.abs(p.z - 0.86) < 0.035 && Math.abs(p.y - 0.035) < 0.03 && Math.abs(p.x) > 0.1) out.set('#0a1420');
  };
  const parts = [finalize(body, { paint: paintBody })];
  // Dorsal fin.
  const dorsal = new THREE.Shape();
  dorsal.moveTo(0, 0);
  dorsal.quadraticCurveTo(0.08, 0.2, -0.22, 0.34);
  dorsal.quadraticCurveTo(-0.16, 0.14, -0.36, 0);
  dorsal.lineTo(0, 0);
  const dg = new THREE.ExtrudeGeometry(dorsal, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 1, curveSegments: 6 });
  place(dg, { rotation: [0, -Math.PI / 2, 0], position: [-0.015, 0.25, 0.05] });
  parts.push(finalize(dg, { paint: back }));
  // Flukes.
  const fluke = new THREE.Shape();
  fluke.moveTo(0, 0.04);
  fluke.quadraticCurveTo(0.24, 0.06, 0.36, -0.12);
  fluke.quadraticCurveTo(0.22, -0.1, 0.04, -0.16);
  fluke.lineTo(-0.04, -0.16);
  fluke.quadraticCurveTo(-0.22, -0.1, -0.36, -0.12);
  fluke.quadraticCurveTo(-0.24, 0.06, 0, 0.04);
  const fg = new THREE.ExtrudeGeometry(fluke, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1, curveSegments: 6 });
  place(fg, { rotation: [Math.PI / 2, 0, 0], position: [0, 0.03, -L / 2 + 0.02] });
  parts.push(finalize(fg, { paint: back }));
  // Pectoral flippers.
  for (const s of [-1, 1]) {
    const pf = blob({ radius: 1, detail: 1, squash: [0.2, 0.025, 0.09], amount: 0, seed: 1 });
    place(pf, { position: [s * 0.27, -0.1, 0.5], rotation: [0.2, s * 0.6, s * -0.5] });
    parts.push(finalize(pf, { paint: side }));
  }
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return setAU(g, L / 2, L);
}

/** Green sea turtle with patterned shell; aPart: 0 body, 1 front flipper, 2 rear flipper. */
export function turtleGeometry() {
  const parts = [];
  const tag = (g, part, pivot) => {
    const n = g.attributes.position.count;
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
    const pv = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pv.set(pivot, i * 3);
    g.setAttribute('aPivot', new THREE.BufferAttribute(pv, 3));
    return g;
  };
  const shellTop = new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  place(shellTop, { scale: [0.55, 0.24, 0.72] });
  const brown = color('#7b5a2c');
  const gold = color('#d9ad55');
  const olive = color('#5e6b2c');
  parts.push(
    tag(
      finalize(shellTop, {
        paint: (p, n, out) => {
          // Scute pattern: hex-ish cells, gold seams.
          const cx = p.x / 0.2;
          const cz = p.z / 0.2 + (Math.floor(cx + 0.5) % 2) * 0.5;
          const fx = Math.abs(cx - Math.round(cx));
          const fz = Math.abs(cz - Math.round(cz));
          const seam = ss(Math.max(fx, fz), 0.36, 0.48);
          const rim = ss(Math.hypot(p.x / 0.55, p.z / 0.72), 0.86, 0.97);
          out.copy(brown).lerp(olive, 0.3 + 0.3 * Math.sin(p.x * 13 + p.z * 7)).lerp(gold, Math.max(seam * 0.8, rim * 0.9));
        },
      }),
      0,
      [0, 0, 0],
    ),
  );
  const plastron = new THREE.SphereGeometry(1, 20, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  place(plastron, { scale: [0.52, 0.08, 0.68] });
  parts.push(tag(finalize(plastron, { paint: '#e8d9a0' }), 0, [0, 0, 0]));
  const skin = color('#b9a85a');
  const skinDark = color('#6f6a35');
  const paintSkin = (p, n, out) => out.copy(skinDark).lerp(skin, 0.5 + 0.5 * Math.sin(p.x * 40) * Math.sin(p.z * 40));
  const head = blob({ radius: 1, detail: 2, squash: [0.13, 0.11, 0.18], amount: 0.02, seed: 2 });
  place(head, { position: [0, 0.03, 0.86] });
  parts.push(tag(finalize(head, { paint: paintSkin }), 0, [0, 0, 0]));
  const eyeL = new THREE.SphereGeometry(0.025, 6, 4);
  const eyeR = eyeL.clone();
  place(eyeL, { position: [0.1, 0.07, 0.93] });
  place(eyeR, { position: [-0.1, 0.07, 0.93] });
  parts.push(tag(finalize(eyeL, { paint: '#101010' }), 0, [0, 0, 0]));
  parts.push(tag(finalize(eyeR, { paint: '#101010' }), 0, [0, 0, 0]));
  for (const s of [-1, 1]) {
    const front = blob({ radius: 1, detail: 2, squash: [0.48, 0.035, 0.15], amount: 0.02, seed: 3 });
    place(front, { position: [s * 0.62, 0, 0.3], rotation: [0, s * 0.45, 0] });
    parts.push(tag(finalize(front, { paint: paintSkin }), 1, [s * 0.36, 0, 0.42]));
    const rear = blob({ radius: 1, detail: 1, squash: [0.2, 0.03, 0.11], amount: 0.02, seed: 4 });
    place(rear, { position: [s * 0.38, -0.02, -0.62], rotation: [0, s * -0.6, 0] });
    parts.push(tag(finalize(rear, { paint: paintSkin }), 2, [s * 0.25, 0, -0.52]));
  }
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
}

/** Jellyfish bell (scalloped cap) + frilly oral arms; aU = 0 at the apex -> 1 at the rim / arm tips. */
export function jellyGeometry() {
  const bell = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI * 0.58);
  const pos = bell.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const rimT = ss(1 - v.y, 0.6, 1.25);
    const scallop = 1 + 0.06 * Math.cos(a * 16) * rimT;
    v.x *= scallop;
    v.z *= scallop;
    v.y = v.y * 0.85;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  bell.computeVertexNormals();
  const bu = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) bu[i] = Math.min(1, (0.85 - pos.getY(i)) / 1.1);
  bell.setAttribute('aU', new THREE.BufferAttribute(bu, 1));
  const keep = (g) => {
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'aU'].includes(name)) g.deleteAttribute(name);
    return g.index ? g.toNonIndexed() : g;
  };
  const parts = [keep(bell)];
  // Oral arms: twisted ribbons hanging below.
  for (let k = 0; k < 4; k++) {
    const a0 = (k / 4) * Math.PI * 2;
    const positions = [];
    const us = [];
    const indices = [];
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const y = 0.1 - t * 2.2;
      const r = 0.12 + 0.05 * Math.sin(t * 9);
      const a = a0 + t * 1.6;
      const w = 0.16 * (1 - t * 0.6) * (0.8 + 0.4 * Math.sin(t * 15));
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      positions.push(cx - Math.sin(a) * w, y, cz + Math.cos(a) * w, cx + Math.sin(a) * w, y, cz - Math.cos(a) * w);
      us.push(1 + t, 1 + t);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('aU', new THREE.Float32BufferAttribute(us, 1));
    g.setIndex(indices);
    g.computeVertexNormals();
    parts.push(keep(g));
  }
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
}

/** Jellyfish tentacles as line segments; aU = 0 at the rim -> 1 at the tip. */
export function tentacleLines(count = 14, segs = 12, length = 2.6) {
  const positions = [];
  const us = [];
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    const r = 0.92;
    const len = length * (0.7 + 0.3 * ((k * 7) % 5) / 4);
    for (let i = 0; i < segs; i++) {
      for (const j of [i, i + 1]) {
        const t = j / segs;
        positions.push(Math.cos(a) * r * (1 - t * 0.25), 0.85 * Math.cos(Math.PI * 0.58) - 0.02 - t * len, Math.sin(a) * r * (1 - t * 0.25));
        us.push(t);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aU', new THREE.Float32BufferAttribute(us, 1));
  return g;
}
