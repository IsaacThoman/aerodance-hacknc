import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { env, NO_REFLECT } from './state.js';

const BOX = { x: [-48, 48], y: [-3, 30], z: [-70, 37] };

/** Gently falling snow around the camera, with sparkling glints. */
export function Snow({ count = 1500 }) {
  const ref = useRef();
  const geometry = useDisposable(() => {
    const rand = makeRandom(66);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seed.set([rand.next(), rand.next(), rand.next(), rand.next()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    // Position is computed in the shader; a dummy attribute keeps three happy.
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    return g;
  }, [count]);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: env.uTime,
          uAuroraGlow: env.uAuroraGlow,
          uMin: { value: new THREE.Vector3(BOX.x[0], BOX.y[0], BOX.z[0]) },
          uSize: { value: new THREE.Vector3(BOX.x[1] - BOX.x[0], BOX.y[1] - BOX.y[0], BOX.z[1] - BOX.z[0]) },
        },
        vertexShader: /* glsl */ `
          attribute vec4 aSeed;
          uniform float uTime;
          uniform vec3 uMin, uSize, uAuroraGlow;
          varying vec3 vColor;
          varying float vSoft;
          void main() {
            float speed = mix(0.9, 1.9, aSeed.w);
            vec3 p = uMin + aSeed.xyz * uSize;
            p.y = uMin.y + mod(aSeed.y * uSize.y - uTime * speed, uSize.y);
            float t = uTime * mix(0.4, 0.9, aSeed.x) + aSeed.z * 30.0;
            p.x += sin(t) * 0.9 + sin(t * 0.37 + 2.0) * 1.4 + uTime * 0.35;
            p.x = uMin.x + mod(p.x - uMin.x, uSize.x);
            p.z += cos(t * 0.8) * 0.7;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float d = -mv.z;
            float px = 0.13 * 480.0 / (2.0 * 0.4877) / max(d, 0.1) * mix(0.7, 1.3, aSeed.z);
            float size = max(px, 1.6);
            gl_PointSize = min(size, 34.0);
            // Big near flakes become soft, dim bokeh.
            vSoft = smoothstep(4.0, 16.0, size);
            float energy = 1.6 / max(size * size * 0.25, 1.0);
            float glint = pow(max(sin(uTime * (2.0 + aSeed.w * 4.0) + aSeed.x * 60.0), 0.0), 40.0) * 4.0;
            float fade = smoothstep(0.0, 3.0, d) * smoothstep(110.0, 50.0, d);
            vec3 base = vec3(0.62, 0.72, 0.95) + uAuroraGlow * 1.5;
            vColor = base * fade * mix(0.9 + glint, 1.0, vSoft) * mix(1.0, max(energy * 6.0, 0.1), vSoft);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          varying float vSoft;
          void main() {
            vec2 p = gl_PointCoord - 0.5;
            float r = length(p) * 2.0;
            float hard = exp(-r * r * 3.5);
            float disc = smoothstep(1.0, 0.85, r) * (0.55 + 0.45 * smoothstep(0.5, 0.95, r));
            float a = mix(hard, disc * 0.6, vSoft);
            gl_FragColor = vec4(vColor * a, 1.0);
          }
        `,
      }),
  );
  useLayoutEffect(() => ref.current.layers.set(NO_REFLECT), []);
  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} renderOrder={20} />;
}

/** A handful of large, soft out-of-focus discs drifting close to the lens. */
export function Bokeh({ count = 16 }) {
  const ref = useRef();
  const geometry = useDisposable(() => {
    const rand = makeRandom(91);
    const seed = new Float32Array(count * 4);
    const col = new Float32Array(count * 3);
    const tints = [
      [0.55, 0.9, 1.0],
      [0.5, 1.0, 0.8],
      [0.75, 0.65, 1.0],
      [1.0, 0.75, 0.5],
      [0.8, 0.9, 1.0],
    ];
    for (let i = 0; i < count; i++) {
      seed.set([rand.next(), rand.next(), rand.next(), rand.next()], i * 4);
      col.set(rand.pick(tints), i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    return g;
  }, [count]);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: env.uTime },
        vertexShader: /* glsl */ `
          attribute vec4 aSeed;
          attribute vec3 aColor;
          uniform float uTime;
          varying vec3 vColor;
          void main() {
            // Positions in clip space so the discs float in front of the lens.
            float t = uTime * mix(0.015, 0.035, aSeed.z);
            vec2 p = vec2(fract(aSeed.x + t) * 2.4 - 1.2, fract(aSeed.y - t * 0.6) * 2.4 - 1.2);
            p.x += sin(uTime * 0.2 + aSeed.w * 6.28) * 0.05;
            gl_Position = vec4(p, 0.0, 1.0);
            gl_PointSize = mix(26.0, 64.0, aSeed.w);
            float pulse = 0.6 + 0.4 * sin(uTime * 0.5 + aSeed.z * 20.0);
            // Keep the lower half (lake) and screen center clearer.
            float edge = smoothstep(0.2, 0.9, length(p * vec2(0.9, 1.2)));
            vColor = aColor * 0.05 * pulse * edge;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          void main() {
            float r = length(gl_PointCoord - 0.5) * 2.0;
            float disc = smoothstep(1.0, 0.9, r);
            float rim = smoothstep(0.65, 0.95, r) * disc;
            gl_FragColor = vec4(vColor * (disc * 0.7 + rim * 0.8), 1.0);
          }
        `,
      }),
  );
  useLayoutEffect(() => ref.current.layers.set(NO_REFLECT), []);
  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} renderOrder={30} />;
}
