import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { causticsGLSL, waterGLSL } from './shaders.js';
import { CAMERA, SUN_TRAVEL, SURFACE_Y } from './constants.js';

// Returns a test: would a shaft from (x, SURFACE_Y, z) cross the dancers on
// screen? Additive light over the transparent dancers washes them out.
function makeShaftTest() {
  const cam = new THREE.PerspectiveCamera(CAMERA.fov, 16 / 9, 0.1, 500);
  cam.position.set(...CAMERA.position);
  cam.lookAt(...CAMERA.target);
  cam.updateMatrixWorld();
  const dir = new THREE.Vector3(...SUN_TRAVEL).normalize();
  const p = new THREE.Vector3();
  return (x, z) => {
    for (let k = 0; k <= 10; k++) {
      p.set(x, SURFACE_Y, z).addScaledVector(dir, k * 1.5).project(cam);
      if (p.z < 1 && Math.abs(p.x) < 0.62 && p.y > -0.5 && p.y < 0.4) return true;
    }
    return false;
  };
}

/**
 * Open water all around: blue gradient by view direction, a glow toward the
 * sun, and the rippling bright underside of the surface above with Snell's
 * window. Follows the camera.
 */
export function WaterBackground({ shared }) {
  const mesh = useRef();
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { ...shared },
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uUnderSun;
          uniform float uTime;
          uniform float uSurfaceY;
          ${waterGLSL}
          ${causticsGLSL}
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            vec3 c = waterBg(d.y);
            float s = max(dot(d, -uUnderSun), 0.0);
            c += vec3(0.55, 0.95, 1.0) * (pow(s, 4.0) * 0.3 + pow(s, 30.0) * 0.8);
            if (d.y > 0.015) {
              float t = (uSurfaceY - cameraPosition.y) / d.y;
              vec2 p = cameraPosition.xz + d.xz * t;
              float fade = exp(-t * 0.018);
              float w = causticPattern(p * 0.075 + vec2(uTime * 0.012, 0.0), uTime * 0.22);
              float w2 = causticPattern(p * 0.16 + 0.31, uTime * 0.31 + 4.0);
              float ripple = (w * 0.8 + w2 * 0.45) * fade;
              float snell = smoothstep(0.6, 0.78, d.y);
              vec3 under = uWaterTop * 1.18 + vec3(0.65, 1.0, 1.0) * ripple;
              vec3 window = vec3(1.7, 2.1, 2.2) * (0.9 + 0.5 * ripple);
              vec3 surf = mix(under, window, snell);
              float fog = 1.0 - exp(-max(t - 4.0, 0.0) * uWaterDensity * 0.85);
              c = mix(surf, c, fog);
            }
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      }),
  );
  useFrame((state) => mesh.current.position.copy(state.camera.position));
  return (
    <mesh ref={mesh} material={material} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[400, 48, 24]} />
    </mesh>
  );
}

/** Shimmering light shafts slanting down from the surface. */
export function GodRays({ shared, count = 22 }) {
  const geometry = useDisposable(() => {
    const plane = new THREE.PlaneGeometry(1, 1, 1, 8);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.setAttribute('position', plane.attributes.position);
    const rand = makeRandom(8);
    const data = new Float32Array(count * 4);
    const shaftCrossesDancers = makeShaftTest();
    for (let i = 0; i < count; i++) {
      let x;
      let z;
      do {
        x = rand.range(-34, 30);
        z = rand.range(-44, -2);
      } while (shaftCrossesDancers(x, z));
      data.set([x, z, rand.range(1.4, 4.2), rand.next()], i * 4);
    }
    g.setAttribute('aRay', new THREE.InstancedBufferAttribute(data, 4));
    g.instanceCount = count;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { ...shared, uIntensity: { value: 0.6 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          uniform float uTime;
          uniform float uSurfaceY;
          uniform vec3 uUnderSun;
          attribute vec4 aRay;
          varying vec2 vUv;
          varying float vFade;
          varying float vPhase;
          void main() {
            vec3 dir = normalize(uUnderSun);
            vec3 top = vec3(aRay.x + sin(uTime * 0.11 + aRay.w * 6.0) * 1.2, uSurfaceY, aRay.y);
            float len = 15.0;
            float along = 0.5 - position.y;
            vec3 mid = top + dir * len * 0.5;
            vec3 side = normalize(cross(dir, normalize(cameraPosition - mid)));
            float w = aRay.z * (1.0 + along * 0.8) * (0.8 + 0.2 * sin(uTime * 0.37 + aRay.w * 11.0));
            vec3 wp = top + dir * along * len + side * position.x * w;
            vUv = vec2(position.x + 0.5, along);
            vPhase = aRay.w;
            vec4 mv = viewMatrix * vec4(wp, 1.0);
            vFade = exp(-length(mv.xyz) * 0.022) * smoothstep(3.0, 9.0, -mv.z);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uIntensity;
          uniform float uBeat;
          varying vec2 vUv;
          varying float vFade;
          varying float vPhase;
          void main() {
            float across = sin(3.14159 * vUv.x);
            across *= across;
            float along = smoothstep(0.0, 0.08, vUv.y) * pow(1.0 - vUv.y, 1.3);
            float flicker = 0.45 + 0.55 * sin(uTime * (0.45 + vPhase * 0.6) + vPhase * 20.0);
            float streak = 0.7 + 0.3 * sin(vUv.x * 9.0 + uTime * 0.8 + vPhase * 7.0);
            float a = across * along * flicker * streak * vFade * uIntensity * (1.0 + uBeat * 0.1);
            gl_FragColor = vec4(vec3(0.7, 0.98, 1.0) * a, 1.0);
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={20} />;
}

/**
 * Rising bubbles: columns from vents (x, y, z, rate) plus loose singles.
 * Shaded as glassy rims with a sparkling highlight.
 */
export function Bubbles({ shared, sources, loose = 60 }) {
  const geometry = useDisposable(() => {
    const ico = new THREE.IcosahedronGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', ico.attributes.position);
    const rand = makeRandom(31);
    const items = [];
    for (const v of sources) {
      const n = v.count ?? 16;
      for (let i = 0; i < n; i++) {
        items.push([v.x + rand.range(-0.08, 0.08), v.z + rand.range(-0.08, 0.08), rand.range(0.8, 1.4), rand.range(0.05, 0.13) * (v.size ?? 1), rand.next(), v.y, v.top ?? 9.4]);
      }
    }
    for (let i = 0; i < loose; i++) {
      items.push([rand.range(-16, 16), rand.range(-24, 9), rand.range(0.5, 1.0), rand.range(0.04, 0.1), rand.next(), -0.6, 9.4]);
    }
    const a = new Float32Array(items.length * 4);
    const b = new Float32Array(items.length * 4);
    items.forEach(([x, z, speed, size, phase, y0, y1], i) => {
      a.set([x, z, speed, size], i * 4);
      b.set([phase, 0, y0, y1], i * 4);
    });
    g.setAttribute('aB', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aB2', new THREE.InstancedBufferAttribute(b, 4));
    g.instanceCount = items.length;
    ico.dispose();
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { ...shared },
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        vertexShader: /* glsl */ `
          uniform float uTime;
          attribute vec4 aB;
          attribute vec4 aB2;
          varying vec3 vN;
          varying vec3 vWorld;
          varying float vA;
          void main() {
            float span = aB2.w - aB2.z;
            float prog = fract(uTime * aB.z / span + aB2.x);
            float y = aB2.z + prog * span;
            float wob = sin(uTime * 3.1 + aB2.x * 30.0) * 0.08 * (0.4 + prog);
            vec3 c = vec3(aB.x + wob, y, aB.y + cos(uTime * 2.6 + aB2.x * 20.0) * 0.06);
            float s = aB.w * (0.75 + 0.6 * prog);
            vec3 p = position * s * vec3(1.0 + 0.08 * sin(uTime * 9.0 + aB2.x * 10.0), 0.84, 1.0);
            vec4 wp = vec4(c + p, 1.0);
            vWorld = wp.xyz;
            vN = normalize(position);
            vA = smoothstep(0.0, 0.03, prog) * (1.0 - smoothstep(0.93, 1.0, prog));
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          ${waterGLSL}
          varying vec3 vN;
          varying vec3 vWorld;
          varying float vA;
          void main() {
            vec3 n = normalize(vN);
            vec3 v = normalize(cameraPosition - vWorld);
            float ndv = abs(dot(n, v));
            float rim = pow(1.0 - ndv, 2.0);
            vec3 L = normalize(vec3(-0.3, 1.0, 0.35));
            float spec = pow(max(dot(reflect(-v, n), L), 0.0), 24.0);
            vec3 col = vec3(0.75, 1.0, 1.0) * rim * 1.3 + vec3(2.6) * spec;
            float a = clamp(rim * 0.75 + spec * 0.8 + 0.05, 0.0, 1.0) * vA;
            float k = 1.0 - waterFogAmount(length(cameraPosition - vWorld));
            gl_FragColor = vec4(col * a * k, a * k);
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={30} />;
}

/** Drifting marine snow / plankton motes, wrapped in a box around the camera. */
export function MarineSnow({ shared, count = 700 }) {
  const geometry = useDisposable(() => {
    const g = new THREE.BufferGeometry();
    const rand = makeRandom(55);
    const p = new Float32Array(count * 3);
    const a = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      p.set([rand.range(-22, 22), rand.range(-1, 10), rand.range(-40, 6)], i * 3);
      a.set([rand.next(), rand.chance(0.05) ? rand.range(2.5, 4) : rand.range(0.7, 1.5)], i * 2);
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aP', new THREE.BufferAttribute(a, 2));
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { ...shared },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          uniform float uTime;
          attribute vec2 aP;
          varying float vAlpha;
          varying float vBokeh;
          void main() {
            vec3 p = position + vec3(
              sin(uTime * 0.21 + aP.x * 10.0) * 0.6 + uTime * 0.1,
              -uTime * 0.05 + sin(uTime * 0.33 + aP.x * 7.0) * 0.3,
              cos(uTime * 0.17 + aP.x * 5.0) * 0.6
            );
            vec3 box = vec3(44.0, 11.0, 46.0);
            vec3 origin = vec3(cameraPosition.x, 4.0, cameraPosition.z - 20.0);
            p = origin + mod(p - origin + box * 0.5, box) - box * 0.5;
            vec4 mv = viewMatrix * vec4(p, 1.0);
            float dist = max(-mv.z, 0.1);
            float size = aP.y * 110.0 / dist;
            vBokeh = smoothstep(4.0, 14.0, size);
            gl_PointSize = clamp(size, 1.0, 20.0);
            float tw = 0.6 + 0.4 * sin(uTime * (1.0 + aP.x * 2.0) + aP.x * 50.0);
            vAlpha = tw * exp(-dist * 0.04) * smoothstep(0.8, 2.0, dist) * mix(0.55, 0.12, vBokeh);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vAlpha;
          varying float vBokeh;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            float disc = smoothstep(1.0, 0.75, d);
            float core = mix(exp(-d * d * 4.0), 0.6 + 0.4 * smoothstep(0.5, 0.95, d), vBokeh);
            gl_FragColor = vec4(vec3(0.85, 1.0, 1.0) * disc * core * vAlpha, 1.0);
          }
        `,
      }),
  );
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={40} />;
}

/** Four-point star glints that flash briefly at fixed points (dome glass, chrome, bubbles). */
export function Sparkles({ shared, points, size = 1 }) {
  const geometry = useDisposable(() => {
    const g = new THREE.BufferGeometry();
    const rand = makeRandom(101);
    const p = new Float32Array(points.length * 3);
    const a = new Float32Array(points.length * 2);
    points.forEach((pt, i) => {
      p.set(pt, i * 3);
      a.set([rand.next(), rand.range(0.7, 1.3) * size], i * 2);
    });
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aS', new THREE.BufferAttribute(a, 2));
    return g;
  }, [points, size]);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { ...shared },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          uniform float uTime;
          uniform float uBeat;
          attribute vec2 aS;
          varying float vA;
          varying float vRot;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            float cyc = fract(uTime * (0.16 + aS.x * 0.14) + aS.x * 7.0);
            float flash = smoothstep(0.0, 0.05, cyc) * smoothstep(0.2, 0.05, cyc);
            vA = flash * (0.8 + 0.4 * uBeat);
            vRot = aS.x * 0.6;
            gl_PointSize = clamp(aS.y * (0.5 + 0.8 * flash) * 260.0 / max(-mv.z, 0.5), 0.0, 48.0);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vA;
          varying float vRot;
          void main() {
            vec2 p = gl_PointCoord - 0.5;
            float c = cos(vRot), s = sin(vRot);
            p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
            float star = exp(-abs(p.x) * 60.0) * exp(-abs(p.y) * 5.0) + exp(-abs(p.y) * 60.0) * exp(-abs(p.x) * 5.0);
            float core = exp(-dot(p, p) * 90.0);
            float k = (star * 0.9 + core * 1.6) * vA;
            gl_FragColor = vec4(vec3(0.85, 1.0, 1.0) * k * 3.0, 1.0);
          }
        `,
      }),
  );
  if (!points.length) return null;
  return <points name="sparkles" geometry={geometry} material={material} frustumCulled={false} renderOrder={45} />;
}
