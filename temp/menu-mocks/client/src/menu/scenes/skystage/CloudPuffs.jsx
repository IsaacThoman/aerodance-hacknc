import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { makeCloudAtlas } from '../../shared/Sky.jsx';
import { CLOUD_Y } from './palette.js';
import { makeSkyUniforms, skyFunction, skyUniformsDecl } from './GoldenSky.jsx';

const DRIFT = 0.9; // world units / second, matches the cloud sea drift
const WRAP = 2600;

/**
 * Camera-facing cumulus billboards sitting in the cloud sea: they give the
 * sea rolling silhouettes, plus a ring of towering clouds on the horizon.
 * Side-lit from the sun's screen direction with golden rims when backlit.
 */
export function CloudPuffs({ count = 230, towers = 26, seed = 11, camera = [0, 4, 20] }) {
  const texture = useDisposable(() => makeCloudAtlas(seed, 384), [seed]);
  const geometry = useDisposable(() => {
    const rand = makeRandom(seed * 7 + 3);
    const plane = new THREE.PlaneGeometry(1, 1, 1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.attributes.position = plane.attributes.position;
    g.attributes.uv = plane.attributes.uv;
    const items = [];
    const place = (r, angle, s, lift) => {
      items.push({
        x: Math.sin(angle) * r,
        z: -Math.cos(angle) * r,
        y: CLOUD_Y + s * lift,
        s,
        cell: rand.int(0, 3),
        flip: rand.sign(),
        seed: rand.next(),
      });
    };
    for (let i = 0; i < count; i++) {
      const u = rand.next();
      const r = 40 + 1150 * Math.pow(u, 1.25);
      const angle = rand.range(-1.15, 1.15);
      const s = (14 + r * 0.11) * rand.range(0.7, 1.35);
      place(r, angle, s, rand.range(0.02, 0.16));
    }
    for (let i = 0; i < towers; i++) {
      const r = rand.range(1300, 1900);
      const angle = rand.range(-1.0, 1.0);
      const s = rand.range(260, 560);
      place(r, angle, s, rand.range(0.05, 0.2));
    }
    const [cx, , cz] = camera;
    items.sort((a, b) => Math.hypot(b.x - cx, b.z - cz) - Math.hypot(a.x - cx, a.z - cz));
    const n = items.length;
    const offsets = new Float32Array(n * 3);
    const scales = new Float32Array(n * 2);
    const cells = new Float32Array(n * 2);
    items.forEach((it, i) => {
      offsets.set([it.x, it.y, it.z], i * 3);
      scales.set([it.s * it.flip, it.s], i * 2);
      cells.set([it.cell, it.seed], i * 2);
    });
    g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    g.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 2));
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    g.instanceCount = n;
    return g;
  }, [count, towers, seed]);

  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
        uniforms: {
          ...makeSkyUniforms(),
          uMap: { value: texture },
          uTime: { value: 0 },
          uLit: { value: new THREE.Color('#ffe0c8') },
          uShade: { value: new THREE.Color('#9a8ad6') },
          uGlowCol: { value: new THREE.Color('#ffd49a') },
          uSeaY: { value: CLOUD_Y },
        },
        vertexShader: /* glsl */ `
          attribute vec3 aOffset;
          attribute vec2 aScale;
          attribute vec2 aCell;
          uniform float uTime;
          uniform vec3 uSunDir;
          varying vec2 vUv;
          varying vec2 vLocal;
          varying float vDist;
          varying float vSunX;
          varying float vToward;
          varying float vWorldY;
          varying float vFade;
          varying vec3 vViewDir;
          varying float vSize;
          void main() {
            vec3 c = aOffset;
            float x = mod(c.x + uTime * ${DRIFT.toFixed(2)} + ${(WRAP / 2).toFixed(1)}, ${WRAP.toFixed(1)}) - ${(WRAP / 2).toFixed(1)};
            vFade = 1.0 - smoothstep(${(WRAP / 2 - 260).toFixed(1)}, ${(WRAP / 2).toFixed(1)}, abs(x));
            c.x = x;
            // Gentle billowing.
            float breathe = 1.0 + 0.03 * sin(uTime * 0.3 + aCell.y * 40.0);
            vec4 mv = modelViewMatrix * vec4(c, 1.0);
            vec2 local = position.xy * aScale * breathe;
            mv.xy += local;
            vDist = -mv.z;
            vWorldY = c.y + local.y;
            vSize = aScale.y;
            gl_Position = projectionMatrix * mv;
            vec2 cell = vec2(mod(aCell.x, 2.0), 1.0 - floor(aCell.x / 2.0));
            vUv = (uv + cell) * 0.5;
            vLocal = vec2(aScale.x < 0.0 ? 1.0 - uv.x : uv.x, uv.y);
            vec3 viewSun = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
            vSunX = viewSun.x * sign(aScale.x);
            vec3 worldDir = normalize(c - cameraPosition);
            vViewDir = worldDir;
            vToward = max(dot(worldDir, uSunDir), 0.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform vec3 uLit, uShade, uGlowCol;
          uniform float uSeaY;
          ${skyUniformsDecl}
          varying vec2 vUv;
          varying vec2 vLocal;
          varying float vDist;
          varying float vSunX;
          varying float vToward;
          varying float vWorldY;
          varying float vFade;
          varying vec3 vViewDir;
          varying float vSize;
          ${skyFunction}
          void main() {
            vec4 t = texture2D(uMap, vUv);
            if (t.a < 0.004) discard;
            float top = clamp(t.r / t.a, 0.0, 1.0);
            float side = clamp(0.5 + (vLocal.x - 0.5) * 1.8 * vSunX, 0.0, 1.0);
            float L = top * 0.7 + side * 0.45 - 0.1;
            vec3 col = mix(uShade, uLit, smoothstep(0.15, 1.0, L));
            // Golden rim on thin edges, strongest when looking toward the sun.
            float thin = 1.0 - smoothstep(0.15, 0.85, t.a);
            float toward = clamp(vToward, 0.0, 1.0);
            col += uGlowCol * (pow(toward, 6.0) * 1.3 + 0.1) * thin;
            col += uGlowCol * pow(toward, 12.0) * 0.2;
            // Haze into the horizon.
            vec3 hd = normalize(vec3(vViewDir.x, 0.0, vViewDir.z));
            vec3 horizon = skyGradient(vec3(hd.x, 0.004, hd.z)) + sunLight(normalize(vec3(hd.x, 0.02, hd.z)), 0.0) * 0.6;
            float fog = 1.0 - exp(-pow(vDist * 0.0011, 1.5));
            col = mix(col, horizon, clamp(fog * 0.92, 0.0, 1.0));
            // Sink the base softly into the sea.
            float sink = smoothstep(uSeaY - vSize * 0.02, uSeaY + vSize * 0.14, vWorldY);
            float a = t.a * sink * vFade;
            gl_FragColor = vec4(col * a, a);
          }
        `,
      }),
  );

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={-10} />;
}
