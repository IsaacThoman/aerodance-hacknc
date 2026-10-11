import * as THREE from 'three';
import { mergeTagged } from './geometry.js';
import { stageUniforms } from './materials.js';

// Shader-painted vehicles: livery is computed from object-space position so the
// meshes stay simple primitives.

const PAINT = {
  train: /* glsl */ `
    vec3 lp = vLocal;
    float win = step(0.15, lp.y) * step(lp.y, 1.25);
    float nose = smoothstep(7.4, 8.6, abs(lp.x)) * step(-0.5, lp.y);
    float glass = max(win, nose);
    float stripe = step(-0.75, lp.y) * step(lp.y, -0.25);
    float lime = step(-1.05, lp.y) * step(lp.y, -0.9);
    vec3 body = vec3(0.95, 0.97, 0.99);
    body = mix(body, vec3(0.0, 0.55, 0.75), stripe);
    body = mix(body, vec3(0.45, 0.85, 0.1), lime);
    body = mix(body, vec3(0.72, 0.78, 0.82), step(lp.y, -1.7));
    pc = mix(body, vec3(0.02, 0.12, 0.2), glass);
    pr = mix(0.2, 0.04, glass);
    pm = mix(0.1, 0.9, glass);
    pe = vec3(0.3, 0.9, 1.0) * nose * step(lp.y, -0.2) * 2.0;
  `,
  pod: /* glsl */ `
    vec3 lp = vLocal;
    float glass = step(0.1, lp.y) * step(-0.9, lp.x);
    pc = mix(vColor.rgb, vec3(0.02, 0.1, 0.2), glass);
    pc = mix(pc, vec3(0.94, 0.96, 0.98), step(lp.y, -0.35));
    pr = mix(0.18, 0.04, glass);
    pm = mix(0.15, 0.9, glass);
    float ring = step(lp.y, -0.5) * (1.0 - glass);
    pe = vec3(0.3, 1.0, 1.0) * ring * 2.5 + vec3(1.0, 0.3, 0.25) * step(lp.x, -1.8) * 2.0;
  `,
  blimp: /* glsl */ `
    vec3 lp = vLocal;
    float wave = sin(lp.x * 0.09 + 0.6) * 1.6;
    float band = smoothstep(-1.2 + wave, -0.9 + wave, -lp.y);
    float lime = step(abs(lp.y - 1.6 + wave), 0.35);
    vec3 body = vec3(0.96, 0.97, 0.99);
    vec3 aqua = mix(vec3(0.0, 0.62, 0.78), vec3(0.0, 0.35, 0.72), smoothstep(-2.0, -8.0, lp.y));
    body = mix(body, aqua, band);
    body = mix(body, vec3(0.5, 0.88, 0.12), lime * (1.0 - band));
    pc = body * vColor.rgb;
    pr = 0.25;
    pm = 0.08;
    pe = vec3(0.0);
  `,
  balloon: /* glsl */ `
    vec3 lp = vLocal;
    float ang = atan(lp.z, lp.x);
    float gore = floor((ang + 3.14159) / 6.28318 * 12.0);
    float alt = mod(gore, 2.0);
    vec3 a = vColor.rgb;
    vec3 b = vec3(0.97, 0.98, 1.0);
    pc = mix(a, b, alt);
    // Band around the equator and a darker crown.
    pc = mix(pc, vec3(1.0, 0.85, 0.2), step(abs(lp.y - 0.15), 0.08));
    pc = mix(pc, a * 0.7, step(0.92, lp.y));
    pc = mix(pc, vec3(0.55, 0.38, 0.22), step(lp.y, -0.95));
    pr = 0.35;
    pm = 0.0;
    pe = vec3(0.0);
  `,
};

export function makeVehicleMaterial(kind, envMap = null) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.1, envMap });
  if (kind === 'blimp' || kind === 'balloon') mat.vertexColors = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = stageUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
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
  mat.customProgramCacheKey = () => `sanctuary-vehicle-${kind}`;
  return mat;
}

/** Monorail car: rounded capsule ~18 units long along x. */
export function makeTrainCar() {
  const g = new THREE.CapsuleGeometry(2.0, 14, 6, 20);
  g.rotateZ(Math.PI / 2);
  g.scale(1, 1.15, 1);
  return g;
}

/** Eco pod: glossy egg ~4.5 units long along x. */
export function makePod() {
  const g = new THREE.CapsuleGeometry(0.9, 2.6, 6, 14);
  g.rotateZ(Math.PI / 2);
  g.scale(1, 0.8, 0.95);
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
  const parts = [{ geometry: body, color: [1, 1, 1] }];
  const fin = new THREE.BoxGeometry(11, 0.5, 8, 4, 1, 1);
  const fp = fin.attributes.position;
  for (let i = 0; i < fp.count; i++) fp.setZ(i, fp.getZ(i) * (0.35 + 0.65 * ((fp.getX(i) + 5.5) / 11)));
  fin.computeVertexNormals();
  const fins = [];
  for (let k = 0; k < 4; k++) {
    const f = fin.clone();
    f.translate(-25, 0, 7.8);
    f.rotateX((k * Math.PI) / 2 + Math.PI / 4);
    fins.push(f);
    parts.push({ geometry: f, color: [0.0, 0.5, 0.72] });
  }
  const gondola = new THREE.CapsuleGeometry(1.6, 9, 4, 12);
  gondola.rotateZ(Math.PI / 2);
  gondola.translate(2, -10.6, 0);
  parts.push({ geometry: gondola, color: [0.85, 0.9, 0.95] });
  const g = mergeTagged(parts);
  [body, fin, gondola, ...fins].forEach((p) => p.dispose());
  return g;
}

/** Hot-air balloon: teardrop envelope (local y in -1..1) with a basket, ~1 unit radius. */
export function makeBalloon() {
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const y = -1 + t * 2;
    const r = t < 0.25 ? 0.18 + (t / 0.25) * 0.42 : Math.sin(Math.acos(Math.min(1, (y - 0.15) / 0.86))) * 0.98 + 0.02;
    pts.push(new THREE.Vector2(Math.max(0.001, t > 0.98 ? 0.001 : r), y));
  }
  const env = new THREE.LatheGeometry(pts, 24);
  const basket = new THREE.BoxGeometry(0.28, 0.2, 0.28).translate(0, -1.35, 0);
  const g = mergeTagged([
    { geometry: env, color: [1, 1, 1] },
    { geometry: basket, color: [1, 1, 1] },
  ]);
  env.dispose();
  basket.dispose();
  return g;
}

/**
 * Wind turbine tower+nacelle (static) and a three-blade rotor centered on the hub.
 * Chunkier than real ones so they still read on the far hills at 640x480.
 */
export function makeTurbine() {
  const tower = new THREE.CylinderGeometry(1.6, 3.4, 72, 10, 1).translate(0, 36, 0);
  const nacelle = new THREE.CapsuleGeometry(1.5, 6, 4, 10).rotateX(Math.PI / 2).translate(0, 72.5, -1.2);
  const base = mergeTagged([{ geometry: tower }, { geometry: nacelle }]);
  tower.dispose();
  nacelle.dispose();
  const blades = [];
  for (let k = 0; k < 3; k++) {
    const b = new THREE.BoxGeometry(4.4, 31, 0.6, 1, 6, 1);
    const p = b.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) + 15.5) / 31;
      p.setX(i, p.getX(i) * (1 - 0.72 * t));
    }
    b.translate(0, 16.5, 0);
    b.rotateZ((k / 3) * Math.PI * 2);
    blades.push({ geometry: b });
  }
  const hub = new THREE.SphereGeometry(2.6, 10, 8).scale(1, 1, 1.4);
  blades.push({ geometry: hub });
  const rotor = mergeTagged(blades);
  blades.forEach((b) => b.geometry.dispose());
  rotor.computeVertexNormals();
  return { base, rotor };
}

/** Gull: body + two-segment wings; aWing = signed span position for flapping. */
export function makeBirdGeometry() {
  const v = [];
  const w = [];
  const quad = (a, b, c, d, wa, wb, wc, wd) => {
    v.push(...a, ...b, ...c, ...a, ...c, ...d);
    w.push(wa, wb, wc, wa, wc, wd);
  };
  v.push(0.7, 0, 0, -0.5, 0.05, 0, 0, 0.12, 0.12, 0.7, 0, 0, 0, 0.12, -0.12, -0.5, 0.05, 0);
  w.push(0, 0, 0, 0, 0, 0);
  for (const s of [1, -1]) {
    quad([0.25, 0.05, 0], [-0.15, 0.05, 0], [-0.25, 0.05, 0.7 * s], [0.15, 0.05, 0.7 * s], 0, 0, 0.5 * s, 0.5 * s);
    quad([0.15, 0.05, 0.7 * s], [-0.25, 0.05, 0.7 * s], [-0.45, 0.05, 1.4 * s], [-0.2, 0.05, 1.4 * s], 0.5 * s, 0.5 * s, s, s);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(w, 1));
  g.computeVertexNormals();
  return g;
}

/** Sailboat ~10 units long along x: hull, mast, mainsail and jib (aPart = 1 gets the instance tint). */
export function makeSailboat() {
  const parts = [];
  const shape = new THREE.Shape();
  shape.moveTo(-4, -1.3);
  shape.lineTo(1.4, -1.35);
  shape.quadraticCurveTo(4.0, -1.1, 4.8, 0);
  shape.quadraticCurveTo(4.0, 1.1, 1.4, 1.35);
  shape.lineTo(-4, 1.3);
  shape.quadraticCurveTo(-4.4, 0, -4, -1.3);
  const hull = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.3, bevelSegments: 2, curveSegments: 8 });
  hull.rotateX(-Math.PI / 2);
  hull.translate(0, -0.5, 0);
  parts.push({ geometry: hull, color: [0.97, 0.98, 1], extra: { aPart: 0 } });
  const mast = new THREE.CylinderGeometry(0.08, 0.12, 12, 5);
  mast.translate(0.9, 6.2, 0);
  parts.push({ geometry: mast, color: [0.85, 0.88, 0.9], extra: { aPart: 0 } });
  const sail = (a, b, c, color, part) => {
    const g = new THREE.BufferGeometry().setFromPoints([a, b, c]);
    g.computeVertexNormals();
    parts.push({ geometry: g, color, extra: { aPart: part } });
  };
  sail(new THREE.Vector3(0.8, 1.2, 0), new THREE.Vector3(0.8, 12, 0), new THREE.Vector3(-3.6, 1.4, 0.4), [1, 1, 1], 0);
  sail(new THREE.Vector3(1.0, 1.1, 0), new THREE.Vector3(1.0, 10.5, 0), new THREE.Vector3(4.6, 0.9, 0.3), [1, 1, 1], 1);
  const g = mergeTagged(parts);
  [hull, mast].forEach((p) => p.dispose());
  parts.slice(2).forEach((p) => p.geometry.dispose());
  return g;
}
