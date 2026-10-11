import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { beat, reducedMotion, useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { gelMaterial, inkMaterial } from './gel.js';
import { blobGeometry, mergeAll } from './geometry.js';
import { FLOOR } from './layout.js';
import { BAR_STOOLS, STOOL_SEAT } from './Bar.jsx';

const COLORS = ['#3ee8ff', '#8dff4a', '#ff5ad0', '#a77bff', '#4f8dff', '#3dffc0', '#d65bff', '#ffe04a'];

// Aeroling crowd around the stage: bob, hop and wave glow sticks on the beat.
function useCrowd() {
  return useDisposable(() => {
    const rand = makeRandom(9001);
    const blobs = [];
    const place = (count, r0, r1, t0, t1) => {
      for (let tries = 0, n = 0; n < count && tries < count * 40; tries++) {
        const r = rand.range(r0, r1);
        const theta = rand.range(t0, t1);
        const x = r * Math.sin(theta);
        const z = r * Math.cos(theta);
        if (blobs.some((b) => (b.x - x) ** 2 + (b.z - z) ** 2 < 0.95)) continue;
        // Leave the speaker stacks and the camera's foreground clear.
        if (Math.abs(Math.abs(x) - 6.9) < 1.6 && Math.abs(z + 3.3) < 1.6) continue;
        if (x * x + (z - 12.6) ** 2 < 11 * 11) continue;
        // Keep clear of the bar counter.
        if (x > 0 && r > 9.3 && theta > 1.65) continue;
        const size = rand.range(0.8, 1.15);
        blobs.push({
          x,
          z,
          size,
          color: new THREE.Color(rand.pick(COLORS)).multiplyScalar(0.17),
          yaw: Math.atan2(-x, -z) + rand.range(-0.35, 0.35),
          style: rand.next(), // < 0.55 hop, < 0.85 bob, else sway
          offset: rand.range(-0.06, 0.06),
          stick: rand.chance(0.3),
          stickColor: new THREE.Color(rand.pick(['#9dff3a', '#1ee8ff', '#ff3fd2', '#ffe84a'])).multiplyScalar(3),
          seed: rand.next(),
          lift: 0,
        });
        n++;
      }
    };
    // Patrons perched on the bar stools, facing the room.
    BAR_STOOLS.forEach(([x, , z], i) => {
      if (i === 2) return;
      blobs.push({
        x,
        z,
        size: 0.75,
        color: new THREE.Color(rand.pick(COLORS)).multiplyScalar(0.3),
        yaw: Math.atan2(-x, -z) + rand.range(-0.6, 0.6),
        style: 0.9,
        offset: rand.range(-0.06, 0.06),
        stick: false,
        seed: rand.next(),
        lift: STOOL_SEAT - FLOOR,
      });
    });
    place(22, 6.35, 7.6, -1.1, 1.1);
    place(26, 6.4, 11.5, 0.9, 2.05);
    place(26, 6.4, 11.5, -2.05, -0.9);
    return blobs;
  }, []);
}

export default function Crowd() {
  const blobs = useCrowd();
  const bodies = useRef();
  const eyes = useRef();
  const sticks = useRef();
  const stickBlobs = useMemo(() => blobs.filter((b) => b.stick), [blobs]);

  const res = useDisposable(() => {
    const l = new THREE.SphereGeometry(0.06, 10, 8).scale(0.8, 1.25, 0.6).translate(-0.13, 0.66, 0.4);
    const r = new THREE.SphereGeometry(0.06, 10, 8).scale(0.8, 1.25, 0.6).translate(0.13, 0.66, 0.4);
    const eyesGeo = mergeAll([l, r]);
    return {
      body: blobGeometry(18),
      eyes: eyesGeo,
      stick: new THREE.CapsuleGeometry(0.035, 0.42, 3, 8),
      gel: gelMaterial({ key: 'crowd', color: '#ffffff', rim: 10, rimPower: 5, glow: 0.04, envMapIntensity: 0.15 }),
      ink: inkMaterial(),
      glow: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: true }),
      m: new THREE.Matrix4(),
      q: new THREE.Quaternion(),
      e: new THREE.Euler(),
      p: new THREE.Vector3(),
      s: new THREE.Vector3(),
    };
  });

  useLayoutEffect(() => {
    blobs.forEach((b, i) => bodies.current.setColorAt(i, b.color));
    bodies.current.instanceColor.needsUpdate = true;
    stickBlobs.forEach((b, i) => sticks.current.setColorAt(i, b.stickColor));
    if (sticks.current.instanceColor) sticks.current.instanceColor.needsUpdate = true;
  }, [blobs, stickBlobs]);

  useFrame((state) => {
    const t = reducedMotion ? 0 : state.clock.elapsedTime;
    const { m, q, e, p, s } = res;
    let k = 0;
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      const ph = (((beat.phase + b.offset) % 1) + 1) % 1;
      const kick = Math.exp(-ph * 6);
      let y = 0;
      let sy = 1;
      let lean = 0;
      if (b.style < 0.55) {
        // Hop: airborne mid-beat, squash on landing.
        const hop = Math.sin(Math.PI * ph);
        const big = beat.bar % 4 === 3 ? 1.6 : 1;
        y = hop * 0.28 * big * (0.7 + b.seed * 0.6);
        sy = 1 - kick * 0.16 + hop * 0.08;
      } else if (b.style < 0.85) {
        sy = 1 - kick * 0.12;
        lean = kick * 0.18;
      } else {
        lean = Math.sin(t * 2.1 + b.seed * 10) * 0.12;
        sy = 1 - kick * 0.08;
      }
      e.set(lean, b.yaw, Math.sin(t * 1.7 + b.seed * 20) * 0.06);
      q.setFromEuler(e);
      const sc = b.size;
      p.set(b.x, FLOOR + b.lift + y * sc, b.z);
      s.set(sc * (1 + (1 - sy) * 0.6), sc * sy, sc * (1 + (1 - sy) * 0.6));
      m.compose(p, q, s);
      bodies.current.setMatrixAt(i, m);
      eyes.current.setMatrixAt(i, m);
      if (b.stick) {
        // Glow stick held above the head, waving.
        const wave = Math.sin(t * 4.2 + b.seed * 12) * 0.6;
        e.set(0, b.yaw, wave);
        q.setFromEuler(e);
        p.set(b.x + Math.cos(b.yaw) * 0.32 * sc, FLOOR + (y + 1.15) * sc, b.z - Math.sin(b.yaw) * 0.32 * sc);
        s.setScalar(sc);
        m.compose(p, q, s);
        sticks.current.setMatrixAt(k++, m);
      }
    }
    bodies.current.instanceMatrix.needsUpdate = true;
    eyes.current.instanceMatrix.needsUpdate = true;
    sticks.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={bodies} args={[res.body, res.gel, blobs.length]} frustumCulled={false} />
      <instancedMesh ref={eyes} args={[res.eyes, res.ink, blobs.length]} frustumCulled={false} />
      <instancedMesh ref={sticks} args={[res.stick, res.glow, Math.max(1, stickBlobs.length)]} frustumCulled={false} />
    </group>
  );
}
