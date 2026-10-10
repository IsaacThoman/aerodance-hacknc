import * as THREE from 'three';
import { makeRandom } from '../../shared/random.js';
import { blob, color, fbm3, finalize, makeNoise3, place, taperedTube } from './geometry.js';

// Procedural reef pieces. All return finalized (mergeable) geometry.

const ss = THREE.MathUtils.smoothstep;

export function rock({ radius = 1.5, seed = 1, squash = [1.2, 0.8, 1], amount = 0.34 } = {}) {
  const g = blob({ radius, detail: radius < 0.6 ? 1 : radius < 1.3 ? 2 : 3, squash, amount, freq: 1.3, seed, flatBottom: true });
  // Second, finer octave of lumps so rocks read as porous reef rock.
  const bump = makeNoise3(seed + 900);
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = bump(x * 2.8, y * 2.8, z * 2.8) * 0.09 * radius + Math.abs(bump(x * 6, y * 6, z * 6)) * 0.04 * radius;
    pos.setXYZ(i, x + nrm.getX(i) * k, y + nrm.getY(i) * k, z + nrm.getZ(i) * k);
  }
  g.computeVertexNormals();
  const noise = makeNoise3(seed + 500);
  const base = color('#e0c49a');
  const dark = color('#a08060');
  const purple = color('#d0609c');
  const algae = color('#9fd04a');
  const pink = color('#ff9a8a');
  return finalize(g, {
    paint: (p, n, out) => {
      const v = fbm3(noise, p.x * 0.9, p.y * 0.9, p.z * 0.9, 3);
      out.copy(dark).lerp(base, ss(v, -0.4, 0.3));
      out.lerp(purple, ss(noise(p.x * 1.7 + 9, p.y * 1.7, p.z * 1.7), 0.2, 0.45) * 0.85);
      out.lerp(pink, ss(noise(p.x * 3.1, p.y * 3.1 + 4, p.z * 3.1), 0.35, 0.55) * 0.6);
      out.lerp(algae, ss(n.y, 0.55, 0.95) * ss(v, -0.2, 0.3) * 0.55);
    },
  });
}

export function brainCoral({ radius = 0.8, seed = 1, palette = ['#c5d65f', '#7f9a32'] } = {}) {
  const g = blob({ radius, detail: 3, squash: [1, 0.72, 1], amount: 0.12, freq: 1.2, seed, flatBottom: true });
  const noise = makeNoise3(seed + 77);
  const a = color(palette[0]);
  const b = color(palette[1]);
  return finalize(g, {
    paint: (p, n, out) => {
      const m = Math.sin(noise(p.x * 2.6, p.y * 2.6, p.z * 2.6) * 18);
      out.copy(b).lerp(a, ss(m, -0.2, 0.4));
      out.multiplyScalar(0.8 + 0.2 * ss(n.y, -0.2, 0.8));
    },
  });
}

/** Branching (staghorn / acropora) coral colony. */
export function branchingCoral({ size = 1, seed = 1, base = '#d14f93', tip = '#ffc1e3', branches = 7, depth = 2 } = {}) {
  const rand = makeRandom(seed);
  const parts = [];
  const cBase = color(base);
  const cTip = color(tip);
  const grow = (start, dir, len, radius, level) => {
    const bend = new THREE.Vector3(rand.range(-0.3, 0.3), rand.range(0.05, 0.3), rand.range(-0.3, 0.3));
    const mid = start.clone().addScaledVector(dir, len * 0.5).addScaledVector(bend, len * 0.25);
    const end = start.clone().addScaledVector(dir, len).addScaledVector(bend, len * 0.4);
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const r0 = radius;
    const r1 = level === depth ? radius * 0.55 : radius * 0.75;
    const t0 = level / (depth + 1);
    const t1 = (level + 1) / (depth + 1);
    parts.push(
      taperedTube(curve, 4, 5, (t) => r0 + (r1 - r0) * t + (t > 0.93 ? -(t - 0.93) * radius * 6 : 0), {
        colorFn: (t, a, out) => out.copy(cBase).lerp(cTip, ss(t0 + (t1 - t0) * t, 0.35, 1.0)),
      }),
    );
    if (level < depth) {
      const kids = rand.int(2, 3);
      for (let k = 0; k < kids; k++) {
        const nd = dir.clone().add(new THREE.Vector3(rand.range(-0.7, 0.7), rand.range(0.1, 0.6), rand.range(-0.7, 0.7))).normalize();
        grow(end, nd, len * rand.range(0.6, 0.85), r1, level + 1);
      }
    }
  };
  for (let i = 0; i < branches; i++) {
    const a = (i / branches) * Math.PI * 2 + rand.range(-0.3, 0.3);
    const dir = new THREE.Vector3(Math.cos(a) * 0.6, rand.range(0.7, 1.1), Math.sin(a) * 0.6).normalize();
    grow(new THREE.Vector3(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08), dir, 0.45 * size, 0.07 * size, 0);
  }
  return parts.map((g) => finalize(g));
}

/** Plate / table coral on a short stalk with an upturned, wavy rim. */
export function tableCoral({ radius = 1.2, seed = 1, top = '#7fd3a6', rim = '#d8ffe6', height = 0.6 } = {}) {
  const noise = makeNoise3(seed);
  const pts = [
    [0.0, 0],
    [0.16, 0],
    [0.12, height * 0.6],
    [0.25, height * 0.9],
    [radius * 0.6, height * 0.98],
    [radius * 0.95, height * 1.06],
    [radius, height * 1.14],
    [radius * 0.96, height * 1.18],
    [radius * 0.6, height * 1.08],
    [0.2, height * 1.05],
    [0, height * 1.04],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 40);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.z);
    const a = Math.atan2(v.z, v.x);
    const w = noise(Math.cos(a) * 1.5, Math.sin(a) * 1.5, seed) * 0.18 * r;
    v.y += w + Math.sin(a * 5 + seed) * 0.04 * r;
    const s = 1 + 0.15 * noise(Math.cos(a) * 2 + 3, Math.sin(a) * 2, 1);
    v.x *= s;
    v.z *= s;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const cTop = color(top);
  const cRim = color(rim);
  const cUnder = color(top).multiplyScalar(0.55);
  return finalize(g, {
    paint: (p, n, out) => {
      const r = Math.hypot(p.x, p.z) / radius;
      out.copy(n.y > 0 ? cTop : cUnder).lerp(cRim, ss(r, 0.75, 1.0) * 0.8);
    },
  });
}

/** Cluster of open tube sponges. */
export function tubeSponges({ count = 4, seed = 1, palette = ['#ffcf3a', '#ff9a3c'] } = {}) {
  const rand = makeRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const h = rand.range(0.5, 1.2);
    const r0 = rand.range(0.1, 0.16);
    const r1 = r0 * rand.range(1.2, 1.5);
    const pts = [
      [0, 0], [r0, 0], [r0 * 1.05, h * 0.5], [r1, h], [r1 * 0.95, h + 0.03], [r1 * 0.78, h + 0.01], [r1 * 0.7, h * 0.7], [0, h * 0.65],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const g = new THREE.LatheGeometry(pts, 14);
    const a = rand.range(0, Math.PI * 2);
    const d = i === 0 ? 0 : rand.range(0.15, 0.35);
    place(g, { position: [Math.cos(a) * d, 0, Math.sin(a) * d], rotation: [rand.range(-0.25, 0.25), 0, rand.range(-0.25, 0.25)] });
    const c = color(palette[i % palette.length]);
    const inner = c.clone().multiplyScalar(0.35);
    parts.push(
      finalize(g, {
        paint: (p, n, out) => {
          out.copy(c).multiplyScalar(0.85 + 0.25 * ss(p.y, 0, h));
          if (p.y > h * 0.6 && Math.hypot(p.x - Math.cos(a) * d, p.z - Math.sin(a) * d) < r1 * 0.8 && n.y < 0.5) out.copy(inner);
        },
      }),
    );
  }
  return parts;
}

/** Swaying sea whips (thin soft corals). */
export function seaWhips({ count = 6, seed = 1, palette = ['#ff6a3d', '#ffb13b'], height = 1.4 } = {}) {
  const rand = makeRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = rand.range(0, Math.PI * 2);
    const d = rand.range(0, 0.3);
    const h = height * rand.range(0.7, 1.15);
    const lean = new THREE.Vector3(rand.range(-0.3, 0.3), 0, rand.range(-0.3, 0.3));
    const start = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
    const curve = new THREE.CatmullRomCurve3([
      start,
      start.clone().add(new THREE.Vector3(0, h * 0.4, 0)).addScaledVector(lean, 0.3),
      start.clone().add(new THREE.Vector3(0, h, 0)).addScaledVector(lean, 1),
    ]);
    const c = color(palette[i % palette.length]);
    const tipC = c.clone().lerp(color('#fff3c4'), 0.5);
    parts.push(
      finalize(
        taperedTube(curve, 8, 4, (t) => 0.045 * (1 - t * 0.6), {
          colorFn: (t, ang, out) => out.copy(c).lerp(tipC, t * t),
          swayFn: (t) => t * 0.9,
        }),
      ),
    );
  }
  return parts;
}

export function starfish({ size = 0.25, seed = 1, paint = '#ff7a2e' } = {}) {
  const shape = new THREE.Shape();
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 1 : 0.42;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2, curveSegments: 2 });
  place(g, { rotation: [-Math.PI / 2, 0, makeRandom(seed).range(0, 6)], scale: size });
  const c = color(paint);
  const light = c.clone().lerp(color('#fff0d0'), 0.4);
  return finalize(g, { paint: (p, n, out) => out.copy(c).lerp(light, ss(n.y, 0.6, 1) * 0.5) });
}

/** Giant clam: two ribbed shell halves with a glowing blue-teal mantle. */
export function giantClam({ size = 0.5, seed = 1 } = {}) {
  const parts = [];
  for (const s of [-1, 1]) {
    const g = new THREE.SphereGeometry(1, 20, 8, 0, Math.PI, 0, Math.PI / 2);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const a = Math.atan2(v.y, v.x);
      const rib = 1 + 0.08 * Math.abs(Math.sin(a * 6));
      pos.setXYZ(i, v.x * rib, v.y * rib * 0.9, v.z * 0.55 * rib);
    }
    g.computeVertexNormals();
    place(g, { rotation: [s > 0 ? -1.1 : -2.0, 0, 0], scale: size, position: [0, size * 0.05, 0] });
    parts.push(finalize(g, { paint: (p, n, out) => out.set('#d9cfc0').lerp(color('#9e8f7d'), ss(-n.y, 0, 1) * 0.6) }));
  }
  const mantle = new THREE.CapsuleGeometry(0.42, 1.0, 4, 10);
  place(mantle, { rotation: [0, 0, Math.PI / 2], scale: [size * 0.95, size * 0.55, size * 0.3], position: [0, size * 0.35, 0] });
  parts.push(
    finalize(mantle, {
      paint: (p, n, out) => {
        const k = 0.5 + 0.5 * Math.sin(p.x * 40 + Math.sin(p.z * 30) * 2);
        out.set('#1aa7d9').lerp(color('#6ff7ff'), k * 0.7);
      },
    }),
  );
  return parts;
}

/** Anemone column (tentacles are instanced separately). */
export function anemoneBase({ radius = 0.45 } = {}) {
  const pts = [[0, 0], [radius * 0.8, 0], [radius * 0.7, 0.25], [radius * 0.95, 0.42], [radius * 0.6, 0.46], [0, 0.44]].map(([x, y]) => new THREE.Vector2(x, y));
  return finalize(new THREE.LatheGeometry(pts, 20), { paint: '#d9487f' });
}

/** Seagrass blade: thin bent strip, aSway = height fraction. */
export function bladeGeometry() {
  const seg = 5;
  const positions = [];
  const normals = [];
  const sways = [];
  const indices = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const w = 0.045 * (1 - t * 0.7);
    const bend = t * t * 0.25;
    positions.push(-w, t, bend, w, t, bend);
    normals.push(0, 0.3, 1, 0, 0.3, 1);
    sways.push(t, t);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sways, 1));
  g.setIndex(indices);
  return g;
}

/** Anemone tentacle: tapered capsule along +y with sway weight. */
export function tentacleGeometry() {
  const g = new THREE.CapsuleGeometry(0.028, 0.3, 2, 5);
  g.translate(0, 0.17, 0);
  const pos = g.attributes.position;
  const sway = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) sway[i] = Math.max(0, pos.getY(i) / 0.36);
  g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
  const cols = new Float32Array(pos.count * 3);
  const base = color('#e9d98a');
  const tip = color('#ff7fd1');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(base).lerp(tip, ss(sway[i], 0.45, 1.0));
    cols.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}


/** Pillar coral: cluster of upright rounded columns. */
export function pillarCoral({ count = 6, size = 1, seed = 1, paint = '#e8c46a' } = {}) {
  const rand = makeRandom(seed);
  const parts = [];
  const c = color(paint);
  const tip = c.clone().lerp(color('#fff6d8'), 0.5);
  for (let i = 0; i < count; i++) {
    const h = size * rand.range(0.5, 1.2);
    const r = size * rand.range(0.07, 0.11);
    const g = new THREE.CapsuleGeometry(r, h, 3, 8);
    const a = rand.range(0, Math.PI * 2);
    const d = i === 0 ? 0 : rand.range(0.1, 0.32) * size;
    place(g, { position: [Math.cos(a) * d, h / 2, Math.sin(a) * d], rotation: [rand.range(-0.12, 0.12), 0, rand.range(-0.12, 0.12)] });
    parts.push(finalize(g, { paint: (p, n, out) => out.copy(c).lerp(tip, ss(p.y, h * 0.6, h + r)) }));
  }
  return parts;
}

/** Leather / mushroom coral: lobed, ruffled cap on a short stalk. */
export function leatherCoral({ radius = 0.6, seed = 1, paint = '#c8e07a', rim = '#f4ffd0' } = {}) {
  const noise = makeNoise3(seed);
  const pts = [[0, 0], [0.14, 0], [0.12, 0.25], [0.2, 0.35], [radius * 0.7, 0.4], [radius, 0.36], [radius * 0.98, 0.42], [radius * 0.6, 0.5], [0, 0.52]].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 36);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.z);
    const a = Math.atan2(v.z, v.x);
    const k = r / radius;
    v.y += Math.sin(a * 7 + seed) * 0.08 * k * k + noise(Math.cos(a) * 2, Math.sin(a) * 2, seed) * 0.1 * k;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const c = color(paint);
  const cr = color(rim);
  return finalize(g, { paint: (p, n, out) => out.copy(c).lerp(cr, ss(Math.hypot(p.x, p.z) / radius, 0.7, 1.0)).multiplyScalar(n.y > 0 ? 1 : 0.6) });
}

/** Gorgonian sea fan: planar branching network of thin tubes (sways). */
export function seaFan({ size = 1.4, seed = 1, base = '#b8287a', tip = '#ff7ac8' } = {}) {
  const rand = makeRandom(seed);
  const parts = [];
  const cb = color(base);
  const ct = color(tip);
  const grow = (start, ang, len, rad, level) => {
    const end = start.clone().add(new THREE.Vector3(Math.sin(ang) * len, Math.cos(ang) * len, rand.range(-0.03, 0.03)));
    const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(rand.range(-0.04, 0.04), 0, 0));
    const t0 = start.y / size;
    const t1 = end.y / size;
    parts.push(
      finalize(
        taperedTube(new THREE.QuadraticBezierCurve3(start, mid, end), 3, 4, () => rad, {
          colorFn: (t, a, out) => out.copy(cb).lerp(ct, ss(t0 + (t1 - t0) * t, 0.2, 0.9)),
          swayFn: (t) => Math.min(1, (t0 + (t1 - t0) * t) * 1.2),
        }),
      ),
    );
    if (level < 4) {
      grow(end, ang - rand.range(0.25, 0.5), len * 0.82, rad * 0.8, level + 1);
      grow(end, ang + rand.range(0.25, 0.5), len * 0.82, rad * 0.8, level + 1);
    }
  };
  grow(new THREE.Vector3(0, 0, 0), 0, size * 0.28, 0.05 * size, 0);
  return parts;
}
