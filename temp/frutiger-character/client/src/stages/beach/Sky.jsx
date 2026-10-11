import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ASPECT, beat, useDisposable } from '../shared/hooks.js';
import { makeCloudAtlas } from '../shared/Sky.jsx';
import { makeRandom } from '../shared/random.js';
import { noise } from '../shared/glsl.js';
import { SUN_DIR, world } from './palette.js';
import { skyGLSL, skyUniforms } from './shaders.js';

/** Sunset dome: banded gradient, pink cirrus, and a big warm sun just above the sea. */
export function SunsetSky({ radius = 2400 }) {
  const mesh = useRef();
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { ...skyUniforms(), uTime: world.uTime },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          ${skyGLSL}
          ${noise}
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            vec3 col = skyGradient(d);
            float h = d.y;
            // Thin cirrus streaks, lit pink away from the sun and gold toward it.
            if (h > 0.02) {
              vec2 p = d.xz / (h + 0.08);
              p = mat2(0.96, -0.28, 0.28, 0.96) * p;
              p.x += uTime * 0.01;
              float n = fbm(p * vec2(0.2, 1.2) + vec2(3.0, 7.0));
              float c = smoothstep(0.1, 0.6, n);
              c *= smoothstep(0.06, 0.16, h) * (1.0 - smoothstep(0.32, 0.6, h));
              float az = dot(normalize(d.xz), normalize(uSunDir.xz)) * 0.5 + 0.5;
              vec3 lit = mix(vec3(1.0, 0.36, 0.55), vec3(1.25, 0.72, 0.36), pow(az, 4.0));
              col = mix(col, lit, c * 0.35);
            }
            // Sun disc, slightly squashed by the low-angle atmosphere, with soft limb.
            vec3 right = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)));
            vec3 up = cross(right, uSunDir);
            vec2 q = vec2(dot(d, right), dot(d, up) * 1.12);
            float r = length(q) / 0.028;
            float disc = (1.0 - smoothstep(0.92, 1.0, r)) * step(0.0, dot(d, uSunDir));
            vec3 discCol = mix(vec3(1.0, 0.97, 0.85), vec3(1.0, 0.72, 0.42), smoothstep(0.2, 1.0, r));
            col = mix(col, discCol * 5.0, disc);
            col += sunHalo(d) * (1.0 - disc);
            // Below the horizon (hidden by the sea, but keeps edges seamless).
            col = mix(col, hazeColor(d), 1.0 - smoothstep(-0.02, 0.0, h));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
  );
  useFrame((state) => mesh.current.position.copy(state.camera.position));
  return (
    <mesh ref={mesh} material={material} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[radius, 64, 32]} />
    </mesh>
  );
}

/**
 * Camera-facing cumulus billboards drifting along +x. Sunset lighting: bases
 * glow gold/peach (lit from below), tops are cooler pink-lilac, and thin edges
 * near the sun catch a bright silver lining.
 */
export function SunsetClouds({ count = 16, center = [0, 160, -1100], area = [2600, 500], heightJitter = 50, size = [140, 320], speed = 3, seed = 3, opacity = 1, renderOrder = -500 }) {
  const texture = useDisposable(() => makeCloudAtlas(seed), [seed]);
  const geometry = useDisposable(() => {
    const rand = makeRandom(seed * 13 + 1);
    const plane = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.attributes.position = plane.attributes.position;
    g.attributes.uv = plane.attributes.uv;
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push({
        x: center[0] + rand.range(-0.5, 0.5) * area[0],
        y: center[1] + rand.range(-1, 1) * heightJitter,
        z: center[2] + rand.range(-0.5, 0.5) * area[1],
        s: rand.range(size[0], size[1]),
        cell: rand.int(0, 3),
        flip: rand.sign(),
      });
    }
    items.sort((a, b) => a.z - b.z);
    const offsets = new Float32Array(count * 3);
    const scales = new Float32Array(count * 2);
    const cells = new Float32Array(count);
    items.forEach((it, i) => {
      offsets.set([it.x, it.y, it.z], i * 3);
      scales.set([it.s * it.flip, it.s * 0.62], i * 2);
      cells[i] = it.cell;
    });
    g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    g.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 2));
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 1));
    g.instanceCount = count;
    return g;
  }, [count, seed]);

  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
        uniforms: {
          ...skyUniforms(),
          uTime: world.uTime,
          uMap: { value: texture },
          uSpeed: { value: speed },
          uMinX: { value: center[0] - area[0] / 2 },
          uWidth: { value: area[0] },
          uOpacity: { value: opacity },
          uUnderNear: { value: new THREE.Color('#ffa04a').multiplyScalar(1.15) },
          uUnderFar: { value: new THREE.Color('#ff7d98') },
          uTopNear: { value: new THREE.Color('#f2b0a8') },
          uTopFar: { value: new THREE.Color('#9c88d2') },
        },
        vertexShader: /* glsl */ `
          attribute vec3 aOffset;
          attribute vec2 aScale;
          attribute float aCell;
          uniform float uTime, uSpeed, uMinX, uWidth;
          varying vec2 vUv;
          varying float vFade;
          varying vec3 vWorld;
          void main() {
            vec3 c = aOffset;
            float x = mod(c.x - uMinX + uTime * uSpeed, uWidth);
            c.x = uMinX + x;
            vFade = smoothstep(0.0, 0.1, x / uWidth) * (1.0 - smoothstep(0.9, 1.0, x / uWidth));
            vec4 mv = modelViewMatrix * vec4(c, 1.0);
            mv.xy += position.xy * aScale;
            vWorld = c + vec3(position.xy * aScale, 0.0);
            gl_Position = projectionMatrix * mv;
            vec2 cell = vec2(mod(aCell, 2.0), 1.0 - floor(aCell / 2.0));
            vUv = (uv + cell) * 0.5;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform float uOpacity;
          uniform vec3 uUnderNear, uUnderFar, uTopNear, uTopFar;
          ${skyGLSL}
          varying vec2 vUv;
          varying float vFade;
          varying vec3 vWorld;
          void main() {
            vec4 t = texture2D(uMap, vUv);
            if (t.a < 0.004) discard;
            float light = clamp(t.r / t.a, 0.0, 1.0);
            vec3 dir = normalize(vWorld - cameraPosition);
            float az = dot(normalize(dir.xz), normalize(uSunDir.xz)) * 0.5 + 0.5;
            float sunward = pow(az, 3.0);
            vec3 base = mix(uUnderFar, uUnderNear, sunward);
            vec3 top = mix(uTopFar, uTopNear, sunward);
            vec3 col = mix(base, top, smoothstep(0.3, 1.0, light));
            // Silver lining on thin edges close to the sun.
            float edge = 1.0 - smoothstep(0.05, 0.7, t.a);
            float near = pow(max(dot(dir, uSunDir), 0.0), 30.0);
            col += uSunCol * edge * near * 3.0;
            col = mix(col, hazeColor(dir), 0.25 * (1.0 - smoothstep(0.02, 0.12, dir.y)));
            float a = t.a * vFade * uOpacity;
            gl_FragColor = vec4(col * a, a);
          }
        `,
      }),
    [texture],
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={renderOrder} />;
}

// Ghosts along the line from the sun through the screen center:
// [t along the line, size (NDC height), shape, r, g, b, alpha]; shape 0 disc, 1 ring, 2 hexagon, 3 starburst.
const GHOSTS = [
  [0.0, 0.3, 3, 1.0, 0.82, 0.55, 0.5],
  [0.34, 0.06, 2, 1.0, 0.7, 0.45, 0.22],
  [0.56, 0.035, 0, 0.55, 1.0, 0.85, 0.3],
  [0.8, 0.1, 1, 1.0, 0.6, 0.8, 0.16],
  [1.12, 0.05, 2, 0.55, 0.85, 1.0, 0.2],
  [1.36, 0.13, 0, 0.8, 0.6, 1.0, 0.07],
  [1.62, 0.07, 2, 1.0, 0.65, 0.75, 0.16],
  [1.95, 0.2, 1, 0.6, 0.9, 1.0, 0.08],
];

/** Screen-space Vista-style lens flare for the low sun (drawn before bloom so it glows). */
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
          uTime: world.uTime,
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
            // Ghosts pile up when the sun is near the middle of the frame; fade them there.
            float spread = aGhost.x > 0.0 ? smoothstep(0.35, 0.8, length(uSun)) : 1.0;
            vec2 q = position.xy * aGhost.y;
            if (aGhost.z > 2.5) q.x *= 4.0;
            q.x /= uAspect;
            vUv = uv;
            vColor = aColor * vec4(1.0, 1.0, 1.0, uVis * spread);
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
              a = (1.0 - smoothstep(0.74, 0.82, h)) * (0.55 + 0.45 * smoothstep(0.3, 0.8, h));
            } else {
              vec2 s = vec2(p.x * 4.0, p.y);
              float r = length(s);
              float ang = atan(s.y, s.x);
              float rays = pow(abs(cos(ang * 3.0 + uTime * 0.05)), 40.0) * exp(-r * 2.2) * 0.6;
              float streak = exp(-abs(p.y) * 40.0) * exp(-abs(p.x) * 3.2);
              a = rays + streak * 0.8 + exp(-r * r * 6.0) * 0.3;
            }
            a *= vColor.a * (0.9 + 0.2 * uPulse) * 1.8;
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
    u.uAspect.value = cam.aspect;
    const edge = Math.max(Math.abs(v.current.x), Math.abs(v.current.y));
    u.uVis.value = v.current.z < 1 ? THREE.MathUtils.clamp((1.15 - edge) / 0.4, 0, 1) : 0;
    u.uPulse.value = beat.pulse;
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={50} />;
}
