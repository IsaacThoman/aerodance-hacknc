import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { beat, useDisposable } from '../shared/hooks.js';
import { hash, simplex } from '../shared/glsl.js';
import { world } from './palette.js';
import { patchMaterial } from './shaders.js';
import { sandHeight } from './terrain.js';
import { finalize, lathe, merge, place } from './geometry.js';
import { TORCHES } from './layout.js';

/** Tiki torches: banded bamboo poles with a woven cup. */
function Poles() {
  const geometry = useDisposable(() => {
    const parts = [];
    for (const [x, z] of TORCHES) {
      const y = sandHeight(x, z);
      const pole = new THREE.CylinderGeometry(0.06, 0.075, 2.1, 7, 6);
      place(pole, { position: [x, y + 1.05, z] });
      parts.push(finalize(pole, { paint: (p, n, out) => out.set(Math.floor((p.y - y) * 3.3) % 2 ? '#c9a26a' : '#a8804c') }));
      const cup = lathe([[0.06, 0], [0.16, 0.08], [0.2, 0.32], [0.17, 0.36], [0, 0.36]], 10);
      place(cup, { position: [x, y + 2.05, z] });
      parts.push(finalize(cup, { paint: '#7a5532' }));
    }
    return merge(parts);
  });
  const material = useDisposable(() =>
    patchMaterial(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.12 }), { key: 'torch' }),
  );
  return <mesh geometry={geometry} material={material} castShadow receiveShadow />;
}

/** Stylised flickering torch flames: camera-facing teardrops with a hot core. */
function Flames() {
  const geometry = useDisposable(() => {
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.attributes.position = plane.attributes.position;
    g.attributes.uv = plane.attributes.uv;
    const off = new Float32Array(TORCHES.length * 4);
    TORCHES.forEach(([x, z], i) => off.set([x, sandHeight(x, z) + 2.36, z, i * 2.7], i * 4));
    g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 4));
    g.instanceCount = TORCHES.length;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: world.uTime, uPulse: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute vec4 aOffset;
          uniform float uTime;
          varying vec2 vUv;
          varying float vSeed;
          void main() {
            vUv = uv;
            vSeed = aOffset.w;
            float s = 0.95 + 0.08 * sin(uTime * 11.0 + aOffset.w);
            vec4 mv = viewMatrix * vec4(aOffset.xyz, 1.0);
            mv.xy += vec2(position.x * 0.55, position.y * 1.05 * s);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime, uPulse;
          varying vec2 vUv;
          varying float vSeed;
          ${hash}
          ${simplex}
          void main() {
            float y = vUv.y;
            float t = uTime * 2.6 + vSeed;
            float wob = snoise(vec2(y * 2.5 - t, vSeed)) * 0.18 * y;
            float x = (vUv.x - 0.5 + wob) * 2.0;
            float width = 0.95 * pow(max(1.0 - y, 0.0), 0.9) * smoothstep(0.0, 0.25, y) + 0.001;
            float d = abs(x) / width;
            float body = 1.0 - smoothstep(0.55, 1.0, d);
            float tongue = smoothstep(0.2, 0.8, snoise(vec2(x * 2.0, y * 3.0 - t * 1.4)) * 0.5 + 0.5 + (1.0 - y) * 0.6);
            float a = body * tongue * (1.0 - smoothstep(0.6, 1.0, y));
            float core = (1.0 - smoothstep(0.0, 0.55, d)) * (1.0 - smoothstep(0.1, 0.6, y));
            vec3 col = mix(vec3(1.6, 0.35, 0.08), vec3(2.6, 1.3, 0.3), smoothstep(0.0, 0.7, 1.0 - d));
            col = mix(col, vec3(4.0, 3.2, 1.8), core);
            float glow = exp(-dot(vec2(x * 0.6, (y - 0.25) * 1.4), vec2(x * 0.6, (y - 0.25) * 1.4)) * 3.0) * 0.25;
            gl_FragColor = vec4((col * a + vec3(1.0, 0.5, 0.2) * glow) * (1.0 + 0.3 * uPulse), 1.0);
          }
        `,
      }),
  );
  useFrame(() => {
    material.uniforms.uPulse.value = beat.pulse;
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={20} />;
}

/** Warm practical lights from the torches; they flicker and breathe with the beat. */
function TorchLights() {
  const refs = useRef([]);
  const spots = useMemo(() => TORCHES.map(([x, z]) => [x, sandHeight(x, z) + 2.6, z + 0.2]), []);
  useFrame(() => {
    const t = world.uTime.value;
    refs.current.forEach((l, i) => {
      if (!l) return;
      l.intensity = 5 * (0.85 + 0.1 * Math.sin(t * 11 + i * 2.7) + 0.05 * Math.sin(t * 27 + i)) * (1 + 0.25 * beat.pulse);
    });
  });
  return spots.map((p, i) => <pointLight key={i} ref={(l) => (refs.current[i] = l)} position={p} color="#ff9a4a" distance={14} decay={1.6} />);
}

export function Torches() {
  return (
    <>
      <Poles />
      <Flames />
      <TorchLights />
    </>
  );
}
