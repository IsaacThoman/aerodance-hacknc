import * as THREE from 'three';
import { makeRandom } from '../../shared/random.js';
import { Builder, KIND, hexToLinear, loft, mat4, roundedLoop, roundedProfile, superR, sweep } from './geometry.js';
import { AVENUES_Z, BRIDGES, GROUND, LANDMARKS, MONORAIL_CORNERS, MONORAIL_Y, STREETS_X, TOWERS, shoreZ } from './layout.js';

// Builds every static piece of the city into one merged geometry, plus the
// placement data (trees, footprints, blocks) other systems need.

const WHITE = hexToLinear('#f6f9fc');
const OFFWHITE = hexToLinear('#dfe8ee');
const SILVER = hexToLinear('#c9d6df');
const GRASS = hexToLinear('#64b23c');
const AQUA_GLOW = hexToLinear('#bff6ff');

export const PAINT = (rough = 0.28, metal = 0.05) => [KIND.PAINT, 0, rough, metal];
const LEAF = [KIND.LEAF, 0, 0, 0];
const SOLAR = [KIND.SOLAR, 0, 0, 0];
const EMIT = (strength, blink = false, beat = false) => [5, blink ? 1 : 0, beat ? 1 : 0, strength];

// Block usage by [column, row] (columns between STREETS_X, rows between AVENUES_Z).
export const PARKS = {
  '2,0': 'park',
  '3,0': 'green',
  '4,0': 'plaza',
  '2,1': 'dome',
};

function rotated(rot) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return (x, z) => [x * c - z * s, x * s + z * c];
}

export function towerSection(T) {
  const { type, a, b = a, rot = 0, twist = 0 } = T;
  const R = rotated(rot);
  switch (type) {
    case 'cyl':
      return (th, t) => {
        const r = a * (1 - 0.06 * t);
        return [Math.cos(th) * r, Math.sin(th) * r];
      };
    case 'ellipse':
      return (th, t) => R(Math.cos(th) * a * (1 - 0.1 * t), Math.sin(th) * b * (1 - 0.1 * t));
    case 'twist':
      return (th, t) => {
        const r = superR(th - twist * t, a, b, 4.2) * (1 - 0.14 * t);
        return R(Math.cos(th) * r, Math.sin(th) * r);
      };
    case 'sail':
      return (th, t) => {
        const r = superR(th, a * (1 - 0.32 * t * t), b * (1 - 0.45 * t), 2.3);
        const x = Math.cos(th) * r;
        let z = Math.sin(th) * r;
        if (z < 0) z *= 0.5;
        z -= b * 0.8 * t * t;
        return R(x, z);
      };
    case 'bulge':
      return (th, t) => {
        const body = 0.84 + 0.3 * Math.sin(Math.PI * t * 0.92);
        const cap = t < 0.76 ? 1 : Math.sqrt(Math.max(0.003, 1 - ((t - 0.76) / 0.24) ** 2));
        const r = a * body * cap;
        return [Math.cos(th) * r, Math.sin(th) * r];
      };
    case 'lobed':
      return (th, t) => {
        const r = a * (1 + 0.15 * Math.cos(3 * (th - twist * t))) * (1 - 0.12 * t);
        return [Math.cos(th) * r, Math.sin(th) * r];
      };
    default:
      return (th) => {
        const r = superR(th, a, b, 5);
        return R(Math.cos(th) * r, Math.sin(th) * r);
      };
  }
}

function perimeter(section, t, n = 64) {
  let p = 0;
  let prev = section(0, t);
  for (let i = 1; i <= n; i++) {
    const cur = section((i / n) * Math.PI * 2, t);
    p += Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    prev = cur;
  }
  return p;
}

const scaled = (section, k, tFixed = null) => (th, t) => {
  const [x, z] = section(th, tFixed ?? t);
  return [x * k, z * k];
};

function addGardenTop(b, rand, { cx, cz, y, section, inner, trees, treeCount = 4, treeScale = 1 }) {
  loft(b, {
    cx, cz, y0: y, y1: y + 1.1, levels: 1, segments: 40,
    section: (th) => section(th, 1),
    color: WHITE, st: PAINT(), floorH: 4,
    capTop: [{ lift: -0.6, scale: 0.94, color: GRASS, st: LEAF }],
  });
  for (let i = 0; i < treeCount; i++) {
    const ang = rand.range(0, Math.PI * 2);
    const rr = Math.sqrt(rand.next()) * inner * 0.62;
    trees.push({ x: cx + Math.cos(ang) * rr, y: y + 0.5, z: cz + Math.sin(ang) * rr, s: rand.range(2.2, 3.6) * treeScale, type: rand.chance(0.3) ? 'cone' : 'round' });
  }
}

function addSolarRoof(b, rand, { cx, cz, y, a, bb, rot = 0 }) {
  const R = rotated(rot);
  const panel = new THREE.BoxGeometry(3.4, 0.14, 1.9);
  const nx = Math.max(1, Math.floor((a * 1.3) / 4));
  const nz = Math.max(1, Math.floor((bb * 1.3) / 2.8));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const lx = (i - (nx - 1) / 2) * 4;
      const lz = (j - (nz - 1) / 2) * 2.8;
      const [ox, oz] = R(lx, lz);
      b.add(panel, mat4([cx + ox, y + 0.9, cz + oz], [0.42, -rot, 0]), { color: [1, 1, 1], st: SOLAR });
    }
  }
  panel.dispose();
}

function addSpire(b, cx, cz, y, height) {
  const cone = new THREE.CylinderGeometry(0.14, 1.5, height, 10, 1);
  b.add(cone, mat4([cx, y + height / 2, cz]), { color: WHITE, st: PAINT(0.25, 0.2) });
  const ring = new THREE.TorusGeometry(2.2, 0.35, 6, 20);
  b.add(ring, mat4([cx, y + height * 0.28, cz], [Math.PI / 2, 0, 0]), { color: WHITE, st: PAINT() });
  const tip = new THREE.SphereGeometry(0.75, 10, 8);
  b.add(tip, mat4([cx, y + height + 0.4, cz]), { color: [1, 0.35, 0.3], st: EMIT(14, true) });
  cone.dispose();
  ring.dispose();
  tip.dispose();
}

function addTower(b, T, rand, out) {
  const { x: cx, z: cz, h, a } = T;
  const bb = T.b ?? a;
  const floorH = 4;
  const seed = rand.next();
  const fa = [T.tint, T.style, seed, T.green ?? 0];
  const st = [KIND.GLASS, T.bands ?? 0, 0, 0];
  const g0 = GROUND;
  out.footprints.push({ x: cx, z: cz, r: Math.max(a, bb) + (T.podium === false ? 1 : 5), h });

  if (T.type === 'stepped') {
    const R = rotated(T.rot ?? 0);
    const tiers = [
      [0, 0.44, 1],
      [0.44, 0.74, 0.76],
      [0.74, 1, 0.52],
    ];
    tiers.forEach(([t0, t1, s], k) => {
      const section = (th) => {
        const r = superR(th, a * s, bb * s, 5);
        return R(Math.cos(th) * r, Math.sin(th) * r);
      };
      const y0 = g0 + h * t0;
      const y1 = g0 + h * t1;
      const cols = Math.round(perimeter(section, 0) / 3);
      loft(b, { cx, cz, y0, y1, levels: 1, segments: 48, section, cols, floorH, fa, st });
      // Terrace slab with a lush garden on top.
      loft(b, {
        cx, cz, y0: y1 - 0.4, y1: y1 + 1.2, levels: 1, segments: 48,
        section: (th) => section(th).map((v) => v * 1.04),
        color: WHITE, st: PAINT(),
        capTop: [{ lift: -0.3, scale: 0.97, color: GRASS, st: LEAF }],
      });
      const next = tiers[k + 1];
      const ringR = next ? (s + next[2]) / 2 : s * 0.5;
      const n = next ? 14 : 5;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + rand.range(-0.15, 0.15);
        const r = superR(ang, a * ringR, bb * ringR, 5);
        const [ox, oz] = R(Math.cos(ang) * r, Math.sin(ang) * r);
        out.trees.push({ x: cx + ox, y: y1 + 1, z: cz + oz, s: rand.range(2, 3.2), type: rand.chance(0.25) ? 'cone' : 'round' });
      }
    });
    return;
  }

  const section = towerSection(T);
  const perim = perimeter(section, 0);
  const colW = T.style === 3 ? 3.3 : T.style === 2 ? 2.6 : 3;
  const cols = Math.max(8, Math.round(perim / colW));
  const levels = { cyl: 2, ellipse: 2, twist: Math.ceil(h / 7), sail: 18, bulge: 36, lobed: Math.ceil(h / 7) }[T.type] ?? 2;
  const segments = T.type === 'twist' || T.type === 'lobed' ? 48 : 40;

  // Podium with a planted roof.
  if (T.podium !== false) {
    const k = 1 + 6 / Math.max(a, bb);
    const pod = scaled(section, k, 0);
    const podH = 9;
    loft(b, {
      cx, cz, y0: g0, y1: g0 + podH, levels: 1, segments: 40, section: pod,
      cols: Math.round((perim * k) / 3.5), floorH: 4.5,
      fa: [T.tint * 0.6 + 0.2, 1, seed + 0.31, 0], st: [KIND.GLASS, 0, 0, 0],
    });
    loft(b, {
      cx, cz, y0: g0 + podH, y1: g0 + podH + 1.0, levels: 1, segments: 40,
      section: scaled(section, k * 1.015, 0), color: WHITE, st: PAINT(),
      capTop: [{ lift: -0.5, scale: 0.96, color: GRASS, st: LEAF }],
    });
    for (let i = 0; i < 7; i++) {
      const ang = rand.range(0, Math.PI * 2);
      const [px, pz] = section(ang, 0);
      const m = (k + 1) / 2 + 0.02;
      out.trees.push({ x: cx + px * m, y: g0 + podH + 0.6, z: cz + pz * m, s: rand.range(1.8, 2.6), type: 'round' });
    }
  }

  // Shaft.
  loft(b, { cx, cz, y0: g0, y1: g0 + h, levels, segments, section, cols, floorH, fa, st });

  const top = g0 + h;
  const topR = Math.min(a, bb) * 0.8;
  switch (T.top) {
    case 'spire':
      loft(b, {
        cx, cz, y0: top - 3, y1: top + 4, levels: 1, segments, section: scaled(section, 1.03, 1),
        color: WHITE, st: PAINT(), capTop: { lift: -3, color: OFFWHITE, st: PAINT() },
      });
      addSpire(b, cx, cz, top - 3, h * 0.2);
      break;
    case 'petals': {
      // Lotus crown: white fins flaring out from the roof edge around a spire.
      loft(b, {
        cx, cz, y0: top - 2, y1: top + 2, levels: 1, segments, section: scaled(section, 1.02, 1),
        color: WHITE, st: PAINT(), capTop: { lift: -1, color: OFFWHITE, st: PAINT() },
      });
      const fin = new THREE.BoxGeometry(1.1, 1, 7, 1, 10, 2);
      const fp = fin.attributes.position;
      for (let i = 0; i < fp.count; i++) {
        const t = fp.getY(i) + 0.5;
        // Lotus petal: wide at the base, pointed tip, curving outward.
        const w = Math.sin(Math.PI * Math.min(1, t * 0.85 + 0.15)) * (1 - 0.55 * t);
        fp.setXYZ(i, fp.getX(i) + t * t * 9, t * 28, fp.getZ(i) * w);
      }
      fin.computeVertexNormals();
      const n = 8;
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2;
        const [px, pz] = section(ang, 1);
        b.add(fin, mat4([cx + px * 0.96, top - 6, cz + pz * 0.96], [0, -ang, 0]), { color: WHITE, st: PAINT(0.22, 0.1) });
      }
      fin.dispose();
      const ring = new THREE.TorusGeometry(topR * 1.15, 0.5, 6, 40);
      b.add(ring, mat4([cx, top + 16, cz], [Math.PI / 2, 0, 0]), { color: WHITE, st: PAINT(0.2, 0.2) });
      ring.dispose();
      addSpire(b, cx, cz, top, h * 0.24);
      break;
    }
    case 'crown':
      loft(b, {
        cx, cz, y0: top - 5, y1: top + 9, levels: 4, segments,
        section: (th, t) => section(th, 1).map((v) => v * (1.02 + 0.08 * t * t)),
        color: WHITE, st: PAINT(0.22, 0.1), capTop: { lift: -11, color: OFFWHITE, st: PAINT() },
      });
      break;
    case 'dome':
      if (T.type !== 'bulge') {
        loft(b, {
          cx, cz, levels: 8, segments, cols, floorH, fa, st,
          yAt: (u) => top + Math.sin(u * Math.PI * 0.5) * topR * 0.7,
          section: (th, u) => section(th, 1).map((v) => v * Math.max(0.04, Math.cos(u * Math.PI * 0.5))),
        });
      }
      {
        const fin = new THREE.CylinderGeometry(0.1, 0.9, 12, 8);
        const domeTop = T.type === 'bulge' ? top : top + topR * 0.7;
        b.add(fin, mat4([cx, domeTop + 5, cz]), { color: WHITE, st: PAINT() });
        fin.dispose();
        const tip = new THREE.SphereGeometry(0.6, 8, 6);
        b.add(tip, mat4([cx, domeTop + 11.2, cz]), { color: [1, 0.35, 0.3], st: EMIT(14, true) });
        tip.dispose();
      }
      break;
    case 'garden':
    default:
      addGardenTop(b, rand, { cx, cz, y: top, section, inner: topR, trees: out.trees, treeCount: 6 });
      break;
  }
}

function addFiller(b, rand, { x, z, a, bb, h, rot }, out) {
  const T = { type: 'block', a, b: bb, rot };
  const section = towerSection(T);
  const style = rand.pick([0, 1, 1, 3, 1]);
  const tint = rand.next();
  const seed = rand.next();
  const cols = Math.round(perimeter(section, 0) / 3);
  loft(b, {
    cx: x, cz: z, y0: GROUND, y1: GROUND + h, levels: 1, segments: 40, section, cols, floorH: 4,
    fa: [tint, style, seed, rand.chance(0.4) ? 0.6 : 0], st: [KIND.GLASS, rand.chance(0.3) ? 4 : 0, 0, 0],
  });
  out.footprints.push({ x, z, r: Math.max(a, bb), h });
  if (rand.chance(0.5)) {
    loft(b, {
      cx: x, cz: z, y0: GROUND + h, y1: GROUND + h + 1, levels: 1, segments: 40, section,
      color: WHITE, st: PAINT(), capTop: { lift: -0.2, scale: 0.98, color: OFFWHITE, st: PAINT(0.5, 0) },
    });
    addSolarRoof(b, rand, { cx: x, cz: z, y: GROUND + h, a, bb, rot });
  } else {
    addGardenTop(b, rand, { cx: x, cz: z, y: GROUND + h, section, inner: Math.min(a, bb), trees: out.trees, treeCount: 3, treeScale: 0.8 });
  }
}

function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const dx = q.x - p.x;
    const dz = q.y - p.y;
    const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.y) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - (p.x + dx * t), z - (p.y + dz * t)));
  }
  return best;
}

function addMonorail(b, out) {
  const loop = roundedLoop(MONORAIL_CORNERS, 46, 2);
  out.monorail = loop;
  const path = loop.points.map((p) => new THREE.Vector3(p.x, MONORAIL_Y, p.y));
  sweep(b, path, roundedProfile(2.6, 1.7, 0.7, 3), {
    closed: true,
    color: (j) => (j > 3 && j < 9 ? WHITE : OFFWHITE),
    st: PAINT(0.25, 0.05),
  });
  // Thin aqua guide stripe along the sides.
  const stripe = roundedProfile(2.75, 0.25, 0.1, 1).map(([x, y, nx, ny]) => [x, y - 0.35, nx, ny]);
  sweep(b, path, stripe, { closed: true, color: hexToLinear('#3fd0e6'), st: PAINT(0.2, 0.1) });
  const pylon = new THREE.CylinderGeometry(0.8, 1.2, 1, 12, 1);
  const cap = new THREE.CapsuleGeometry(0.9, 3.2, 4, 8);
  const every = Math.round(32 / loop.step);
  for (let i = 0; i < loop.points.length; i += every) {
    const p = loop.points[i];
    const t = loop.tangents[i];
    const hgt = MONORAIL_Y - 1 - GROUND;
    b.add(pylon, mat4([p.x, GROUND + hgt / 2, p.y], [0, 0, 0], [1, hgt, 1]), { color: WHITE, st: PAINT() });
    b.add(cap, mat4([p.x, MONORAIL_Y - 1.4, p.y], [0, -Math.atan2(t.y, t.x), Math.PI / 2]), { color: WHITE, st: PAINT() });
  }
  pylon.dispose();
  cap.dispose();
}

function addWaterfront(b, out) {
  // Seawall, glass balustrade and lamp posts following the shoreline.
  const x0 = -372;
  const x1 = 378;
  const pts = [];
  for (let x = x0; x <= x1; x += 4) pts.push(new THREE.Vector3(x, 0, shoreZ(x)));
  const base = b.count;
  const wallColor = hexToLinear('#e9eef0');
  pts.forEach((p, i) => {
    const q = pts[Math.min(i + 1, pts.length - 1)];
    const r = pts[Math.max(i - 1, 0)];
    const dz = q.z - r.z;
    const dx = q.x - r.x;
    const n = new THREE.Vector3(-dz, 0, dx).normalize();
    b.vertex([p.x, GROUND + 0.35, p.z + 0.4], [n.x, 0, n.z], [0, 0], wallColor, [0, 0, 0, 0], PAINT(0.5));
    b.vertex([p.x, -3, p.z + 0.4], [n.x, 0, n.z], [0, 0], hexToLinear('#b8c8cc'), [0, 0, 0, 0], PAINT(0.5));
  });
  for (let i = 0; i < pts.length - 1; i++) {
    const a = base + i * 2;
    b.tri(a, a + 1, a + 2);
    b.tri(a + 2, a + 1, a + 3);
  }
  // Coping strip.
  sweep(b, pts.map((p) => new THREE.Vector3(p.x, GROUND + 0.35, p.z - 0.4)), [[-1.1, 0, 0, 1], [1.1, 0, 0, 1]], {
    closed: false, color: WHITE, st: PAINT(0.4),
  });
  // Glass balustrade.
  sweep(b, pts.map((p) => new THREE.Vector3(p.x, GROUND + 0.9, p.z - 0.2)), [[-0.08, -0.55, 1, 0], [-0.08, 0.55, 1, 0], [0.08, 0.55, -1, 0]], {
    closed: false, color: hexToLinear('#9fe3ef'), st: PAINT(0.08, 0.5),
  });
  // Lamps.
  const pole = new THREE.CylinderGeometry(0.12, 0.18, 6, 6);
  const head = new THREE.SphereGeometry(0.55, 10, 8);
  for (let x = x0 + 10; x < x1; x += 22) {
    if (Math.abs(x + 8) < 22) continue;
    const z = shoreZ(x) - 3;
    b.add(pole, mat4([x, GROUND + 3, z]), { color: WHITE, st: PAINT() });
    b.add(head, mat4([x, GROUND + 6.2, z]), { color: AQUA_GLOW, st: EMIT(1.6) });
  }
  pole.dispose();
  head.dispose();
  out.promenade = pts;
}

function addMarina(b, rand, out) {
  // Two white piers with docked boats.
  const piers = [
    { x: -168, len: 52 },
    { x: 214, len: 46 },
  ];
  const deck = new THREE.BoxGeometry(1, 1, 1);
  for (const p of piers) {
    const z0 = shoreZ(p.x) - 1;
    b.add(deck, mat4([p.x, 1.0, z0 + p.len / 2], [0, 0, 0], [4, 0.6, p.len]), { color: WHITE, st: PAINT(0.5) });
    for (let k = 1; k <= 3; k++) {
      b.add(deck, mat4([p.x, 1.0, z0 + (p.len * k) / 4], [0, 0, 0], [18, 0.5, 2.6]), { color: OFFWHITE, st: PAINT(0.5) });
      for (const side of [-1, 1]) {
        out.docked.push({ x: p.x + side * 6.5, z: z0 + (p.len * k) / 4 + rand.range(-3, 3), heading: Math.PI / 2 + rand.range(-0.05, 0.05), s: rand.range(0.75, 0.95) });
      }
    }
  }
  deck.dispose();
}

function addStage(b, out) {
  // Floating band shell on the bay: concentric white arches over a glowing stage.
  const x = LANDMARKS.shell.x;
  const z = 60;
  out.stage = { x, z };
  const disc = new THREE.CylinderGeometry(17, 15.5, 1.6, 56);
  b.add(disc, mat4([x, 0.8, z]), { color: WHITE, st: PAINT(0.35) });
  const rim = new THREE.TorusGeometry(16.7, 0.32, 6, 72);
  b.add(rim, mat4([x, 1.45, z], [Math.PI / 2, 0, 0]), { color: hexToLinear('#7ff3ff'), st: EMIT(2.2, false, true) });
  const floor = new THREE.CylinderGeometry(12.5, 12.5, 0.3, 48);
  b.add(floor, mat4([x, 1.75, z - 1]), { color: hexToLinear('#123f9a'), st: PAINT(0.12, 0.35) });
  // Light rings set into the dance floor, pulsing with the beat.
  [
    [3.6, '#7ff3ff'],
    [6.6, '#ff9fd8'],
    [9.6, '#7ff3ff'],
  ].forEach(([r, c]) => {
    const ring = new THREE.TorusGeometry(r, 0.22, 4, 48);
    b.add(ring, mat4([x, 1.92, z - 1], [Math.PI / 2, 0, 0], [1, 1, 0.5]), { color: hexToLinear(c), st: EMIT(2.4, false, true) });
    ring.dispose();
  });
  const walk = new THREE.BoxGeometry(5, 0.8, 20);
  b.add(walk, mat4([x, 1.0, shoreZ(x) + 8]), { color: WHITE, st: PAINT(0.4) });
  // Deep blue back shell for contrast.
  const back = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI, 0, Math.PI / 2);
  const bm = mat4([x, 1.6, z - 4], [0, Math.PI, 0], [14.5, 13, 11]);
  b.add(back, bm, { color: hexToLinear('#2b7fd6'), st: PAINT(0.2, 0.2) });
  b.add(back, bm, {
    color: (p) => {
      const k = Math.min(1, Math.max(0, (p.y - 1.6) / 13));
      return [0.01 + 0.05 * k, 0.05 + 0.2 * k, 0.22 + 0.4 * k];
    },
    st: PAINT(0.45, 0.0),
    flip: true,
  });
  // Concentric arches stepping toward the audience.
  const arches = [
    [15.2, 0.75, 3.5],
    [13.6, 0.65, 0.6],
    [12.0, 0.58, -2.2],
    [10.4, 0.5, -4.8],
  ];
  arches.forEach(([r, tube, dz], i) => {
    const arch = new THREE.TorusGeometry(r, tube, 8, 48, Math.PI);
    b.add(arch, mat4([x, 1.6, z + dz], [0, 0, 0], [1, 0.92, 1]), { color: WHITE, st: PAINT(0.18, 0.15) });
    const glow = new THREE.TorusGeometry(r - tube * 0.95, 0.16, 5, 48, Math.PI);
    const col = i % 2 ? hexToLinear('#ff9fd8') : hexToLinear('#7ff3ff');
    b.add(glow, mat4([x, 1.6, z + dz + 0.25], [0, 0, 0], [1, 0.92, 1]), { color: col, st: EMIT(2.6, false, true) });
    arch.dispose();
    glow.dispose();
  });
  // Speaker stacks.
  const spk = new THREE.BoxGeometry(2.4, 4.2, 2.2);
  for (const sx of [-13.5, 13.5]) b.add(spk, mat4([x + sx, 3.7, z + 4.5]), { color: hexToLinear('#e9f1f7'), st: PAINT(0.3) });
  [disc, rim, floor, walk, back, spk].forEach((g) => g.dispose());
}

function addIslands(b, rand, out) {
  // Floating garden islands anchored in the bay.
  const islands = [
    { x: -62, z: 118, r: 11 },
    { x: 160, z: 124, r: 9.5 },
    { x: 90, z: 195, r: 7 },
    { x: -230, z: 170, r: 12 },
  ];
  const rim = new THREE.TorusGeometry(1, 0.12, 8, 40);
  const hull = new THREE.CylinderGeometry(1, 0.86, 0.3, 40);
  const mound = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  for (const isl of islands) {
    b.add(hull, mat4([isl.x, 0.35, isl.z], [0, 0, 0], [isl.r, 3, isl.r]), { color: WHITE, st: PAINT(0.3) });
    b.add(rim, mat4([isl.x, 0.85, isl.z], [Math.PI / 2, 0, 0], [isl.r, isl.r, 4]), { color: hexToLinear('#e6f7ff'), st: PAINT(0.15, 0.2) });
    b.add(mound, mat4([isl.x, 0.9, isl.z], [0, 0, 0], [isl.r * 0.9, isl.r * 0.22, isl.r * 0.9]), { color: hexToLinear('#6cc04a'), st: LEAF });
    const n = Math.max(3, Math.round(isl.r / 2.5));
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2 + rand.range(-0.3, 0.3);
      const rr = rand.range(isl.r * 0.25, isl.r * 0.6);
      out.trees.push({ x: isl.x + Math.cos(ang) * rr, y: 1.2, z: isl.z + Math.sin(ang) * rr, s: rand.range(6, 9), type: k % 2 ? 'palm' : 'round' });
    }
    // Little white gazebo with a glossy roof.
    const gaz = new THREE.CylinderGeometry(0.12, 0.12, 2.6, 6);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      b.add(gaz, mat4([isl.x + Math.cos(a) * 1.8, 2.5, isl.z + Math.sin(a) * 1.8]), { color: WHITE, st: PAINT() });
    }
    const roof = new THREE.SphereGeometry(2.4, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    b.add(roof, mat4([isl.x, 3.7, isl.z], [0, 0, 0], [1, 0.55, 1]), { color: hexToLinear('#3fc6e8'), st: PAINT(0.15, 0.2) });
    gaz.dispose();
    roof.dispose();
  }
  rim.dispose();
  hull.dispose();
  mound.dispose();
}

function addPlaza(b, out) {
  const { x, z } = LANDMARKS.plaza;
  const R = 24;
  const wall = new THREE.CylinderGeometry(R + 1.2, R + 1.4, 1.0, 64, 1, true);
  b.add(wall, mat4([x, GROUND + 0.3, z]), { color: WHITE, st: PAINT(0.35) });
  const rim = new THREE.RingGeometry(R, R + 1.3, 64, 1);
  b.add(rim, mat4([x, GROUND + 0.8, z], [-Math.PI / 2, 0, 0]), { color: WHITE, st: PAINT(0.35) });
  // Pedestal under the globe.
  const ped = new THREE.CylinderGeometry(3.2, 5, 4.5, 28);
  b.add(ped, mat4([x, GROUND + 2.25, z]), { color: WHITE, st: PAINT(0.2, 0.1) });
  const cradle = new THREE.TorusGeometry(6.5, 0.45, 8, 40);
  b.add(cradle, mat4([x, GROUND + 6.2, z], [Math.PI / 2, 0, 0]), { color: SILVER, st: PAINT(0.15, 0.7) });
  out.globe = { x, y: GROUND + 4.5 + 9.5, z, r: 9.5, pool: R };
  // Solar trees around the plaza.
  const stem = new THREE.CylinderGeometry(0.35, 0.6, 1, 8);
  const panel = new THREE.CylinderGeometry(3, 3, 0.22, 6);
  const spots = [
    [x - 38, z - 34],
    [x + 38, z - 34],
    [x - 40, z + 30],
    [x + 40, z + 30],
    [-120, 34],
    [70, 36],
    [150, 36],
    [-230, 36],
  ];
  for (const [sx, sz] of spots) {
    const H = 12;
    b.add(stem, mat4([sx, GROUND + H / 2, sz], [0, 0, 0], [1, H, 1]), { color: WHITE, st: PAINT() });
    for (let k = 0; k < 5; k++) {
      const ang = (k / 5) * Math.PI * 2 + 0.3;
      const rr = k === 0 ? 0 : 3.2;
      const px = sx + Math.cos(ang) * (k === 0 ? 0 : rr);
      const pz = sz + Math.sin(ang) * (k === 0 ? 0 : rr);
      const py = GROUND + H - 1.5 + (k % 2) * 1.6 + (k === 0 ? 2.2 : 0);
      if (k > 0) b.add(stem, mat4([(sx + px) / 2, py - 0.8, (sz + pz) / 2], [Math.sin(ang) * 0.9, 0, -Math.cos(ang) * 0.9], [0.4, 4, 0.4]), { color: WHITE, st: PAINT() });
      b.add(panel, mat4([px, py, pz], [0.3, ang, 0]), { color: [1, 1, 1], st: SOLAR });
    }
  }
  wall.dispose();
  rim.dispose();
  ped.dispose();
  cradle.dispose();
  stem.dispose();
  panel.dispose();
}

function addBridges(b, rand) {
  const tube = [];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    tube.push([Math.cos(a) * 3.2, Math.sin(a) * 2.6, Math.cos(a), Math.sin(a)]);
  }
  for (const br of BRIDGES) {
    const A = TOWERS[br.from];
    const B = TOWERS[br.to];
    const path = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      path.push(new THREE.Vector3(A.x + (B.x - A.x) * t, GROUND + br.y - Math.sin(t * Math.PI) * 1.5, A.z + (B.z - A.z) * t));
    }
    sweep(b, path, tube, { closed: false, fa: [0.6, 3, rand.next(), 0], st: [KIND.GLASS, 0, 0, 0], cols: 10, uvLen: 3.2 });
    const spine = roundedProfile(7.4, 0.9, 0.4, 2).map(([x, y, nx, ny]) => [x, y - 2.8, nx, ny]);
    sweep(b, path, spine, { closed: false, color: WHITE, st: PAINT() });
  }
}

function addDomeBase(b, out) {
  const { x, z } = LANDMARKS.dome;
  const domes = [
    { dx: 0, dz: 0, r: 26, hy: 0.78 },
    { dx: 32, dz: 14, r: 18, hy: 0.8 },
    { dx: -26, dz: 18, r: 15, hy: 0.82 },
  ];
  out.domes = domes.map((d) => ({ x: x + d.dx, z: z + d.dz, r: d.r, hy: d.hy }));
  const ring = new THREE.TorusGeometry(1, 0.03, 6, 64);
  for (const d of out.domes) {
    b.add(ring, mat4([d.x, GROUND + 0.4, d.z], [Math.PI / 2, 0, 0], [d.r, d.r, 30]), { color: WHITE, st: PAINT() });
  }
  ring.dispose();
}

export function buildCity() {
  const rand = makeRandom(20240611);
  const b = new Builder();
  const out = { trees: [], footprints: [], docked: [], domes: [], monorail: null, blocks: [] };

  TOWERS.forEach((T) => addTower(b, T, rand, out));
  addMonorail(b, out);
  addWaterfront(b, out);
  addMarina(b, rand, out);
  addStage(b, out);
  addIslands(b, rand, out);
  addPlaza(b, out);
  addBridges(b, rand);
  addDomeBase(b, out);

  // Fill the remaining blocks with lower rounded buildings.
  const rail = out.monorail.points;
  const placed = [...out.footprints];
  for (let ci = 0; ci < STREETS_X.length - 1; ci++) {
    for (let ri = 0; ri < AVENUES_Z.length - 1; ri++) {
      const x0 = STREETS_X[ci] + 8;
      const x1 = STREETS_X[ci + 1] - 8;
      const z1 = AVENUES_Z[ri] - 8;
      const z0 = AVENUES_Z[ri + 1] + 8;
      const use = PARKS[`${ci},${ri}`] ?? 'build';
      out.blocks.push({ x0: x0 - 3, x1: x1 + 3, z0: z0 - 3, z1: z1 + 3, use, row: ri });
      if (use !== 'build') continue;
      const target = ri === 0 ? 3 : 4;
      let made = 0;
      for (let k = 0; k < 60 && made < target; k++) {
        const a = rand.range(7, 14);
        const bb = rand.range(6, 11);
        const r = Math.max(a, bb) * 1.1;
        const x = rand.range(x0 + r, x1 - r);
        const z = rand.range(z0 + r, z1 - r);
        if (x1 - x0 < 2 * r || z1 - z0 < 2 * r) continue;
        if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 5)) continue;
        if (distToPolyline(x, z, rail) < r + 5) continue;
        const hRange = [
          [10, 22],
          [16, 42],
          [20, 56],
          [24, 64],
        ][ri];
        const h = rand.range(hRange[0], hRange[1]);
        const rot = rand.pick([0, 0, 0, 0.25, -0.2]);
        addFiller(b, rand, { x, z, a, bb, h, rot }, out);
        placed.push({ x, z, r });
        made++;
      }
    }
  }

  // Distant district beyond the grid, hazy and simpler.
  for (let i = 0; i < 26; i++) {
    const x = -420 + i * 34 + rand.range(-10, 10);
    const z = rand.range(-430, -365);
    const type = rand.pick(['cyl', 'ellipse', 'twist', 'block', 'lobed']);
    const a = rand.range(9, 16);
    const T = { x, z, type, a, b: a * rand.range(0.7, 1), h: rand.range(50, 150) * (1 - Math.abs(x - 60) / 900), style: rand.int(0, 3), tint: rand.next(), top: rand.pick(['garden', 'dome', 'crown']), twist: rand.range(-0.8, 0.8), podium: false };
    addTower(b, T, rand, out);
  }

  // Trees: parks, the domes' gardens, streets and the promenade.
  for (const blk of out.blocks) {
    if (blk.use === 'build') {
      // Street trees along the block edges.
      for (let x = blk.x0 + 4; x < blk.x1; x += 11) {
        for (const z of [blk.z1 - 1.5, blk.z0 + 1.5]) {
          if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 2)) continue;
          out.trees.push({ x: x + rand.range(-1, 1), y: GROUND, z, s: rand.range(3.6, 4.6), type: 'round' });
        }
      }
      continue;
    }
    const n = blk.use === 'plaza' ? 26 : blk.use === 'dome' ? 30 : 90;
    for (let k = 0; k < n * 3 && n > 0; k++) {
      const x = rand.range(blk.x0 + 3, blk.x1 - 3);
      const z = rand.range(blk.z0 + 3, blk.z1 - 3);
      if (blk.use === 'plaza' && Math.hypot(x - LANDMARKS.plaza.x, z - LANDMARKS.plaza.z) < 34) continue;
      if (blk.use === 'dome' && out.domes.some((d) => Math.hypot(x - d.x, z - d.z) < d.r + 3)) continue;
      if (blk.use === 'green' && Math.hypot((x - 0) / 30, (z + 22) / 18) < 1) continue; // pond
      if (out.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 5.5)) continue;
      out.trees.push({ x, y: GROUND, z, s: rand.range(4, 6.5), type: rand.chance(0.22) ? 'cone' : 'round' });
    }
  }
  // Boulevard + promenade rows.
  for (let x = -360; x < 360; x += 12) {
    if (Math.abs(x + 8) < 20) continue;
    out.trees.push({ x: x + 3, y: GROUND, z: 12.5, s: rand.range(3.8, 4.6), type: 'round' });
    if (Math.abs(x - LANDMARKS.plaza.x) > 30) out.trees.push({ x: x + 9, y: GROUND, z: shoreZ(x + 9) - 9, s: rand.range(3.4, 4.2), type: rand.chance(0.15) ? 'cone' : 'round' });
  }
  // Inside the biodomes: dense tropical planting.
  for (const d of out.domes) {
    const n = Math.round(d.r * 1.2);
    for (let k = 0; k < n; k++) {
      const ang = rand.range(0, Math.PI * 2);
      const rr = Math.sqrt(rand.next()) * d.r * 0.75;
      const h = Math.sqrt(1 - (rr / d.r) ** 2) * d.r * d.hy;
      out.trees.push({ x: d.x + Math.cos(ang) * rr, y: GROUND, z: d.z + Math.sin(ang) * rr, s: Math.min(rand.range(4, 8), h * 0.75), type: rand.chance(0.45) ? 'palm' : 'round' });
    }
  }

  return { geometry: b.build(), ...out };
}
