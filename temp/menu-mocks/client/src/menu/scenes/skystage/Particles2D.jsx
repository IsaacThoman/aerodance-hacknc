import { forwardRef, useImperativeHandle } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';

const MAX = 128;

/**
 * HUD particle pool for confetti and sparkle bursts. Call ref.emit(x, y,
 * { count, colors, speed, spread, angle, gravity, size, kind }) to spawn.
 * kind: 0 = confetti ribbon, 1 = four-point sparkle.
 */
export const Particles2D = forwardRef(function Particles2D({ z = 40 }, ref) {
  const geometry = useDisposable(() => {
    const plane = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.attributes.position = plane.attributes.position;
    g.attributes.uv = plane.attributes.uv;
    g.setAttribute('aStart', new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4)); // x, y, t0, kind
    g.setAttribute('aVel', new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4)); // vx, vy, gravity, size
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3));
    const start = g.attributes.aStart.array;
    for (let i = 0; i < MAX; i++) start[i * 4 + 2] = -100;
    g.instanceCount = MAX;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute vec4 aStart;
          attribute vec4 aVel;
          attribute vec3 aColor;
          uniform float uTime;
          varying vec2 vUv;
          varying vec3 vColor;
          varying float vA;
          varying float vKind;
          void main() {
            float t = uTime - aStart.z;
            float life = aStart.w > 0.5 ? 0.9 : 1.6;
            float alive = step(0.0, t) * step(t, life);
            vec2 p = aStart.xy + aVel.xy * t * (1.0 - 0.35 * t / life) + vec2(0.0, -0.5 * aVel.z * t * t);
            float seed = fract(aStart.x * 0.137 + aStart.y * 0.071 + aStart.z * 3.3);
            float rot = t * (6.0 + seed * 8.0) * (seed > 0.5 ? 1.0 : -1.0);
            vec2 q = position.xy;
            if (aStart.w < 0.5) {
              // Confetti: a flat ribbon tumbling (squash on one axis).
              q *= vec2(1.0, 0.45);
              q.x *= cos(t * (9.0 + seed * 6.0));
            }
            q = mat2(cos(rot), sin(rot), -sin(rot), cos(rot)) * q;
            float grow = smoothstep(0.0, 0.08, t);
            vec2 pos = p + q * aVel.w * grow * alive;
            vUv = uv;
            vColor = aColor;
            vKind = aStart.w;
            vA = alive * (1.0 - smoothstep(life * 0.6, life, t));
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 0.0, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vColor;
          varying float vA;
          varying float vKind;
          void main() {
            vec2 d = abs(vUv - 0.5) * 2.0;
            float a;
            vec3 c = vColor;
            if (vKind > 0.5) {
              float star = max(1.0 - (d.x * 5.0 + d.y * 0.8), 0.0) + max(1.0 - (d.y * 5.0 + d.x * 0.8), 0.0);
              float core = exp(-dot(d, d) * 10.0);
              a = clamp(star + core, 0.0, 1.0);
              c = mix(c, vec3(1.0), core * 0.8);
            } else {
              float box = smoothstep(1.0, 0.8, max(d.x, d.y));
              a = box;
              c = mix(c, vec3(1.0), smoothstep(0.6, 0.0, vUv.y) * 0.35);
            }
            a *= vA;
            if (a < 0.01) discard;
            gl_FragColor = vec4(c * a, a);
            #include <colorspace_fragment>
          }
        `,
        premultipliedAlpha: true,
      }),
  );

  const state = useDisposable(() => ({ next: 0, time: 0, color: new THREE.Color() }));

  useImperativeHandle(ref, () => ({
    emit(x, y, { count = 12, colors = ['#ffffff'], speed = 380, spread = Math.PI * 2, angle = Math.PI / 2, gravity = 700, size = 14, kind = 0, jitter = 0 } = {}) {
      const s = geometry.attributes.aStart.array;
      const v = geometry.attributes.aVel.array;
      const c = geometry.attributes.aColor.array;
      for (let k = 0; k < count; k++) {
        const i = state.next;
        state.next = (state.next + 1) % MAX;
        const a = angle + (Math.random() - 0.5) * spread;
        const sp = speed * (0.45 + Math.random() * 0.75);
        s[i * 4] = x + (Math.random() - 0.5) * jitter;
        s[i * 4 + 1] = y + (Math.random() - 0.5) * jitter;
        s[i * 4 + 2] = state.time + Math.random() * 0.05;
        s[i * 4 + 3] = kind;
        v[i * 4] = Math.cos(a) * sp;
        v[i * 4 + 1] = Math.sin(a) * sp;
        v[i * 4 + 2] = gravity;
        v[i * 4 + 3] = size * (0.7 + Math.random() * 0.6);
        state.color.set(colors[Math.floor(Math.random() * colors.length)]);
        c[i * 3] = state.color.r;
        c[i * 3 + 1] = state.color.g;
        c[i * 3 + 2] = state.color.b;
      }
      geometry.attributes.aStart.needsUpdate = true;
      geometry.attributes.aVel.needsUpdate = true;
      geometry.attributes.aColor.needsUpdate = true;
    },
  }));

  useFrame((s) => {
    state.time = s.clock.elapsedTime;
    material.uniforms.uTime.value = state.time;
  });

  return <mesh geometry={geometry} material={material} position={[0, 0, z]} frustumCulled={false} renderOrder={20} />;
});
