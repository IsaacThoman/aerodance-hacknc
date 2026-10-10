import * as THREE from 'three';

// Geometry accumulation helpers. Everything static in the city is merged into
// a handful of buffers that share one "city" material; per-vertex attributes
// pick the surface kind (glass facade, painted, foliage, solar, paving).

export const KIND = { GLASS: 0, PAINT: 1, LEAF: 2, SOLAR: 3, PAVE: 4 };

const DEFAULT_FA = [0, 0, 0, 0];

export class Builder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.fa = [];
    this.st = [];
    this.idx = [];
  }

  get count() {
    return this.pos.length / 3;
  }

  vertex(p, n, uv, col, fa, st) {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(uv[0], uv[1]);
    this.col.push(col[0], col[1], col[2]);
    this.fa.push(fa[0], fa[1], fa[2], fa[3]);
    this.st.push(st[0], st[1], st[2], st[3]);
    return this.count - 1;
  }

  tri(a, b, c) {
    this.idx.push(a, b, c);
  }

  /**
   * Append a three.js geometry transformed by `matrix`.
   * opts: color [r,g,b] or fn(pos, normal) -> [r,g,b], fa, st, uvScale.
   */
  add(geometry, matrix, { color = [1, 1, 1], fa = DEFAULT_FA, st = [1, 0, 0.3, 0], uvScale = [1, 1], flip = false } = {}) {
    const g = geometry;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const u = g.attributes.uv;
    const base = this.count;
    const v = new THREE.Vector3();
    const nv = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      if (n) nv.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      else nv.set(0, 1, 0);
      const c = typeof color === 'function' ? color(v, nv) : color;
      this.vertex(
        [v.x, v.y, v.z],
        flip ? [-nv.x, -nv.y, -nv.z] : [nv.x, nv.y, nv.z],
        u ? [u.getX(i) * uvScale[0], u.getY(i) * uvScale[1]] : [0, 0],
        c,
        fa,
        st,
      );
    }
    const ix = g.index ? g.index.array : null;
    const n3 = ix ? ix.length : p.count;
    for (let i = 0; i < n3; i += 3) {
      const a = base + (ix ? ix[i] : i);
      const b = base + (ix ? ix[i + 1] : i + 1);
      const c = base + (ix ? ix[i + 2] : i + 2);
      if (flip) this.idx.push(a, c, b);
      else this.idx.push(a, b, c);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.fa, 4));
    g.setAttribute('aStyle', new THREE.Float32BufferAttribute(this.st, 4));
    const max = this.count;
    g.setIndex(max > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Superellipse radius for direction theta. n=2 ellipse, n~4 rounded rectangle. */
export function superR(theta, a, b, n) {
  const c = Math.abs(Math.cos(theta)) / a;
  const s = Math.abs(Math.sin(theta)) / b;
  return Math.pow(Math.pow(c, n) + Math.pow(s, n), -1 / n);
}

/**
 * Loft a closed cross-section up a vertical axis.
 * section(theta, t) -> [x, z] offsets from (cx, cz) at normalized height t.
 * Facade grid uv: u counts window columns around the perimeter, v counts floors (world y / floorH).
 */
export function loft(b, {
  cx = 0,
  cz = 0,
  y0 = 0,
  y1 = 10,
  levels = 8,
  segments = 32,
  section,
  yAt = null,
  cols = 24,
  floorH = 4,
  color = [1, 1, 1],
  fa = DEFAULT_FA,
  st = [0, 0, 0, 0],
  capTop = null,
  capBottom = false,
}) {
  const ring = [];
  for (let j = 0; j <= levels; j++) {
    const t = j / levels;
    const y = yAt ? yAt(t) : y0 + (y1 - y0) * t;
    const row = [];
    for (let i = 0; i < segments; i++) {
      const th = (i / segments) * Math.PI * 2;
      const [x, z] = section(th, t);
      row.push([cx + x, y, cz + z]);
    }
    ring.push(row);
  }
  const P = (i, j) => ring[Math.max(0, Math.min(levels, j))][((i % segments) + segments) % segments];
  const base = b.count;
  for (let j = 0; j <= levels; j++) {
    for (let i = 0; i <= segments; i++) {
      const p = P(i, j);
      const pa = P(i + 1, j);
      const pb = P(i - 1, j);
      const T = [pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]];
      const qa = P(i, j + 1);
      const qb = P(i, j - 1);
      const V = [qa[0] - qb[0], qa[1] - qb[1], qa[2] - qb[2]];
      // N = V x T (outward for counter-clockwise sections)
      let nx = V[1] * T[2] - V[2] * T[1];
      let ny = V[2] * T[0] - V[0] * T[2];
      let nz = V[0] * T[1] - V[1] * T[0];
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      const c = typeof color === 'function' ? color(p, j / levels) : color;
      b.vertex(p, [nx, ny, nz], [(i / segments) * cols, p[1] / floorH], c, fa, st);
    }
  }
  const W = segments + 1;
  for (let j = 0; j < levels; j++) {
    for (let i = 0; i < segments; i++) {
      const a = base + j * W + i;
      const bb = base + (j + 1) * W + i;
      const c = base + j * W + i + 1;
      const d = base + (j + 1) * W + i + 1;
      b.tri(a, bb, c);
      b.tri(c, bb, d);
    }
  }
  const cap = (j, up, opts) => {
    const row = ring[j];
    let mx = 0;
    let mz = 0;
    for (const p of row) {
      mx += p[0];
      mz += p[2];
    }
    mx /= row.length;
    mz /= row.length;
    const y = row[0][1] + (opts.lift ?? 0);
    const scale = opts.scale ?? 1;
    const n = up ? [0, 1, 0] : [0, -1, 0];
    const center = b.vertex([mx, y, mz], n, [0, 0], opts.color ?? [1, 1, 1], opts.fa ?? fa, opts.st ?? st);
    const first = b.count;
    for (let i = 0; i < segments; i++) {
      const p = row[i];
      const x = mx + (p[0] - mx) * scale;
      const z = mz + (p[2] - mz) * scale;
      b.vertex([x, y, z], n, [(x - mx) / 4, (z - mz) / 4], opts.color ?? [1, 1, 1], opts.fa ?? fa, opts.st ?? st);
    }
    for (let i = 0; i < segments; i++) {
      const a = first + i;
      const c = first + ((i + 1) % segments);
      if (up) b.tri(center, c, a);
      else b.tri(center, a, c);
    }
  };
  if (capTop) {
    const caps = Array.isArray(capTop) ? capTop : [capTop];
    for (const c of caps) cap(levels, true, c);
  }
  if (capBottom) cap(0, false, capBottom === true ? {} : capBottom);
  return ring;
}

/** Sample a closed polyline of corner points with rounded corners. Returns {points, tangents, lengths, total}. */
export function roundedLoop(corners, radius, step = 2) {
  const pts = [];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const p0 = corners[(i - 1 + n) % n];
    const p1 = corners[i];
    const p2 = corners[(i + 1) % n];
    const d0 = new THREE.Vector2(p1[0] - p0[0], p1[1] - p0[1]);
    const d1 = new THREE.Vector2(p2[0] - p1[0], p2[1] - p1[1]);
    const r = Math.min(radius, d0.length() * 0.45, d1.length() * 0.45);
    d0.normalize();
    d1.normalize();
    const a = new THREE.Vector2(p1[0] - d0.x * r, p1[1] - d0.y * r);
    const c = new THREE.Vector2(p1[0] + d1.x * r, p1[1] + d1.y * r);
    // Quadratic Bezier through the corner for a smooth fillet.
    const k = Math.max(6, Math.round(r / step));
    for (let s = 0; s <= k; s++) {
      const t = s / k;
      const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * p1[0] + t * t * c.x;
      const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * p1[1] + t * t * c.y;
      pts.push(new THREE.Vector2(x, y));
    }
    // Straight run to the next fillet start.
    const next = corners[(i + 1) % n];
    const after = corners[(i + 2) % n];
    const dn = new THREE.Vector2(after[0] - next[0], after[1] - next[1]);
    const segLen = Math.hypot(next[0] - p1[0], next[1] - p1[1]);
    const rn = Math.min(radius, segLen * 0.45, dn.length() * 0.45);
    const end = new THREE.Vector2(next[0] - d1.x * rn, next[1] - d1.y * rn);
    const runLen = c.distanceTo(end);
    const m = Math.max(1, Math.round(runLen / (step * 4)));
    for (let s = 1; s < m; s++) {
      pts.push(new THREE.Vector2().lerpVectors(c, end, s / m));
    }
  }
  // Resample at uniform arc length.
  const lens = [0];
  for (let i = 1; i <= pts.length; i++) lens.push(lens[i - 1] + pts[i % pts.length].distanceTo(pts[i - 1]));
  const total = lens[lens.length - 1];
  const count = Math.round(total / step);
  const out = [];
  let k = 0;
  for (let i = 0; i < count; i++) {
    const s = (i / count) * total;
    while (lens[k + 1] < s) k++;
    const t = (s - lens[k]) / (lens[k + 1] - lens[k] || 1);
    out.push(new THREE.Vector2().lerpVectors(pts[k], pts[(k + 1) % pts.length], t));
  }
  const tangents = out.map((p, i) => {
    const a = out[(i - 1 + out.length) % out.length];
    const b = out[(i + 1) % out.length];
    return new THREE.Vector2(b.x - a.x, b.y - a.y).normalize();
  });
  return { points: out, tangents, total, step: total / count };
}

/** Sweep a 2D profile (in the plane normal to the path) along a 3D path. */
export function sweep(b, path, profile, { closed = true, color = [1, 1, 1], fa = DEFAULT_FA, st = [1, 0, 0.3, 0], uvLen = 1, cols = 1 } = {}) {
  const n = path.length;
  const m = profile.length;
  const base = b.count;
  const up = new THREE.Vector3(0, 1, 0);
  const T = new THREE.Vector3();
  const S = new THREE.Vector3();
  const U = new THREE.Vector3();
  let along = 0;
  const rows = closed ? n + 1 : n;
  for (let i = 0; i < rows; i++) {
    const p = path[i % n];
    const pn = path[Math.min(i + 1, n - 1) % n];
    const pp = path[Math.max(i - 1, 0) % n];
    if (closed) {
      T.subVectors(path[(i + 1) % n], path[(i - 1 + n) % n]).normalize();
    } else {
      T.subVectors(pn, pp).normalize();
    }
    if (i > 0) along += p.distanceTo(path[(i - 1) % n]);
    S.crossVectors(T, up).normalize();
    U.crossVectors(S, T).normalize();
    for (let j = 0; j < m; j++) {
      const [sx, sy, nx, ny] = profile[j];
      const pos = [p.x + S.x * sx + U.x * sy, p.y + S.y * sx + U.y * sy, p.z + S.z * sx + U.z * sy];
      const nor = [S.x * nx + U.x * ny, S.y * nx + U.y * ny, S.z * nx + U.z * ny];
      b.vertex(pos, nor, [(j / (m - 1)) * cols, along / uvLen], typeof color === 'function' ? color(j, i) : color, fa, st);
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < m - 1; j++) {
      const a = base + i * m + j;
      const c = base + i * m + j + 1;
      const d = base + (i + 1) * m + j;
      const e = base + (i + 1) * m + j + 1;
      b.tri(a, c, d);
      b.tri(c, e, d);
    }
  }
}

/** Rounded-rectangle profile for sweep(): [x, y, nx, ny] points, counter-clockwise. */
export function roundedProfile(w, h, r, seg = 3) {
  const pts = [];
  const corners = [
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, Math.PI / 2],
    [-w / 2 + r, -h / 2 + r, Math.PI],
    [w / 2 - r, -h / 2 + r, Math.PI * 1.5],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let s = 0; s <= seg; s++) {
      const a = a0 + (s / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.cos(a), Math.sin(a)]);
    }
  }
  pts.push(pts[0]);
  return pts;
}

export const mat4 = (() => {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  return (pos, rot = [0, 0, 0], scale = [1, 1, 1]) => {
    e.set(rot[0], rot[1], rot[2]);
    q.setFromEuler(e);
    p.set(pos[0], pos[1], pos[2]);
    if (typeof scale === 'number') s.set(scale, scale, scale);
    else s.set(scale[0], scale[1], scale[2]);
    return m.clone().compose(p, q, s);
  };
})();

export function hexToLinear(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}
