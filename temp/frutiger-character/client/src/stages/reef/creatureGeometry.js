import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { blob, color, finalize, place, ss } from './geometry.js';

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
  rings = 12,
  segs = 8,
} = {}) {
  const positions = [];
  const normals = [];
  const fins = [];
  const indices = [];
  const total = 0.8 + tailLen;
  const profile = (u) => (u < 0.32 ? Math.sqrt(Math.max(0, 1 - ((0.32 - u) / 0.32) ** 2)) : 1 - 0.82 * ss((u - 0.32) / 0.68, 0, 1));
  const zAt = (u) => 0.5 - u * 0.8;
  const halfH = (u, lower) => (height / 2) * profile(u) * (lower ? 0.9 : 1);
  const n = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    const u = i / rings;
    const p = profile(u);
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const sy = Math.sin(a);
      positions.push(Math.cos(a) * (width / 2) * p, sy * (height / 2) * p * (sy < 0 ? 0.9 : 1), zAt(u));
      n.set(Math.cos(a) / Math.max(width, 0.01), sy / height, (0.5 - u) * 0.8).normalize();
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
  const addVert = (x, y, z) => {
    positions.push(x, y, z);
    normals.push(1, 0, 0);
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
    const steps = 6;
    let prevBase = -1;
    let prevTip = -1;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const u = span[0] + (span[1] - span[0]) * t;
      const z = zAt(u);
      const yb = halfH(u, lower) * 0.92 * (lower ? -1 : 1);
      const shape = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.7) * (1 - t * 0.25);
      const b = addVert(0, yb, z);
      const tp = addVert(0, yb + (lower ? -1 : 1) * h * shape, z - h * 0.35 * t);
      if (prevBase >= 0) indices.push(prevBase, b, prevTip, prevTip, b, tp);
      prevBase = b;
      prevTip = tp;
    }
  };
  finStrip(dorsalSpan, dorsalH, false);
  finStrip(analSpan, analH, true);
  for (const s of [-1, 1]) {
    const z = zAt(0.34);
    const x = (width / 2) * profile(0.34) * 0.9 * s;
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
  const back = color('#3f73aa');
  const side = color('#93bcdc');
  const belly = color('#f4f9fb');
  const paintBody = (p, n, out) => {
    out.copy(belly).lerp(side, ss(p.y + n.y * 0.08, -0.12, 0.02)).lerp(back, ss(p.y + n.y * 0.1, 0.02, 0.2));
    if (Math.abs(p.z - 0.86) < 0.035 && Math.abs(p.y - 0.035) < 0.03 && Math.abs(p.x) > 0.1) out.set('#0a1420');
  };
  const parts = [finalize(body, { paint: paintBody })];
  const dorsal = new THREE.Shape();
  dorsal.moveTo(0, 0);
  dorsal.quadraticCurveTo(0.08, 0.2, -0.22, 0.34);
  dorsal.quadraticCurveTo(-0.16, 0.14, -0.36, 0);
  dorsal.lineTo(0, 0);
  const dg = new THREE.ExtrudeGeometry(dorsal, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 1, curveSegments: 6 });
  place(dg, { rotation: [0, -Math.PI / 2, 0], position: [-0.015, 0.25, 0.05] });
  parts.push(finalize(dg, { paint: back }));
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
    const count = g.attributes.position.count;
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(count).fill(part), 1));
    const pv = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) pv.set(pivot, i * 3);
    g.setAttribute('aPivot', new THREE.BufferAttribute(pv, 3));
    return g;
  };
  const shellTop = new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  place(shellTop, { scale: [0.55, 0.24, 0.72] });
  const brown = color('#7b5a2c');
  const gold = color('#e0b85a');
  const olive = color('#5e7a2c');
  parts.push(
    tag(
      finalize(shellTop, {
        paint: (p, n, out) => {
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
  const skin = color('#c2b060');
  const skinDark = color('#6f6a35');
  const paintSkin = (p, n, out) => out.copy(skinDark).lerp(skin, 0.5 + 0.5 * Math.sin(p.x * 40) * Math.sin(p.z * 40));
  const head = blob({ radius: 1, detail: 2, squash: [0.13, 0.11, 0.18], amount: 0.02, seed: 2 });
  place(head, { position: [0, 0.03, 0.86] });
  parts.push(tag(finalize(head, { paint: paintSkin }), 0, [0, 0, 0]));
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

/** Manta ray, wingspan 2, nose at +z; aSway = signed span (-1 left tip .. 1 right tip). */
export function mantaGeometry() {
  const cols = 24;
  const rows = 10;
  const top = color('#16294a');
  const edge = color('#2c4c78');
  const belly = color('#e9f3f7');
  const lead = (x) => 0.42 - 0.5 * Math.pow(Math.abs(x), 1.15);
  const trail = (x) => -0.42 + 0.42 * Math.pow(Math.abs(x), 0.8);
  const thick = (x, v) => 0.1 * Math.pow(1 - Math.abs(x), 1.6) * Math.sin(Math.PI * v) + 0.006;
  const parts = [];
  for (const side of [1, -1]) {
    const positions = [];
    const colors = [];
    const sways = [];
    const indices = [];
    for (let i = 0; i <= cols; i++) {
      const x = (i / cols) * 2 - 1;
      // Swept-back wingtips.
      const sweep = -0.28 * Math.pow(Math.abs(x), 2.2);
      for (let j = 0; j <= rows; j++) {
        const v = j / rows;
        const z = trail(x) + (lead(x) - trail(x)) * v + sweep;
        positions.push(x, side * thick(x, v), z);
        const c = side > 0 ? top.clone().lerp(edge, Math.abs(x) * 0.6) : belly.clone().lerp(edge, ss(Math.abs(x), 0.75, 1));
        colors.push(c.r, c.g, c.b);
        sways.push(x);
      }
    }
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const a = i * (rows + 1) + j;
        const b = a + rows + 1;
        if (side > 0) indices.push(a, b, a + 1, b, b + 1, a + 1);
        else indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(sways, 1));
    g.setIndex(indices);
    g.computeVertexNormals();
    parts.push(finalize(g));
  }
  // Cephalic fins and a whip tail.
  for (const s of [-1, 1]) {
    const f = new THREE.CapsuleGeometry(0.035, 0.18, 2, 6);
    place(f, { rotation: [Math.PI / 2, 0, 0], position: [s * 0.13, 0, 0.5] });
    parts.push(finalize(f, { paint: '#1c3354', sway: s * 0.12 }));
  }
  const tail = new THREE.CylinderGeometry(0.004, 0.025, 0.9, 5);
  place(tail, { rotation: [Math.PI / 2, 0, 0], position: [0, 0, -0.85] });
  parts.push(finalize(tail, { paint: '#1c3354' }));
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
}

/** Jellyfish bell (scalloped cap) + frilly oral arms; aU = 0 at the apex -> 1 at the rim, > 1 on the arms. */
export function jellyGeometry() {
  const bell = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI * 0.58);
  const pos = bell.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const rimT = ss(1 - v.y, 0.6, 1.25);
    const scallop = 1 + 0.06 * Math.cos(a * 16) * rimT;
    pos.setXYZ(i, v.x * scallop, v.y * 0.85, v.z * scallop);
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
  for (let k = 0; k < 4; k++) {
    const a0 = (k / 4) * Math.PI * 2;
    const positions = [];
    const us = [];
    const indices = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = 0.1 - t * 2.2;
      const r = 0.12 + 0.05 * Math.sin(t * 9);
      const a = a0 + t * 1.6;
      const w = 0.16 * (1 - t * 0.6) * (0.8 + 0.4 * Math.sin(t * 15));
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      positions.push(cx - Math.sin(a) * w, y, cz + Math.cos(a) * w, cx + Math.sin(a) * w, y, cz - Math.cos(a) * w);
      us.push(1 + t, 1 + t);
    }
    for (let i = 0; i < steps; i++) {
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
    const len = length * (0.7 + (0.3 * ((k * 7) % 5)) / 4);
    for (let i = 0; i < segs; i++) {
      for (const j of [i, i + 1]) {
        const t = j / segs;
        positions.push(Math.cos(a) * 0.92 * (1 - t * 0.25), 0.85 * Math.cos(Math.PI * 0.58) - 0.02 - t * len, Math.sin(a) * 0.92 * (1 - t * 0.25));
        us.push(t);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aU', new THREE.Float32BufferAttribute(us, 1));
  return g;
}
