import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { makeLit } from './materials.js';

const MOON_SURFACE = /* glsl */ `
  uniform vec3 uA, uB;
  void surface(inout Surf s, vec3 V) {
    vec3 n = normalize(vObjPos);
    float m = fbm(n * 2.2 + 4.0);
    float c = snoise(n * 5.0);
    float crater = smoothstep(0.45, 0.6, c) - 0.6 * smoothstep(0.62, 0.8, c);
    s.albedo = mix(uA, uB, smoothstep(-0.4, 0.4, m)) * (1.0 - 0.25 * crater);
    s.gloss = 0.1;
    s.shine = 12.0;
  }
`;

/** Tiny moon on an inclined circular orbit around its parent's origin. */
export function Moon({ radius = 0.35, distance = 4, speed = 0.3, phase = 0, incline = 0.35, colors = ['#8f86c9', '#e6defa'], rim = '#c9b8ff', children }) {
  const ref = useRef();
  const material = useDisposable(
    () =>
      makeLit({
        surface: MOON_SURFACE,
        painted: false,
        withNoise: true,
        rim,
        rimStrength: 0.9,
        uniforms: { uA: { value: new THREE.Color(colors[0]) }, uB: { value: new THREE.Color(colors[1]) } },
      }),
    [],
  );
  useFrame((state) => {
    const a = state.clock.elapsedTime * speed + phase;
    const m = ref.current;
    m.position.set(Math.cos(a) * distance, Math.sin(a) * distance * Math.sin(incline), Math.sin(a) * distance * Math.cos(incline));
    m.rotation.y = a * 0.5;
  });
  return (
    <group ref={ref}>
      <mesh material={material}>
        <icosahedronGeometry args={[radius, 6]} />
      </mesh>
      {children}
    </group>
  );
}
