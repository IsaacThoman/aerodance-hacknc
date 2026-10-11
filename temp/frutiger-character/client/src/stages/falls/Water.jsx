import { useMemo } from 'react';
import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { fx, lightGLSL, windGLSL } from './fx.js';
import { fallSites, LAKE, LAKE_Y, RIVER_CURVE, valleyHeight } from './terrain.js';

const MAX_FOAM = 8;

// ------------------------------------------------------------------ lake

function bakeDepth(box, size = 128) {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = box[0] + ((i + 0.5) / size) * box[2];
      const z = box[1] + ((j + 0.5) / size) * box[3];
      const d = Math.min(1, Math.max(0, (LAKE_Y - valleyHeight(x, z)) / 7));
      data[(j * size + i) * 4] = Math.round(d * 255);
      data[(j * size + i) * 4 + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const waterSurfaceGLSL = /* glsl */ `
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  vec3 skyReflect(vec3 r) {
    return mix(uSkyHorizon, uSkyTop, pow(clamp(r.y, 0.0, 1.0), 0.5));
  }
`;

export function Lake() {
  const sites = useMemo(fallSites, []);
  const box = useMemo(() => [LAKE.x - LAKE.rx * 1.25, LAKE.z - LAKE.rz * 1.25, LAKE.rx * 2.5, LAKE.rz * 2.5], []);
  const depth = useDisposable(() => bakeDepth(box), [box]);
  const geometry = useDisposable(() => {
    const g = new THREE.PlaneGeometry(box[2], box[3], 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(box[0] + box[2] / 2, LAKE_Y, box[1] + box[3] / 2);
    return g;
  }, [box]);
  const material = useDisposable(() => {
    const foam = sites.filter((s) => s.bottom <= LAKE_Y + 0.5).slice(0, MAX_FOAM);
    const feet = Array.from({ length: MAX_FOAM }, (_, i) =>
      foam[i] ? new THREE.Vector4(foam[i].foot.x, foam[i].foot.z, foam[i].width, 1) : new THREE.Vector4(0, 0, 0, 0),
    );
    return new THREE.ShaderMaterial({
      uniforms: {
        ...fx,
        uDepth: { value: depth },
        uBox: { value: new THREE.Vector4(...box) },
        uFeet: { value: feet },
        uSkyTop: { value: new THREE.Color('#3f8fe6') },
        uSkyHorizon: { value: new THREE.Color('#d8f1ff') },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        ${windGLSL}
        ${lightGLSL}
        ${waterSurfaceGLSL}
        uniform sampler2D uDepth;
        uniform vec4 uBox;
        uniform vec4 uFeet[${MAX_FOAM}];
        varying vec3 vWorld;
        void main() {
          vec2 p = vWorld.xz;
          vec2 duv = (p - uBox.xy) / uBox.zw;
          float depth = texture2D(uDepth, duv).r;
          // Ripples: two scrolling noise layers as a normal.
          vec4 a = tnoise(p * 0.11 + vec2(uTime * 0.05, uTime * 0.03));
          vec4 b = tnoise(p * 0.27 - vec2(uTime * 0.04, -uTime * 0.06));
          vec2 slope = (a.xy + b.zw * 0.6) * 0.16;
          // Falls churn the water around their feet.
          float foam = 0.0;
          for (int i = 0; i < ${MAX_FOAM}; i++) {
            vec4 f = uFeet[i];
            if (f.w < 0.5) continue;
            vec2 d = p - f.xy;
            float r = length(d);
            float ring = sin(r * 0.9 - uTime * 3.0) * 0.5 + 0.5;
            float reach = f.z * 2.6;
            float k = exp(-r / reach);
            foam += k * (0.55 + 0.45 * ring) * smoothstep(-0.2, 0.5, tnoise(p * 0.35 + uTime * vec2(0.2, -0.1)).r + k);
            slope += normalize(d + 1e-3) * k * 0.25 * ring;
          }
          vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
          vec3 v = normalize(cameraPosition - vWorld);
          float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
          vec3 shallow = vec3(0.1, 0.74, 0.62);
          vec3 deep = vec3(0.0, 0.38, 0.5);
          vec3 body = mix(shallow, deep, smoothstep(0.05, 0.85, depth));
          body *= uSunColor * 0.75 + uSkyLight * 0.55;
          vec3 refl = skyReflect(reflect(-v, n));
          vec3 col = mix(body, refl, clamp(fres * 0.45, 0.0, 1.0));
          // Sun glints sparkle on the ripples.
          vec3 h = normalize(uSunDir + v);
          float glint = pow(max(dot(n, h), 0.0), 220.0);
          col += uSunColor * glint * 6.0;
          // Twinkling sky glints on the ripple crests.
          float tw = tnoise(p * 0.9 + vec2(uTime * 0.31, -uTime * 0.23)).r * tnoise(p * 1.3 - vec2(uTime * 0.2, uTime * 0.27)).g;
          col += vec3(1.0, 0.98, 0.9) * smoothstep(0.32, 0.5, tw) * 2.5;
          // Bright shallows rim and churned foam.
          col = mix(col, vec3(0.86, 0.95, 0.96), smoothstep(0.08, 0.0, depth) * 0.5);
          col = mix(col, vec3(0.92, 0.97, 1.0) * (uSunColor + uSkyLight * 0.5), clamp(foam, 0.0, 1.0) * 0.85);
          col = applyHaze(col, vWorld, 1.0);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
  }, [depth, sites, box]);
  return <mesh geometry={geometry} material={material} renderOrder={-2} />;
}

// ----------------------------------------------------------------- river

export function River() {
  const geometry = useDisposable(() => {
    const steps = 160;
    const pts = RIVER_CURVE.getSpacedPoints(steps);
    const pos = [];
    const uv = [];
    const idx = [];
    let len = 0;
    for (let i = 0; i <= steps; i++) {
      const p = pts[i];
      const q = pts[Math.min(i + 1, steps)];
      const o = pts[Math.max(i - 1, 0)];
      const tx = q.x - o.x;
      const tz = q.z - o.z;
      const tl = Math.hypot(tx, tz) || 1;
      const nx = -tz / tl;
      const nz = tx / tl;
      if (i > 0) len += p.distanceTo(pts[i - 1]);
      const w = 4.2 + 1.5 * Math.sin(i * 0.21);
      for (const s of [-1, 1]) {
        pos.push(p.x + nx * w * s, LAKE_Y - 0.9 - (i / steps) * 1.5, p.z + nz * w * s);
        uv.push(s * 0.5 + 0.5, len);
      }
      if (i < steps) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { ...fx, uSkyTop: { value: new THREE.Color('#3f8fe6') }, uSkyHorizon: { value: new THREE.Color('#d8f1ff') } },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }
        `,
        fragmentShader: /* glsl */ `
          ${windGLSL}
          ${lightGLSL}
          ${waterSurfaceGLSL}
          varying vec3 vWorld;
          varying vec2 vUv;
          void main() {
            float flow = vUv.y * 0.12 - uTime * 0.6;
            vec4 a = tnoise(vec2(vUv.x * 1.5, flow));
            vec3 n = normalize(vec3(a.x * 0.2, 1.0, a.y * 0.2));
            vec3 v = normalize(cameraPosition - vWorld);
            float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
            vec3 body = vec3(0.08, 0.5, 0.48) * (uSunColor * 0.75 + uSkyLight * 0.55);
            vec3 col = mix(body, skyReflect(reflect(-v, n)), fres * 0.9);
            col += uSunColor * pow(max(dot(n, normalize(uSunDir + v)), 0.0), 160.0) * 4.0;
            col = applyHaze(col, vWorld, 1.0);
            float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
            gl_FragColor = vec4(col, edge);
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} renderOrder={-1} />;
}

// ------------------------------------------------------------- waterfalls

function buildFalls(sites) {
  const NU = 8;
  const NV = 30;
  const pos = [];
  const uv = [];
  const fall = [];
  const idx = [];
  let base = 0;
  const rand = makeRandom(91);
  sites.forEach((s) => {
    const drop = s.lip.y - s.bottom;
    const side = new THREE.Vector3(-s.dir.y, 0, s.dir.x);
    const out = new THREE.Vector3(s.dir.x, 0, s.dir.y);
    const reach = s.out + 2.2;
    const seed = rand.range(0, 50);
    for (let j = 0; j <= NV + 1; j++) {
      // Row 0 sits back on the river shelf; the fall starts at row 1.
      const v = j === 0 ? 0 : (j - 1) / NV;
      for (let i = 0; i <= NU; i++) {
        const u = i / NU;
        const c = u * 2 - 1;
        const w = s.width * (1 + 0.45 * v) * 0.5;
        const p = s.lip.clone();
        if (j === 0) {
          p.addScaledVector(out, -3.5);
          p.y += 0.35;
        } else {
          p.addScaledVector(out, reach * Math.sqrt(v) + 0.3 * v);
          p.y -= drop * v;
        }
        p.addScaledVector(side, c * w);
        // Slightly cupped sheet, like water pouring through a notch.
        p.addScaledVector(out, -c * c * s.width * 0.18);
        pos.push(p.x, p.y, p.z);
        uv.push(u, j === 0 ? -0.04 : v);
        fall.push(seed, s.width, drop, 0);
      }
    }
    for (let j = 0; j <= NV; j++) {
      for (let i = 0; i < NU; i++) {
        const a = base + j * (NU + 1) + i;
        const b = a + 1;
        const c = a + NU + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    base += (NV + 2) * (NU + 1);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFall', new THREE.Float32BufferAttribute(fall, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function Waterfalls({ sites }) {
  const geometry = useDisposable(() => buildFalls(sites), [sites]);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { ...fx },
        vertexShader: /* glsl */ `
          attribute vec4 aFall;
          varying vec2 vUv;
          varying vec4 vFall;
          varying vec3 vWorld;
          void main() {
            vUv = uv;
            vFall = aFall;
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }
        `,
        fragmentShader: /* glsl */ `
          ${windGLSL}
          ${lightGLSL}
          varying vec2 vUv;
          varying vec4 vFall;
          varying vec3 vWorld;
          void main() {
            float seed = vFall.x;
            float width = vFall.y;
            float drop = vFall.z;
            float u = vUv.x;
            float v = max(vUv.y, 0.0);
            // Streaks scroll down, accelerating as the water falls.
            float fallen = v * drop;
            float speed = uTime * 9.0;
            vec2 q = vec2(u * width * 0.55 + seed, (fallen - speed) * 0.045 + seed);
            float s1 = tnoise(q * vec2(1.0, 1.0)).r;
            float s2 = tnoise(q * vec2(2.3, 1.7) + 4.1).g;
            float streak = s1 * 0.6 + s2 * 0.4;
            // Strands: wide falls split into a few ropes of water.
            float strands = smoothstep(-0.35, 0.25, tnoise(vec2(u * width * 0.12 + seed * 3.0, v * 0.6 + seed)).b + 0.25);
            float edge = smoothstep(0.0, 0.16, u) * smoothstep(1.0, 0.84, u);
            float body = edge * mix(0.55, 1.0, strands);
            body *= smoothstep(-0.05, 0.03, vUv.y);
            // Fade into the mist at the bottom.
            body *= 1.0 - smoothstep(0.8, 1.0, v);
            float alpha = body * (0.55 + 0.45 * smoothstep(-0.4, 0.5, streak));
            vec3 water = mix(vec3(0.62, 0.86, 0.9), vec3(1.0), smoothstep(-0.2, 0.6, streak));
            vec3 nrm = normalize(vec3(cameraPosition.x - vWorld.x, 0.0, cameraPosition.z - vWorld.z));
            float lit = clamp(dot(nrm, uSunDir) * 0.5 + 0.7, 0.0, 1.0);
            vec3 col = water * (uSunColor * lit * 1.1 + uSkyLight * 0.7);
            col += vec3(1.0, 0.98, 0.92) * smoothstep(0.55, 0.85, streak) * 0.9;
            col = applyHaze(col, vWorld, 0.9);
            gl_FragColor = vec4(col * alpha, alpha);
          }
        `,
        premultipliedAlpha: true,
      }),
  );
  return <mesh geometry={geometry} material={material} renderOrder={2} frustumCulled={false} />;
}

// ------------------------------------------------------------------ mist

export function Mist({ sites, extra = [] }) {
  const geometry = useDisposable(() => {
    const rand = makeRandom(57);
    const plane = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.attributes.position = plane.attributes.position;
    g.attributes.uv = plane.attributes.uv;
    const centers = [];
    const params = [];
    const aspects = [];
    for (const s of sites) {
      const n = Math.round(12 + s.width * 1.8);
      for (let i = 0; i < n; i++) {
        const c = s.foot.clone();
        c.x += s.dir.x * rand.range(-1, 6) + -s.dir.y * rand.range(-1, 1) * s.width * 0.9;
        c.z += s.dir.y * rand.range(-1, 6) + s.dir.x * rand.range(-1, 1) * s.width * 0.9;
        c.y += rand.range(-1, 1);
        centers.push(c.x, c.y, c.z);
        // size, rise, phase, rate
        params.push(s.width * rand.range(1.6, 2.8) + 4, rand.range(3, 8) + s.width * 0.5, rand.next(), rand.range(0.05, 0.1));
        aspects.push(rand.range(1.2, 1.7));
      }
    }
    for (const e of extra) {
      centers.push(...e.c);
      params.push(...e.p);
      aspects.push(e.aspect ?? 1);
    }
    g.setAttribute('aCenter', new THREE.InstancedBufferAttribute(new Float32Array(centers), 3));
    g.setAttribute('aParams', new THREE.InstancedBufferAttribute(new Float32Array(params), 4));
    g.setAttribute('aAspect', new THREE.InstancedBufferAttribute(new Float32Array(aspects), 1));
    g.instanceCount = centers.length / 3;
    return g;
  }, [sites, extra]);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
        uniforms: { ...fx },
        vertexShader: /* glsl */ `
          attribute vec3 aCenter;
          attribute vec4 aParams;
          attribute float aAspect;
          uniform float uTime;
          varying vec2 vUv;
          varying float vAge;
          varying float vSeed;
          varying vec3 vWorld;
          void main() {
            float age = fract(uTime * aParams.w + aParams.z);
            vec3 c = aCenter;
            c.y += age * aParams.y;
            c.x += sin(age * 3.0 + aParams.z * 20.0) * 1.5 * aAspect;
            float s = aParams.x * (0.6 + age * 0.9);
            vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
            vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
            vec3 w = c + (camR * position.x * aAspect + camU * position.y * 0.8) * s;
            vUv = uv;
            vAge = age;
            vSeed = aParams.z;
            vWorld = w;
            gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          ${windGLSL}
          ${lightGLSL}
          varying vec2 vUv;
          varying float vAge;
          varying float vSeed;
          varying vec3 vWorld;
          void main() {
            vec2 d = vUv - 0.5;
            float r = length(d) * 2.0;
            float puff = smoothstep(1.0, 0.2, r);
            float billow = tnoise(vUv * 1.6 + vSeed * 13.0 + vec2(0.0, -uTime * 0.05)).r;
            float a = puff * smoothstep(-0.6, 0.4, billow + 0.2 - r * 0.6);
            a *= smoothstep(0.0, 0.18, vAge) * (1.0 - smoothstep(0.55, 1.0, vAge)) * 0.75;
            vec3 col = vec3(0.98, 0.99, 1.0) * (uSunColor * (0.7 + 0.4 * vUv.y) + uSkyLight * 0.8);
            col = applyHaze(col, vWorld, 0.8);
            gl_FragColor = vec4(col * a, a);
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} renderOrder={3} frustumCulled={false} />;
}

// --------------------------------------------------------------- rainbow

export function Rainbow({ center = [-6, -56, -176], radius = 76, start = 98, end = 172 }) {
  const geometry = useDisposable(() => new THREE.PlaneGeometry(radius * 2.3, radius * 2.3), [radius]);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          ...fx,
          uRange: { value: new THREE.Vector2(THREE.MathUtils.degToRad(start), THREE.MathUtils.degToRad(end)) },
        },
        vertexShader: /* glsl */ `
          varying vec2 vP;
          varying vec3 vWorld;
          void main() {
            vP = (uv - 0.5) * 2.3;
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }
        `,
        fragmentShader: /* glsl */ `
          ${windGLSL}
          ${lightGLSL}
          uniform vec2 uRange;
          varying vec2 vP;
          varying vec3 vWorld;
          vec3 spectrum(float t) {
            // t: 0 = violet (inner) .. 1 = red (outer)
            return clamp(vec3(
              smoothstep(0.45, 0.85, t) + 0.35 * smoothstep(0.15, 0.0, t),
              smoothstep(0.15, 0.5, t) * smoothstep(1.0, 0.62, t),
              smoothstep(0.55, 0.15, t)
            ), 0.0, 1.0);
          }
          void main() {
            float r = length(vP);
            float ang = atan(vP.y, vP.x);
            float w = 0.085;
            float t = (r - (1.0 - w)) / w;
            float band = smoothstep(-0.1, 0.25, t) * smoothstep(1.1, 0.75, t);
            float along = smoothstep(uRange.x, uRange.x + 0.35, ang) * smoothstep(uRange.y, uRange.y - 0.25, ang);
            // Strongest where it rises out of the spray; shimmer as the mist moves.
            float shimmer = 0.75 + 0.25 * tnoise(vec2(ang * 3.0 - uTime * 0.05, uTime * 0.07)).r;
            float a = band * along * shimmer * 0.55;
            // Faint secondary glow inside the bow.
            float inner = smoothstep(1.0 - w, 0.55, r) * along * 0.035;
            vec3 col = spectrum(clamp(t, 0.0, 1.0)) * a + vec3(0.9, 0.95, 1.0) * inner;
            col *= 1.0 - hazeAmount(vWorld, 0.5) * 0.5;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    [start, end],
  );
  // An upright plane facing +z, toward the camera.
  return <mesh geometry={geometry} material={material} position={center} renderOrder={4} frustumCulled={false} />;
}
