import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ASPECT, useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { SUN_DIR } from './layout.js';
import { stageUniforms } from './materials.js';
import { FOUNTAIN } from './terraceGeometry.js';
import { instanced } from './geometry.js';

// Small-scale sparkle around the terrace: glossy bubbles drifting up past it,
// twinkling glints, the fountain's spray and a soft lens flare from the sun.

const quad = () => new THREE.PlaneGeometry(1, 1);

export function Bubbles({ count = 56 }) {
  const geometry = useDisposable(() => {
    const rand = makeRandom(808);
    const seed = new Float32Array(count * 4);
    const move = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      let x;
      let z;
      // Keep big bubbles out of the space right in front of the dancers.
      do {
        x = rand.range(-19, 19);
        z = rand.range(-16, 7);
      } while (Math.abs(x) < 5 && z > -4);
      const size = rand.chance(0.25) ? rand.range(0.35, 0.6) : rand.range(0.12, 0.3);
      seed.set([x, rand.range(0, 20), z, size], i * 4);
      move.set([rand.range(0.35, 0.8), rand.range(0, 6.28), rand.range(0.2, 0.7), rand.next()], i * 4);
    }
    return instanced(quad(), count, { aSeed: [4, seed], aMove: [4, move] });
  }, [count]);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: stageUniforms.uTime },
        vertexShader: /* glsl */ `
          attribute vec4 aSeed;
          attribute vec4 aMove;
          uniform float uTime;
          varying vec2 vUv;
          varying float vFade;
          varying float vHue;
          void main() {
            float range = 20.0;
            float y = mod(aSeed.y + uTime * aMove.x, range);
            vec3 c = vec3(aSeed.x + sin(uTime * 0.6 + aMove.y) * aMove.z, y - 3.0, aSeed.z + cos(uTime * 0.5 + aMove.y * 1.3) * aMove.z);
            vFade = smoothstep(0.0, 3.0, y) * smoothstep(range, range - 4.0, y);
            vec4 mv = viewMatrix * vec4(c, 1.0);
            mv.xy += position.xy * aSeed.w * 2.0 * (1.0 + 0.04 * sin(uTime * 3.0 + aMove.y));
            gl_Position = projectionMatrix * mv;
            vUv = uv;
            vHue = aMove.w + uTime * 0.05;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          varying float vFade;
          varying float vHue;
          void main() {
            vec2 p = vUv * 2.0 - 1.0;
            float r = length(p);
            if (r > 1.0) discard;
            float rim = smoothstep(0.55, 0.96, r) * smoothstep(1.0, 0.94, r);
            vec3 irid = 0.55 + 0.45 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + r * 1.3 + p.x * 0.5 + vHue));
            float hl = smoothstep(0.32, 0.0, length((p - vec2(-0.36, 0.42)) * vec2(1.0, 1.4)));
            float hl2 = smoothstep(0.16, 0.0, length(p - vec2(0.42, -0.44)));
            vec3 col = mix(vec3(0.85, 0.97, 1.0), irid, 0.55) * rim * 1.2 + vec3(2.2) * hl + vec3(1.2) * hl2;
            float a = (rim * 0.7 + hl * 0.9 + hl2 * 0.5 + 0.05) * vFade;
            gl_FragColor = vec4(col, a);
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={10} />;
}

export function Glints({ count = 44 }) {
  const geometry = useDisposable(() => {
    const rand = makeRandom(4242);
    const seed = new Float32Array(count * 4);
    const move = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      let x;
      let z;
      do {
        x = rand.range(-20, 20);
        z = rand.range(-18, 6);
      } while (Math.abs(x) < 4 && z > -3);
      seed.set([x, rand.range(0.5, 9), z, rand.range(0.25, 0.5)], i * 4);
      move.set([rand.range(1.2, 2.6), rand.range(0, 6.28), rand.range(0.2, 0.6), 0], i * 4);
    }
    return instanced(quad(), count, { aSeed: [4, seed], aMove: [4, move] });
  }, [count]);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: stageUniforms.uTime },
        vertexShader: /* glsl */ `
          attribute vec4 aSeed;
          attribute vec4 aMove;
          uniform float uTime;
          varying vec2 vUv;
          varying float vTw;
          void main() {
            vec3 c = aSeed.xyz + vec3(sin(uTime * 0.3 + aMove.y), sin(uTime * 0.25 + aMove.y * 2.0) * 0.6, cos(uTime * 0.2 + aMove.y)) * aMove.z;
            vTw = pow(0.5 + 0.5 * sin(uTime * aMove.x + aMove.y), 8.0);
            vec4 mv = viewMatrix * vec4(c, 1.0);
            mv.xy += position.xy * aSeed.w * (0.4 + 0.6 * vTw);
            gl_Position = projectionMatrix * mv;
            vUv = uv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          varying float vTw;
          void main() {
            vec2 p = vUv * 2.0 - 1.0;
            float star = max(0.0, 1.0 - abs(p.x) * 10.0 - abs(p.y) * 1.1) + max(0.0, 1.0 - abs(p.y) * 10.0 - abs(p.x) * 1.1);
            float core = exp(-dot(p, p) * 20.0);
            gl_FragColor = vec4(vec3(1.0, 0.97, 0.88) * (star * 0.8 + core) * vTw * 3.0, 1.0);
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={11} />;
}

export function FountainSpray() {
  const geometry = useDisposable(() => {
    const rand = makeRandom(99);
    const jets = [];
    const top = [FOUNTAIN.x, FOUNTAIN.y + 0.95, FOUNTAIN.z];
    for (let i = 0; i < 150; i++) {
      const a = rand.range(0, Math.PI * 2);
      const s = rand.range(0, 0.35);
      jets.push([...top, Math.cos(a) * s, rand.range(4.8, 5.4), Math.sin(a) * s, 1.25, rand.next()]);
    }
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const r = FOUNTAIN.r - 0.12;
      for (let i = 0; i < 26; i++) {
        const sp = rand.range(1.45, 1.65);
        jets.push([FOUNTAIN.x + Math.cos(a) * r, FOUNTAIN.y + 0.32, FOUNTAIN.z + Math.sin(a) * r, -Math.cos(a) * sp, rand.range(2.8, 3.1), -Math.sin(a) * sp, 0.7, rand.next()]);
      }
    }
    const n = jets.length;
    const origin = new Float32Array(n * 4);
    const vel = new Float32Array(n * 4);
    jets.forEach((j, i) => {
      origin.set([j[0], j[1], j[2], j[7]], i * 4);
      vel.set([j[3], j[4], j[5], j[6]], i * 4);
    });
    return instanced(quad(), n, { aOrigin: [4, origin], aVel: [4, vel] });
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: stageUniforms.uTime },
        vertexShader: /* glsl */ `
          attribute vec4 aOrigin;
          attribute vec4 aVel;
          uniform float uTime;
          varying vec2 vUv;
          varying float vFade;
          void main() {
            float life = aVel.w;
            float u = fract(uTime / life + aOrigin.w);
            float t = u * life;
            vec3 p = aOrigin.xyz + aVel.xyz * t + vec3(0.0, -4.9, 0.0) * t * t;
            vFade = smoothstep(0.0, 0.06, u) * smoothstep(1.0, 0.85, u);
            vec4 mv = viewMatrix * vec4(p, 1.0);
            mv.xy += position.xy * (0.07 + 0.05 * u);
            gl_Position = projectionMatrix * mv;
            vUv = uv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          varying float vFade;
          void main() {
            float d = length(vUv * 2.0 - 1.0);
            float a = smoothstep(1.0, 0.2, d) * vFade * 0.6;
            gl_FragColor = vec4(vec3(0.8, 0.96, 1.0) * 1.2, a);
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={9} />;
}

// Butterflies flitting around the planters: [cx, cy, cz, radius, color].
const BUTTERFLIES = [
  [-9.8, 1.2, -0.8, 1.6, '#3fd2ff'],
  [-10.6, 2.2, -2.0, 2.0, '#ffe14a'],
  [-6.5, 0.9, 5.6, 1.2, '#ff7fbf'],
  [12.0, 1.6, -4.2, 1.8, '#ffffff'],
  [9.6, 1.4, -1.6, 2.2, '#9be24a'],
  [6.8, 0.9, 5.2, 1.1, '#ffb347'],
];

export function Butterflies() {
  const geometry = useDisposable(() => {
    // Two wing quads hinged on the body axis (z); aSide = -1 left, +1 right.
    const pos = [];
    const side = [];
    const uv = [];
    for (const s of [-1, 1]) {
      const quadPts = [
        [0, -0.5],
        [s, -0.5],
        [s, 0.5],
        [0, 0.5],
      ];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const [x, z] = quadPts[i];
        pos.push(x, 0, z);
        side.push(s);
        uv.push(Math.abs(x), z + 0.5);
      }
    }
    const base = new THREE.BufferGeometry();
    base.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    base.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    base.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    const n = BUTTERFLIES.length;
    const center = new Float32Array(n * 4);
    const color = new Float32Array(n * 4);
    const c = new THREE.Color();
    BUTTERFLIES.forEach(([x, y, z, r, col], i) => {
      center.set([x, y, z, r], i * 4);
      c.set(col);
      color.set([c.r, c.g, c.b, i * 1.7], i * 4);
    });
    return instanced(base, n, { aCenter: [4, center], aColor: [4, color] });
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: stageUniforms.uTime },
        vertexShader: /* glsl */ `
          attribute float aSide;
          attribute vec4 aCenter;
          attribute vec4 aColor;
          uniform float uTime;
          varying vec2 vUv;
          varying vec3 vColor;
          vec3 path(float t, float ph, float r) {
            return vec3(sin(t * 0.7 + ph) * r, sin(t * 1.3 + ph * 2.0) * 0.45 + sin(t * 3.1 + ph) * 0.1, cos(t * 0.53 + ph * 1.3) * r * 0.7);
          }
          void main() {
            float ph = aColor.w;
            vec3 p = aCenter.xyz + path(uTime, ph, aCenter.w);
            vec3 ahead = aCenter.xyz + path(uTime + 0.1, ph, aCenter.w);
            vec2 dir = normalize(ahead.xz - p.xz + 1e-4);
            float flap = 0.25 + 1.0 * abs(sin(uTime * 13.0 + ph * 5.0));
            vec3 lp = position * 0.3;
            lp = vec3(lp.x * cos(flap), abs(lp.x) * sin(flap), lp.z);
            // Body axis (local z) follows the flight direction.
            vec3 fwd = vec3(dir.x, 0.0, dir.y);
            vec3 right = vec3(dir.y, 0.0, -dir.x);
            vec3 world = p + right * lp.x + vec3(0.0, lp.y, 0.0) + fwd * lp.z;
            gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
            vUv = uv;
            vColor = aColor.rgb;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vColor;
          void main() {
            // Fore and hind wing lobes with a pale rim and dark body edge.
            vec2 p = vUv;
            float fore = length((p - vec2(0.48, 0.66)) / vec2(0.5, 0.36));
            float hind = length((p - vec2(0.38, 0.3)) / vec2(0.36, 0.3));
            float d = min(fore, hind);
            if (d > 1.0) discard;
            vec3 col = mix(vColor * 1.25, vec3(1.2), smoothstep(0.7, 0.95, d) * 0.6);
            col *= mix(0.55, 1.0, smoothstep(0.0, 0.12, p.x));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={8} />;
}

// [position along the sun -> center -> mirror line, width, height, r, g, b, shape (0 glow, 1 disc, 2 ring, 3 streak)]
const FLARE = [
  [0, 0.6, 0.6, 1.0, 0.9, 0.7, 0],
  [0, 2.2, 0.03, 0.8, 0.9, 1.0, 3],
  [0.42, 0.16, 0.16, 0.3, 0.9, 1.0, 2],
  [0.68, 0.07, 0.07, 0.5, 1.0, 0.4, 1],
  [1.22, 0.12, 0.12, 0.5, 0.6, 1.0, 1],
  [1.45, 0.05, 0.05, 0.3, 1.0, 0.9, 1],
  [1.85, 0.34, 0.34, 0.6, 0.8, 1.0, 2],
];

export function LensFlare({ strength = 1 }) {
  const geometry = useDisposable(() => {
    const n = FLARE.length;
    const a = new Float32Array(n * 4);
    const b = new Float32Array(n * 4);
    FLARE.forEach((f, i) => {
      a.set([f[0], f[1], f[2], f[6]], i * 4);
      b.set([f[3], f[4], f[5], 0], i * 4);
    });
    return instanced(quad(), n, { aFlare: [4, a], aColor: [4, b] });
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uSun: { value: new THREE.Vector2() }, uVis: { value: 0 }, uAspect: { value: ASPECT } },
        vertexShader: /* glsl */ `
          attribute vec4 aFlare;
          attribute vec4 aColor;
          uniform vec2 uSun;
          uniform float uAspect;
          varying vec2 vUv;
          varying vec3 vColor;
          varying float vShape;
          void main() {
            vec2 c = mix(uSun, -uSun, aFlare.x * 0.5);
            gl_Position = vec4(c + position.xy * aFlare.yz * vec2(1.0 / uAspect, 1.0) * 2.0, 0.0, 1.0);
            vUv = uv;
            vColor = aColor.rgb;
            vShape = aFlare.w;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uVis;
          varying vec2 vUv;
          varying vec3 vColor;
          varying float vShape;
          void main() {
            vec2 p = vUv * 2.0 - 1.0;
            float d = length(p);
            float v;
            if (vShape < 0.5) v = pow(max(1.0 - d, 0.0), 3.0) * 0.25;
            else if (vShape < 1.5) v = smoothstep(1.0, 0.8, d) * 0.12;
            else if (vShape < 2.5) v = smoothstep(0.7, 0.85, d) * smoothstep(1.0, 0.9, d) * 0.1;
            else v = pow(max(1.0 - abs(p.x), 0.0), 2.0) * pow(max(1.0 - abs(p.y), 0.0), 1.5) * 0.3;
            gl_FragColor = vec4(vColor * v * uVis, 1.0);
          }
        `,
      }),
  );
  const sun = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    sun.copy(SUN_DIR).multiplyScalar(1000).add(camera.position).project(camera);
    const u = material.uniforms;
    u.uSun.value.set(sun.x, sun.y);
    u.uAspect.value = camera.aspect;
    const edge = Math.max(Math.abs(sun.x), Math.abs(sun.y));
    u.uVis.value = sun.z < 1 ? (1 - THREE.MathUtils.smoothstep(edge, 1.0, 1.8)) * strength : 0;
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={2000} />;
}

