import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { noise } from '../../shared/glsl.js';
import { beat, useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { cityUniforms, makeCityMaterial, makeFoliageMaterial } from './materials.js';
import { buildMountains, buildTerrain, makeGroundMaterial, paintGroundTexture } from './terrain.js';
import { BLOSSOMS, TREE_GREENS, makeConeTree, makePalm, makeRoundTree } from './trees.js';
import { GROUND, groundHeight, shoreZ } from './layout.js';
import { reactions } from './reactions.js';
import { LAYER_NO_REFLECT } from './Water.jsx';

// Static world: merged city, terrain, distant mountains, trees, the biodomes,
// the plaza globe with its pool and fountains.

export function CityMesh({ city }) {
  const material = useDisposable(() => makeCityMaterial());
  return <mesh geometry={city.geometry} material={material} />;
}

export function Terrain({ city }) {
  const texture = useDisposable(() => paintGroundTexture(city), [city]);
  const geometry = useDisposable(() => buildTerrain());
  const material = useDisposable(() => makeGroundMaterial(texture), [texture]);
  const mountains = useDisposable(() => buildMountains());
  const mountainMat = useDisposable(() => new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  return (
    <>
      <mesh geometry={geometry} material={material} />
      <mesh geometry={mountains} material={mountainMat} renderOrder={-400} />
    </>
  );
}

function hillTrees(rand) {
  const out = [];
  // Woods scattered over the hills behind the city and on the headlands.
  for (let i = 0; i < 2600 && out.length < 520; i++) {
    const x = rand.range(-1100, 1100);
    const z = rand.range(-900, 260);
    const inCity = x > -380 && x < 385 && z > -440;
    if (inCity) continue;
    if (z > shoreZ(x) - 6) continue;
    const h = groundHeight(x, z);
    if (h < GROUND + 2) continue;
    // Clump trees using a cheap noise field.
    const clump = Math.sin(x * 0.011) * Math.sin(z * 0.013 + 1.7) + Math.sin(x * 0.027 + z * 0.019) * 0.5;
    if (clump < 0.35) continue;
    out.push({ x, y: h - 0.5, z, s: rand.range(7, 12), type: rand.chance(0.3) ? 'cone' : 'round' });
  }
  return out;
}

export function Trees({ city }) {
  // Trees near the water show up in the bay's reflection; the rest skip that pass.
  const data = useMemo(() => {
    const rand = makeRandom(91);
    const all = [...city.trees, ...hillTrees(rand)];
    const groups = [{ round: [], cone: [], palm: [] }, { round: [], cone: [], palm: [] }];
    for (const t of all) {
      const nearWater = t.z > shoreZ(t.x) - 40;
      groups[nearWater ? 0 : 1][t.type].push(t);
    }
    return groups;
  }, [city]);
  const geometries = useDisposable(() => ({ round: makeRoundTree(), cone: makeConeTree(), palm: makePalm() }));
  const material = useDisposable(() => makeFoliageMaterial({ sway: 0.35 }));
  const palmMaterial = useDisposable(() => {
    const m = makeFoliageMaterial({ sway: 0.6 });
    m.side = THREE.DoubleSide;
    return m;
  });
  const meshes = useMemo(() => {
    const rand = makeRandom(4);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const color = new THREE.Color();
    const make = (type, list, mat, layer) => {
      if (!list.length) return null;
      const mesh = new THREE.InstancedMesh(geometries[type], mat, list.length);
      list.forEach((t, i) => {
        e.set(rand.range(-0.04, 0.04), rand.range(0, Math.PI * 2), rand.range(-0.04, 0.04));
        q.setFromEuler(e);
        const w = t.s * rand.range(0.85, 1.15);
        m.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(w, t.s, w));
        mesh.setMatrixAt(i, m);
        if (type === 'palm') color.set(rand.pick(['#4fb43a', '#6cc84a', '#3fa33f']));
        else if (rand.chance(0.05) && t.y < GROUND + 0.5) color.set(rand.pick(BLOSSOMS));
        else color.set(rand.pick(TREE_GREENS));
        mesh.setColorAt(i, color);
      });
      mesh.computeBoundingSphere();
      if (layer) mesh.layers.set(layer);
      return mesh;
    };
    return data
      .flatMap((g, gi) => [
        make('round', g.round, material, gi ? LAYER_NO_REFLECT : 0),
        make('cone', g.cone, material, gi ? LAYER_NO_REFLECT : 0),
        make('palm', g.palm, palmMaterial, gi ? LAYER_NO_REFLECT : 0),
      ])
      .filter(Boolean);
  }, [data, geometries, material, palmMaterial]);
  useEffect(() => () => meshes.forEach((m) => m.dispose()), [meshes]);
  return (
    <>
      {meshes.map((mesh, i) => (
        <primitive key={i} object={mesh} />
      ))}
    </>
  );
}

function makeDomeGeometry(domes) {
  const parts = [];
  for (const d of domes) {
    const ico = new THREE.IcosahedronGeometry(1, 3);
    const p = ico.attributes.position;
    const pos = [];
    const nor = [];
    const bary = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) {
      const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
      if (cy < -0.03) continue;
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(p, i + k).normalize();
        const n = new THREE.Vector3(v.x, v.y / d.hy, v.z).normalize();
        pos.push(d.x + v.x * d.r, GROUND + Math.max(v.y, -0.02) * d.r * d.hy, d.z + v.z * d.r);
        nor.push(n.x, n.y, n.z);
        bary.push(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('aBary', new THREE.Float32BufferAttribute(bary, 3));
    parts.push(g);
    ico.dispose();
  }
  const merged = new THREE.BufferGeometry();
  const cat = (name, size) => {
    const total = parts.reduce((s, g) => s + g.attributes[name].array.length, 0);
    const arr = new Float32Array(total);
    let o = 0;
    for (const g of parts) {
      arr.set(g.attributes[name].array, o);
      o += g.attributes[name].array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(arr, size));
  };
  cat('position', 3);
  cat('normal', 3);
  cat('aBary', 3);
  parts.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  return merged;
}

const domeUniforms = { uGlow: { value: 0 } };

export function Biodomes({ city }) {
  const geometry = useDisposable(() => makeDomeGeometry(city.domes), [city]);
  const material = useDisposable(() => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.06, metalness: 0.2, transparent: true, depthWrite: false });
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uGlow = domeUniforms.uGlow;
      shader.uniforms.uTime = cityUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aBary;\nvarying vec3 vBary;\nvarying vec3 vWP;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvBary = aBary;\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBary;\nvarying vec3 vWP;\nuniform float uGlow;\nuniform float uTime;')
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
          vec3 bw = fwidth(vBary);
          vec3 a3 = smoothstep(vec3(0.0), bw * 1.2 + 0.045, vBary);
          float frame = 1.0 - min(min(a3.x, a3.y), a3.z);
          float hub = smoothstep(0.86, 0.95, max(max(vBary.x, vBary.y), vBary.z));
          frame = max(frame, hub);
          diffuseColor.rgb = mix(vec3(0.45, 0.8, 0.85), vec3(0.95, 0.97, 1.0), frame);
          diffuseColor.a = mix(0.14, 1.0, frame);
          roughnessFactor = mix(0.04, 0.35, frame);
          metalnessFactor = mix(0.25, 0.05, frame);`,
        )
        .replace(
          '#include <opaque_fragment>',
          `float sweep = smoothstep(0.9, 1.0, sin(vWP.y * 0.25 - uTime * 3.0)) * uGlow;
          vec3 glowCol = vec3(0.4, 1.0, 0.9) * (uGlow * 0.05 + sweep * 0.9) * frame;
          gl_FragColor = vec4(totalDiffuse * diffuseColor.a + totalSpecular * mix(1.8, 1.0, frame) + glowCol, diffuseColor.a);`,
        );
    };
    m.customProgramCacheKey = () => 'ecocity-dome';
    return m;
  });
  useFrame((_, dt) => {
    const target = reactions.focus === 'dome' ? 1 : 0;
    domeUniforms.uGlow.value += (target - domeUniforms.uGlow.value) * Math.min(1, dt * 4);
  });
  return <mesh geometry={geometry} material={material} renderOrder={5} />;
}

export function Globe({ city }) {
  const { x, y, z, r } = city.globe;
  const globe = useRef();
  const rings = useRef();
  const globeGeo = useDisposable(() => new THREE.SphereGeometry(r, 64, 40));
  const globeMat = useDisposable(() => {
    const m = new THREE.MeshPhysicalMaterial({ roughness: 0.35, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04 });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vObjN;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvObjN = normal;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vObjN;\n${noise}`)
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
          vec3 q = normalize(vObjN);
          float land = fbm(q * 1.6 + vec3(2.0, 0.5, 1.0)) + 0.12;
          float isLand = smoothstep(0.03, 0.07, land);
          vec3 ocean = mix(vec3(0.0, 0.12, 0.5), vec3(0.0, 0.45, 0.75), smoothstep(-0.25, 0.06, land));
          vec3 ground = mix(vec3(0.08, 0.42, 0.04), vec3(0.42, 0.62, 0.1), smoothstep(0.15, 0.45, land));
          ground = mix(ground, vec3(0.62, 0.52, 0.28), smoothstep(0.45, 0.65, land) * 0.6);
          vec3 c = mix(ocean, ground, isLand);
          c = mix(c, vec3(0.95, 0.98, 1.0), smoothstep(0.82, 0.9, abs(q.y)));
          diffuseColor.rgb = c;
          roughnessFactor = mix(0.15, 0.55, isLand);`,
        );
    };
    m.customProgramCacheKey = () => 'ecocity-globe';
    return m;
  });
  const ringGeo = useDisposable(() => {
    const a = new THREE.TorusGeometry(r * 1.32, 0.28, 8, 96);
    const b = new THREE.TorusGeometry(r * 1.22, 0.22, 8, 96).rotateX(Math.PI / 2);
    const c = new THREE.TorusGeometry(r * 1.42, 0.18, 8, 96).rotateY(Math.PI / 2).rotateZ(0.4);
    const merged = new THREE.BufferGeometry();
    const parts = [a, b, c].map((g) => g.toNonIndexed());
    const total = parts.reduce((s, g) => s + g.attributes.position.count, 0);
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      o += g.attributes.position.count;
    }
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    [a, b, c, ...parts].forEach((g) => g.dispose());
    return merged;
  });
  const ringMat = useDisposable(() => new THREE.MeshStandardMaterial({ color: '#f4f9ff', roughness: 0.18, metalness: 0.55 }));
  useFrame((state, dt) => {
    const spin = reactions.focus === 'plaza' ? 1.6 : 0.22;
    globe.current.rotation.y += dt * spin;
    rings.current.rotation.y -= dt * 0.12;
    rings.current.rotation.x = 0.4 + Math.sin(state.clock.elapsedTime * 0.2) * 0.08;
  });
  return (
    <group position={[x, y, z]}>
      <mesh ref={globe} geometry={globeGeo} material={globeMat} rotation={[0.41, 0, 0]} />
      <mesh ref={rings} geometry={ringGeo} material={ringMat} />
    </group>
  );
}

export function PlazaPool({ city }) {
  const { x, z, pool } = city.globe;
  const geometry = useDisposable(() => new THREE.CircleGeometry(pool, 64).rotateX(-Math.PI / 2));
  const material = useDisposable(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#27c4d8', roughness: 0.05, metalness: 0.15 });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = cityUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vLocal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position.xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vLocal;\nuniform float uTime;')
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          float rr = length(vLocal);
          float rip = sin(rr * 1.6 - uTime * 4.0) * 0.5 + sin(rr * 0.9 + uTime * 2.5) * 0.5;
          vec2 dir = vLocal / max(rr, 0.001);
          normal = normalize(normal + vec3(dir.x, 0.0, dir.y) * rip * 0.12);`,
        );
    };
    m.customProgramCacheKey = () => 'ecocity-pool';
    return m;
  });
  return <mesh geometry={geometry} material={material} position={[x, GROUND + 0.45, z]} />;
}

export const fountainUniforms = { uTime: { value: 0 }, uSurge: { value: 0 }, uBeat: { value: 0 } };

export function Fountain({ city }) {
  const { x, z, pool } = city.globe;
  const geometry = useDisposable(() => {
    const jets = 18;
    const per = 40;
    const ring = 14;
    const perRing = 26;
    const total = jets * per + ring * perRing;
    const pos = new Float32Array(total * 3);
    const a = new Float32Array(total * 4);
    let k = 0;
    for (let j = 0; j < jets; j++) {
      for (let i = 0; i < per; i++, k++) a.set([(j / jets) * Math.PI * 2, i / per, 0, Math.random()], k * 4);
    }
    for (let j = 0; j < ring; j++) {
      for (let i = 0; i < perRing; i++, k++) a.set([(j / ring) * Math.PI * 2 + 0.1, i / perRing, 1, Math.random()], k * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aJet', new THREE.BufferAttribute(a, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { ...fountainUniforms, uPool: { value: pool } },
        vertexShader: /* glsl */ `
          attribute vec4 aJet;
          uniform float uTime, uSurge, uPool;
          varying float vAlpha;
          void main() {
            float ang = aJet.x;
            float kind = aJet.z;
            vec3 p;
            float life;
            if (kind < 0.5) {
              float T = 2.2 * (1.0 + uSurge * 0.25);
              life = fract(uTime / T + aJet.y);
              float tt = life * T;
              float R = uPool - 2.0;
              vec2 dir = vec2(cos(ang), sin(ang));
              float vy = 4.9 * T;
              float vh = (R - 7.5) / T;
              p = vec3(dir.x * (R - vh * tt), 0.6 + vy * tt - 4.9 * tt * tt, dir.y * (R - vh * tt));
              p.xz += dir * (aJet.w - 0.5) * 0.4;
            } else {
              float T = 1.25;
              life = fract(uTime / T + aJet.y);
              float launch = uTime - life * T;
              float ph = fract(launch * 118.0 / 60.0);
              float power = 4.0 + 6.0 * exp(-ph * 5.0) + uSurge * 5.0;
              float tt = life * T;
              float vy = power;
              float y = max(vy * tt - 4.9 * tt * tt, 0.0);
              float R = 11.5;
              p = vec3(cos(ang) * R, 0.6 + y, sin(ang) * R);
              p.xz += vec2(aJet.w - 0.5, fract(aJet.w * 7.0) - 0.5) * 0.5;
            }
            vAlpha = smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.85, 1.0, life));
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp(1.25 * 700.0 / -mv.z, 1.0, 6.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vAlpha;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = 1.0 - smoothstep(0.2, 0.5, length(c));
            gl_FragColor = vec4(vec3(1.25, 1.35, 1.4), d * vAlpha * 0.85);
          }
        `,
      }),
  );
  useFrame((state, dt) => {
    fountainUniforms.uTime.value = state.clock.elapsedTime;
    const target = reactions.focus === 'plaza' ? 1 : 0;
    fountainUniforms.uSurge.value += (target + reactions.burst * 0.8 - fountainUniforms.uSurge.value) * Math.min(1, dt * 3);
    fountainUniforms.uBeat.value = beat.pulse;
  });
  return <points geometry={geometry} material={material} position={[x, GROUND, z]} frustumCulled={false} renderOrder={6} />;
}
