import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { LAND_KIND, makeLandMaterial } from './landMaterial.js';
import { makeNoise2 } from './terrain.js';
import { makeTree, TreeGroup } from './Trees.jsx';
import { Waterfalls } from './Water.jsx';

// Floating islands: grassy domes on rocky inverted cones, each with a few
// trees and a thin waterfall spilling off the rim into the clouds below.
export const ISLANDS = [
  { p: [40, 26, -160], R: 12, seed: 1, falls: [{ angle: 108, width: 3.2 }] },
  { p: [-25, 40, -300], R: 10, seed: 2, falls: [{ angle: 70, width: 2.6 }] },
  { p: [25, 80, -480], R: 9, seed: 3, falls: [{ angle: 96, width: 2.2 }] },
];

function islandRadius(noise, R, a) {
  return R * (1 + 0.14 * noise(Math.cos(a) * 1.4, Math.sin(a) * 1.4) + 0.05 * noise(Math.cos(a) * 4 + 3, Math.sin(a) * 4));
}

function buildIsland({ R, seed }) {
  const noise = makeNoise2(seed * 13 + 7);
  const NA = 48;
  const rows = [];
  // Domed top from the centre to the rim, then the rocky cone down to a tip.
  for (let i = 0; i <= 5; i++) {
    const k = i / 5;
    rows.push({ k, y: (a) => R * 0.16 * (1 - k * k) + 0.4 * noise(Math.cos(a) * 3 * k, Math.sin(a) * 3 * k) * k });
  }
  for (let i = 1; i <= 12; i++) {
    const s = i / 12;
    rows.push({ k: Math.pow(1 - s, 0.75) * (1 - 0.08 * Math.sin(s * 9)), y: () => -R * 1.5 * Math.pow(s, 1.15) - 0.3, under: s });
  }
  const pos = [];
  const idx = [];
  rows.forEach((row) => {
    for (let i = 0; i <= NA; i++) {
      const a = (i / NA) * Math.PI * 2;
      let r = islandRadius(noise, R, a) * row.k;
      if (row.under) r *= 1 + 0.18 * noise(a * 2.5, row.under * 4);
      pos.push(Math.cos(a) * r, row.y(a), Math.sin(a) * r);
    }
  });
  for (let j = 0; j < rows.length - 1; j++) {
    for (let i = 0; i < NA; i++) {
      const a = j * (NA + 1) + i;
      const b = a + 1;
      const c = a + NA + 1;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { g, noise };
}

function Island({ cfg, index, material }) {
  const built = useDisposable(() => buildIsland(cfg), [cfg]);
  const { trees, sites } = useMemo(() => {
    const rand = makeRandom(cfg.seed * 7);
    const list = [];
    const n = Math.round(cfg.R * 0.5) + 2;
    for (let i = 0; i < n; i++) {
      const a = rand.range(0, Math.PI * 2);
      const k = Math.sqrt(rand.next()) * 0.7;
      const y = cfg.R * 0.16 * (1 - k * k);
      list.push(makeTree(rand, Math.cos(a) * cfg.R * k, y - 0.2, Math.sin(a) * cfg.R * k, rand.range(0.16, 0.26) * cfg.R));
    }
    const falls = cfg.falls.map((f) => {
      const a = THREE.MathUtils.degToRad(f.angle);
      const dir = new THREE.Vector2(Math.cos(a), Math.sin(a));
      const r = islandRadius(built.noise, cfg.R, a);
      const lip = new THREE.Vector3(dir.x * (r + 0.2), 0.1, dir.y * (r + 0.2));
      return { lip, dir, width: f.width, bottom: -cfg.R * 2.6, out: 1.2 };
    });
    return { trees: list, sites: falls };
  }, [cfg, built]);
  const group = useRef();
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    group.current.position.set(cfg.p[0], cfg.p[1] + Math.sin(t * 0.32 + index * 2.1) * 0.9, cfg.p[2]);
    group.current.rotation.y = Math.sin(t * 0.05 + index) * 0.08;
  });
  return (
    <group ref={group} position={cfg.p}>
      <mesh geometry={built.g} material={material} />
      <TreeGroup trees={trees} detail={2} />
      <Waterfalls sites={sites} />
    </group>
  );
}

export function FloatingIslands() {
  const material = useDisposable(() => makeLandMaterial(LAND_KIND.island));
  return ISLANDS.map((cfg, i) => <Island key={i} cfg={cfg} index={i} material={material} />);
}

/** Cloud wisps hanging beneath the islands (fed to the Mist batch). */
export function islandWisps() {
  const rand = makeRandom(5);
  const out = [];
  for (const cfg of ISLANDS) {
    for (let i = 0; i < 5; i++) {
      out.push({
        c: [cfg.p[0] + rand.range(-0.8, 0.8) * cfg.R, cfg.p[1] - cfg.R * rand.range(1.6, 2.4), cfg.p[2] + rand.range(-0.4, 0.6) * cfg.R],
        p: [cfg.R * rand.range(1.6, 2.4), cfg.R * 0.3, i / 5 + rand.range(0, 0.1), 0.02],
      });
    }
  }
  return out;
}
