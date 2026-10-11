import * as THREE from 'three';
import { makeRandom } from '../shared/random.js';
import { blob, color, finalize, lathe, makeNoise3, merge, mesh, place, taperedTube } from './geometry.js';

const _c = new THREE.Color();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ss = THREE.MathUtils.smoothstep;

/** Per-triangle paint (by centroid) so stripes and gores stay crisp. */
export function paintFaces(geo, fn, sway = 0) {
  const g = finalize(geo, { sway });
  const pos = g.attributes.position;
  const col = g.attributes.color;
  for (let i = 0; i < pos.count; i += 3) {
    _a.fromBufferAttribute(pos, i).add(_b.fromBufferAttribute(pos, i + 1)).add(_d.fromBufferAttribute(pos, i + 2)).multiplyScalar(1 / 3);
    fn(_a, _c);
    for (let k = 0; k < 3; k++) col.setXYZ(i + k, _c.r, _c.g, _c.b);
  }
  return g;
}

/** Curved palm: banded trunk, coconuts and feathery drooping fronds made of leaflets. */
export function palmGeometry({ height = 8, lean = 2, heading = 0, seed = 1, fronds = 10, frondLength = 3.6, hue = 0 } = {}) {
  const rand = makeRandom(seed);
  const parts = [];
  const dir = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
  const pts = [
    new THREE.Vector3(0, -0.5, 0),
    dir.clone().multiplyScalar(lean * 0.12).setY(height * 0.33),
    dir.clone().multiplyScalar(lean * 0.45).setY(height * 0.68),
    dir.clone().multiplyScalar(lean).setY(height),
  ];
  const curve = new THREE.CatmullRomCurve3(pts);
  const bark = color('#8a6a48');
  const barkLight = color('#d9bf94');
  parts.push(
    finalize(
      taperedTube(curve, 20, 7, (t) => 0.3 * (1 - t * 0.42) + Math.max(0, 0.08 - t) * 3, {
        colorFn: (t, a, out) => {
          const band = Math.pow(0.5 + 0.5 * Math.sin(t * height * 4.4), 4);
          out.copy(bark).lerp(barkLight, 0.2 + band * 0.55);
        },
        swayFn: (t) => t * t * 0.3,
      }),
    ),
  );
  const crown = pts[3];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rand.range(0, 1);
    const g = new THREE.SphereGeometry(0.2, 8, 6);
    place(g, { position: [crown.x + Math.cos(a) * 0.26, crown.y - 0.3 - rand.range(0, 0.12), crown.z + Math.sin(a) * 0.26] });
    parts.push(finalize(g, { paint: i % 2 ? '#7a5426' : '#9a7a2a', sway: 0.3 }));
  }
  const dark = color('#1f7a36').offsetHSL(hue, 0, 0);
  const light = color('#a3e35a').offsetHSL(hue, 0, 0);
  const P = new THREE.Vector3();
  const T = new THREE.Vector3();
  const side = new THREE.Vector3();
  const down = new THREE.Vector3();
  for (let k = 0; k < fronds; k++) {
    const az = (k / fronds) * Math.PI * 2 + rand.range(-0.25, 0.25);
    const up = k % 3 === 0 ? rand.range(0.35, 0.7) : rand.range(-0.2, 0.35);
    const len = frondLength * rand.range(0.82, 1.12);
    const out = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const c = new THREE.CatmullRomCurve3([
      crown.clone(),
      crown.clone().addScaledVector(out, len * 0.32).add(new THREE.Vector3(0, len * (0.2 + up * 0.25), 0)),
      crown.clone().addScaledVector(out, len * 0.7).add(new THREE.Vector3(0, len * (0.04 + up * 0.22), 0)),
      crown.clone().addScaledVector(out, len).add(new THREE.Vector3(0, -len * (0.38 - up * 0.3), 0)),
    ]);
    const positions = [];
    const colors = [];
    const sways = [];
    const indices = [];
    const N = 15;
    for (let i = 0; i < N; i++) {
      const t = 0.1 + (0.88 * i) / N;
      c.getPointAt(t, P);
      c.getTangentAt(t, T);
      side.crossVectors(T, UP).normalize();
      down.crossVectors(side, T).normalize();
      const L = len * 0.4 * Math.sin(Math.PI * (t * 0.85 + 0.1)) + 0.1;
      const sw = 0.3 + t * t * 0.9;
      for (const s of [-1, 1]) {
        const base = positions.length / 3;
        const b1 = P.clone().addScaledVector(T, -len * 0.035);
        const b2 = P.clone().addScaledVector(T, len * 0.035);
        const tip = P.clone().addScaledVector(side, s * L * 0.85).addScaledVector(T, L * 0.4).addScaledVector(down, L * 0.42);
        const order = s > 0 ? [b2, b1, tip] : [b1, b2, tip];
        for (const v of order) positions.push(v.x, v.y, v.z);
        _c.copy(dark).lerp(light, 0.25 + t * 0.35);
        colors.push(_c.r, _c.g, _c.b, _c.r, _c.g, _c.b);
        _c.copy(dark).lerp(light, 0.8 + t * 0.2);
        colors.push(_c.r, _c.g, _c.b);
        sways.push(sw, sw, sw + L * 0.25);
        indices.push(base, base + 1, base + 2);
      }
    }
    parts.push(finalize(mesh(positions, indices, colors, sways)));
  }
  return parts;
}

/** Striped beach umbrella; the canopy has a top and an underside. */
export function umbrellaGeometry({ stripes = ['#ff6b7a', '#ffffff'], radius = 1.5, height = 2.5, tilt = [0, 0, 0] } = {}) {
  const parts = [];
  // Rim-to-tip profile winds outward (the top); tip-to-rim winds inward (the underside).
  const prof = [[radius * 1.01, -0.1], [radius, 0], [radius * 0.65, 0.24], [radius * 0.3, 0.42], [0.03, 0.5]];
  const top = lathe(prof, 16);
  const under = lathe([...prof].reverse().map(([x, y]) => [x * 0.985, y - 0.03]), 16);
  for (const g of [top, under]) {
    place(g, { position: [0, height - 0.4, 0] });
    parts.push(
      paintFaces(g, (p, out) => {
        const a = Math.atan2(p.z, p.x) + Math.PI;
        out.set(stripes[Math.floor((a / (Math.PI * 2)) * 8) % stripes.length]);
        if (p.y < height - 0.45) out.multiplyScalar(0.92);
      }),
    );
  }
  const pole = new THREE.CylinderGeometry(0.035, 0.04, height + 0.3, 6);
  place(pole, { position: [0, (height - 0.3) / 2, 0] });
  parts.push(finalize(pole, { paint: '#f4f1ea' }));
  const knob = new THREE.SphereGeometry(0.08, 8, 6);
  place(knob, { position: [0, height + 0.15, 0] });
  parts.push(finalize(knob, { paint: stripes[0] }));
  const g = merge(parts);
  return place(g, { rotation: tilt });
}

/** White sun lounger with a striped towel; its foot points to +z. */
export function loungerGeometry({ towel = '#3fd3e0' } = {}) {
  const parts = [];
  const seat = new THREE.BoxGeometry(0.66, 0.08, 1.3);
  place(seat, { position: [0, 0.36, 0.25] });
  parts.push(finalize(seat, { paint: '#fbfbf8' }));
  const back = new THREE.BoxGeometry(0.66, 0.08, 0.75);
  place(back, { position: [0, 0.6, -0.68], rotation: [-0.75, 0, 0] });
  parts.push(finalize(back, { paint: '#fbfbf8' }));
  const t1 = new THREE.BoxGeometry(0.56, 0.02, 1.2);
  place(t1, { position: [0, 0.41, 0.28] });
  parts.push(paintFaces(t1, (p, out) => out.set(Math.floor((p.z + 2) * 4) % 2 ? towel : '#ffffff')));
  for (const [x, z] of [[-0.28, 0.82], [0.28, 0.82], [-0.28, -0.3], [0.28, -0.3]]) {
    const leg = new THREE.CylinderGeometry(0.03, 0.03, 0.36, 5);
    place(leg, { position: [x, 0.18, z] });
    parts.push(finalize(leg, { paint: '#d8dde2' }));
  }
  return merge(parts);
}

/** Striped beach towel lying flat, long axis along z. */
export function towelGeometry() {
  const g = new THREE.BoxGeometry(0.95, 0.025, 1.85, 1, 1, 12);
  place(g, { position: [0, 0.012, 0] });
  const stripes = ['#2fc6e8', '#ffffff', '#ff6f8a', '#ffffff'];
  return paintFaces(g, (p, out) => out.set(stripes[Math.floor((p.z + 0.925) * 4.3) % stripes.length]));
}

export function flipFlopGeometry(tone = '#ff7fa8') {
  const sole = new THREE.CylinderGeometry(0.1, 0.1, 0.03, 12);
  place(sole, { position: [0, 0.015, 0], scale: [0.85, 1, 2.3] });
  const strap = new THREE.TorusGeometry(0.07, 0.014, 4, 10, Math.PI);
  place(strap, { position: [0, 0.03, 0.04], rotation: [0, Math.PI / 2, 0] });
  return merge([finalize(sole, { paint: tone }), finalize(strap, { paint: '#ffffff' })]);
}

/** Little sandcastle: a round keep, three crenellated towers and an aqua pennant. */
export function sandcastleGeometry() {
  const sand = '#e3b97f';
  const parts = [];
  const keep = new THREE.CylinderGeometry(0.34, 0.42, 0.26, 14);
  place(keep, { position: [0, 0.13, 0] });
  parts.push(finalize(keep, { paint: sand }));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const x = Math.cos(a) * 0.28;
    const z = Math.sin(a) * 0.28;
    const tower = new THREE.CylinderGeometry(0.1, 0.12, 0.36, 10);
    place(tower, { position: [x, 0.36, z] });
    parts.push(finalize(tower, { paint: sand }));
    const cap = new THREE.ConeGeometry(0.11, 0.16, 10);
    place(cap, { position: [x, 0.62, z] });
    parts.push(finalize(cap, { paint: '#efc890' }));
  }
  const pole = new THREE.CylinderGeometry(0.008, 0.008, 0.32, 4);
  place(pole, { position: [0, 0.42, 0] });
  parts.push(finalize(pole, { paint: '#ffffff' }));
  parts.push(finalize(mesh([0, 0.58, 0, 0, 0.48, 0, 0.16, 0.53, 0], [0, 1, 2, 0, 2, 1]), { paint: '#2fc6e8' }));
  return merge(parts);
}

export function bucketGeometry() {
  const pail = lathe([[0, 0], [0.13, 0], [0.17, 0.24], [0.155, 0.24], [0.12, 0.02], [0, 0.02]], 14);
  return finalize(pail, { paint: (p, n, out) => out.set(p.y > 0.19 ? '#ffd23a' : '#ff6f61') });
}

/** Glossy surfboard standing on its tail. */
export function surfboardGeometry({ base = '#ffffff', stripe = '#2fc6e8', length = 2.1 } = {}) {
  const g = new THREE.SphereGeometry(1, 16, 10);
  place(g, { scale: [0.27, length / 2, 0.05], position: [0, length / 2, 0] });
  return paintFaces(g, (p, out) => {
    const y = p.y / length;
    out.set(base);
    if (Math.abs(y - 0.62) < 0.05 || Math.abs(y - 0.5) < 0.025) out.set(stripe);
    if (Math.abs(p.x) < 0.012) out.set(stripe);
  });
}

export function surfRackGeometry() {
  const parts = [];
  for (const x of [-1.1, 1.1]) {
    const post = new THREE.CylinderGeometry(0.05, 0.06, 1.5, 6);
    place(post, { position: [x, 0.75, 0] });
    parts.push(finalize(post, { paint: '#f2efe6' }));
  }
  for (const y of [0.55, 1.35]) {
    const bar = new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6);
    place(bar, { position: [0, y, 0], rotation: [0, 0, Math.PI / 2] });
    parts.push(finalize(bar, { paint: '#2fc6e8' }));
  }
  return parts;
}

/** Six-gore beach ball, radius 1. */
export function beachBallGeometry() {
  const g = new THREE.SphereGeometry(1, 18, 12);
  const gores = ['#ff4f6a', '#ffffff', '#ffc93a', '#ffffff', '#2fb8ff', '#ffffff'];
  return paintFaces(g, (p, out) => {
    if (Math.abs(p.y) > 0.9) return out.set('#ffffff');
    const a = Math.atan2(p.z, p.x) + Math.PI;
    out.set(gores[Math.floor((a / (Math.PI * 2)) * 6) % 6]);
  });
}

/** White lifeguard tower on stilts with a coral roof, ramp and a pennant (sway). */
export function lifeguardGeometry() {
  const parts = [];
  const white = '#fbfbf7';
  for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
    const leg = new THREE.CylinderGeometry(0.07, 0.09, 2.6, 6);
    place(leg, { position: [x * 0.88, 1.2, z * 0.88], rotation: [z * 0.06, 0, -x * 0.06] });
    parts.push(finalize(leg, { paint: white }));
  }
  for (const z of [-0.75, 0.75]) {
    const brace = new THREE.BoxGeometry(1.7, 0.08, 0.06);
    place(brace, { position: [0, 1.0, z], rotation: [0, 0, 0.55] });
    parts.push(finalize(brace, { paint: white }));
  }
  const deck = new THREE.BoxGeometry(2.1, 0.14, 2.1);
  place(deck, { position: [0, 2.45, 0] });
  parts.push(finalize(deck, { paint: '#2fc6e0' }));
  const cabin = new THREE.BoxGeometry(1.5, 1.25, 1.35);
  place(cabin, { position: [0, 3.15, -0.2] });
  parts.push(
    paintFaces(cabin, (p, out) => {
      out.set(white);
      if (p.y > 3.0 && p.y < 3.5 && p.z > 0.4) out.set('#3f7fb0');
      if (p.y < 2.75) out.set('#ff6f61');
    }),
  );
  const roof = new THREE.CylinderGeometry(1.05, 1.05, 2.0, 12, 1, false, 0, Math.PI);
  place(roof, { position: [0, 3.78, -0.2], rotation: [0, 0, Math.PI / 2], scale: [1, 1, 0.35] });
  parts.push(finalize(roof, { paint: '#ff6f61' }));
  for (const [x, z, len, rot] of [[0, 1.0, 2.1, 0], [-1.02, 0, 2.1, Math.PI / 2], [1.02, 0, 2.1, Math.PI / 2]]) {
    const rail = new THREE.CylinderGeometry(0.035, 0.035, len, 5);
    place(rail, { position: [x, 3.05, z], rotation: [0, rot, Math.PI / 2] });
    parts.push(finalize(rail, { paint: white }));
  }
  const ramp = new THREE.BoxGeometry(0.75, 0.08, 3.4);
  place(ramp, { position: [0.55, 1.2, 2.3], rotation: [0.8, 0, 0] });
  parts.push(finalize(ramp, { paint: '#e9dcc4' }));
  const pole = new THREE.CylinderGeometry(0.03, 0.03, 1.8, 5);
  place(pole, { position: [0.6, 4.6, -0.6] });
  parts.push(finalize(pole, { paint: white }));
  const flag = mesh(
    [0.62, 5.45, -0.6, 0.62, 5.0, -0.6, 1.45, 5.28, -0.62],
    [0, 1, 2, 0, 2, 1],
    null,
    [0, 0, 0.6],
  );
  parts.push(finalize(flag, { paint: '#ffcf3a' }));
  return merge(parts);
}

/** Small sailboat: hull, cabin, mast, main + jib; bow at +z. */
export function sailboatGeometry({ hull = '#26b3d9', stripe = '#ff7a8a' } = {}) {
  const parts = [];
  const h = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  place(h, { scale: [0.95, 0.75, 3.2] });
  parts.push(finalize(h, { paint: (p, n, out) => out.set(p.y > -0.18 ? hull : '#ffffff') }));
  const deck = new THREE.CircleGeometry(1, 18);
  place(deck, { rotation: [-Math.PI / 2, 0, 0], scale: [0.93, 3.15, 1] });
  parts.push(finalize(deck, { paint: '#f3e3c0' }));
  const cabin = blob({ radius: 0.6, detail: 1, squash: [1, 0.55, 1.8], amount: 0.02, seed: 4 });
  place(cabin, { position: [0, 0.2, -0.2] });
  parts.push(finalize(cabin, { paint: '#ffffff' }));
  const mast = new THREE.CylinderGeometry(0.05, 0.07, 7.5, 6);
  place(mast, { position: [0, 3.75, 0.6] });
  parts.push(finalize(mast, { paint: '#e9eef2' }));
  const sail = (pts, paint, belly) => {
    const [a, b, c] = pts.map((v) => new THREE.Vector3(...v));
    const n = 6;
    const positions = [];
    const indices = [];
    const rowStart = [];
    let idx = 0;
    for (let i = 0; i <= n; i++) {
      rowStart.push(idx);
      for (let j = 0; j <= n - i; j++) {
        const u = i / n;
        const v = j / n;
        const w = 1 - u - v;
        const q = new THREE.Vector3().addScaledVector(a, w).addScaledVector(b, u).addScaledVector(c, v);
        q.x += belly * u * v * w * 6;
        positions.push(q.x, q.y, q.z);
        idx++;
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        const p0 = rowStart[i] + j;
        const p1 = rowStart[i + 1] + j;
        indices.push(p0, p1, p0 + 1);
        if (j < n - i - 1) indices.push(p1, p1 + 1, p0 + 1);
      }
    }
    return finalize(mesh(positions, indices), { paint });
  };
  parts.push(sail([[0, 0.9, 0.5], [0, 7.3, 0.6], [0, 0.9, -2.6]], (p, n, out) => out.set(p.y > 2.4 && p.y < 3.1 ? stripe : '#ffffff'), 0.6));
  parts.push(sail([[0, 0.8, 0.75], [0, 6.6, 0.7], [0, 0.6, 3.0]], (p, n, out) => out.set(p.y < 2.0 ? stripe : '#ffffff'), -0.5));
  return merge(parts);
}

/** Gull with an M-shaped wing; aSway encodes signed span (wing tip = +-1). */
export function gullGeometry() {
  const parts = [];
  const body = new THREE.SphereGeometry(0.16, 10, 6);
  place(body, { scale: [0.8, 0.75, 2.4] });
  parts.push(finalize(body, { paint: '#ffffff' }));
  const head = new THREE.SphereGeometry(0.12, 8, 6);
  place(head, { position: [0, 0.07, 0.36] });
  parts.push(finalize(head, { paint: '#ffffff' }));
  const beak = new THREE.ConeGeometry(0.03, 0.12, 5);
  place(beak, { position: [0, 0.05, 0.5], rotation: [Math.PI / 2, 0, 0] });
  parts.push(finalize(beak, { paint: '#ffc23a' }));
  for (const s of [-1, 1]) {
    const lead = [[0.05, 0.02, 0.12], [0.45, 0.16, 0.12], [1.05, 0.0, -0.08]];
    const trail = [[0.05, 0.0, -0.18], [0.45, 0.12, -0.22], [1.05, -0.02, -0.16]];
    const positions = [];
    const sways = [];
    const colors = [];
    for (let i = 0; i < 3; i++) {
      for (const e of [lead[i], trail[i]]) {
        positions.push(e[0] * s, e[1], e[2]);
        sways.push((e[0] / 1.05) * s);
        _c.set(i === 2 ? '#3a4552' : i === 1 ? '#c9d4de' : '#eef2f5');
        colors.push(_c.r, _c.g, _c.b);
      }
    }
    const idx = s > 0 ? [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4] : [0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5];
    parts.push(finalize(mesh(positions, idx, colors, sways)));
  }
  return merge(parts);
}

/** Countershaded dolphin, ~2.4 long, nose at +z. */
export function dolphinGeometry() {
  const parts = [];
  const body = lathe(
    [[0, -1.25], [0.06, -1.15], [0.13, -0.85], [0.24, -0.35], [0.27, 0.05], [0.24, 0.45], [0.15, 0.8], [0.07, 0.95], [0.055, 1.12], [0, 1.2]],
    14,
  );
  place(body, { rotation: [Math.PI / 2, 0, 0], scale: [0.9, 1, 1] });
  const back = color('#4f78a8');
  const belly = color('#eef4fa');
  parts.push(finalize(body, { paint: (p, n, out) => out.copy(belly).lerp(back, ss(p.y + n.y * 0.1, -0.08, 0.1)) }));
  const fin = mesh([0, 0.2, 0.15, 0, 0.2, -0.3, 0, 0.55, -0.35], [0, 1, 2, 0, 2, 1]);
  parts.push(finalize(fin, { paint: back }));
  const fluke = mesh([0, 0, -1.1, -0.42, 0.02, -1.38, 0.42, 0.02, -1.38, 0, 0.0, -1.28], [0, 1, 3, 0, 3, 2, 0, 3, 1, 0, 2, 3]);
  parts.push(finalize(fluke, { paint: back }));
  for (const s of [-1, 1]) {
    const f = mesh([s * 0.2, -0.1, 0.4, s * 0.5, -0.25, 0.15, s * 0.2, -0.12, 0.15], [0, 1, 2, 0, 2, 1]);
    parts.push(finalize(f, { paint: back }));
  }
  return merge(parts);
}

/** Jet ski with a rider; bow at +z. */
export function jetSkiGeometry({ hull = '#ffffff', accent = '#ff5f7a', vest = '#ffd23a' } = {}) {
  const parts = [];
  const h = new THREE.SphereGeometry(1, 14, 8);
  place(h, { scale: [0.45, 0.28, 1.25], position: [0, 0.12, 0] });
  parts.push(finalize(h, { paint: (p, n, out) => out.set(p.y > 0.2 ? accent : hull) }));
  const seat = new THREE.BoxGeometry(0.32, 0.18, 0.9);
  place(seat, { position: [0, 0.42, -0.25] });
  parts.push(finalize(seat, { paint: '#24324a' }));
  const torso = new THREE.CapsuleGeometry(0.17, 0.45, 3, 8);
  place(torso, { position: [0, 0.95, -0.1], rotation: [0.35, 0, 0] });
  parts.push(finalize(torso, { paint: vest }));
  const head = new THREE.SphereGeometry(0.13, 8, 6);
  place(head, { position: [0, 1.45, 0.08] });
  parts.push(finalize(head, { paint: '#8a5a3a' }));
  return merge(parts);
}

/** White cruise liner (~90 long, bow at +x). Returns { body, windows }. */
export function cruiseShipGeometry() {
  const outline = (len, wid, bow) => {
    const s = new THREE.Shape();
    s.moveTo(-len / 2, -wid / 2);
    s.lineTo(len / 2 - bow, -wid / 2);
    s.quadraticCurveTo(len / 2, -wid * 0.2, len / 2 + bow * 0.15, 0);
    s.quadraticCurveTo(len / 2, wid * 0.2, len / 2 - bow, wid / 2);
    s.lineTo(-len / 2, wid / 2);
    s.quadraticCurveTo(-len / 2 - 2, 0, -len / 2, -wid / 2);
    return s;
  };
  const body = [];
  const windows = [];
  const hull = new THREE.ExtrudeGeometry(outline(92, 13, 16), { depth: 8, bevelEnabled: false, curveSegments: 8 });
  place(hull, { rotation: [Math.PI / 2, 0, 0], position: [0, 7, 0] });
  body.push(
    finalize(hull, {
      paint: (p, n, out) => {
        out.set('#ffffff');
        if (p.y < 1.6) out.set('#2a4f9a');
        else if (p.y > 5.2 && p.y < 6.2) out.set('#2fb6e0');
      },
    }),
  );
  const decks = [[76, 11.5, 10, 7, 2.6], [66, 10.5, 8, 9.6, 2.4], [52, 9.5, 6, 12, 2.4], [34, 8, 4, 14.4, 2.2]];
  decks.forEach(([len, wid, bow, y, ht], i) => {
    const d = new THREE.ExtrudeGeometry(outline(len, wid, bow), { depth: ht, bevelEnabled: false, curveSegments: 6 });
    place(d, { rotation: [Math.PI / 2, 0, 0], position: [-4 - i * 2, y + ht, 0] });
    body.push(finalize(d, { paint: '#ffffff' }));
    for (const s of [-1, 1]) {
      const w = new THREE.PlaneGeometry(len - bow - 4, 0.7);
      place(w, { position: [-4 - i * 2 - bow / 2, y + ht * 0.55, s * (wid / 2 + 0.05)], rotation: [0, s > 0 ? 0 : Math.PI, 0] });
      windows.push(finalize(w, { paint: '#ffd9a0' }));
    }
  });
  const funnel = new THREE.CylinderGeometry(2.2, 2.8, 6, 12);
  place(funnel, { position: [-18, 19.5, 0], scale: [1.6, 1, 1] });
  body.push(finalize(funnel, { paint: (p, n, out) => out.set(p.y > 21 ? '#ff6f61' : '#2fb6e0') }));
  for (const s of [-1, 1]) {
    const w = new THREE.PlaneGeometry(70, 0.6);
    place(w, { position: [-2, 4.2, s * 6.55], rotation: [0, s > 0 ? 0 : Math.PI, 0] });
    windows.push(finalize(w, { paint: '#ffcf90' }));
  }
  return { body: merge(body), windows: merge(windows) };
}

/** Wind turbine tower + nacelle (rotor is separate). Hub at (0, height, 0.9). */
export function turbineTowerGeometry(height = 22) {
  const tower = new THREE.CylinderGeometry(0.35, 0.75, height, 10);
  place(tower, { position: [0, height / 2, 0] });
  const nacelle = new THREE.CapsuleGeometry(0.6, 1.8, 3, 8);
  place(nacelle, { position: [0, height, -0.1], rotation: [Math.PI / 2, 0, 0] });
  return [finalize(tower, { paint: '#f5f7fa' }), finalize(nacelle, { paint: '#f5f7fa' })];
}

export function rotorGeometry(radius = 9) {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const blade = mesh(
      [-0.35, 0, 0.05, 0.35, 0, 0.05, 0.12, radius, 0, -0.08, radius, 0, 0, 0, -0.08],
      [0, 1, 2, 0, 2, 3, 1, 0, 4, 1, 4, 2, 0, 3, 4, 4, 3, 2],
    );
    place(blade, { rotation: [0, 0, (i / 3) * Math.PI * 2] });
    parts.push(finalize(blade, { paint: '#f7f9fb' }));
  }
  const hub = new THREE.SphereGeometry(0.55, 10, 8);
  place(hub, { scale: [1, 1, 1.5] });
  parts.push(finalize(hub, { paint: '#ffffff' }));
  return merge(parts);
}

/** Lighthouse tower with aqua bands; lantern room is separate (emissive). Height ~13. */
export function lighthouseGeometry() {
  const parts = [];
  const tower = lathe([[0, 0], [2.0, 0], [2.0, 0.5], [1.6, 0.8], [1.05, 11], [1.55, 11.1], [1.6, 11.5], [0, 11.5]], 20);
  parts.push(
    finalize(tower, {
      paint: (p, n, out) => {
        out.set('#ffffff');
        if ((p.y > 3.2 && p.y < 4.6) || (p.y > 7.2 && p.y < 8.6)) out.set('#ff6f61');
      },
    }),
  );
  const roof = lathe([[0, 0], [1.1, 0], [1.35, 0.05], [1.1, 0.6], [0.3, 1.8], [0, 2.0]], 16);
  place(roof, { position: [0, 13.1, 0] });
  parts.push(finalize(roof, { paint: '#ff6f61' }));
  const ball = new THREE.SphereGeometry(0.22, 8, 6);
  place(ball, { position: [0, 15.2, 0] });
  parts.push(finalize(ball, { paint: '#ffffff' }));
  const house = new THREE.BoxGeometry(3.2, 2.2, 2.6);
  place(house, { position: [2.6, 1.1, 0.6] });
  parts.push(finalize(house, { paint: '#ffffff' }));
  const hroof = new THREE.CylinderGeometry(1.5, 1.5, 3.4, 4, 1);
  place(hroof, { position: [2.6, 2.5, 0.6], rotation: [0, Math.PI / 4, 0], scale: [1, 0.5, 1.2] });
  parts.push(finalize(hroof, { paint: '#ff6f61' }));
  return parts;
}

/** Big volcano island: polar grid with a crater, green skirts, bare upper slopes. */
export function volcanoGeometry({ radius = 170, height = 120, seed = 3 } = {}) {
  const noise = makeNoise3(seed);
  const rings = 22;
  const segs = 56;
  const positions = [];
  const indices = [];
  const crater = 0.13;
  for (let i = 0; i <= rings; i++) {
    const rho = i / rings;
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const n = noise(Math.cos(a) * 2.2 + 4, Math.sin(a) * 2.2, rho * 3);
      const r = rho * radius * (1 + 0.12 * n);
      let h = rho < crater ? height * (0.86 + 0.14 * (rho / crater)) : height * Math.pow(1 - (rho - crater) / (1 - crater), 1.9);
      h += (1 - rho) * rho * height * 0.25 * noise(Math.cos(a) * 5, Math.sin(a) * 5, 9);
      // Erosion gullies down the cone.
      h += (1 - rho) * rho * height * 0.08 * noise(Math.cos(a) * 14, Math.sin(a) * 14, rho * 2);
      if (rho > 0.92) h = Math.min(h, (1 - rho) * 20) - (rho - 0.92) * 30;
      positions.push(Math.cos(a) * r, h, Math.sin(a) * r);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const b = (i + 1) * (segs + 1) + j;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const green = color('#2f8a4a');
  const lush = color('#5cb85c');
  const rock = color('#6e5560');
  const rim = color('#8a5a50');
  const sand = color('#f0d9a8');
  return finalize(mesh(positions, indices), {
    paint: (p, n, out) => {
      const y = p.y / height;
      out.copy(lush).lerp(green, ss(y, 0.05, 0.25)).lerp(rock, ss(y, 0.3, 0.55)).lerp(rim, ss(y, 0.8, 0.95));
      if (p.y < 3) out.lerp(sand, 0.8);
    },
  });
}
