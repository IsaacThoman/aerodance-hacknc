import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { fogUniforms, patchClub } from './patch.js';
import { arcBand, arcTube, mergeAll } from './geometry.js';
import { fishGeometry, SPECIES } from './fish.js';
import { FLOOR, TANK, TANK_CENTERS, polar } from './layout.js';
import {
  CURTAIN_R,
  SAND,
  TOP,
  backFragment,
  bubbleFragment,
  bubbleVertex,
  curtainFragment,
  fishFragment,
  fishVertex,
  glassFragment,
  sandFragment,
  vertexWorld,
} from './aquaShaders.js';

// Floor-to-ceiling aquarium walls wrapping the back corners of the club.
function useFish() {
  return useDisposable(() => {
    const base = fishGeometry();
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    for (const name of ['position', 'normal', 'aU', 'aFin']) g.setAttribute(name, base.attributes[name]);
    const rand = makeRandom(4242);
    const perTank = 42;
    const count = perTank * TANK_CENTERS.length;
    const seed = new Float32Array(count * 4);
    const look = new Float32Array(count * 4);
    const body = new Float32Array(count * 3);
    const accent = new Float32Array(count * 3);
    const weights = SPECIES.reduce((s, sp) => s + sp.weight, 0);
    const color = new THREE.Color();
    let i = 0;
    TANK_CENTERS.forEach((center) => {
      // Small schools share species, direction and roughly height.
      for (let k = 0; k < perTank; ) {
        let w = rand.next() * weights;
        const sp = SPECIES.find((s) => (w -= s.weight) < 0) ?? SPECIES[0];
        const n = Math.min(perTank - k, sp.size < 0.45 ? rand.int(4, 8) : rand.int(1, 3));
        const dir = rand.sign();
        const phase = rand.next();
        const height = rand.range(0.05, 0.95);
        const speed = rand.range(0.45, 0.85);
        for (let j = 0; j < n; j++, k++, i++) {
          seed.set([phase + rand.range(-0.04, 0.04), rand.next(), THREE.MathUtils.clamp(height + rand.range(-0.06, 0.06), 0, 1), speed * rand.range(0.95, 1.05)], i * 4);
          look.set([sp.pattern, sp.size * 1.7 * rand.range(0.85, 1.15), center, dir], i * 4);
          color.set(sp.body).toArray(body, i * 3);
          color.set(sp.accent).toArray(accent, i * 3);
        }
      }
    });
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.setAttribute('aLook', new THREE.InstancedBufferAttribute(look, 4));
    g.setAttribute('aBody', new THREE.InstancedBufferAttribute(body, 3));
    g.setAttribute('aAccent', new THREE.InstancedBufferAttribute(accent, 3));
    g.instanceCount = count;
    base.dispose();
    return g;
  });
}

function useBubbles() {
  return useDisposable(() => {
    const rand = makeRandom(77);
    const seeds = [];
    TANK_CENTERS.forEach((center) => {
      for (let s = 0; s < 6; s++) {
        const theta = center + rand.range(-0.85, 0.85) * TANK.half;
        const r = rand.range(14.0, 15.4);
        const speed = rand.range(1.1, 1.7);
        for (let b = 0; b < 12; b++) seeds.push(theta, r, rand.next(), speed * rand.range(0.85, 1.15));
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4));
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((seeds.length / 4) * 3), 3));
    return g;
  });
}

export default function Aquarium() {
  const fish = useFish();
  const bubbles = useBubbles();
  const mats = useDisposable(() => {
    const shader = (fragmentShader, opts = {}) =>
      new THREE.ShaderMaterial({ uniforms: fogUniforms(), vertexShader: vertexWorld, fragmentShader, fog: true, ...opts });
    return {
      back: shader(backFragment, { side: THREE.BackSide }),
      curtain: shader(curtainFragment, { side: THREE.BackSide }),
      sand: shader(sandFragment),
      glass: new THREE.ShaderMaterial({
        uniforms: fogUniforms(),
        vertexShader: vertexWorld,
        fragmentShader: glassFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
      }),
      fish: new THREE.ShaderMaterial({ uniforms: fogUniforms(), vertexShader: fishVertex, fragmentShader: fishFragment, fog: true, side: THREE.DoubleSide }),
      bubble: new THREE.ShaderMaterial({
        uniforms: fogUniforms(),
        vertexShader: bubbleVertex,
        fragmentShader: bubbleFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      frame: new THREE.MeshPhysicalMaterial({ color: '#c6d1f0', roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0.5 }),
      plinth: patchClub(new THREE.MeshPhysicalMaterial({ color: '#0e1650', roughness: 0.25, clearcoat: 1, envMapIntensity: 0.4, side: THREE.BackSide }), {
        key: 'tank-plinth',
        emissive: /* glsl */ `
          float l = exp(-pow((vClubWorld.y - ${(SAND - 0.2).toFixed(2)}) * 20.0, 2.0));
          totalEmissiveRadiance += vec3(0.2, 0.9, 1.0) * l * 2.0;
        `,
        dots: 1,
      }),
    };
  });

  // Both tanks merged per material.
  const geo = useDisposable(() => {
    const parts = { back: [], curtain: [], glass: [], plinth: [], frame: [], sand: [] };
    TANK_CENTERS.forEach((c) => {
      const start = c - TANK.half;
      const len = TANK.half * 2;
      parts.back.push(arcBand(TANK.back, start - 0.25, len + 0.5, FLOOR - 1, TOP + 2.5, 48));
      parts.curtain.push(arcBand(CURTAIN_R, start - 0.15, len + 0.3, SAND - 0.1, SAND + 2.6, 64));
      parts.glass.push(arcBand(TANK.glass - 0.02, start, len, SAND, TOP, 48));
      parts.plinth.push(arcBand(TANK.glass, start, len, FLOOR, SAND, 48));
      parts.frame.push(arcTube(TANK.glass - 0.1, start, len, 0.12, SAND, 48), arcTube(TANK.glass - 0.1, start, len, 0.12, TOP, 48));
      for (const f of [0.25, 0.5, 0.75]) {
        const [x, , z] = polar(TANK.glass - 0.08, start + len * f);
        parts.frame.push(new THREE.CylinderGeometry(0.06, 0.06, TOP - SAND, 8, 1, true).translate(x, (TOP + SAND) / 2, z));
      }
      // Sand: RingGeometry runs counterclockwise from +x in XY; map to cylinder thetas.
      parts.sand.push(
        new THREE.RingGeometry(TANK.glass - 0.1, TANK.back + 0.1, 48, 1, 0, len + 0.5)
          .rotateX(-Math.PI / 2)
          .rotateY(start - 0.25 - Math.PI / 2)
          .translate(0, SAND, 0),
      );
    });
    return Object.fromEntries(Object.entries(parts).map(([k, list]) => [k, mergeAll(list)]));
  });

  return (
    <group>
      <mesh geometry={geo.back} material={mats.back} />
      <mesh geometry={geo.curtain} material={mats.curtain} />
      <mesh geometry={geo.sand} material={mats.sand} />
      <mesh geometry={geo.plinth} material={mats.plinth} />
      <mesh geometry={geo.frame} material={mats.frame} />
      <mesh geometry={fish} material={mats.fish} frustumCulled={false} />
      <mesh geometry={geo.glass} material={mats.glass} renderOrder={2} />
      <points geometry={bubbles} material={mats.bubble} frustumCulled={false} renderOrder={3} />
    </group>
  );
}
