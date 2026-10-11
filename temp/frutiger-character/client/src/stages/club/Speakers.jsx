import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { beat, useDisposable } from '../shared/hooks.js';
import { C } from './clock.js';
import { patchClub } from './patch.js';
import { mergeAll } from './geometry.js';
import { FLOOR } from './layout.js';

// Glossy white speaker stacks with pumping woofers and glowing trim rings.
// Both stacks share merged cabinets and instanced woofers.
const STACKS = [
  { position: [-6.9, FLOOR, -3.3], rotationY: 0.5 },
  { position: [6.9, FLOOR, -3.3], rotationY: -0.5 },
];
const WOOFERS = [
  { y: 0.85, z: 0.68, r: 0.62, phase: 0, ring: 0 },
  { y: 2.25, z: 0.58, r: 0.4, phase: 0.5, ring: 1 },
  { y: 3.18, z: 0.58, r: 0.4, phase: 0.5, ring: 1 },
];
const RINGS = [new THREE.Color(C.aqua), new THREE.Color(C.magenta)];

const stackMatrix = ({ position, rotationY }) => new THREE.Matrix4().makeRotationY(rotationY).setPosition(...position);
const at = (x, y, z, rx = 0) => new THREE.Matrix4().makeRotationX(rx).setPosition(x, y, z);

// Merge one part placed at each local matrix in every stack.
function placeAll(make, locals) {
  const parts = [];
  STACKS.forEach((stack) => {
    const sm = stackMatrix(stack);
    locals.forEach((m) => parts.push(make().applyMatrix4(new THREE.Matrix4().multiplyMatrices(sm, m))));
  });
  return mergeAll(parts);
}

function cabinet() {
  const parts = [
    new RoundedBoxGeometry(1.75, 1.7, 1.35, 4, 0.22).translate(0, 0.85, 0),
    new RoundedBoxGeometry(1.45, 2.15, 1.15, 4, 0.22).translate(0, 2.75, -0.05),
    new RoundedBoxGeometry(1.4, 0.55, 0.8, 3, 0.2).translate(0, 4.1, -0.1),
  ];
  return mergeAll(parts);
}

export default function Speakers() {
  const cones = useRef();
  const caps = useRef();
  const trims = useRef();
  const surrounds = useRef();

  const res = useDisposable(() => {
    const bases = [];
    STACKS.forEach((stack) => {
      const sm = stackMatrix(stack);
      WOOFERS.forEach((w) => bases.push({ ...w, m: new THREE.Matrix4().multiplyMatrices(sm, at(0, w.y, w.z)) }));
    });
    return {
      bases,
      shell: placeAll(cabinet, [new THREE.Matrix4()]),
      tweeters: placeAll(
        () => new THREE.SphereGeometry(0.13, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        [-0.42, 0, 0.42].map((x) => at(x, 4.1, 0.38, Math.PI / 2)),
      ),
      strips: placeAll(() => new THREE.BoxGeometry(1.1, 0.05, 0.02), [at(0, 0.12, 0.69), at(0, 1.83, 0.6)]),
      cone: new THREE.LatheGeometry(
        [[0.18, -0.2], [0.3, -0.17], [0.55, -0.1], [0.8, -0.03], [0.86, 0.0]].map(([x, y]) => new THREE.Vector2(x, y)),
        32,
      ).rotateX(Math.PI / 2),
      cap: new THREE.SphereGeometry(0.24, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.55).translate(0, 0, -0.08),
      surround: new THREE.TorusGeometry(0.88, 0.07, 8, 40),
      trim: new THREE.TorusGeometry(1.0, 0.045, 6, 40),
      shellMat: patchClub(new THREE.MeshPhysicalMaterial({ color: '#c3cdee', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 0.45 }), {
        key: 'speaker-shell',
        dots: 0.7,
      }),
      coneMat: new THREE.MeshPhysicalMaterial({ color: '#2a2f66', roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.1 }),
      rubber: new THREE.MeshPhysicalMaterial({ color: '#181c3c', roughness: 0.4, clearcoat: 0.6 }),
      chrome: new THREE.MeshStandardMaterial({ color: '#eef3ff', metalness: 1, roughness: 0.1 }),
      glow: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      strip: new THREE.MeshBasicMaterial({ color: new THREE.Color(C.aqua).multiplyScalar(2) }),
    };
  });
  const tmp = useDisposable(() => ({ m: new THREE.Matrix4(), pump: new THREE.Matrix4(), c: new THREE.Color() }));
  const n = res.bases.length;

  useLayoutEffect(() => {
    res.bases.forEach((b, i) => {
      tmp.m.copy(b.m).multiply(tmp.pump.makeScale(b.r, b.r, b.r));
      surrounds.current.setMatrixAt(i, tmp.m);
      trims.current.setMatrixAt(i, tmp.m);
      trims.current.setColorAt(i, RINGS[b.ring]);
    });
    surrounds.current.instanceMatrix.needsUpdate = true;
    trims.current.instanceMatrix.needsUpdate = true;
  }, [res, tmp]);

  useFrame(() => {
    for (let i = 0; i < n; i++) {
      const b = res.bases[i];
      const p = Math.exp(-((beat.phase + b.phase) % 1) * 7);
      const s = b.r * (1 + p * 0.03);
      tmp.pump.makeScale(s, s, s).setPosition(0, 0, p * 0.12 * b.r);
      tmp.m.multiplyMatrices(b.m, tmp.pump);
      cones.current.setMatrixAt(i, tmp.m);
      caps.current.setMatrixAt(i, tmp.m);
      const k = b.ring ? 1.1 + beat.pulse * 1.4 : 1.3 + beat.pulse * 2.2;
      trims.current.setColorAt(i, tmp.c.copy(RINGS[b.ring]).multiplyScalar(k));
    }
    cones.current.instanceMatrix.needsUpdate = true;
    caps.current.instanceMatrix.needsUpdate = true;
    trims.current.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <mesh geometry={res.shell} material={res.shellMat} castShadow />
      <mesh geometry={res.tweeters} material={res.chrome} />
      <mesh geometry={res.strips} material={res.strip} />
      <instancedMesh ref={cones} args={[res.cone, res.coneMat, n]} frustumCulled={false} />
      <instancedMesh ref={caps} args={[res.cap, res.chrome, n]} frustumCulled={false} />
      <instancedMesh ref={surrounds} args={[res.surround, res.rubber, n]} frustumCulled={false} />
      <instancedMesh ref={trims} args={[res.trim, res.glow, n]} frustumCulled={false} />
    </group>
  );
}
