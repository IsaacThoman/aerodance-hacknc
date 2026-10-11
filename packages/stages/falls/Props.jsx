import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { beat, useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { valleyHeight } from './terrain.js';

const flat = (g) => {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  return n;
};

// ---------------------------------------------------------- wind turbines

function buildTurbine() {
  const tower = new THREE.CylinderGeometry(0.5, 1.0, 32, 10, 1, true);
  tower.translate(0, 16, 0);
  const nacelle = new THREE.CapsuleGeometry(0.85, 3, 4, 10);
  nacelle.rotateX(Math.PI / 2);
  nacelle.translate(0, 32.5, -0.6);
  const body = mergeGeometries([flat(tower), flat(nacelle)]);
  const hub = new THREE.SphereGeometry(0.75, 12, 8);
  hub.scale(1, 1, 1.5);
  const blades = [flat(hub)];
  for (let i = 0; i < 3; i++) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.35, 0);
    shape.quadraticCurveTo(-0.9, 2.5, -0.55, 6);
    shape.lineTo(-0.1, 15.5);
    shape.quadraticCurveTo(0.05, 15.8, 0.12, 15.3);
    shape.lineTo(0.35, 6);
    shape.quadraticCurveTo(0.6, 2.5, 0.35, 0);
    const b = new THREE.ShapeGeometry(shape, 4);
    b.rotateZ((i / 3) * Math.PI * 2);
    blades.push(flat(b));
  }
  return { body, rotor: mergeGeometries(blades) };
}

/** sites: [{ x, z, y?, s }] — on the mesa tops so they stand against the sky. */
export function Turbines({ sites: input, seed = 12 }) {
  const sites = useMemo(() => {
    const rand = makeRandom(seed);
    return input.map((t) => {
      const yaw = rand.range(-0.35, 0.35);
      const s = t.s ?? 0.75;
      const y = t.y ?? valleyHeight(t.x, t.z) - 1;
      const hub = new THREE.Vector3(0, 32.5, 1.2).applyEuler(new THREE.Euler(0, yaw, 0)).multiplyScalar(s).add(new THREE.Vector3(t.x, y, t.z));
      return { x: t.x, y, z: t.z, yaw, s, hub, phase: rand.range(0, 6), speed: rand.range(0.9, 1.3) };
    });
  }, [input, seed]);
  const parts = useDisposable(() => {
    const geo = buildTurbine();
    const mat = new THREE.MeshStandardMaterial({ color: '#f4f8fb', roughness: 0.35, side: THREE.DoubleSide });
    const body = new THREE.InstancedMesh(geo.body, mat, sites.length);
    const rotor = new THREE.InstancedMesh(geo.rotor, mat, sites.length);
    const m = new THREE.Matrix4();
    sites.forEach((t, i) => {
      m.compose(new THREE.Vector3(t.x, t.y, t.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, t.yaw, 0)), new THREE.Vector3(t.s, t.s, t.s));
      body.setMatrixAt(i, m);
    });
    body.frustumCulled = false;
    rotor.frustumCulled = false;
    return { geo, mat, body, rotor };
  }, [sites]);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), s: new THREE.Vector3() }), []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    sites.forEach((site, i) => {
      tmp.e.set(0, site.yaw, site.phase + t * 0.9 * site.speed);
      tmp.q.setFromEuler(tmp.e);
      tmp.s.setScalar(site.s);
      tmp.m.compose(site.hub, tmp.q, tmp.s);
      parts.rotor.setMatrixAt(i, tmp.m);
    });
    parts.rotor.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <primitive object={parts.body} />
      <primitive object={parts.rotor} />
    </>
  );
}

// ------------------------------------------------------- hot-air balloons

function makeGoreTexture(colors) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  const w = c.width / colors.length;
  colors.forEach((col, i) => {
    const g = ctx.createLinearGradient(i * w, 0, (i + 1) * w, 0);
    g.addColorStop(0, col);
    g.addColorStop(0.5, '#ffffff');
    g.addColorStop(0.55, col);
    g.addColorStop(1, col);
    ctx.fillStyle = col;
    ctx.fillRect(i * w, 0, w, 64);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = g;
    ctx.fillRect(i * w, 0, w, 64);
    ctx.globalAlpha = 1;
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  return t;
}

const BALLOON_LOOKS = [
  ['#19b8ff', '#ffffff', '#7fe03a', '#ffffff'],
  ['#ff4f7a', '#ffb22e', '#ffe94a', '#3ad16a', '#2aa6ff', '#9a5cff'],
];

export function Balloons({ balloons }) {
  const shared = useDisposable(() => {
    const prof = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const a = -Math.PI / 2 + t * Math.PI;
      // Teardrop envelope: narrow throat, round crown.
      const r = Math.cos(a) * (t < 0.5 ? 0.55 + 0.45 * Math.sin(t * Math.PI) : 1);
      prof.push(new THREE.Vector2(Math.max(r, 0.12 * (1 - t)), Math.sin(a) * 1.15 + (t < 0.5 ? (0.5 - t) * -0.4 : 0)));
    }
    const envelope = new THREE.LatheGeometry(prof, 24);
    const basket = new THREE.CylinderGeometry(0.22, 0.18, 0.28, 8);
    basket.translate(0, -1.75, 0);
    return { envelope, basket, basketMat: new THREE.MeshStandardMaterial({ color: '#b07a45', roughness: 0.8 }) };
  });
  const mats = useDisposable(() =>
    BALLOON_LOOKS.map((cols) => {
      const map = makeGoreTexture(cols);
      return { map, mat: new THREE.MeshPhysicalMaterial({ map, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2, side: THREE.DoubleSide }) };
    }),
  );
  const refs = useRef([]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    refs.current.forEach((g, i) => {
      if (!g) return;
      const b = balloons[i];
      g.position.set(b.p[0] + Math.sin(t * 0.05 + i * 2) * b.drift, b.p[1] + Math.sin(t * 0.3 + i) * 0.8, b.p[2]);
      g.rotation.y = t * 0.1 + i;
    });
  });
  return balloons.map((b, i) => (
    <group key={i} ref={(el) => (refs.current[i] = el)} scale={b.s}>
      <mesh geometry={shared.envelope} material={mats[b.look].mat} />
      <mesh geometry={shared.basket} material={shared.basketMat} />
    </group>
  ));
}

// ---------------------------------------------- observatory + cable car

export function Observatory({ position, cableTo }) {
  const parts = useDisposable(() => {
    const dome = new THREE.SphereGeometry(5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.translate(0, 3, 0);
    const drum = new THREE.CylinderGeometry(5.2, 5.6, 3, 32);
    drum.translate(0, 1.5, 0);
    const deck = new THREE.CylinderGeometry(8, 8.4, 0.6, 32);
    const mast = new THREE.CylinderGeometry(0.12, 0.2, 6, 6);
    mast.translate(0, 10, 0);
    const band = new THREE.TorusGeometry(5.25, 0.35, 8, 48);
    band.rotateX(Math.PI / 2);
    band.translate(0, 2.4, 0);
    const slit = new THREE.BoxGeometry(1.2, 4.6, 0.6);
    slit.translate(0, 5.6, 3.6);
    slit.rotateX(-0.6);
    return {
      white: mergeGeometries([flat(dome), flat(drum), flat(deck), flat(mast)]),
      glass: mergeGeometries([flat(band), flat(slit)]),
    };
  });
  const mats = useDisposable(() => ({
    white: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 }),
    glass: new THREE.MeshStandardMaterial({ color: '#3ad8ff', emissive: '#38e8ff', emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.4 }),
  }));
  const cable = useDisposable(() => {
    if (!cableTo) return null;
    const a = new THREE.Vector3(...position).add(new THREE.Vector3(0, 9, 0));
    const b = new THREE.Vector3(...cableTo);
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const p = a.clone().lerp(b, t);
      p.y -= Math.sin(t * Math.PI) * a.distanceTo(b) * 0.05;
      pts.push(p);
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const curve = new THREE.CatmullRomCurve3(pts);
    const pod = new THREE.CapsuleGeometry(0.9, 0.9, 4, 12);
    pod.scale(1, 1, 1.25);
    const podMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.15, clearcoat: 1, emissive: '#2fd8ff', emissiveIntensity: 0.15 });
    const lineMat = new THREE.LineBasicMaterial({ color: '#4d6b7d', transparent: true, opacity: 0.7 });
    return { g, curve, lineMat, line: new THREE.Line(g, lineMat), pod, podMat };
  }, [cableTo]);
  const pods = useRef([]);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    mats.glass.emissiveIntensity = 0.7 + beat.pulse * 0.8;
    if (!cable) return;
    pods.current.forEach((p, i) => {
      if (!p) return;
      const k = (Math.sin(t * 0.06 + i * Math.PI) * 0.5 + 0.5) * 0.9 + 0.05;
      cable.curve.getPointAt(k, tmp);
      p.position.set(tmp.x, tmp.y - 1.4, tmp.z);
    });
  });
  return (
    <>
      <group position={position}>
        <mesh geometry={parts.white} material={mats.white} />
        <mesh geometry={parts.glass} material={mats.glass} />
      </group>
      {cable && (
        <>
          <primitive object={cable.line} />
          {[0, 1].map((i) => (
            <mesh key={i} ref={(el) => (pods.current[i] = el)} geometry={cable.pod} material={cable.podMat} />
          ))}
        </>
      )}
    </>
  );
}
