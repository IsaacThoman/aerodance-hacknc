import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ASPECT, beat, useDisposable } from '../../shared/hooks.js';
import { SUN_DIR } from './palette.js';

// Ghosts along the line from the sun through the screen center:
// [t along the line (0 = sun, 2 = mirrored), size (NDC height), shape, r, g, b, alpha]
// shape: 0 soft disc, 1 ring, 2 hexagon, 3 sun starburst + anamorphic streak.
const GHOSTS = [
  [0.0, 0.5, 3, 1.0, 0.86, 0.62, 0.7],
  [0.3, 0.07, 2, 1.0, 0.72, 0.5, 0.3],
  [0.52, 0.04, 0, 0.6, 1.0, 0.85, 0.35],
  [0.76, 0.12, 1, 1.0, 0.6, 0.85, 0.25],
  [1.08, 0.055, 2, 0.55, 0.85, 1.0, 0.28],
  [1.3, 0.15, 0, 0.75, 0.6, 1.0, 0.1],
  [1.58, 0.08, 2, 1.0, 0.65, 0.8, 0.2],
  [1.92, 0.22, 1, 0.6, 0.9, 1.0, 0.12],
];

/**
 * Screen-space Vista-style lens flare for the low sun, drawn in the world
 * pass (so it blooms) with clip-space quads; fades as the sun nears the edge.
 */
export function SunFlare() {
  const geometry = useDisposable(() => {
    const plane = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.attributes.position = plane.attributes.position;
    g.attributes.uv = plane.attributes.uv;
    const a = new Float32Array(GHOSTS.length * 3);
    const c = new Float32Array(GHOSTS.length * 4);
    GHOSTS.forEach(([t, size, shape, r, gg, b, al], i) => {
      a.set([t, size, shape], i * 3);
      c.set([r, gg, b, al], i * 4);
    });
    g.setAttribute('aGhost', new THREE.InstancedBufferAttribute(a, 3));
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(c, 4));
    g.instanceCount = GHOSTS.length;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uSun: { value: new THREE.Vector2() },
          uVis: { value: 0 },
          uAspect: { value: ASPECT },
          uPulse: { value: 0 },
          uTime: { value: 0 },
        },
        vertexShader: /* glsl */ `
          attribute vec3 aGhost;
          attribute vec4 aColor;
          uniform vec2 uSun;
          uniform float uAspect, uVis;
          varying vec2 vUv;
          varying vec4 vColor;
          varying float vShape;
          void main() {
            vec2 center = mix(uSun, -uSun, aGhost.x * 0.5);
            vec2 q = position.xy * aGhost.y;
            // Starburst gets a wide anamorphic quad for the horizontal streak.
            if (aGhost.z > 2.5) q.x *= 4.0;
            q.x /= uAspect;
            vUv = uv;
            vColor = aColor * vec4(1.0, 1.0, 1.0, uVis);
            vShape = aGhost.z;
            gl_Position = vec4(center + q, 0.0, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uPulse, uTime;
          varying vec2 vUv;
          varying vec4 vColor;
          varying float vShape;
          float hexDist(vec2 p) {
            p = abs(p);
            return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
          }
          void main() {
            vec2 p = vUv * 2.0 - 1.0;
            float a = 0.0;
            if (vShape < 0.5) {
              a = exp(-dot(p, p) * 3.5);
            } else if (vShape < 1.5) {
              float r = length(p);
              a = exp(-pow((r - 0.8) * 9.0, 2.0)) + 0.15 * exp(-r * r * 2.0);
            } else if (vShape < 2.5) {
              float h = hexDist(p);
              a = smoothstep(0.82, 0.74, h) * (0.55 + 0.45 * smoothstep(0.3, 0.8, h));
            } else {
              vec2 s = vec2(p.x * 4.0, p.y);
              float r = length(s);
              float ang = atan(s.y, s.x);
              float rays = pow(abs(cos(ang * 3.0 + uTime * 0.05)), 40.0) * exp(-r * 2.2) * 0.6;
              float streak = exp(-abs(p.y) * 38.0) * exp(-abs(p.x) * 1.6);
              a = rays + streak * 0.9 + exp(-r * r * 6.0) * 0.35;
            }
            a *= vColor.a * (0.9 + 0.2 * uPulse) * 3.5;
            gl_FragColor = vec4(vColor.rgb * a, 1.0);
          }
        `,
      }),
  );
  const v = useRef(new THREE.Vector3());
  useFrame((state) => {
    const cam = state.camera;
    v.current.copy(SUN_DIR).multiplyScalar(1000).add(cam.position).project(cam);
    const u = material.uniforms;
    u.uSun.value.set(v.current.x, v.current.y);
    const edge = Math.max(Math.abs(v.current.x), Math.abs(v.current.y));
    u.uVis.value = v.current.z < 1 ? THREE.MathUtils.clamp((1.15 - edge) / 0.4, 0, 1) : 0;
    u.uPulse.value = beat.pulse;
    u.uTime.value = state.clock.elapsedTime;
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={50} />;
}
