import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { makeCloudAtlas } from '../../shared/Sky.jsx';

/**
 * Variant of the shared CloudField: drifting cumulus billboards that thin
 * out as they pass in front of the sun (so the sun and its flare stay
 * visible), with a warm sunlit rim on the side facing the sun.
 */
export function MeadowClouds({
  count = 30,
  center = [0, 175, -700],
  area = [2200, 600],
  heightJitter = 45,
  size = [170, 360],
  speed = 4,
  seed = 5,
  lit = '#ffffff',
  shade = '#9dbfe6',
  rim = '#fff3d6',
  fogColor = '#d4eeff',
  fogNear = 500,
  fogFar = 1900,
  opacity = 1,
  sun = [0, 0.3, -1],
  renderOrder = -500,
}) {
  const texture = useDisposable(() => makeCloudAtlas(seed), [seed]);
  const geometry = useDisposable(() => {
    const rand = makeRandom(seed * 13 + 1);
    const plane = new THREE.PlaneGeometry(1, 1, 1, 1);
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
      scales.set([it.s * it.flip, it.s], i * 2);
      cells[i] = it.cell;
    });
    g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    g.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 2));
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 1));
    g.instanceCount = count;
    return g;
  }, [count, seed, ...center, ...area, heightJitter, ...size]);

  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
        uniforms: {
          uMap: { value: null },
          uTime: { value: 0 },
          uSpeed: { value: 0 },
          uMinX: { value: 0 },
          uWidth: { value: 1 },
          uLit: { value: new THREE.Color() },
          uShade: { value: new THREE.Color() },
          uRim: { value: new THREE.Color() },
          uFog: { value: new THREE.Color() },
          uFogNear: { value: 0 },
          uFogFar: { value: 1 },
          uOpacity: { value: 1 },
          uSun: { value: new THREE.Vector3() },
        },
        vertexShader: /* glsl */ `
          attribute vec3 aOffset;
          attribute vec2 aScale;
          attribute float aCell;
          uniform float uTime, uSpeed, uMinX, uWidth;
          uniform vec3 uSun;
          varying vec2 vUv;
          varying float vFade;
          varying float vDist;
          varying float vSunSide;
          varying vec3 vView;
          varying vec3 vSunView;
          void main() {
            vec3 c = aOffset;
            float x = mod(c.x - uMinX + uTime * uSpeed, uWidth);
            c.x = uMinX + x;
            vFade = smoothstep(0.0, 0.12, x / uWidth) * smoothstep(1.0, 0.88, x / uWidth);
            vec4 mv = modelViewMatrix * vec4(c, 1.0);
            vec3 sunView = normalize((viewMatrix * vec4(uSun, 0.0)).xyz);
            vSunView = sunView;
            // Which side of the cloud faces the sun (screen-space).
            vec2 toSun = sunView.xy / max(-sunView.z, 0.05) - mv.xy / max(-mv.z, 0.05);
            vSunSide = dot(normalize(position.xy * sign(aScale)), normalize(toSun + 1e-4));
            mv.xy += position.xy * aScale;
            vView = mv.xyz;
            vDist = -mv.z;
            gl_Position = projectionMatrix * mv;
            vec2 cell = vec2(mod(aCell, 2.0), 1.0 - floor(aCell / 2.0));
            vUv = (uv + cell) * 0.5;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform vec3 uLit, uShade, uRim, uFog;
          uniform float uFogNear, uFogFar, uOpacity;
          varying vec2 vUv;
          varying float vFade;
          varying float vDist;
          varying float vSunSide;
          varying vec3 vView;
          varying vec3 vSunView;
          void main() {
            vec4 t = texture2D(uMap, vUv);
            float vSunGlow = smoothstep(0.988, 0.9993, dot(normalize(vView), normalize(vSunView)));
            if (t.a < 0.004) discard;
            float light = clamp(t.r / t.a, 0.0, 1.0);
            vec3 col = mix(uShade, uLit, smoothstep(0.35, 1.0, light));
            // Warm silver lining toward the sun on the thin edges.
            float edge = 1.0 - smoothstep(0.15, 0.85, t.a);
            col += uRim * edge * smoothstep(0.0, 1.0, vSunSide) * 0.35;
            col = mix(col, uFog, smoothstep(uFogNear, uFogFar, vDist));
            // Thin out in front of the sun so it keeps shining through.
            col += uRim * vSunGlow * 0.6;
            float a = t.a * vFade * uOpacity * (1.0 - 0.82 * vSunGlow);
            gl_FragColor = vec4(col * a, a);
          }
        `,
      }),
  );

  const u = material.uniforms;
  u.uMap.value = texture;
  u.uSpeed.value = speed;
  u.uMinX.value = center[0] - area[0] / 2;
  u.uWidth.value = area[0];
  u.uLit.value.set(lit);
  u.uShade.value.set(shade);
  u.uRim.value.set(rim);
  u.uFog.value.set(fogColor);
  u.uFogNear.value = fogNear;
  u.uFogFar.value = fogFar;
  u.uOpacity.value = opacity;
  u.uSun.value.set(...sun).normalize();

  useFrame((state) => {
    u.uTime.value = state.clock.elapsedTime;
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={renderOrder} />;
}
