import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { beat, useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { heightAt, PLATFORM_R } from './terrain.js';

const AQUA = new THREE.Color('#38f2ff');
const LIME = new THREE.Color('#a8ff5a');
const STUDS = 40;

function makeFloorTexture() {
  const s = 1024;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  const m = s / 2;
  const R = m;
  const g = ctx.createRadialGradient(m, m, 0, m, m, R);
  g.addColorStop(0, '#f4fbff');
  g.addColorStop(0.62, '#ffffff');
  g.addColorStop(0.84, '#f2fbfd');
  g.addColorStop(0.86, '#c9f1f7');
  g.addColorStop(0.97, '#b5e9f3');
  g.addColorStop(1, '#e6f8fb');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  // Fine concentric grooves.
  for (let i = 1; i < 14; i++) {
    ctx.beginPath();
    ctx.arc(m, m, (i / 14) * R * 0.98, 0, Math.PI * 2);
    ctx.strokeStyle = i % 4 === 0 ? 'rgba(120,190,215,0.55)' : 'rgba(150,200,220,0.22)';
    ctx.lineWidth = i % 4 === 0 ? 4 : 2;
    ctx.stroke();
  }
  // Soft radial segments.
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(m + Math.cos(a) * R * 0.3, m + Math.sin(a) * R * 0.3);
    ctx.lineTo(m + Math.cos(a) * R * 0.97, m + Math.sin(a) * R * 0.97);
    ctx.strokeStyle = 'rgba(150,200,220,0.16)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // Sunburst of pale aqua/lime petals around the middle ring.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.save();
    ctx.translate(m, m);
    ctx.rotate(a);
    const pg = ctx.createLinearGradient(R * 0.3, 0, R * 0.8, 0);
    pg.addColorStop(0, i % 2 ? 'rgba(120,225,255,0.22)' : 'rgba(170,240,140,0.2)');
    pg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.moveTo(R * 0.3, 0);
    ctx.quadraticCurveTo(R * 0.55, R * 0.09, R * 0.82, 0);
    ctx.quadraticCurveTo(R * 0.55, -R * 0.09, R * 0.3, 0);
    ctx.fill();
    ctx.restore();
  }
  // Ring of glass studs near the rim.
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const sg = ctx.createRadialGradient(m + Math.cos(a) * R * 0.92, m + Math.sin(a) * R * 0.92, 0, m + Math.cos(a) * R * 0.92, m + Math.sin(a) * R * 0.92, R * 0.022);
    sg.addColorStop(0, 'rgba(90,215,255,0.85)');
    sg.addColorStop(1, 'rgba(90,215,255,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(m + Math.cos(a) * R * 0.92, m + Math.sin(a) * R * 0.92, R * 0.022, 0, Math.PI * 2);
    ctx.fill();
  }
  // Centre emblem: an aqua drop inside a leafy ring.
  const e = ctx.createRadialGradient(m, m, 0, m, m, R * 0.22);
  e.addColorStop(0, 'rgba(120,235,255,0.55)');
  e.addColorStop(0.75, 'rgba(160,240,220,0.25)');
  e.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = e;
  ctx.beginPath();
  ctx.arc(m, m, R * 0.22, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.save();
    ctx.translate(m + Math.cos(a) * R * 0.16, m + Math.sin(a) * R * 0.16);
    ctx.rotate(a + Math.PI / 2);
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.018, R * 0.045, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(110,205,90,0.45)';
    ctx.fill();
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Round white gloss platform with glass step and pulsing aqua light rings. */
export function Platform() {
  const R = PLATFORM_R;
  const parts = useDisposable(() => {
    const top = new THREE.CircleGeometry(R - 0.12, 96);
    top.rotateX(-Math.PI / 2);
    // Beveled rim + body down into the grass.
    const prof = [
      [R - 0.14, 0.0], [R - 0.04, -0.03], [R + 0.02, -0.1], [R + 0.03, -0.22], [R - 0.02, -0.3],
      [R - 0.06, -0.34], [R + 0.4, -0.38], [R + 0.62, -0.44], [R + 0.66, -0.52], [R + 0.6, -0.6],
      [R + 0.7, -1.4],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const rim = new THREE.LatheGeometry(prof.slice(0, 6), 128);
    const step = new THREE.LatheGeometry(prof.slice(5), 128);
    const ring = new THREE.RingGeometry(R * 0.79, R * 0.82, 128);
    ring.rotateX(-Math.PI / 2);
    ring.translate(0, 0.006, 0);
    const ring2 = new THREE.RingGeometry(1.3, 1.36, 96);
    ring2.rotateX(-Math.PI / 2);
    ring2.translate(0, 0.006, 0);
    const strip = new THREE.TorusGeometry(R + 0.035, 0.035, 6, 160);
    strip.rotateX(Math.PI / 2);
    strip.translate(0, -0.16, 0);
    const glow = new THREE.TorusGeometry(R + 0.64, 0.03, 6, 160);
    glow.rotateX(Math.PI / 2);
    glow.translate(0, -0.47, 0);
    return { top, rim, step, rings: mergeGeometries([ring, ring2]), strips: mergeGeometries([strip, glow]), owned: [ring, ring2, strip, glow] };
  });
  const floorMap = useDisposable(makeFloorTexture);
  const mats = useDisposable(() => ({
    floor: new THREE.MeshPhysicalMaterial({ color: '#dfeaee', map: floorMap, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0.75 }),
    rim: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide }),
    step: new THREE.MeshPhysicalMaterial({ color: '#7fd8ea', roughness: 0.08, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.2, side: THREE.DoubleSide }),
    rings: new THREE.MeshBasicMaterial({ color: AQUA.clone(), toneMapped: false }),
    strips: new THREE.MeshBasicMaterial({ color: AQUA.clone(), toneMapped: false }),
  }));
  // Glass studs around the step that chase around the rim on the beat.
  const studs = useDisposable(() => {
    const g = new THREE.SphereGeometry(0.075, 10, 6);
    g.scale(1, 0.6, 1);
    const m = new THREE.MeshBasicMaterial({ toneMapped: false });
    const mesh = new THREE.InstancedMesh(g, m, STUDS);
    const mat = new THREE.Matrix4();
    for (let i = 0; i < STUDS; i++) {
      const a = (i / STUDS) * Math.PI * 2;
      mat.makeTranslation(Math.cos(a) * (R + 0.36), -0.35, Math.sin(a) * (R + 0.36));
      mesh.setMatrixAt(i, mat);
      mesh.setColorAt(i, AQUA);
    }
    return { g, m, mesh };
  });
  const tmp = useMemo(() => new THREE.Color(), []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const p = beat.pulse;
    mats.rings.color.copy(AQUA).multiplyScalar(1.3 + p * 1.5 + 0.2 * Math.sin(t * 1.3));
    mats.strips.color.copy(AQUA).lerp(LIME, 0.25 + 0.25 * Math.sin(t * 0.6)).multiplyScalar(1.5 + p * 1.2);
    const head = ((beat.beat + beat.phase) * 4) % STUDS;
    for (let i = 0; i < STUDS; i++) {
      const d = (head - i + STUDS) % STUDS;
      const k = Math.exp(-d * 0.35) + Math.exp(-((STUDS - d) % STUDS) * 0.9) * 0.5;
      tmp.copy(AQUA).lerp(LIME, (i % 4) / 6).multiplyScalar(0.7 + k * 3.2 + p * 0.5);
      studs.mesh.setColorAt(i, tmp);
    }
    studs.mesh.instanceColor.needsUpdate = true;
  });
  return (
    <group>
      <mesh geometry={parts.top} material={mats.floor} receiveShadow />
      <mesh geometry={parts.rim} material={mats.rim} receiveShadow />
      <mesh geometry={parts.step} material={mats.step} receiveShadow />
      <mesh geometry={parts.rings} material={mats.rings} />
      <mesh geometry={parts.strips} material={mats.strips} />
      <primitive object={studs.mesh} />
    </group>
  );
}

// ------------------------------------------------------------ solar flowers

// Solar-cell petal: bright aqua at the hub fading to deep blue at the tip,
// a fine cell grid and a glossy streak.
function makePetalTexture() {
  const w = 128;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, '#9af6ff');
  g.addColorStop(0.35, '#33c2ff');
  g.addColorStop(1, '#0b55cf');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(220,250,255,0.35)';
  ctx.lineWidth = 2;
  for (let y = 8; y < h; y += 18) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  for (let x = 10; x < w; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(w / 2, h);
  ctx.lineTo(w / 2, 10);
  ctx.stroke();
  const s = ctx.createLinearGradient(0, 0, w, 0);
  s.addColorStop(0.12, 'rgba(255,255,255,0)');
  s.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  s.addColorStop(0.36, 'rgba(255,255,255,0)');
  ctx.fillStyle = s;
  ctx.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // Extrude caps use shape coordinates as uvs: x in [-0.45, 0.45], y in [0.1, 1.5].
  t.repeat.set(1 / 0.9, 1 / 1.4);
  t.offset.set(0.5, -0.1 / 1.4);
  return t;
}

/** Tube with a radius that tapers along a curve. */
export function taperedTube(points, r0, r1, radial = 8, steps = 20) {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(steps, false);
  const pos = [];
  const norm = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const c = curve.getPointAt(t);
    const r = THREE.MathUtils.lerp(r0, r1, t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      v.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      norm.push(v.x, v.y, v.z);
      pos.push(c.x + v.x * r, c.y + v.y * r, c.z + v.z * r);
    }
  }
  const index = [];
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setIndex(index);
  return g;
}

const stripUv = (g) => {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  return n;
};

function buildFlowerSculpture() {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const stem = taperedTube([V(0, 0, 0), V(0.18, 2.0, 0.05), V(-0.12, 4.2, 0.14), V(0.12, 6.5, 0.24)], 0.13, 0.06, 10, 32);
  const collar = new THREE.CylinderGeometry(0.22, 0.32, 0.25, 16);
  collar.translate(0, 0.12, 0);
  const white = mergeGeometries([stripUv(stem), stripUv(collar)]);
  // Two glossy leaves.
  const leaves = [];
  for (const [y, side, tilt] of [[1.7, 1, 0.7], [3.1, -1, 0.6]]) {
    const leaf = new THREE.SphereGeometry(0.5, 16, 8);
    leaf.scale(1, 0.08, 0.32);
    leaf.translate(0.5, 0, 0);
    leaf.rotateZ(tilt);
    if (side < 0) leaf.rotateY(Math.PI);
    leaf.translate(side * 0.05, y, 0.05);
    leaves.push(stripUv(leaf));
  }
  const hub = new THREE.SphereGeometry(0.3, 24, 16);
  hub.scale(1, 1, 0.75);
  const petals = [];
  for (let i = 0; i < 7; i++) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.12);
    shape.quadraticCurveTo(0.42, 0.55, 0.22, 1.25);
    shape.quadraticCurveTo(0, 1.45, -0.22, 1.25);
    shape.quadraticCurveTo(-0.42, 0.55, 0, 0.12);
    const p = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.03, bevelSegments: 2, curveSegments: 10 });
    p.translate(0, 0.16, -0.03);
    p.rotateX(-0.18);
    p.rotateZ((i / 7) * Math.PI * 2);
    petals.push(p.index ? p.toNonIndexed() : p);
  }
  const ring = new THREE.TorusGeometry(0.38, 0.035, 8, 48);
  return {
    white,
    leaves: mergeGeometries(leaves),
    hub,
    petals: mergeGeometries(petals),
    ring,
  };
}

export function SolarFlowers({ sites }) {
  const geo = useDisposable(buildFlowerSculpture);
  const petalMap = useDisposable(makePetalTexture);
  const mats = useDisposable(() => ({
    white: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06 }),
    leaf: new THREE.MeshPhysicalMaterial({ color: '#7fdc2e', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 }),
    petal: new THREE.MeshPhysicalMaterial({
      color: '#ffffff', map: petalMap, roughness: 0.1, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.03,
      iridescence: 0.5, iridescenceIOR: 1.4, emissive: '#0a3f8a', emissiveIntensity: 0.25, envMapIntensity: 1.4, side: THREE.DoubleSide,
    }),
    ring: new THREE.MeshBasicMaterial({ color: AQUA.clone(), toneMapped: false }),
  }));
  const heads = useRef([]);
  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    heads.current.forEach((h, i) => {
      if (!h) return;
      h.rotation.z -= delta * (0.45 + 0.08 * i);
      h.parent.rotation.x = -0.25 + Math.sin(t * 0.7 + i) * 0.03;
    });
    mats.ring.color.copy(AQUA).lerp(LIME, 0.3).multiplyScalar(1.5 + beat.pulse * 2);
  });
  return sites.map(([x, z, yaw], i) => (
    <group key={i} position={[x, heightAt(x, z) - 0.05, z]} rotation={[0, yaw, 0]} scale={0.84}>
      <mesh geometry={geo.white} material={mats.white} castShadow />
      <mesh geometry={geo.leaves} material={mats.leaf} />
      <group position={[0.12, 6.55, 0.28]}>
        <group ref={(el) => (heads.current[i] = el)}>
          <mesh geometry={geo.petals} material={mats.petal} />
        </group>
        <mesh geometry={geo.hub} material={mats.white} />
        <mesh geometry={geo.ring} material={mats.ring} />
      </group>
    </group>
  ));
}

// ------------------------------------------------------------ flower beds

const BLOOMS = ['#ff5fa8', '#ffd23a', '#ffffff', '#ff7a3d', '#c27bff', '#ff3d6e', '#7fd8ff'];

/** Glossy white planters overflowing with flowers. beds: [{ x, z, r, arc }] */
export function FlowerBeds({ beds }) {
  const built = useDisposable(() => {
    const rand = makeRandom(404);
    const rims = [];
    const soils = [];
    const blooms = [];
    for (const b of beds) {
      const y = heightAt(b.x, b.z);
      const rim = new THREE.TorusGeometry(b.r, 0.12, 8, 48, b.arc ?? Math.PI * 2);
      rim.rotateX(Math.PI / 2);
      if (b.rot) rim.rotateY(b.rot);
      rim.scale(1, 1.6, 1);
      rim.translate(b.x, y + 0.12, b.z);
      rims.push(stripUv(rim));
      const mound = new THREE.SphereGeometry(b.r * 0.98, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      mound.scale(1, 0.35 / b.r, 1);
      mound.translate(b.x, y + 0.08, b.z);
      soils.push(stripUv(mound));
      const n = Math.round(b.r * b.r * 34);
      for (let i = 0; i < n; i++) {
        const a = rand.range(0, Math.PI * 2);
        const d = Math.sqrt(rand.next()) * b.r * 0.92;
        const px = b.x + Math.cos(a) * d;
        const pz = b.z + Math.sin(a) * d;
        const py = y + 0.15 + 0.35 * Math.sqrt(Math.max(0, 1 - (d / b.r) ** 2)) + rand.range(0, 0.15);
        blooms.push({ p: [px, py, pz], s: rand.range(0.06, 0.11), c: rand.pick(BLOOMS) });
      }
    }
    const bloomGeo = new THREE.IcosahedronGeometry(1, 0);
    const bloomMat = new THREE.MeshStandardMaterial({ roughness: 0.55, emissive: '#331a22', emissiveIntensity: 0.25 });
    const mesh = new THREE.InstancedMesh(bloomGeo, bloomMat, blooms.length);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    blooms.forEach((b, i) => {
      m.makeScale(b.s, b.s * 0.7, b.s).setPosition(...b.p);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.set(b.c));
    });
    return {
      rims: mergeGeometries(rims),
      soil: mergeGeometries(soils),
      mesh,
      bloomGeo,
      bloomMat,
      rimMat: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06 }),
      soilMat: new THREE.MeshStandardMaterial({ color: '#2f7d1e', roughness: 0.9 }),
    };
  }, [beds]);
  return (
    <group>
      <mesh geometry={built.rims} material={built.rimMat} />
      <mesh geometry={built.soil} material={built.soilMat} />
      <primitive object={built.mesh} />
    </group>
  );
}
