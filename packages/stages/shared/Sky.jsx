import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from './hooks.js';
import { makeRandom } from './random.js';
import { noise } from './glsl.js';

/**
 * Infinite gradient sky dome with a sun disc + glow. Follows the camera.
 * Colors are hex strings; intensities > 1 feed bloom.
 */
export function SkyDome({
  top = '#1572d8',
  horizon = '#c4ecff',
  bottom = '#eaf8ff',
  exponent = 0.55,
  sunDirection = [0.35, 0.3, -1],
  sunColor = '#fff4d6',
  sunDisc = 6,
  sunGlow = 1,
  sunSize = 1,
  stars = 0,
  radius = 1800,
}) {
  const mesh = useRef();
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uBottom: { value: new THREE.Color() },
          uSunColor: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3() },
          uExponent: { value: 0.5 },
          uSunDisc: { value: 1 },
          uSunGlow: { value: 1 },
          uSunSize: { value: 1 },
          uStars: { value: 0 },
          uTime: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop, uHorizon, uBottom, uSunColor, uSunDir;
          uniform float uExponent, uSunDisc, uSunGlow, uSunSize, uStars, uTime;
          varying vec3 vDir;
          ${noise}
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 col = h >= 0.0
              ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), uExponent))
              : mix(uHorizon, uBottom, pow(clamp(-h * 3.0, 0.0, 1.0), 0.6));
            float s = max(dot(d, normalize(uSunDir)), 0.0);
            float disc = smoothstep(1.0 - 0.0009 * uSunSize, 1.0 - 0.0006 * uSunSize, s);
            col += uSunColor * (disc * uSunDisc + pow(s, 64.0 / uSunSize) * 0.6 * uSunGlow + pow(s, 8.0) * 0.25 * uSunGlow);
            if (uStars > 0.0) {
              vec3 p = d * 300.0;
              vec3 cell = floor(p);
              float rnd = hash12(cell.xy + cell.z * 17.0);
              vec3 local = fract(p) - 0.5;
              float star = smoothstep(0.08, 0.0, length(local)) * step(0.985, rnd);
              float tw = 0.6 + 0.4 * sin(uTime * (1.0 + rnd * 3.0) + rnd * 40.0);
              col += vec3(star * tw * uStars) * smoothstep(-0.05, 0.2, h);
            }
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
  );

  const u = material.uniforms;
  u.uTop.value.set(top);
  u.uHorizon.value.set(horizon);
  u.uBottom.value.set(bottom);
  u.uSunColor.value.set(sunColor);
  u.uSunDir.value.set(...sunDirection).normalize();
  u.uExponent.value = exponent;
  u.uSunDisc.value = sunDisc;
  u.uSunGlow.value = sunGlow;
  u.uSunSize.value = sunSize;
  u.uStars.value = stars;

  useFrame((state) => {
    mesh.current.position.copy(state.camera.position);
    u.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh ref={mesh} material={material} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[radius, 48, 24]} />
    </mesh>
  );
}

/**
 * 2x2 atlas of fluffy cumulus clouds. RGB (premultiplied) encodes lighting
 * (1 = sunlit top, 0 = shaded underside); alpha encodes density.
 */
export function makeCloudAtlas(seed = 7, cell = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = cell * 2;
  canvas.height = cell * 2;
  const ctx = canvas.getContext('2d');
  const rand = makeRandom(seed);
  for (let i = 0; i < 4; i++) {
    const ox = (i % 2) * cell;
    const oy = Math.floor(i / 2) * cell;
    const layer = document.createElement('canvas');
    layer.width = cell;
    layer.height = cell;
    const l = layer.getContext('2d');
    const base = cell * 0.7;
    const puffs = [];
    const spread = cell * (0.28 + 0.08 * (i % 2));
    for (let p = 0; p < 34; p++) {
      const t = rand.range(-1, 1);
      const x = cell / 2 + t * spread;
      const hump = Math.cos(t * Math.PI * 0.5);
      const r = cell * rand.range(0.07, 0.13) * (0.6 + hump * 0.7);
      const y = base - r * 0.6 - rand.range(0, 1) * hump * cell * 0.24;
      puffs.push({ x, y, r });
    }
    // Lower puffs first so higher, sunlit ones overlap them.
    puffs.sort((a, b) => b.y - a.y);
    for (const { x, y, r } of puffs) {
      const g = l.createRadialGradient(x - r * 0.25, y - r * 0.4, r * 0.05, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.55, 'rgba(225,225,225,1)');
      g.addColorStop(0.85, 'rgba(150,150,150,0.9)');
      g.addColorStop(1, 'rgba(120,120,120,0)');
      l.fillStyle = g;
      l.beginPath();
      l.arc(x, y, r, 0, Math.PI * 2);
      l.fill();
    }
    // Shade the underside and flatten the base.
    l.globalCompositeOperation = 'source-atop';
    const shade = l.createLinearGradient(0, base - cell * 0.18, 0, base + cell * 0.05);
    shade.addColorStop(0, 'rgba(90,90,90,0)');
    shade.addColorStop(1, 'rgba(90,90,90,0.75)');
    l.fillStyle = shade;
    l.fillRect(0, 0, cell, cell);
    l.globalCompositeOperation = 'destination-out';
    const cut = l.createLinearGradient(0, base - cell * 0.03, 0, base + cell * 0.06);
    cut.addColorStop(0, 'rgba(0,0,0,0)');
    cut.addColorStop(1, 'rgba(0,0,0,1)');
    l.fillStyle = cut;
    l.fillRect(0, 0, cell, cell);
    ctx.drawImage(layer, ox, oy);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.premultiplyAlpha = true;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/**
 * Field of camera-facing cumulus billboards drifting along +x and wrapping.
 * center/area define the box clouds live in: area = [width, depth].
 */
export function CloudField({
  count = 40,
  center = [0, 120, -400],
  area = [1400, 600],
  heightJitter = 40,
  size = [120, 260],
  speed = 4,
  seed = 3,
  lit = '#ffffff',
  shade = '#9fbde0',
  fogColor = '#cfeeff',
  fogNear = 300,
  fogFar = 1500,
  opacity = 1,
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
      const s = rand.range(size[0], size[1]);
      items.push({
        x: center[0] + rand.range(-0.5, 0.5) * area[0],
        y: center[1] + rand.range(-1, 1) * heightJitter,
        z: center[2] + rand.range(-0.5, 0.5) * area[1],
        s,
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
          uFog: { value: new THREE.Color() },
          uFogNear: { value: 0 },
          uFogFar: { value: 1 },
          uOpacity: { value: 1 },
        },
        vertexShader: /* glsl */ `
          attribute vec3 aOffset;
          attribute vec2 aScale;
          attribute float aCell;
          uniform float uTime, uSpeed, uMinX, uWidth;
          varying vec2 vUv;
          varying float vFade;
          varying float vDist;
          void main() {
            vec3 c = aOffset;
            float x = mod(c.x - uMinX + uTime * uSpeed, uWidth);
            c.x = uMinX + x;
            vFade = smoothstep(0.0, 0.12, x / uWidth) * smoothstep(1.0, 0.88, x / uWidth);
            vec4 mv = modelViewMatrix * vec4(c, 1.0);
            mv.xy += position.xy * aScale;
            vDist = -mv.z;
            gl_Position = projectionMatrix * mv;
            // Canvas rows run top-down; texture v runs bottom-up.
            vec2 cell = vec2(mod(aCell, 2.0), 1.0 - floor(aCell / 2.0));
            vUv = (uv + cell) * 0.5;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform vec3 uLit, uShade, uFog;
          uniform float uFogNear, uFogFar, uOpacity;
          varying vec2 vUv;
          varying float vFade;
          varying float vDist;
          void main() {
            vec4 t = texture2D(uMap, vUv);
            if (t.a < 0.004) discard;
            float light = clamp(t.r / t.a, 0.0, 1.0);
            vec3 col = mix(uShade, uLit, smoothstep(0.35, 1.0, light));
            col = mix(col, uFog, smoothstep(uFogNear, uFogFar, vDist));
            float a = t.a * vFade * uOpacity;
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
  u.uFog.value.set(fogColor);
  u.uFogNear.value = fogNear;
  u.uFogFar.value = fogFar;
  u.uOpacity.value = opacity;

  useFrame((state) => {
    u.uTime.value = state.clock.elapsedTime;
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={renderOrder} />;
}

export function useSunDirection(elevationDeg, azimuthDeg) {
  return useMemo(() => {
    const e = THREE.MathUtils.degToRad(elevationDeg);
    const a = THREE.MathUtils.degToRad(azimuthDeg);
    return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
  }, [elevationDeg, azimuthDeg]);
}
