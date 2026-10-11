import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { WATER_Y, world } from './palette.js';
import { makeLitMaterial } from './shaders.js';
import { cruiseShipGeometry, sailboatGeometry } from './props.js';

const SAILBOATS = [
  { x: -30, z: -170, speed: 0.9, scale: 1.4 },
  { x: 55, z: -260, speed: -0.7, scale: 1.8 },
  { x: -120, z: -380, speed: 0.6, scale: 2.2 },
  { x: 90, z: -120, speed: -0.5, scale: 1.2 },
];

function Sailboats() {
  const mesh = useRef();
  const geometry = useDisposable(() => sailboatGeometry());
  const material = useDisposable(() => makeLitMaterial({ shininess: 60, specular: 0.4, rim: 0.6, side: THREE.DoubleSide }));
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(() => {
    const t = world.uTime.value;
    SAILBOATS.forEach((b, i) => {
      const span = 260;
      const x = b.x + ((((t * b.speed) % span) + span * 1.5) % span) - span / 2;
      dummy.position.set(x, WATER_Y + 0.1 * Math.sin(t * 1.1 + i * 2), b.z);
      dummy.rotation.set(0.04 * Math.sin(t * 1.3 + i), b.speed > 0 ? Math.PI / 2 : -Math.PI / 2, 0.06 * Math.sin(t * 0.9 + i * 1.7) - 0.08 * Math.sign(b.speed));
      dummy.scale.setScalar(b.scale);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, SAILBOATS.length]} frustumCulled={false} />;
}

/** White cruise liner gliding across the horizon with its decks lit up. */
function CruiseShip() {
  const group = useRef();
  const { body, windows } = useDisposable(() => cruiseShipGeometry());
  const mats = useDisposable(() => ({
    body: makeLitMaterial({ shininess: 60, specular: 0.3, rim: 0.4 }),
    windows: makeLitMaterial({ emissive: '#ffffff', emissiveIntensity: 2.2, specular: 0, rim: 0 }),
  }));
  useFrame(() => {
    const t = world.uTime.value;
    group.current.position.set(-170 + ((t * 1.4) % 420), WATER_Y - 0.6 + Math.sin(t * 0.4) * 0.15, -690);
  });
  return (
    <group ref={group} rotation={[0, -0.06, 0]}>
      <mesh geometry={body} material={mats.body} />
      <mesh geometry={windows} material={mats.windows} />
    </group>
  );
}

export function Vista() {
  return (
    <>
      <Sailboats />
      <CruiseShip />
    </>
  );
}
