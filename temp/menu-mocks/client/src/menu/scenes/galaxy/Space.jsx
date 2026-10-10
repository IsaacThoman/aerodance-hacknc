import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { noise } from '../../shared/glsl.js';
import { SPRITE_GLSL } from './materials.js';

// Galactic plane normal: the nebula band and denser stars follow it.
const BAND_N = new THREE.Vector3(-0.32, 1, 0.18).normalize();
// Where the distant spiral galaxy sits in the sky.
const SPIRAL_DIR = new THREE.Vector3(0.02, 0.245, -1).normalize();

const NEBULA_GLSL = /* glsl */ `
  ${noise}
  vec3 nebula(vec3 d) {
    float b = dot(d, uBand);
    float band = exp(-b * b / 0.16);
    float t = 0.0;
    // Deep indigo base with a gentle vertical gradient.
    vec3 col = mix(vec3(0.006, 0.010, 0.05), vec3(0.022, 0.014, 0.085), smoothstep(-0.7, 0.8, d.y));
    col += vec3(0.02, 0.01, 0.06) * band;

    // Domain-warped cloud field (kept soft so planets pop against it).
    vec3 p = d * 1.35;
    vec3 q = vec3(fbm(p + vec3(0.0, t, 0.0)), fbm(p + vec3(5.2, 1.3, 2.8)), fbm(p + vec3(9.1, 4.7, 1.3 - t)));
    vec3 r = p + q * 0.75;
    float n1 = fbm(r * 1.2);
    float n2 = fbm(r * 1.9 + 3.0);
    float n3 = snoise(r * 4.0) * 0.5;
    float dens = smoothstep(-0.25, 0.8, n1 + 0.15 * n3) * (0.22 + 0.95 * band);

    vec3 violet = vec3(0.2, 0.1, 0.75);
    vec3 magenta = vec3(0.75, 0.14, 0.55);
    vec3 teal = vec3(0.03, 0.42, 0.7);
    vec3 gold = vec3(1.0, 0.6, 0.25);
    vec3 neb = mix(violet, magenta, smoothstep(0.0, 0.6, n2));
    neb = mix(neb, teal, smoothstep(-0.12, 0.35, q.x - 0.15 * n2 + 0.2 * d.x));
    col += neb * dens * dens * 0.36;
    // Soft glowing gold-pink cores where the clouds are thickest.
    float core = smoothstep(0.4, 1.0, n1 + 0.2 * n3);
    col += mix(gold, vec3(1.0, 0.72, 0.85), smoothstep(0.1, 0.6, n2)) * core * core * (0.16 + 0.45 * band);
    // Dark dust lanes through the band.
    float lane = smoothstep(0.15, 0.55, fbm(r * 2.2 + 7.0)) * band;
    col *= 1.0 - 0.5 * lane;

    return max(col, 0.0);
  }
`;

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

/**
 * Painterly nebula skybox. The expensive domain-warped clouds are baked once
 * into a cube map; spiral galaxy and twinkling star dust stay live, and the
 * whole sky sways very slowly about the galactic pole.
 */
export function NebulaSky({ radius = 1500, resolution = 768 }) {
  const gl = useThree((s) => s.gl);
  const mesh = useRef();
  const target = useDisposable(() => new THREE.WebGLCubeRenderTarget(resolution, { type: THREE.HalfFloatType, generateMipmaps: false }), [resolution]);

  useLayoutEffect(() => {
    const bake = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      uniforms: { uBand: { value: BAND_N } },
      vertexShader: SKY_VERT,
      fragmentShader: /* glsl */ `
        uniform vec3 uBand;
        varying vec3 vDir;
        ${NEBULA_GLSL}
        void main() { gl_FragColor = vec4(nebula(normalize(vDir)), 1.0); }
      `,
    });
    const box = new THREE.BoxGeometry(10, 10, 10);
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(box, bake));
    const camera = new THREE.CubeCamera(0.1, 100, target);
    const prevTarget = gl.getRenderTarget();
    const prevAutoClear = gl.autoClear;
    gl.autoClear = true;
    camera.update(gl, scene);
    gl.autoClear = prevAutoClear;
    gl.setRenderTarget(prevTarget);
    box.dispose();
    bake.dispose();
  }, [gl, target]);

  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uSpiral: { value: SPIRAL_DIR },
          uNebula: { value: target.texture },
          uRot: { value: new THREE.Matrix3() },
        },
        vertexShader: SKY_VERT,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uSpiral;
          uniform samplerCube uNebula;
          uniform mat3 uRot;
          varying vec3 vDir;
          ${noise}
          float hash13(vec3 c) { return hash12(c.xy + c.z * 31.17); }
          float stars(vec3 d, float scale, float prob, float size) {
            vec3 p = d * scale;
            vec3 c = floor(p);
            float h = hash13(c);
            if (h > prob) return 0.0;
            vec3 o = vec3(hash13(c + 11.3), hash13(c + 27.1), hash13(c + 41.9)) * 0.5 + 0.25;
            float dist = length(fract(p) - o);
            float tw = 0.65 + 0.35 * sin(uTime * (0.8 + h * 30.0) + h * 300.0);
            return smoothstep(size, 0.0, dist) * tw * (0.4 + 0.6 * hash13(c + 5.0));
          }
          void main() {
            vec3 d = uRot * normalize(vDir);
            vec3 col = textureCube(uNebula, d).rgb;
            float lum = dot(col, vec3(0.3, 0.5, 0.2));
            // Distant spiral galaxy.
            float sd = dot(d, uSpiral);
            if (sd > 0.97) {
              vec3 gx = normalize(cross(uSpiral, vec3(0.0, 1.0, 0.0)));
              vec3 gy = cross(gx, uSpiral);
              vec2 uv = vec2(dot(d, gx), dot(d, gy)) / 0.095;
              float ca = cos(0.45), sa = sin(0.45);
              uv = mat2(ca, -sa, sa, ca) * uv;
              uv.y /= 0.42;
              float r2 = dot(uv, uv) + 1e-5;
              float rr = sqrt(r2);
              // cos(2*theta - phi) without atan (stable at the core).
              float c2 = (uv.x * uv.x - uv.y * uv.y) / r2;
              float s2 = 2.0 * uv.x * uv.y / r2;
              float phi = log(rr + 0.02) * 4.2 - uTime * 0.05;
              float arm = c2 * cos(phi) + s2 * sin(phi);
              float knots = snoise(vec3(uv * 6.0, 1.0)) * 0.5 + 0.5;
              float arms = pow(clamp(0.5 + 0.5 * arm, 0.0, 1.0), 2.5) * exp(-rr * 2.3) * smoothstep(1.3, 0.15, rr);
              float bulge = exp(-rr * rr * 30.0);
              vec3 gcol = mix(vec3(0.45, 0.55, 1.2), vec3(1.1, 0.45, 0.9), knots) * arms * (0.6 + 0.8 * knots);
              gcol += vec3(1.6, 1.25, 0.85) * bulge * 1.6 + vec3(0.6, 0.4, 0.7) * exp(-rr * 3.5) * 0.35;
              col += gcol * smoothstep(0.97, 0.985, sd);
            }

            // Faint dense star dust, thicker where the nebula glows.
            float dense = smoothstep(0.02, 0.2, lum);
            col += vec3(0.75, 0.8, 1.0) * stars(d, 340.0, 0.05 + 0.12 * dense, 0.32) * 0.55;
            col += vec3(1.0, 0.9, 0.85) * stars(d, 150.0, 0.04, 0.3) * 0.8;
            gl_FragColor = vec4(max(col, 0.0), 1.0);
          }
        `,
      }),
    [target],
  );

  const axis = useMemo(() => BAND_N.clone(), []);
  const rot = useMemo(() => new THREE.Matrix4(), []);
  useFrame((state) => {
    mesh.current.position.copy(state.camera.position);
    material.uniforms.uTime.value = state.clock.elapsedTime;
    rot.makeRotationAxis(axis, Math.sin(state.clock.elapsedTime * 0.012) * 0.07);
    material.uniforms.uRot.value.setFromMatrix4(rot);
  });

  return (
    <mesh ref={mesh} material={material} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[radius, 48, 24]} />
    </mesh>
  );
}

const STAR_COLORS = ['#ffffff', '#ffffff', '#d6e6ff', '#cfe0ff', '#fff0d2', '#ffd9f0', '#e2d6ff'];

/** Twinkling point stars on a large shell (with real parallax as the camera glides). */
export function StarField({ count = 2600, seed = 5 }) {
  const geometry = useDisposable(() => {
    const rand = makeRandom(seed);
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const data = new Float32Array(count * 3);
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // Rejection sample to concentrate stars along the galactic band.
      for (let k = 0; k < 8; k++) {
        v.set(rand.range(-1, 1), rand.range(-1, 1), rand.range(-1, 1));
        if (v.lengthSq() > 1 || v.lengthSq() < 0.01) continue;
        v.normalize();
        const b = v.dot(BAND_N);
        if (rand.next() < 0.35 + 0.65 * Math.exp(-(b * b) / 0.08)) break;
      }
      v.multiplyScalar(rand.range(420, 700));
      pos.set([v.x, v.y, v.z], i * 3);
      c.set(rand.pick(STAR_COLORS));
      col.set([c.r, c.g, c.b], i * 3);
      const big = rand.chance(0.06);
      data.set([big ? rand.range(3.0, 4.6) : rand.range(1.3, 2.6), rand.range(0, 100), rand.range(0.6, 3.2)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aData', new THREE.BufferAttribute(data, 3));
    return g;
  }, [count, seed]);

  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute vec3 aColor;
          attribute vec3 aData;
          uniform float uTime;
          varying vec3 vColor;
          varying float vTw;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            float tw = 0.55 + 0.45 * sin(uTime * aData.z + aData.y) * sin(uTime * aData.z * 0.37 + aData.y * 2.0);
            vTw = tw;
            vColor = aColor;
            gl_PointSize = aData.x * (0.75 + 0.35 * tw);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          varying float vTw;
          void main() {
            vec2 p = (gl_PointCoord * 2.0 - 1.0) * vec2(1.3333, 1.0); // undo the anamorphic stretch
            float a = exp(-dot(p, p) * 3.5);
            gl_FragColor = vec4(vColor * a * (0.5 + 1.1 * vTw), 1.0);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
  );

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={-900} />;
}

// Bright stars with diffraction cross flares (bloom picks them up).
const FLARES = [
  // [direction x, y, z, size px, color, phase]
  [0.42, 0.38, -1, 34, '#fff3d6', 0.0],
  [-0.25, -0.12, -1, 22, '#d8e8ff', 1.7],
  [0.95, -0.28, -1, 26, '#ffd6f4', 3.1],
  [0.12, 0.6, -1, 18, '#dff6ff', 4.2],
  [0.7, 0.62, -1, 16, '#fff0c8', 2.2],
  [-0.62, 0.05, -1, 14, '#e8dcff', 5.0],
  [0.28, -0.55, -1, 20, '#cff4ff', 0.9],
  [1.2, 0.2, -1, 28, '#ffe3c4', 2.7],
  [-0.05, 0.22, -1, 12, '#ffffff', 3.8],
  [0.55, 0.05, -1, 13, '#ffd2ec', 1.1],
];

export function FlareStars() {
  const geometry = useDisposable(() => {
    const pos = new Float32Array(FLARES.length * 3);
    const col = new Float32Array(FLARES.length * 3);
    const data = new Float32Array(FLARES.length * 2);
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    FLARES.forEach(([x, y, z, size, color, phase], i) => {
      v.set(x * 0.65, y * 0.37, z).normalize().multiplyScalar(650);
      pos.set([v.x, v.y, v.z], i * 3);
      c.set(color);
      col.set([c.r, c.g, c.b], i * 3);
      data.set([size, phase], i * 2);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aData', new THREE.BufferAttribute(data, 2));
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute vec3 aColor;
          attribute vec2 aData;
          uniform float uTime;
          varying vec3 vColor;
          varying float vRot;
          varying float vTw;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            float tw = 0.75 + 0.25 * sin(uTime * 1.3 + aData.y * 2.0) + 0.12 * sin(uTime * 4.1 + aData.y);
            vTw = tw;
            vRot = uTime * 0.05 + aData.y;
            vColor = aColor;
            gl_PointSize = aData.x * tw;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          varying float vRot;
          varying float vTw;
          ${SPRITE_GLSL}
          void main() {
            vec2 p = (gl_PointCoord * 2.0 - 1.0) * vec2(1.3333, 1.0); // undo the anamorphic stretch
            float c = cos(vRot * 0.2), s = sin(vRot * 0.2);
            vec2 q = mat2(c, -s, s, c) * p;
            float f = flare4(q, 22.0);
            vec2 q2 = mat2(0.7071, -0.7071, 0.7071, 0.7071) * q;
            f += flare4(q2, 40.0) * 0.25;
            f += exp(-dot(p, p) * 7.0) * 0.35;
            gl_FragColor = vec4(vColor * f * (1.1 + vTw * 1.4), 1.0);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
  );
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={-800} />;
}

/** Wispy dust-cloud atlas (2x2), white with alpha. */
function makeDustAtlas(seed = 11, cell = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = cell * 2;
  const ctx = canvas.getContext('2d');
  const rand = makeRandom(seed);
  for (let i = 0; i < 4; i++) {
    const ox = (i % 2) * cell;
    const oy = Math.floor(i / 2) * cell;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, cell, cell);
    ctx.clip();
    for (let k = 0; k < 70; k++) {
      const a = rand.range(0, Math.PI * 2);
      const rr = Math.pow(rand.next(), 0.7) * cell * 0.3;
      const x = ox + cell / 2 + Math.cos(a) * rr * 1.2;
      const y = oy + cell / 2 + Math.sin(a) * rr * 0.6;
      const r = cell * rand.range(0.06, 0.16);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const alpha = rand.range(0.05, 0.14);
      g.addColorStop(0, `rgba(255,255,255,${alpha})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r * rand.range(1, 2.2), r, rand.range(-0.4, 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const DUST = [
  // x, y, z, size, color, cell, alpha
  [-14, 7, -26, 30, '#8a5cff', 0, 0.55],
  [12, -9, -20, 34, '#ff5fb8', 1, 0.42],
  [30, 10, -45, 48, '#4fd6e8', 2, 0.42],
  [-6, -12, -30, 36, '#5a6bff', 3, 0.5],
  [2, 14, -55, 60, '#c46bff', 1, 0.4],
  [26, -12, -6, 22, '#57e0d2', 0, 0.3],
  [-10, -2, -12, 18, '#ff7ad1', 2, 0.25],
  [55, 30, -110, 80, '#ff9ad8', 3, 0.35],
  [10, 4, -18, 20, '#ffd27a', 0, 0.18],
];

/** Soft, slowly turning nebula wisps in the midground for depth. */
export function DustClouds() {
  const texture = useDisposable(() => makeDustAtlas());
  const geometry = useDisposable(() => {
    const plane = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.attributes.position = plane.attributes.position;
    g.attributes.uv = plane.attributes.uv;
    const off = new Float32Array(DUST.length * 3);
    const col = new Float32Array(DUST.length * 3);
    const data = new Float32Array(DUST.length * 4);
    const c = new THREE.Color();
    DUST.forEach(([x, y, z, s, color, cell, alpha], i) => {
      off.set([x, y, z], i * 3);
      c.set(color);
      col.set([c.r, c.g, c.b], i * 3);
      data.set([s, cell, alpha, i * 1.7], i * 4);
    });
    g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
    g.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4));
    g.instanceCount = DUST.length;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: texture }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute vec3 aOffset;
          attribute vec3 aColor;
          attribute vec4 aData;
          uniform float uTime;
          varying vec2 vUv;
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            vec3 c = aOffset + vec3(sin(uTime * 0.05 + aData.w) * 1.5, sin(uTime * 0.07 + aData.w * 2.0) * 0.8, 0.0);
            vec4 mv = modelViewMatrix * vec4(c, 1.0);
            float a = uTime * 0.012 * (mod(aData.w, 2.0) - 0.8) + aData.w;
            mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
            mv.xy += rot * position.xy * aData.x;
            gl_Position = projectionMatrix * mv;
            vec2 cell = vec2(mod(aData.y, 2.0), floor(aData.y / 2.0));
            vUv = (uv + cell) * 0.5;
            vColor = aColor;
            // Fade when very close to the camera.
            vAlpha = aData.z * smoothstep(4.0, 14.0, -mv.z);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          varying vec2 vUv;
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            float a = texture2D(uMap, vUv).a * vAlpha;
            gl_FragColor = vec4(vColor * a, 1.0);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
  );
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={-700} />;
}
