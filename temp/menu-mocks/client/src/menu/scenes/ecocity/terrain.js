import * as THREE from 'three';
import { noise } from '../../shared/glsl.js';
import { makeRandom } from '../../shared/random.js';
import { AVENUES_Z, GROUND, LANDMARKS, STREETS_X, SUN, groundHeight, shoreZ } from './layout.js';

// Ground: one big terrain mesh (flat city, rolling hills, headlands) shaded
// with a painted city-map texture inside the grid and procedural grass outside.

export const MAP = { x0: -470, x1: 470, z0: -450, z1: 130 };
const MAP_W = 2048;
const MAP_H = Math.round((MAP_W * (MAP.z1 - MAP.z0)) / (MAP.x1 - MAP.x0));

export function paintGroundTexture(city) {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const ctx = canvas.getContext('2d');
  const s = MAP_W / (MAP.x1 - MAP.x0);
  const X = (x) => (x - MAP.x0) * s;
  const Z = (z) => (MAP.z1 - z) * s;
  const rand = makeRandom(77);

  // Base meadow.
  ctx.fillStyle = '#74bc4e';
  ctx.fillRect(0, 0, MAP_W, MAP_H);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = rand.chance(0.5) ? 'rgba(140,205,90,0.35)' : 'rgba(70,150,60,0.3)';
    ctx.beginPath();
    ctx.ellipse(rand.range(0, MAP_W), rand.range(0, MAP_H), rand.range(20, 90), rand.range(15, 60), rand.range(0, 3), 0, Math.PI * 2);
    ctx.fill();
  }

  // Paved city area bounded by the shoreline.
  ctx.beginPath();
  ctx.moveTo(X(-372), Z(-345));
  ctx.lineTo(X(378), Z(-345));
  for (let x = 378; x >= -372; x -= 6) ctx.lineTo(X(x), Z(shoreZ(x) + 0.5));
  ctx.closePath();
  ctx.fillStyle = '#e3e9ec';
  ctx.fill();

  // Promenade boards between the boulevard and the water.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(X(-372), Z(27));
  ctx.lineTo(X(378), Z(27));
  for (let x = 378; x >= -372; x -= 6) ctx.lineTo(X(x), Z(shoreZ(x) + 0.5));
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = '#efe7d6';
  ctx.fillRect(0, 0, MAP_W, MAP_H);
  ctx.strokeStyle = 'rgba(170,140,100,0.25)';
  ctx.lineWidth = 1;
  for (let z = 27; z < 60; z += 1.2) {
    ctx.beginPath();
    ctx.moveTo(X(-372), Z(z));
    ctx.lineTo(X(378), Z(z));
    ctx.stroke();
  }
  // Lawn strip with planters.
  ctx.fillStyle = '#7cc653';
  for (let x = -360; x < 370; x += 30) ctx.fillRect(X(x), Z(33), 20 * s, 5 * s);
  ctx.restore();

  // Blocks.
  for (const blk of city.blocks) {
    const x = X(blk.x0);
    const y = Z(blk.z1);
    const w = (blk.x1 - blk.x0) * s;
    const h = (blk.z1 - blk.z0) * s;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6 * s);
    ctx.clip();
    if (blk.use === 'build') {
      ctx.fillStyle = '#eaeff1';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#86c95c';
      for (let k = 0; k < 5; k++) {
        ctx.beginPath();
        ctx.roundRect(x + rand.range(0, w - 30 * s), y + rand.range(0, h - 20 * s), rand.range(14, 30) * s, rand.range(8, 18) * s, 4 * s);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(160,175,185,0.5)';
      ctx.lineWidth = 0.5 * s;
      for (let gx = x; gx < x + w; gx += 4 * s) {
        ctx.beginPath();
        ctx.moveTo(gx, y);
        ctx.lineTo(gx, y + h);
        ctx.stroke();
      }
    } else {
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, '#7ccb57');
      g.addColorStop(1, '#5fb447');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      // Meandering paths.
      ctx.strokeStyle = '#f1e9d2';
      ctx.lineCap = 'round';
      ctx.lineWidth = 3 * s;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.moveTo(x, y + h * rand.range(0.1, 0.9));
        ctx.bezierCurveTo(x + w * 0.3, y + h * rand.range(0, 1), x + w * 0.7, y + h * rand.range(0, 1), x + w, y + h * rand.range(0.1, 0.9));
        ctx.stroke();
      }
      if (blk.use === 'green') {
        // Pond.
        const cx = X(0);
        const cz = Z(-22);
        ctx.fillStyle = '#e9e3cf';
        ctx.beginPath();
        ctx.ellipse(cx, cz, 32 * s, 20 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        const pg = ctx.createRadialGradient(cx, cz, 2, cx, cz, 30 * s);
        pg.addColorStop(0, '#1aa6c4');
        pg.addColorStop(0.8, '#38c8d8');
        pg.addColorStop(1, '#8be6e6');
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.ellipse(cx, cz, 29 * s, 17.5 * s, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (blk.use === 'plaza') {
        const cx = X(LANDMARKS.plaza.x);
        const cz = Z(LANDMARKS.plaza.z);
        ctx.fillStyle = '#f2f5f6';
        ctx.beginPath();
        ctx.arc(cx, cz, 40 * s, 0, Math.PI * 2);
        ctx.fill();
        for (let r = 40; r > 25; r -= 3) {
          ctx.strokeStyle = r % 6 === 1 ? '#c9d7df' : '#dde6eb';
          ctx.lineWidth = 1.2 * s;
          ctx.beginPath();
          ctx.arc(cx, cz, r * s, 0, Math.PI * 2);
          ctx.stroke();
        }
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * 25 * s, cz + Math.sin(a) * 25 * s);
          ctx.lineTo(cx + Math.cos(a) * 40 * s, cz + Math.sin(a) * 40 * s);
          ctx.stroke();
        }
        // Pool water (the animated pool mesh sits on top of this).
        ctx.fillStyle = '#2fbfd0';
        ctx.beginPath();
        ctx.arc(cx, cz, 24 * s, 0, Math.PI * 2);
        ctx.fill();
      }
      if (blk.use === 'dome') {
        ctx.strokeStyle = '#f1e9d2';
        ctx.lineWidth = 4 * s;
        for (const d of city.domes) {
          ctx.beginPath();
          ctx.arc(X(d.x), Z(d.z), (d.r + 3) * s, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // Streets and avenues.
  const road = (x0, z0, x1, z1, width) => {
    ctx.strokeStyle = '#d2dade';
    ctx.lineWidth = (width + 3) * s;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(X(x0), Z(z0));
    ctx.lineTo(X(x1), Z(z1));
    ctx.stroke();
    ctx.strokeStyle = '#9fb0bb';
    ctx.lineWidth = width * s;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 0.35 * s;
    ctx.setLineDash([3 * s, 3 * s]);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  for (const z of AVENUES_Z) road(-372, z, 378, z, z === 20 ? 12 : 9);
  for (const x of STREETS_X) road(x, 20, x, -340, 8);
  // Zebra crossings.
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  for (const x of STREETS_X) {
    for (const z of AVENUES_Z) {
      for (let k = -3; k <= 3; k++) ctx.fillRect(X(x + k * 1.2) - 0.3 * s, Z(z + 7), 0.6 * s, 2.5 * s);
    }
  }

  // Soft contact shadows and long morning shadows away from the sun. Drawn
  // into a quarter-resolution layer and composited once with a single blur,
  // which is far cheaper than filtering every shape.
  const sx = -SUN.x / Math.hypot(SUN.x, SUN.z);
  const sz = -SUN.z / Math.hypot(SUN.x, SUN.z);
  const slope = Math.hypot(SUN.x, SUN.z) / SUN.y;
  const q = 4;
  const shadow = document.createElement('canvas');
  shadow.width = MAP_W / q;
  shadow.height = Math.ceil(MAP_H / q);
  const sh = shadow.getContext('2d');
  sh.scale(1 / q, 1 / q);
  for (const f of city.footprints) {
    const len = Math.min(f.h * slope, 160);
    sh.fillStyle = 'rgba(40,70,90,0.13)';
    sh.beginPath();
    sh.moveTo(X(f.x - sz * f.r), Z(f.z + sx * f.r));
    sh.lineTo(X(f.x + sx * len - sz * f.r * 0.8), Z(f.z + sz * len + sx * f.r * 0.8));
    sh.lineTo(X(f.x + sx * len + sz * f.r * 0.8), Z(f.z + sz * len - sx * f.r * 0.8));
    sh.lineTo(X(f.x + sz * f.r), Z(f.z - sx * f.r));
    sh.closePath();
    sh.fill();
    sh.fillStyle = 'rgba(30,50,70,0.28)';
    sh.beginPath();
    sh.arc(X(f.x), Z(f.z), (f.r + 2.5) * s, 0, Math.PI * 2);
    sh.fill();
  }
  sh.fillStyle = 'rgba(30,60,40,0.25)';
  for (const t of city.trees) {
    if (t.y > GROUND + 0.5) continue;
    sh.beginPath();
    sh.ellipse(X(t.x + sx * t.s * 0.4), Z(t.z + sz * t.s * 0.4), t.s * 0.5 * s, t.s * 0.4 * s, 0, 0, Math.PI * 2);
    sh.fill();
  }
  ctx.save();
  ctx.filter = 'blur(3px)';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(shadow, 0, 0, MAP_W, shadow.height * q);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

export function buildTerrain() {
  const cols = 240;
  const rows = 150;
  const xMin = -1700;
  const xMax = 1700;
  const zFar = -1500;
  const pos = [];
  const uv = [];
  const idx = [];
  // Row 0 is a skirt that dips under the water just past the shoreline.
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const x = xMin + ((xMax - xMin) * i) / cols;
      const shore = shoreZ(x);
      let z;
      let y;
      if (j === 0) {
        z = shore + 7;
        y = -4;
      } else {
        const v = (j - 1) / (rows - 1);
        z = shore + (zFar - shore) * Math.pow(v, 1.5);
        y = groundHeight(x, z);
      }
      pos.push(x, y, z);
      uv.push((x - MAP.x0) / (MAP.x1 - MAP.x0), (z - MAP.z0) / (MAP.z1 - MAP.z0));
    }
  }
  const W = cols + 1;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * W + i;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function makeGroundMaterial(map) {
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${noise}`)
      .replace(
        '#include <map_fragment>',
        `
        vec4 cityTex = texture2D(map, vMapUv);
        vec2 q = vWPos.xz;
        float n1 = snoise(q * 0.004);
        float n2 = snoise(q * 0.017 + 4.0);
        float n3 = snoise(q * 0.06 + 9.0);
        vec3 grass = mix(vec3(0.13, 0.42, 0.06), vec3(0.24, 0.55, 0.08), n1 * 0.5 + 0.5);
        grass = mix(grass, vec3(0.06, 0.26, 0.05), smoothstep(0.35, 0.7, n2) * 0.65);
        grass *= 0.9 + 0.12 * n3;
        // Sunny meadow highlights on the hill tops.
        grass = mix(grass, vec3(0.42, 0.62, 0.12), smoothstep(40.0, 110.0, vWPos.y) * 0.35);
        float beach = smoothstep(4.5, 2.0, vWPos.y) * (1.0 - step(abs(vWPos.x), 372.0) * step(vWPos.z, 60.0));
        grass = mix(grass, vec3(0.82, 0.74, 0.55), beach);
        float inMap = step(0.0, vMapUv.x) * step(vMapUv.x, 1.0) * step(0.0, vMapUv.y) * step(vMapUv.y, 1.0);
        float edge = min(min(vMapUv.x, 1.0 - vMapUv.x) * 940.0, min(vMapUv.y, 1.0 - vMapUv.y) * 580.0);
        float cityMix = inMap * smoothstep(0.0, 40.0, edge);
        diffuseColor.rgb *= mix(grass, cityTex.rgb, cityMix);
        `,
      );
  };
  mat.customProgramCacheKey = () => 'ecocity-ground';
  return mat;
}

export function buildMountains() {
  const rand = makeRandom(5);
  const pos = [];
  const idx = [];
  const n = 160;
  const layers = [
    { z: -2050, h: 260, amp: 1, col: 0 },
    { z: -1750, h: 170, amp: 0.8, col: 1 },
  ];
  const colors = [];
  layers.forEach((L, li) => {
    const base = pos.length / 3;
    const ph = rand.range(0, 10);
    for (let i = 0; i <= n; i++) {
      const x = -3600 + (7200 * i) / n;
      const ridge =
        L.h * (0.55 + 0.3 * Math.sin(x * 0.0021 + ph) + 0.18 * Math.sin(x * 0.0057 + ph * 2) + 0.08 * Math.sin(x * 0.017 + ph));
      const z = L.z - 200 * Math.sin(x * 0.001 + ph);
      pos.push(x, -10, z, x, ridge * L.amp, z);
      const c = li === 0 ? [0.42, 0.6, 0.78] : [0.3, 0.5, 0.62];
      colors.push(...c, ...c.map((v) => v * 1.25));
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(idx);
  return g;
}
