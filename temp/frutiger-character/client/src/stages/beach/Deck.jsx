import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { beat, useDisposable } from '../shared/hooks.js';
import { hash, simplex } from '../shared/glsl.js';
import { DECK_R, world } from './palette.js';
import { patchMaterial, skyGLSL, skyUniforms } from './shaders.js';
import { sandHeight } from './terrain.js';
import { finalize, lathe, merge, place, taperedTube } from './geometry.js';
import { PALMS, TORCHES } from './layout.js';

// Lamp posts on the deck rim, and where the string lights hang from.
const POST_H = 4.3;
const POSTS = [
  [-4.6, 1.85],
  [-3.75, -3.2],
  [3.75, -3.2],
  [4.6, 1.85],
];
const lampTop = ([x, z]) => new THREE.Vector3(x, POST_H + 0.05, z);
const palmAnchor = (p, y) => new THREE.Vector3(p.x + Math.cos(p.heading) * 0.25, y, p.z + Math.sin(p.heading) * 0.25);
// String light spans: [from, to, sag, bulbs].
const SPANS = [
  [lampTop(POSTS[0]), lampTop(POSTS[1]), 0.7, 11],
  [lampTop(POSTS[1]), lampTop(POSTS[2]), 0.9, 15],
  [lampTop(POSTS[2]), lampTop(POSTS[3]), 0.7, 11],
  [lampTop(POSTS[0]), palmAnchor(PALMS[0], 5.6), 0.9, 10],
  [lampTop(POSTS[3]), palmAnchor(PALMS[1], 5.8), 0.9, 10],
];
const BULB_COLORS = ['#ffd9a0', '#ff9fb8', '#8ff0ff', '#ffe58a', '#b8ff9a'];
// Glass float-lanterns bobbing in the shallows: x, z, color.
const FLOATS = [
  [-5.3, -6.6, '#ffc070'],
  [-7.6, -10.2, '#ff9fc0'],
  [6.1, -7.3, '#8ff0ff'],
  [8.3, -11.2, '#ffc070'],
  [-0.9, -14.5, '#ffe08a'],
  [1.6, -19, '#ff9fc0'],
];

function catenary(a, b, sag, t, out) {
  out.lerpVectors(a, b, t);
  out.y -= sag * 4 * t * (1 - t);
  return out;
}

/** Pearl-white round deck top: radial planks, aqua inlay rings and a sun medallion. */
function makeDeckTexture(size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const m = size / 2;
  const R = m;
  const bg = ctx.createRadialGradient(m, m, 0, m, m, R);
  bg.addColorStop(0, '#fffdf8');
  bg.addColorStop(0.7, '#f6f1e8');
  bg.addColorStop(1, '#ede6da');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  // Radial plank seams.
  ctx.strokeStyle = 'rgba(150,135,115,0.28)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const r0 = (i % 2 ? 0.33 : 0.26) * R;
    ctx.beginPath();
    ctx.moveTo(m + Math.cos(a) * r0, m + Math.sin(a) * r0);
    ctx.lineTo(m + Math.cos(a) * R * 0.93, m + Math.sin(a) * R * 0.93);
    ctx.stroke();
  }
  for (const r of [0.55, 0.74]) {
    ctx.beginPath();
    ctx.arc(m, m, r * R, 0, Math.PI * 2);
    ctx.stroke();
  }
  const ring = (r, w, col) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(m, m, r * R, 0, Math.PI * 2);
    ctx.stroke();
  };
  ring(0.95, 10, '#4fd6e6');
  ring(0.925, 3, '#ffffff');
  ring(0.3, 9, '#4fd6e6');
  ring(0.275, 3, '#ffffff');
  // Sun medallion.
  ctx.fillStyle = '#ffe3a6';
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r1 = (i % 2 ? 0.22 : 0.26) * R;
    ctx.beginPath();
    ctx.moveTo(m + Math.cos(a - 0.09) * 0.13 * R, m + Math.sin(a - 0.09) * 0.13 * R);
    ctx.lineTo(m + Math.cos(a) * r1, m + Math.sin(a) * r1);
    ctx.lineTo(m + Math.cos(a + 0.09) * 0.13 * R, m + Math.sin(a + 0.09) * 0.13 * R);
    ctx.fill();
  }
  const sun = ctx.createRadialGradient(m, m, 0, m, m, 0.14 * R);
  sun.addColorStop(0, '#fff6dc');
  sun.addColorStop(0.7, '#ffd98a');
  sun.addColorStop(1, '#ffc46a');
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(m, m, 0.14 * R, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function DeckBody() {
  const { body, top } = useDisposable(() => {
    const R = DECK_R;
    // Lathe profiles run bottom-to-top so faces wind outward.
    const shell = lathe(
      [[R - 0.32, -1.6], [R - 0.3, -0.6], [R - 0.06, -0.52], [R - 0.02, -0.36], [R + 0.02, -0.3], [R, -0.12], [R - 0.1, -0.02], [R - 0.3, 0.0]],
      96,
    );
    const parts = [
      finalize(shell, { paint: (p, n, out) => out.set(p.y < -0.36 && p.y > -0.56 ? '#3cc8dc' : p.y < -0.56 ? '#e9eef0' : '#fbfaf6') }),
    ];
    // A low step around the front half, down to the sand.
    const step = lathe([[R - 0.1, -0.9], [R + 0.62, -0.9], [R + 0.62, -0.3], [R + 0.55, -0.24], [R - 0.1, -0.24]], 48, -1.1, 2.2);
    parts.push(finalize(step, { paint: '#f4f1ea' }));
    // Glass rail posts and chrome-white top rail around the back.
    const arc = [];
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI - 1.05 + (i / 40) * 2.1;
      arc.push(new THREE.Vector3(Math.sin(a) * (R - 0.18), 1.02, Math.cos(a) * (R - 0.18)));
    }
    parts.push(finalize(taperedTube(new THREE.CatmullRomCurve3(arc), 60, 6, () => 0.055), { paint: '#ffffff' }));
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI - 1.05 + (i / 10) * 2.1;
      const post = new THREE.CylinderGeometry(0.035, 0.035, 1.02, 6);
      place(post, { position: [Math.sin(a) * (R - 0.18), 0.51, Math.cos(a) * (R - 0.18)] });
      parts.push(finalize(post, { paint: '#e8f2f6' }));
    }
    // Lamp posts: slim tapered white columns with an aqua collar.
    for (const [x, z] of POSTS) {
      const col = lathe([[0.16, 0], [0.12, 0.25], [0.07, 0.4], [0.055, POST_H - 0.3], [0.1, POST_H - 0.25], [0.1, POST_H - 0.1], [0.05, POST_H]], 12);
      place(col, { position: [x, 0, z] });
      parts.push(finalize(col, { paint: (p, n, out) => out.set(p.y > POST_H - 0.28 && p.y < POST_H - 0.08 ? '#3cc8dc' : '#fdfcf8') }));
    }
    // Tiki torches: banded bamboo poles with a woven cup.
    for (const [x, z] of TORCHES) {
      const y = sandHeight(x, z);
      const pole = new THREE.CylinderGeometry(0.06, 0.075, 2.1, 7, 6);
      place(pole, { position: [x, y + 1.05, z] });
      parts.push(finalize(pole, { paint: (p, n, out) => out.set(Math.floor((p.y - y) * 3.3) % 2 ? '#c9a26a' : '#a8804c') }));
      const cup = lathe([[0.06, 0], [0.16, 0.08], [0.2, 0.32], [0.17, 0.36], [0, 0.36]], 10);
      place(cup, { position: [x, y + 2.05, z] });
      parts.push(finalize(cup, { paint: '#7a5532' }));
    }
    const topGeo = new THREE.CircleGeometry(R - 0.28, 96);
    topGeo.rotateX(-Math.PI / 2);
    return { body: merge(parts), top: topGeo };
  });
  const texture = useDisposable(() => makeDeckTexture());
  const mats = useDisposable(
    () => ({
      body: patchMaterial(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.12 }), { key: 'deck' }),
      top: patchMaterial(new THREE.MeshPhysicalMaterial({ map: texture, roughness: 0.55, clearcoat: 0.7, clearcoatRoughness: 0.1, color: '#ece8e2' }), { key: 'deck-top', ibl: 0.5 }),
    }),
    [texture],
  );
  return (
    <>
      <mesh geometry={body} material={mats.body} castShadow receiveShadow />
      <mesh geometry={top} material={mats.top} position={[0, 0.002, 0]} receiveShadow />
    </>
  );
}

/** Curved glass balustrade behind the dancers: fresnel sky reflection, aqua edges. */
function GlassRail() {
  const geometry = useDisposable(() => {
    const g = new THREE.CylinderGeometry(DECK_R - 0.18, DECK_R - 0.18, 0.95, 64, 1, true, Math.PI - 1.05, 2.1);
    g.translate(0, 0.52, 0);
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
        side: THREE.DoubleSide,
        uniforms: { ...skyUniforms() },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          varying vec3 vN;
          varying vec2 vUv;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            vN = normalize(mat3(modelMatrix) * normal);
            vUv = uv;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          ${skyGLSL}
          varying vec3 vWorld;
          varying vec3 vN;
          varying vec2 vUv;
          void main() {
            vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
            vec3 v = normalize(cameraPosition - vWorld);
            float ndv = abs(dot(n, v));
            float F = 0.05 + 0.95 * pow(1.0 - ndv, 4.0);
            vec3 r = reflect(-v, n);
            vec3 sky = skyGradient(vec3(r.x, abs(r.y), r.z));
            float panel = fract(vUv.x * 10.0);
            float seam = 1.0 - smoothstep(0.0, 0.03, min(panel, 1.0 - panel));
            float edge = 1.0 - smoothstep(0.0, 0.06, min(vUv.y, 1.0 - vUv.y));
            vec3 col = mix(vec3(0.45, 0.85, 0.9) * 0.4, sky * 1.1, F) + vec3(0.5, 1.0, 1.1) * edge * 0.7;
            float a = clamp(0.1 + F * 0.55 + edge * 0.5 + seam * 0.15, 0.0, 1.0);
            gl_FragColor = vec4(col * a, a);
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} renderOrder={-5} />;
}

/**
 * Warm glowing things: lantern orbs, string-light bulbs and rim pearls. One
 * instanced emissive shader; each light flickers on its own and swells on the beat.
 */
function Lights() {
  const { geometry, wires } = useDisposable(() => {
    const items = [];
    for (const [x, z] of POSTS) items.push({ p: [x, POST_H + 0.28, z], s: 0.24, c: '#ffb45a', k: 0 });
    const v = new THREE.Vector3();
    const wirePts = [];
    SPANS.forEach(([a, b, sag, n], si) => {
      for (let i = 0; i <= 24; i++) {
        catenary(a, b, sag, i / 24, v);
        wirePts.push(v.x, v.y, v.z);
        if (i > 0 && i < 24) wirePts.push(v.x, v.y, v.z);
      }
      for (let i = 1; i < n; i++) {
        catenary(a, b, sag, i / n, v);
        items.push({ p: [v.x, v.y - 0.12, v.z], s: 0.085, c: BULB_COLORS[(i + si) % BULB_COLORS.length], k: 1 });
      }
    });
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      items.push({ p: [Math.sin(a) * (DECK_R + 0.03), -0.21, Math.cos(a) * (DECK_R + 0.03)], s: 0.06, c: i % 2 ? '#8ff0ff' : '#ffe2a6', k: 2, a });
    }
    FLOATS.forEach(([x, z, c], i) => items.push({ p: [x, 0, z], s: 0.26, c, k: 3, a: i * 1.7 }));
    const sphere = new THREE.SphereGeometry(1, 12, 8);
    const g = new THREE.InstancedBufferGeometry();
    g.index = sphere.index;
    g.attributes.position = sphere.attributes.position;
    g.attributes.normal = sphere.attributes.normal;
    const off = new Float32Array(items.length * 4);
    const col = new Float32Array(items.length * 3);
    const kind = new Float32Array(items.length * 2);
    const c = new THREE.Color();
    items.forEach((it, i) => {
      off.set([...it.p, it.s], i * 4);
      c.set(it.c);
      col.set([c.r, c.g, c.b], i * 3);
      kind.set([it.k, it.a ?? i * 0.37], i * 2);
    });
    g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 4));
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
    g.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 2));
    g.instanceCount = items.length;
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
    return { geometry: g, wires: wg };
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: world.uTime, uWaterY: world.uWaterY, uPulse: { value: 0 }, uBeatN: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute vec4 aOffset;
          attribute vec3 aColor;
          attribute vec2 aKind;
          uniform float uTime, uWaterY, uPulse, uBeatN;
          varying vec3 vColor;
          varying vec3 vN;
          varying vec3 vView;
          varying float vGlass;
          void main() {
            vec3 wp = aOffset.xyz + position * aOffset.w;
            float id = aKind.y;
            // Float-lanterns ride the water.
            if (aKind.x > 2.5) wp.y += uWaterY + aOffset.w * 0.55 + sin(uTime * 1.4 + id) * 0.05;
            float flicker = 0.85 + 0.1 * sin(uTime * 9.0 + id * 13.0) + 0.05 * sin(uTime * 23.0 + id * 7.0);
            float gain;
            if (aKind.x < 0.5) gain = 1.7 + 0.8 * uPulse;
            else if (aKind.x < 1.5) gain = 2.4 * flicker + 2.2 * uPulse * step(0.5, fract(id * 3.1 + uBeatN * 0.5));
            else if (aKind.x > 2.5) gain = 1.5 * flicker + 0.7 * uPulse;
            else {
              // Rim pearls: a chase that steps around the deck on every beat.
              float chase = fract(id / 6.2831853 - uBeatN / 8.0);
              gain = 0.9 + 3.0 * pow(1.0 - chase, 6.0) + 0.6 * uPulse;
            }
            vColor = aColor * gain;
            vGlass = step(aKind.x, 0.5) + step(2.5, aKind.x);
            vN = normalize(normalMatrix * position);
            vec4 mv = viewMatrix * vec4(wp, 1.0);
            vView = -mv.xyz;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          varying vec3 vN;
          varying vec3 vView;
          varying float vGlass;
          void main() {
            float ndv = abs(dot(normalize(vN), normalize(vView)));
            // Lantern orbs: bright core inside a glossy glass shell.
            float core = mix(1.0, smoothstep(0.2, 0.9, ndv) * 1.4 + 0.25, vGlass);
            vec3 col = vColor * core + vec3(1.0, 0.95, 0.9) * pow(1.0 - ndv, 3.0) * vGlass * 0.8;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
  );
  const wireMat = useDisposable(() => new THREE.LineBasicMaterial({ color: '#5a4a52', transparent: true, opacity: 0.7 }));
  useFrame(() => {
    material.uniforms.uPulse.value = beat.pulse;
    material.uniforms.uBeatN.value = beat.beat;
  });
  return (
    <>
      <mesh geometry={geometry} material={material} frustumCulled={false} />
      <lineSegments geometry={wires} material={wireMat} />
    </>
  );
}

/** Stylised flickering torch flames: camera-facing teardrops with a hot core. */
function Flames() {
  const geometry = useDisposable(() => {
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.attributes.position = plane.attributes.position;
    g.attributes.uv = plane.attributes.uv;
    const off = new Float32Array(TORCHES.length * 4);
    TORCHES.forEach(([x, z], i) => off.set([x, sandHeight(x, z) + 2.36, z, i * 2.7], i * 4));
    g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 4));
    g.instanceCount = TORCHES.length;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: world.uTime, uPulse: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute vec4 aOffset;
          uniform float uTime;
          varying vec2 vUv;
          varying float vSeed;
          void main() {
            vUv = uv;
            vSeed = aOffset.w;
            float s = 0.95 + 0.08 * sin(uTime * 11.0 + aOffset.w);
            vec4 mv = viewMatrix * vec4(aOffset.xyz, 1.0);
            mv.xy += vec2(position.x * 0.55, position.y * 1.05 * s);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime, uPulse;
          varying vec2 vUv;
          varying float vSeed;
          ${hash}
          ${simplex}
          void main() {
            float y = vUv.y;
            float t = uTime * 2.6 + vSeed;
            float wob = snoise(vec2(y * 2.5 - t, vSeed)) * 0.18 * y;
            float x = (vUv.x - 0.5 + wob) * 2.0;
            float width = 0.95 * pow(1.0 - y, 0.9) * smoothstep(0.0, 0.25, y) + 0.001;
            float d = abs(x) / width;
            float body = 1.0 - smoothstep(0.55, 1.0, d);
            float tongue = smoothstep(0.2, 0.8, snoise(vec2(x * 2.0, y * 3.0 - t * 1.4)) * 0.5 + 0.5 + (1.0 - y) * 0.6);
            float a = body * tongue * (1.0 - smoothstep(0.6, 1.0, y));
            float core = (1.0 - smoothstep(0.0, 0.55, d)) * (1.0 - smoothstep(0.1, 0.6, y));
            vec3 col = mix(vec3(1.6, 0.35, 0.08), vec3(2.6, 1.3, 0.3), smoothstep(0.0, 0.7, 1.0 - d));
            col = mix(col, vec3(4.0, 3.2, 1.8), core);
            float glow = exp(-dot(vec2(x * 0.6, (y - 0.25) * 1.4), vec2(x * 0.6, (y - 0.25) * 1.4)) * 3.0) * 0.25;
            gl_FragColor = vec4((col * a + vec3(1.0, 0.5, 0.2) * glow) * (1.0 + 0.3 * uPulse), 1.0);
          }
        `,
      }),
  );
  useFrame(() => {
    material.uniforms.uPulse.value = beat.pulse;
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={20} />;
}

/** Warm practical lights from the torches; they flicker and breathe with the beat. */
function TorchLights() {
  const refs = useRef([]);
  const spots = useMemo(() => TORCHES.map(([x, z]) => [x, sandHeight(x, z) + 2.6, z + 0.2]), []);
  useFrame(() => {
    const t = world.uTime.value;
    refs.current.forEach((l, i) => {
      if (!l) return;
      l.intensity = 5 * (0.85 + 0.1 * Math.sin(t * 11 + i * 2.7) + 0.05 * Math.sin(t * 27 + i)) * (1 + 0.25 * beat.pulse);
    });
  });
  return spots.map((p, i) => <pointLight key={i} ref={(l) => (refs.current[i] = l)} position={p} color="#ff9a4a" distance={14} decay={1.6} />);
}

export function Deck() {
  return (
    <>
      <DeckBody />
      <GlassRail />
      <Lights />
      <Flames />
      <TorchLights />
    </>
  );
}
