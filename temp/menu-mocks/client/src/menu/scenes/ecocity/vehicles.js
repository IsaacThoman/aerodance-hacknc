import * as THREE from 'three';
import { cityUniforms } from './materials.js';

// Shader-painted vehicles: livery is computed from object-space position so
// the meshes stay simple. Motion for pods is computed on the GPU.

const PAINT = {
  train: /* glsl */ `
    vec3 lp = vLocal;
    float win = step(0.05, lp.y) * step(lp.y, 1.05);
    float mull = 1.0 - step(0.12, abs(fract(lp.x / 1.8) - 0.5) * 2.0 - 0.8);
    float nose = smoothstep(5.2, 6.4, abs(lp.x)) * step(-0.3, lp.y);
    float glass = max(win * (1.0 - mull * 0.0), nose);
    float stripe = step(-0.55, lp.y) * step(lp.y, -0.2);
    float lime = step(-0.72, lp.y) * step(lp.y, -0.62);
    vec3 body = vec3(0.95, 0.97, 0.99);
    body = mix(body, vec3(0.0, 0.55, 0.72), stripe);
    body = mix(body, vec3(0.45, 0.85, 0.1), lime);
    body = mix(body, vec3(0.72, 0.78, 0.82), step(lp.y, -1.15));
    vec3 g = vec3(0.02, 0.12, 0.2);
    pc = mix(body, g, glass);
    pr = mix(0.22, 0.04, glass);
    pm = mix(0.1, 0.9, glass);
    pe = vec3(0.0);
  `,
  pod: /* glsl */ `
    vec3 lp = vLocal;
    float glass = step(0.12, lp.y) * step(-1.0, lp.x);
    float under = step(lp.y, -0.42);
    pc = mix(vColor.rgb, vec3(0.94, 0.96, 0.98), under);
    pc = mix(pc, vec3(0.02, 0.1, 0.18), glass);
    pr = mix(0.18, 0.04, glass);
    pm = mix(0.15, 0.9, glass);
    pe = vec3(0.0);
    #ifdef AIR
      float ring = step(lp.y, -0.55) * (1.0 - glass);
      pe = vec3(0.3, 1.0, 1.0) * ring * 2.2;
    #endif
    // Tail lights
    pe += vec3(1.0, 0.25, 0.2) * step(lp.x, -1.95) * step(-0.2, lp.y) * step(lp.y, 0.1) * 1.5;
  `,
  blimp: /* glsl */ `
    vec3 lp = vLocal;
    float wave = sin(lp.x * 0.09 + 0.6) * 1.6;
    float band = smoothstep(-1.2 + wave, -0.9 + wave, -lp.y) ;
    float lime = step(abs(-lp.y - (-1.6 + wave) + 0.0), 0.35);
    vec3 body = vec3(0.96, 0.97, 0.99);
    vec3 aqua = mix(vec3(0.0, 0.62, 0.78), vec3(0.0, 0.35, 0.72), smoothstep(-2.0, -8.0, lp.y));
    body = mix(body, aqua, band);
    body = mix(body, vec3(0.5, 0.88, 0.12), lime * (1.0 - band));
    pc = body * vColor.rgb;
    pr = 0.24;
    pm = 0.08;
    pe = vec3(0.0);
  `,
};

export function makeVehicleMaterial(kind, { air = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.1 });
  if (kind === 'blimp') mat.vertexColors = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = cityUniforms.uTime;
    if (air) shader.defines = { ...shader.defines, AIR: '' };
    const motion = kind === 'pod';
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        varying vec3 vLocal;
        ${motion ? 'attribute vec4 aLane;\nattribute vec4 aMove;' : ''}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        motion
          ? `
        #include <beginnormal_vertex>
        vec2 mvP;
        vec2 mvD;
        float mvY;
        float mvS = 1.0;
        #ifdef AIR
          float ang = uTime * aMove.x + aMove.y * 6.2831853;
          mvP = aLane.xy + vec2(cos(ang) * aLane.z, sin(ang) * aLane.w);
          mvD = normalize(vec2(-sin(ang) * aLane.z, cos(ang) * aLane.w)) * sign(aMove.x);
          mvY = aMove.z + sin(uTime * 0.7 + aMove.y * 10.0) * aMove.w;
        #else
          float len = length(aLane.zw - aLane.xy);
          float u = fract(uTime * aMove.x / len + aMove.y);
          mvP = mix(aLane.xy, aLane.zw, u);
          mvD = (aLane.zw - aLane.xy) / len;
          mvY = aMove.z;
          mvS = smoothstep(0.0, 0.025, u) * smoothstep(1.0, 0.975, u);
        #endif
        vec3 mvX = vec3(mvD.x, 0.0, mvD.y);
        vec3 mvZ = vec3(-mvD.y, 0.0, mvD.x);
        objectNormal = mvX * objectNormal.x + vec3(0.0, objectNormal.y, 0.0) + mvZ * objectNormal.z;
        `
          : '#include <beginnormal_vertex>',
      )
      .replace(
        '#include <begin_vertex>',
        motion
          ? `
        #include <begin_vertex>
        vLocal = position;
        vec3 lpos = transformed * mvS;
        transformed = vec3(mvP.x, mvY, mvP.y) + mvX * lpos.x + vec3(0.0, lpos.y, 0.0) + mvZ * lpos.z;
        `
          : `#include <begin_vertex>
        vLocal = position;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;\nuniform float uTime;')
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        vec3 pc; float pr; float pm; vec3 pe;
        {
          ${PAINT[kind]}
        }
        diffuseColor.rgb = pc;
        roughnessFactor = pr;
        metalnessFactor = pm;`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += pe;');
  };
  mat.customProgramCacheKey = () => `ecocity-vehicle-${kind}-${air}`;
  return mat;
}

/** Monorail car: rounded capsule ~14 m long, origin at its center. */
export function makeTrainCar() {
  const g = new THREE.CapsuleGeometry(1.55, 11, 8, 20);
  g.rotateZ(Math.PI / 2);
  g.scale(1, 1.12, 1);
  return g;
}

/** Eco pod: ~4.2 m glossy egg. */
export function makePod() {
  const g = new THREE.CapsuleGeometry(0.85, 2.4, 6, 14);
  g.rotateZ(Math.PI / 2);
  g.scale(1, 0.82, 0.95);
  return g;
}

/** Airship body with fins and gondola, nose toward +x. */
export function makeBlimp() {
  const pts = [];
  const L = 64;
  for (let i = 0; i <= 32; i++) {
    const u = i / 32;
    const r = 10.5 * Math.pow(Math.sin(Math.PI * u), 0.72) * (1 - 0.18 * u);
    pts.push(new THREE.Vector2(Math.max(r, 0.001), (u - 0.5) * L));
  }
  const body = new THREE.LatheGeometry(pts, 40);
  body.rotateZ(Math.PI / 2);
  body.rotateX(Math.PI / 2);
  const parts = [colorize(body, [1, 1, 1])];
  const fin = new THREE.BoxGeometry(11, 0.5, 8, 4, 1, 1);
  const fp = fin.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    const x = fp.getX(i);
    const z = fp.getZ(i);
    // Swept trailing fin.
    const k = (x + 5.5) / 11;
    fp.setZ(i, z * (0.35 + 0.65 * k) + (z > 0 ? 0 : 0));
  }
  fin.computeVertexNormals();
  const finColor = [0.0, 0.5, 0.72];
  for (let k = 0; k < 4; k++) {
    const f = fin.clone();
    f.translate(-25, 0, 7.8);
    f.rotateX((k * Math.PI) / 2 + Math.PI / 4);
    parts.push(colorize(f, finColor));
  }
  const gondola = new THREE.CapsuleGeometry(1.6, 9, 4, 12);
  gondola.rotateZ(Math.PI / 2);
  gondola.translate(2, -10.6, 0);
  parts.push(colorize(gondola, [0.85, 0.9, 0.95]));
  const g = mergeAll(parts);
  [body, fin, gondola, ...parts].forEach((p) => p.dispose());
  return g;
}

function colorize(geometry, color) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(color, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function mergeAll(parts) {
  const total = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [
    ['position', 3],
    ['normal', 3],
    ['color', 3],
  ]) {
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of parts) {
      arr.set(g.attributes[name].array, o);
      o += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

/** Sailboat with hull, cabin, mast, white mainsail and a tinted jib (aPart = 1). */
export function makeSailboat() {
  const parts = [];
  const shape = new THREE.Shape();
  shape.moveTo(-4, -1.3);
  shape.lineTo(1.4, -1.35);
  shape.quadraticCurveTo(4.0, -1.1, 4.7, 0);
  shape.quadraticCurveTo(4.0, 1.1, 1.4, 1.35);
  shape.lineTo(-4, 1.3);
  shape.quadraticCurveTo(-4.4, 0, -4, -1.3);
  const hull = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.35, bevelSegments: 3, curveSegments: 10 });
  hull.rotateX(-Math.PI / 2);
  hull.translate(0, -0.55, 0);
  parts.push(tag(hull, [0.97, 0.98, 1], 0));
  const stripe = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false, curveSegments: 10 });
  stripe.rotateX(-Math.PI / 2);
  stripe.scale(1.03, 1, 1.06);
  stripe.translate(0, -0.1, 0);
  parts.push(tag(stripe, [1, 1, 1], 1));
  const cabin = new THREE.CapsuleGeometry(0.75, 2.2, 4, 10);
  cabin.rotateZ(Math.PI / 2);
  cabin.scale(1, 0.6, 1.2);
  cabin.translate(-0.8, 0.75, 0);
  parts.push(tag(cabin, [0.93, 0.96, 0.98], 0));
  const mast = new THREE.CylinderGeometry(0.07, 0.1, 11, 6);
  mast.translate(0.9, 5.8, 0);
  parts.push(tag(mast, [0.85, 0.88, 0.9], 0));
  // Mainsail (cambered triangle) and jib.
  const sail = (a, b, c, camber, color, part) => {
    const segs = 6;
    const pos = [];
    for (let i = 0; i <= segs; i++) {
      for (let j = 0; j <= segs - i; j++) {
        const u = i / segs;
        const v = j / segs;
        const w = 1 - u - v;
        const p = new THREE.Vector3().addScaledVector(a, w).addScaledVector(b, u).addScaledVector(c, v);
        p.z += camber * Math.sin(Math.PI * (u + v)) * (1 - u) * 1.2;
        pos.push(p);
      }
    }
    const idx = [];
    let row = 0;
    const rowStart = [];
    for (let i = 0; i <= segs; i++) {
      rowStart.push(row);
      row += segs - i + 1;
    }
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < segs - i; j++) {
        const p0 = rowStart[i] + j;
        const p1 = rowStart[i] + j + 1;
        const p2 = rowStart[i + 1] + j;
        idx.push(p0, p2, p1);
        if (j < segs - i - 1) idx.push(p1, p2, rowStart[i + 1] + j + 1);
      }
    }
    const g = new THREE.BufferGeometry().setFromPoints(pos);
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(tag(g, color, part));
  };
  sail(new THREE.Vector3(0.8, 1.5, 0), new THREE.Vector3(0.8, 11.0, 0), new THREE.Vector3(-3.6, 1.7, 0), 0.6, [1, 1, 1], 0);
  sail(new THREE.Vector3(1.0, 1.4, 0), new THREE.Vector3(1.0, 9.5, 0), new THREE.Vector3(4.4, 1.0, 0), 0.5, [1, 1, 1], 1);
  const total = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [
    ['position', 3],
    ['normal', 3],
    ['color', 3],
    ['aPart', 1],
  ]) {
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of parts) {
      arr.set(g.attributes[name].array, o);
      o += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  parts.forEach((p) => p.dispose());
  [hull, stripe, cabin, mast].forEach((p) => p.dispose());
  return out;
}

function tag(geometry, color, part) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g.attributes.uv) g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(color, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
  return g;
}

/** Wind turbine tower+nacelle (static) and a three-blade rotor centered on the hub. */
export function makeTurbine() {
  const tower = new THREE.CylinderGeometry(0.9, 2.1, 72, 12, 1).translate(0, 36, 0);
  const nacelle = new THREE.CapsuleGeometry(1.5, 6, 4, 10).rotateX(Math.PI / 2).translate(0, 72.5, -1.2);
  const hub = new THREE.SphereGeometry(1.7, 12, 8).scale(1, 1, 1.4).translate(0, 72.5, 3.0);
  const parts = [tower, nacelle, hub].map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.deleteAttribute('uv');
    return n;
  });
  const total = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const base = new THREE.BufferGeometry();
  for (const [name, size] of [
    ['position', 3],
    ['normal', 3],
  ]) {
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of parts) {
      arr.set(g.attributes[name].array, o);
      o += g.attributes[name].array.length;
    }
    base.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  [tower, nacelle, hub, ...parts].forEach((g) => g.dispose());

  const blades = [];
  for (let k = 0; k < 3; k++) {
    const b = new THREE.BoxGeometry(2.4, 31, 0.32, 1, 8, 1);
    const p = b.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) + 15.5) / 31;
      p.setX(i, p.getX(i) * (1 - 0.72 * t) + (p.getX(i) > 0 ? 0.3 * (1 - t) : 0));
      p.setZ(i, p.getZ(i) + p.getX(i) * 0.15 * (1 - t));
    }
    b.translate(0, 16.5, 0);
    b.rotateZ((k / 3) * Math.PI * 2);
    b.deleteAttribute('uv');
    blades.push(b.toNonIndexed());
    b.dispose();
  }
  const rotor = new THREE.BufferGeometry();
  for (const [name, size] of [
    ['position', 3],
    ['normal', 3],
  ]) {
    const total2 = blades.reduce((s, g) => s + g.attributes[name].array.length, 0);
    const arr = new Float32Array(total2);
    let o = 0;
    for (const g of blades) {
      arr.set(g.attributes[name].array, o);
      o += g.attributes[name].array.length;
    }
    rotor.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  rotor.computeVertexNormals();
  blades.forEach((g) => g.dispose());
  return { base, rotor };
}
