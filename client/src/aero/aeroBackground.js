/*
 * Aero Skyline: a looping Frutiger Aero drone flight rendered with three.js.
 *
 * Two ways to use it:
 *
 * 1) Inside an existing renderer (e.g. React Three Fiber):
 *      const world = createAeroWorld({ renderer, scene, camera, speed: 1 });
 *      each frame:  world.update(deltaSeconds); world.render();
 *      cleanup:     world.dispose();
 *    It takes over the camera, adds its objects under one group in `scene`,
 *    and restores the renderer/scene settings it changed on dispose.
 *
 * 2) Standalone on a <canvas>:
 *      const aero = createAeroBackground(canvas, { speed: 1 });
 *      aero.setPaused(true); aero.setSpeed(0.5); aero.destroy();
 *
 * Options: speed (multiplier), quality ('auto' | 'high' | 'low'), start (0..1 loop position),
 *          (default start 0.08: low over the meadow, facing the skyline)
 *          onTelemetry(({ altitude, speedKmh, zone, progress }) => ...) called ~4x per second.
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Water } from 'three/addons/objects/Water.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createMountainGeometry } from './mountainGeometry.js';
import { createLakeNormalPixels } from './lakeNormals.js';
import { createFlockInstances } from './flock/world-instances.js';
import flockCameraUrl from './flock/flock-camera-world.glb?url';

const TAU = Math.PI * 2;

export function createAeroWorld({ renderer, scene, camera, speed = 1, quality = 'auto', start = 0.08, onTelemetry = null } = {}) {
  const opts = { speed, quality, start, onTelemetry };

  /* ------------------------------------------------------------------ helpers */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // The main random stream is fixed so the scene looks the same every load.
  // Later additions use their own streams (withRng) so they never reshuffle the original layout.
  let rng = mulberry32(20261010);
  const rnd = () => rng();
  function withRng(seed, fn) { const prev = rng; rng = mulberry32(seed); try { return fn(); } finally { rng = prev; } }
  const R = (a, b) => a + (b - a) * rnd();
  const RI = (a, b) => Math.floor(R(a, b + 1));
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.2;
  const col = (hex) => new THREE.Color(hex); // sRGB hex -> linear working space
  const hsl = (h, s, l) => new THREE.Color().setHSL(h, s, l, THREE.SRGBColorSpace);
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const hexMul = (hex, f) => { const c = new THREE.Color(hex); c.r = Math.min(1, c.r * f); c.g = Math.min(1, c.g * f); c.b = Math.min(1, c.b * f); return '#' + c.getHexString(); };
  const hexRGB = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

  function hash3(i, j, k) {
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const L = (a, b, t) => a + (b - a) * t;
    const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
    return L(
      L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
      L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
  }

  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const small = opts.quality === 'low' || (opts.quality === 'auto' && coarse);
  const Q = small ? 0.55 : 1;
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionMul = reduceMotion ? 0.5 : 1;

  /* ------------------------------------------------- renderer / scene setup */
  const prev = {
    autoClear: renderer.autoClear, toneMapping: renderer.toneMapping,
    shadow: renderer.shadowMap.enabled, shadowType: renderer.shadowMap.type, shadowAuto: renderer.shadowMap.autoUpdate,
    fog: scene.fog, environment: scene.environment, background: scene.background,
    fov: camera.fov, near: camera.near, far: camera.far,
  };
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const ANISO = renderer.capabilities.getMaxAnisotropy();
  const root = new THREE.Group();
  root.name = 'aero-world';
  scene.add(root);
  scene.background = null;
  camera.fov = 66; camera.near = 0.3; camera.far = 6500; camera.updateProjectionMatrix();

  const textures = [];
  function tex(c, repeat, color = true) {
    const t = new THREE.CanvasTexture(c);
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = ANISO;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    textures.push(t);
    return t;
  }

  const FOG_BASE = col('#cfeaff'), FOG_WHITE = col('#f4f9ff');
  scene.fog = new THREE.FogExp2(FOG_BASE.clone(), 0.00032);
  const SUN = new THREE.Vector3(0.45, 0.5, -0.74).normalize();
  const U = { time: { value: 0 } };

  /* ------------------------------------------------------------------- sky */
  const skyVS = `varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
  const skyFS = `
  uniform vec3 sunDir;uniform float env;uniform float uTime;varying vec3 vDir;
  float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
  float fbm(vec2 p){float s=0.0,a=0.5;for(int i=0;i<5;i++){s+=a*vn(p);p*=2.03;a*=0.5;}return s;}
  void main(){
    vec3 d=normalize(vDir);float h=d.y;
    vec3 zen=vec3(0.015,0.19,0.80),mid=vec3(0.13,0.50,0.96),hor=vec3(0.80,0.93,1.0);
    vec3 c=mix(hor,mid,smoothstep(0.0,0.28,h));c=mix(c,zen,smoothstep(0.24,0.95,h));
    if(h>0.02){vec2 uv=d.xz/(h+0.18)*1.6+vec2(uTime*0.004,0.0);
      float w=fbm(uv*vec2(0.6,2.4));c=mix(c,vec3(1.0),smoothstep(0.58,0.85,w)*0.38*smoothstep(0.02,0.25,h));}
    if(h<0.0){vec3 g=env>0.5?vec3(0.36,0.62,0.30):hor;c=mix(hor,g,smoothstep(0.0,-0.18,h));}
    float s=max(dot(d,sunDir),0.0);
    c+=vec3(1.0,0.98,0.92)*(pow(s,900.0)*3.0+pow(s,40.0)*0.32+pow(s,6.0)*0.12);
    if(env>0.5)c=pow(c,vec3(2.2));
    gl_FragColor=vec4(c,1.0);
  }`;
  const skyMat = (env) => new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: SUN }, env: { value: env ? 1 : 0 }, uTime: U.time },
    vertexShader: skyVS, fragmentShader: skyFS, side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5200, 48, 24), skyMat(false));
  sky.renderOrder = -2; root.add(sky);
  {
    const pm = new THREE.PMREMGenerator(renderer);
    const es = new THREE.Scene();
    const m = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), skyMat(true));
    es.add(m);
    scene.environment = pm.fromScene(es, 0.02, 0.1, 100).texture;
    m.geometry.dispose(); m.material.dispose(); pm.dispose();
  }

  function sunTex() {
    const c = cv(512, 512), g = c.getContext('2d');
    const gr = g.createRadialGradient(256, 256, 0, 256, 256, 256);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.06, 'rgba(255,255,250,1)');
    gr.addColorStop(0.16, 'rgba(255,250,230,.55)'); gr.addColorStop(0.4, 'rgba(200,235,255,.12)'); gr.addColorStop(1, 'rgba(200,235,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512); g.translate(256, 256);
    for (let i = 0; i < 14; i++) {
      g.save(); g.rotate((i / 14) * TAU + (i % 2) * 0.1);
      const L = i % 2 ? 150 : 230, lg = g.createLinearGradient(0, 0, L, 0);
      lg.addColorStop(0, 'rgba(255,255,255,.75)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg; g.beginPath(); g.moveTo(0, -3); g.lineTo(L, 0); g.lineTo(0, 3); g.fill(); g.restore();
    }
    return tex(c);
  }
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex(), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
  sunSprite.scale.set(1500, 1500, 1); sunSprite.renderOrder = -1; root.add(sunSprite);

  /* ---------------------------------------------------------------- lights */
  root.add(new THREE.HemisphereLight(col('#d6ecff'), col('#6fae3c'), 2.2));
  const sunL = new THREE.DirectionalLight(col('#fff6e5'), 3.6);
  sunL.position.copy(SUN).multiplyScalar(700);
  sunL.castShadow = true;
  sunL.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  Object.assign(sunL.shadow.camera, { left: -340, right: 340, top: 340, bottom: -340, near: 1, far: 1700 });
  sunL.shadow.bias = -0.0004; sunL.shadow.normalBias = 0.6;
  root.add(sunL, sunL.target);

  /* ----------------------------------------------------------- flight path */
  const P = [[60, 3, 800], [32, 2.2, 700], [28, 2.6, 580], [33, 7, 450], [35, 19, 330], [35, 29, 240], [35, 34, 140], [35, 37, 40], [35, 39, -12], [30, 41, -30], [15, 42, -35], [-40, 44, -35], [-85, 46, -36], [-101, 48, -48], [-105, 51, -100], [-105, 56, -170], [-103, 66, -235], [-85, 90, -310], [-40, 140, -400], [60, 215, -480], [220, 280, -460], [380, 300, -300], [440, 282, -60], [420, 222, 180], [330, 130, 380], [230, 50, 560], [140, 12, 740]];
  const curve = new THREE.CatmullRomCurve3(P.map((p) => new THREE.Vector3(...p)), true, 'centripetal');
  curve.arcLengthDivisions = 4000;
  const LEN = curve.getLength();
  const pathPts = curve.getSpacedPoints(1400);
  const meadowPts = curve.getSpacedPoints(4000).filter((p) => p.y < 12 && p.z > 300);
  function clearOfPath(x, y, z, r) {
    const r2 = r * r;
    for (const p of pathPts) { const dx = p.x - x, dy = p.y - y, dz = p.z - z; if (dx * dx + dy * dy + dz * dz < r2) return false; }
    return true;
  }
  function nearMeadow(spread) { const p = pick(meadowPts); return [p.x + gauss() * spread, p.z + gauss() * spread, p]; }

  /* ---------------------------------------------------------------- ground */
  function grassCanvas() {
    const S = 512, c = cv(S, S), g = c.getContext('2d');
    g.fillStyle = '#5cba2c'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) {
      const x = R(0, S), y = R(0, S), r = R(30, 90), light = rnd() < 0.5;
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, light ? 'rgba(200,255,120,.10)' : 'rgba(20,90,10,.10)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
    for (let i = 0; i < 11000; i++) { g.fillStyle = `hsl(${R(84, 112)},${R(55, 78)}%,${R(30, 58)}%)`; g.fillRect(R(0, S), R(0, S), R(1, 2.2), R(2, 6)); }
    return c;
  }
  const grassCanvasEl = grassCanvas();
  const grassTex = tex(grassCanvasEl, true); grassTex.repeat.set(380, 380);
  // Flat plain in the middle, rising into rolling rim hills from ~1150 m out.
  function groundY(x, z) {
    const rim = sstep(1150, 2700, Math.hypot(x, z - 150));
    return rim * (110 + 80 * Math.sin(x * 0.0021) * Math.cos(z * 0.0017) + 38 * Math.sin(x * 0.005 + z * 0.004)) - 0.02;
  }
  {
    const g = new THREE.PlaneGeometry(9000, 9000, 200, 200); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, groundY(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: grassTex }));
    m.receiveShadow = true; root.add(m);
  }
  {
    const mm = new THREE.MeshLambertMaterial({ color: col('#8fb9d6'), flatShading: true });
    const sm = new THREE.MeshLambertMaterial({ color: col('#ffffff'), flatShading: true });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU + R(-0.1, 0.1), r = R(3500, 3950), h = R(380, 720), rad = R(380, 620);
      const c = new THREE.Mesh(createMountainGeometry(rad, h), [mm, sm]);
      c.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); c.rotation.y = R(0, TAU); root.add(c);
    }
  }
  function roadCanvas() {
    const S = 256, c = cv(S, S), g = c.getContext('2d'), rw = (13 / 70) * S;
    g.fillStyle = '#5f6973'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#d7e0e8'; g.fillRect(rw - 6, rw - 6, S - 2 * rw + 12, S - 2 * rw + 12);
    g.fillStyle = '#c4ced8'; g.fillRect(rw, rw, S - 2 * rw, S - 2 * rw);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1;
    for (let i = rw; i < S - rw; i += 12) { g.beginPath(); g.moveTo(i, rw); g.lineTo(i, S - rw); g.stroke(); }
    g.fillStyle = '#f6d84a';
    for (let i = rw; i < S - rw; i += 14) { g.fillRect(0, i, 1.5, 8); g.fillRect(S - 1.5, i, 1.5, 8); g.fillRect(i, 0, 8, 1.5); g.fillRect(i, S - 1.5, 8, 1.5); }
    g.fillStyle = 'rgba(255,255,255,.85)';
    for (const [x0, y0] of [[0, 0], [S, 0], [0, S], [S, S]]) for (let k = 0; k < 5; k++) {
      const o = 4 + k * 4.5;
      g.fillRect(x0 ? S - rw + 2 : rw - 8, y0 ? S - rw + o : o, 6, 2.2);
      g.fillRect(x0 ? S - rw + o : o, y0 ? S - rw + 2 : rw - 8, 2.2, 6);
    }
    return c;
  }
  {
    // One street grid (x -665..665) in two pieces: downtown + east/west districts (z -265..245)
    // and the north district (z -735..-485). It stops at the quays so it never sits under the lake.
    // UVs come from world position so every piece lines up with the 70 m blocks.
    const t = tex(roadCanvas(), true);
    const mat = new THREE.MeshLambertMaterial({ map: t, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    for (const [z0, z1] of [[-265, 245], [-735, -485]]) {
      const g = new THREE.PlaneGeometry(1330, z1 - z0); g.rotateX(-Math.PI / 2); g.translate(0, 0.05, (z0 + z1) / 2);
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + 665) / 70, -(pos.getZ(i) + 735) / 70);
      const m = new THREE.Mesh(g, mat); m.receiveShadow = true; root.add(m);
    }
  }

  /* --------------------------------------------------------------- facades */
  const STYLES = {
    blue: { frame: '#dfe9f3', mx: 3, my: 3, sp: 9, spc: '#a9c3df', panes: ['#1d5ec8', '#2c78de', '#3a8cf0', '#2468d2', '#4a9cf5'], metal: 0.6, pilasters: false },
    white: { frame: '#f5f8fb', mx: 9, my: 10, sp: 0, panes: ['#2f6688', '#3d7fa3', '#28597a', '#4b8db0'], metal: 0.35, pilasters: true },
    teal: { frame: '#d3eeee', mx: 3, my: 3, sp: 4, spc: '#9fd6d8', panes: ['#26aebf', '#3cc4cf', '#58d2da', '#1f97aa'], fins: true, metal: 0.55 },
    silver: { frame: '#f2f5f8', mx: 3, my: 3, sp: 16, spc: '#ffffff', panes: ['#7c97b2', '#93adc6', '#6886a3', '#a5bdd3'], metal: 0.5, pilasters: true },
    deep: { frame: '#a9c0d8', mx: 2, my: 2, sp: 0, panes: ['#123c8c', '#1a4ea6', '#0f3478', '#1d5ab8'], metal: 0.75 },
  };
  const STYLE_KEYS = Object.keys(STYLES);
  const RU = 1 / 1024, RV = 1 / 1024; // UV of a frame-coloured texel, used for roofs

  // Colour map plus a matching roughness (G) / metalness (B) map: matte frames, mirror glass.
  function facadeTextures(s) {
    const S = 512, cw = 128, rh = 128, sc = 2;
    const c = cv(S, S), g = c.getContext('2d');
    const rm = cv(S, S), r = rm.getContext('2d');
    g.fillStyle = s.frame; g.fillRect(0, 0, S, S);
    r.fillStyle = 'rgb(0,170,25)'; r.fillRect(0, 0, S, S);
    const mx = s.mx * sc, my = s.my * sc, sp = s.sp * sc;
    for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) {
      const x = k * cw + mx, y = row * rh + my, w = cw - 2 * mx, h = rh - 2 * my - sp;
      const base = pick(s.panes);
      const gr = g.createLinearGradient(x, y, x + w * 0.6, y + h);
      gr.addColorStop(0, hexMul(base, 1.4)); gr.addColorStop(0.55, base); gr.addColorStop(1, hexMul(base, rnd() < 0.15 ? 0.75 : 0.95));
      g.fillStyle = gr; g.fillRect(x, y, w, h);
      // centre mullion splits each bay into two panes
      g.fillStyle = s.frame; g.fillRect(x + w / 2 - 1.5, y, 3, h);
      // diagonal sky glint
      g.fillStyle = 'rgba(255,255,255,.14)';
      g.beginPath(); g.moveTo(x + w * 0.1, y); g.lineTo(x + w * 0.38, y); g.lineTo(x + w * 0.1, y + h); g.lineTo(x, y + h); g.lineTo(x, y + h * 0.65); g.closePath(); g.fill();
      // interior: blinds, ceiling light strip, occasional plants
      if (rnd() < 0.22) { g.fillStyle = 'rgba(235,245,255,.42)'; const bh = h * R(0.2, 0.55); g.fillRect(x, y, w, bh); g.fillStyle = 'rgba(180,200,220,.35)'; for (let yy = y + 3; yy < y + bh; yy += 4) g.fillRect(x, yy, w, 1); }
      g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x + 4, y + 6, w - 8, 2);
      if (rnd() < 0.08) { g.fillStyle = 'rgba(40,120,40,.55)'; g.beginPath(); g.arc(x + R(10, w - 10), y + h - 8, 7, 0, TAU); g.fill(); }
      // mullion edge highlights
      g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(x - 1, y, 1, h); g.fillRect(x, y - 1, w, 1);
      g.fillStyle = 'rgba(0,30,60,.25)'; g.fillRect(x + w, y, 1, h); g.fillRect(x, y + h, w, 1);
      // spandrel panel with seam lines
      if (sp) { g.fillStyle = s.spc; g.fillRect(k * cw, y + h, cw, sp); g.fillStyle = 'rgba(0,30,60,.12)'; g.fillRect(k * cw, y + h + sp - 2, cw, 2); }
      r.fillStyle = `rgb(0,${Math.round(R(10, 28))},${Math.round(s.metal * 255)})`; r.fillRect(x, y, w, h);
      r.fillStyle = 'rgb(0,170,25)'; r.fillRect(x + w / 2 - 1.5, y, 3, h);
    }
    if (s.fins) { g.fillStyle = '#e9fbfb'; for (let k = 0; k < 8; k++) g.fillRect(k * 64 - 2, 0, 4, S); }
    g.fillStyle = s.frame; g.fillRect(0, S - 6, 6, 6);
    return { map: tex(c, true), rough: tex(rm, true, false) };
  }
  const MAT = {};
  for (const k of STYLE_KEYS) {
    const t = facadeTextures(STYLES[k]);
    MAT[k] = new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.rough, metalnessMap: t.rough, roughness: 1, metalness: 1, envMapIntensity: 1.35 });
  }
  function helipadTex() {
    const c = cv(256, 256), g = c.getContext('2d');
    g.fillStyle = '#5b6672'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#ffffff'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 100, 0, TAU); g.stroke();
    g.strokeStyle = '#ffd23a'; g.lineWidth = 6; g.beginPath(); g.arc(128, 128, 118, 0, TAU); g.stroke();
    g.fillStyle = '#ffffff'; g.fillRect(88, 72, 18, 112); g.fillRect(150, 72, 18, 112); g.fillRect(88, 119, 80, 18);
    return tex(c);
  }
  const roofGrassTex = tex(grassCanvasEl, true);
  Object.assign(MAT, {
    trim: new THREE.MeshStandardMaterial({ color: col('#f3f7fb'), metalness: 0.15, roughness: 0.35 }),
    podium: new THREE.MeshStandardMaterial({ color: col('#dbe6f0'), metalness: 0.2, roughness: 0.4 }),
    capglass: new THREE.MeshStandardMaterial({ color: col('#8fd6ff'), metalness: 0.9, roughness: 0.06, envMapIntensity: 1.6 }),
    lobby: new THREE.MeshStandardMaterial({ color: col('#b9e6ff'), metalness: 0.85, roughness: 0.05, envMapIntensity: 1.5 }),
    units: new THREE.MeshLambertMaterial({ color: col('#b7c3ce') }),
    dark: new THREE.MeshStandardMaterial({ color: col('#4a5560'), metalness: 0.6, roughness: 0.4 }),
    red: new THREE.MeshBasicMaterial({ color: col('#ff3b3b') }),
    bridge: new THREE.MeshStandardMaterial({ color: col('#e8302f'), metalness: 0.35, roughness: 0.35 }),
    deck: new THREE.MeshLambertMaterial({ color: col('#d8dde3') }),
    helipad: new THREE.MeshLambertMaterial({ map: helipadTex() }),
    roofgrass: new THREE.MeshLambertMaterial({ map: roofGrassTex }),
    solar: new THREE.MeshStandardMaterial({ color: col('#1b3f8f'), metalness: 0.8, roughness: 0.15, envMapIntensity: 1.4 }),
  });

  const GEO = {};
  let sink = false; // when true, geometry is generated (to keep the random stream in step) but thrown away
  const add = (k, g) => { if (sink) { g.dispose(); return; } (GEO[k] || (GEO[k] = [])).push(g); };
  function facadeBox(w, h, d, hs = 1) {
    const g = new THREE.BoxGeometry(w, h, d, 1, hs, 1), uv = g.attributes.uv, n = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, RU, RV);
      else { const fw = Math.abs(n.getX(i)) > 0.5 ? d : w; uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(fw / 12)), (uv.getY(i) * h) / 16); }
    }
    return g;
  }
  function box(k, x, y, z, w, h, d, ry = 0) {
    const g = STYLES[k] ? facadeBox(w, h, d) : new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z); add(k, g);
  }
  function cyl(k, x, y, z, r, h, seg = 28, r2 = r) {
    const g = new THREE.CylinderGeometry(r2, r, h, seg, 1);
    if (STYLES[k]) {
      const uv = g.attributes.uv, n = g.attributes.normal;
      const side = 2 * r * Math.sin(Math.PI / seg) * seg;
      const rep = seg <= 12 ? seg * Math.max(1, Math.round(side / seg / 12)) : Math.max(2, Math.round(side / 12));
      for (let i = 0; i < uv.count; i++) {
        if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, RU, RV); else uv.setXY(i, uv.getX(i) * rep, (uv.getY(i) * h) / 16);
      }
    }
    if (seg === 8) g.rotateY(Math.PI / 8);
    g.translate(x, y, z); add(k, g);
  }
  const OCC_BOXES = [];
  const TREES = [], DTREES = [];
  let treeList = TREES;
  const tree = (x, z, s, kind = 'round', y = 0) => { if (!sink) treeList.push({ x, y, z, s, kind }); };
  const occ = (b) => { if (!sink) OCC_BOXES.push(b); };

  function antenna(x, top, z, ah) {
    cyl('dark', x, top + ah / 2, z, 0.35, ah, 6, 0.18);
    for (let k = 1; k <= 3; k++) cyl('dark', x, top + (ah * k) / 4, z, 0.9 - k * 0.15, 0.3, 8);
    const s = new THREE.SphereGeometry(0.7, 8, 6); s.translate(x, top + ah, z); add('red', s);
  }
  function crown(x, z, w, d, top, tall) {
    const c = rnd();
    if (c < 0.2) { // glass lantern crown with frame
      const ch = R(7, 14), p = 0.9;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('trim', x + sx * (w / 2 - p / 2), top + ch / 2, z + sz * (d / 2 - p / 2), p, ch, p);
      box('trim', x, top + ch - 0.6, z + (d / 2 - 0.4), w, 1.2, 0.8); box('trim', x, top + ch - 0.6, z - (d / 2 - 0.4), w, 1.2, 0.8);
      box('trim', x + (w / 2 - 0.4), top + ch - 0.6, z, 0.8, 1.2, d); box('trim', x - (w / 2 - 0.4), top + ch - 0.6, z, 0.8, 1.2, d);
      for (let k = 1; k < 4; k++) box('trim', x, top + (ch * k) / 4, z, w * 0.72, 0.3, d * 0.72);
      box('capglass', x, top + ch * 0.36, z, w * 0.7, ch * 0.72, d * 0.7);
      return top + ch * 0.72;
    }
    if (c < 0.36) { // glass pyramid on a trim plinth
      box('trim', x, top + 0.6, z, w + 0.8, 1.2, d + 0.8);
      const hh = R(6, 16), g = new THREE.ConeGeometry(0.7071, 1, 4); g.rotateY(Math.PI / 4); g.scale(w, hh, d); g.translate(x, top + 1.2 + hh / 2, z); add('capglass', g);
      return top + 1.2 + hh * 0.5;
    }
    if (c < 0.52 && w > 16 && d > 16) { // helipad
      box('trim', x, top + 0.8, z, w + 0.8, 1.6, d + 0.8);
      const r = Math.min(w, d) * 0.42;
      cyl('trim', x, top + 2.3, z, r, 1.4, 24);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; box('dark', x + Math.cos(a) * r * 0.6, top + 1.8, z + Math.sin(a) * r * 0.6, 0.5, 1.6, 0.5); }
      const pad = new THREE.CircleGeometry(r * 0.96, 32); pad.rotateX(-Math.PI / 2); pad.translate(x, top + 3.02, z); add('helipad', pad);
      return top + 3;
    }
    if (c < 0.68 && !tall) { // roof garden with glass balustrade
      box('trim', x, top + 0.6, z, w + 0.6, 1.2, d + 0.6);
      box('roofgrass', x, top + 1.4, z, w - 1.4, 0.4, d - 1.4);
      for (const [bw, bd, bx, bz] of [[w, 0.15, 0, d / 2 - 0.2], [w, 0.15, 0, -d / 2 + 0.2], [0.15, d, w / 2 - 0.2, 0], [0.15, d, -w / 2 + 0.2, 0]]) box('lobby', x + bx, top + 2.2, z + bz, bw, 2, bd);
      for (let k = 0, n = RI(3, 6); k < n; k++) tree(x + R(-w / 2 + 2.5, w / 2 - 2.5), z + R(-d / 2 + 2.5, d / 2 - 2.5), R(0.55, 0.9), rnd() < 0.3 ? 'conifer' : 'round', top + 1.6);
      box('trim', x + R(-w / 5, w / 5), top + 3, z + R(-d / 5, d / 5), R(3, 5), 3, R(3, 5)); // stair house
      return top + 1.6;
    }
    // mechanical roof: parapet, plant units, water tank, solar panels
    box('trim', x, top + 0.8, z, w + 1.2, 1.6, d + 1.2);
    box('units', x, top + 1.7, z, w - 0.6, 0.2, d - 0.6);
    for (let k = 0, n = RI(1, 3); k < n; k++) {
      const uw = R(2, w * 0.3), ud = R(2, d * 0.3), uh = R(1.5, 3.5), ux = x + R(-w / 4, w / 4), uz = z + R(-d / 4, d / 4);
      box('units', ux, top + 1.6 + uh / 2, uz, uw, uh, ud);
      cyl('dark', ux, top + 1.6 + uh + 0.25, uz, Math.min(uw, ud) * 0.3, 0.5, 10);
    }
    if (rnd() < 0.5) { const tx = x + R(-w / 4, w / 4), tz = z + R(-d / 4, d / 4); cyl('podium', tx, top + 4, tz, 1.6, 3, 12); cyl('dark', tx, top + 5.9, tz, 0.1, 0.8, 12, 1.7); for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box('dark', tx + sx, top + 2, tz + sz, 0.2, 1.6, 0.2); }
    if (rnd() < 0.5) for (let k = 0; k < 3; k++) { const g = new THREE.BoxGeometry(w * 0.25, 0.12, 1.6); g.rotateX(-0.35); g.translate(x - w * 0.3 + k * 0.01, top + 2.2, z - d * 0.35 + k * 2.2); add('solar', g); }
    return top + 1.6;
  }

  function addLedges(x, z, w, d, y0, y1, round) {
    for (let y = y0 + 16; y < y1 - 3; y += 16) {
      if (round) cyl('trim', x, y, z, w / 2 + 0.35, 0.45, 28);
      else box('trim', x, y, z, w + 0.5, 0.45, d + 0.5);
    }
  }
  function addVerticals(x, z, w, d, y0, y1, s) {
    const h = y1 - y0, ym = (y0 + y1) / 2;
    if (s.pilasters) for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('trim', x + sx * (w / 2 - 0.2), ym, z + sz * (d / 2 - 0.2), 1.1, h, 1.1);
    if (s.fins) {
      for (let fx = -w / 2 + 4.5; fx < w / 2 - 2; fx += 4.5) { box('trim', x + fx, ym, z + d / 2 + 0.35, 0.25, h, 0.7); box('trim', x + fx, ym, z - d / 2 - 0.35, 0.25, h, 0.7); }
      for (let fz = -d / 2 + 4.5; fz < d / 2 - 2; fz += 4.5) { box('trim', x + w / 2 + 0.35, ym, z + fz, 0.7, h, 0.25); box('trim', x - w / 2 - 0.35, ym, z + fz, 0.7, h, 0.25); }
    }
  }

  function tower(x, z, w, d, h, far) {
    const st = pick(STYLE_KEYS), s = STYLES[st];
    let base = 0;
    if (!far) {
      const r = rnd();
      if (r < 0.45) { // double-height glass lobby, columns, entrance canopy
        box('lobby', x, 3, z, w - 1.6, 6, d - 1.6);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('trim', x + sx * (w / 2 - 0.5), 3, z + sz * (d / 2 - 0.5), 1, 6, 1);
        box('trim', x, 6.3, z, w + 0.4, 0.6, d + 0.4);
        const side = RI(0, 3), cw = Math.min(w, d) * 0.5;
        if (side < 2) box('trim', x, 4.6, z + (side ? 1 : -1) * (d / 2 + 2), cw, 0.35, 4);
        else box('trim', x + (side === 2 ? 1 : -1) * (w / 2 + 2), 4.6, z, 4, 0.35, cw);
        base = 6.6;
      } else if (r < 0.75) {
        box('podium', x, 4.5, z, w + 4, 9, d + 4);
        box('lobby', x, 2, z, w + 4.1, 3, d + 4.1);
        box('trim', x, 9.2, z, w + 4.6, 0.5, d + 4.6);
        base = 9.4;
      }
    }
    const round = !far && rnd() < 0.12 && Math.abs(w - d) < 6;
    const octa = !round && !far && rnd() < 0.12 && Math.abs(w - d) < 6;
    if (round || octa) {
      const r = Math.min(w, d) / 2, seg = octa ? 8 : 28;
      cyl(st, x, base + (h - base) / 2, z, r, h - base, seg);
      if (round) addLedges(x, z, r * 2, r * 2, base, h, true);
      cyl('trim', x, h + 0.7, z, r + 0.6, 1.4, seg);
      let top = h + 1.4;
      if (rnd() < 0.6) { const h2 = R(8, 22); cyl(st, x, top + h2 / 2, z, r * 0.7, h2, seg); top += h2; cyl('trim', x, top + 0.5, z, r * 0.7 + 0.5, 1, seg); top += 1; }
      if (h > 120) antenna(x, top, z, R(14, 30));
      occ([x - r, x + r, top, z - r, z + r]);
      return top;
    }
    const fr = (h > 110 && rnd() < 0.55) ? (rnd() < 0.5 ? [0.66, 0.34] : [0.52, 0.3, 0.18]) : [1];
    let cw = w, cd = d, y0 = base;
    const total = h - base;
    for (let t = 0; t < fr.length; t++) {
      const hh = total * fr[t];
      box(st, x, y0 + hh / 2, z, cw, hh, cd);
      if (!far) { addLedges(x, z, cw, cd, y0, y0 + hh, false); addVerticals(x, z, cw, cd, y0, y0 + hh, s); }
      y0 += hh;
      if (t < fr.length - 1) { // setback terrace with planting
        box('trim', x, y0 + 0.5, z, cw + 0.8, 1, cd + 0.8);
        if (!far) {
          box('roofgrass', x, y0 + 1.15, z, cw - 1, 0.3, cd - 1);
          const nw = cw * R(0.68, 0.8), nd = cd * R(0.68, 0.8);
          for (let k = 0; k < 4; k++) { const sx = k & 1 ? 1 : -1, sz = k & 2 ? 1 : -1; tree(x + sx * (cw / 2 + nw / 2) / 2, z + sz * (cd / 2 + nd / 2) / 2, R(0.5, 0.75), 'round', y0 + 1.3); }
          cw = nw; cd = nd;
        } else { cw *= 0.75; cd *= 0.75; }
        y0 += 1;
      }
    }
    let top = far ? (box('trim', x, y0 + 0.8, z, cw + 1.2, 1.6, cd + 1.2), y0 + 1.6) : crown(x, z, cw, cd, y0, h > 160);
    if (h > 150 && rnd() < 0.55) antenna(x + R(-cw / 5, cw / 5), top, z + R(-cd / 5, cd / 5), R(14, 30));
    occ([x - w / 2, x + w / 2, top, z - d / 2, z + d / 2]);
    return top;
  }

  // Landmark 1: twisting teal glass tower
  function twistTower(x, z, w, h, turn) {
    box('podium', x, 5, z, w + 10, 10, w + 10); box('trim', x, 10.3, z, w + 10.6, 0.6, w + 10.6);
    box('lobby', x, 2.5, z, w + 10.2, 4, w + 10.2);
    const g = facadeBox(w, h, w, 80); g.translate(0, h / 2, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const a = (p.getY(i) / h) * turn, px = p.getX(i), pz = p.getZ(i); p.setXYZ(i, px * Math.cos(a) - pz * Math.sin(a), p.getY(i) + 10.6, px * Math.sin(a) + pz * Math.cos(a)); }
    g.computeVertexNormals(); g.translate(x, 0, z); add('teal', g);
    for (let y = 16; y < h - 4; y += 16) box('trim', x, y + 10.6, z, w + 0.7, 0.5, w + 0.7, (y / h) * turn);
    const top = h + 10.6;
    box('trim', x, top + 1, z, w + 1, 2, w + 1, turn);
    for (let k = 0; k < 4; k++) { const g2 = new THREE.BoxGeometry(1, 22, 1); g2.translate((w / 2) * (k & 1 ? 1 : -1), 11, (w / 2) * (k & 2 ? 1 : -1)); g2.rotateY(turn); g2.translate(x, top + 2, z); add('trim', g2); }
    const lan = new THREE.BoxGeometry(w * 0.8, 18, w * 0.8); lan.rotateY(turn); lan.translate(x, top + 11, z); add('capglass', lan);
    antenna(x, top + 22, z, 34);
    occ([x - w * 0.7, x + w * 0.7, top + 22, z - w * 0.7, z + w * 0.7]);
  }
  // Landmark 2: tiered tower with a needle spire
  function spireTower(x, z) {
    box('podium', x, 6, z, 46, 12, 46); box('lobby', x, 3, z, 46.2, 5, 46.2); box('trim', x, 12.3, z, 46.6, 0.6, 46.6);
    const tiers = [[36, 150], [28, 90], [20, 60], [13, 35]];
    let y = 12.6;
    for (const [w, h] of tiers) {
      box('blue', x, y + h / 2, z, w, h, w); addLedges(x, z, w, w, y, y + h, false); addVerticals(x, z, w, w, y, y + h, { pilasters: true });
      y += h; box('trim', x, y + 0.7, z, w + 1.4, 1.4, w + 1.4); y += 1.4;
    }
    box('capglass', x, y + 5, z, 9, 10, 9);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('trim', x + sx * 4.6, y + 5, z + sz * 4.6, 0.8, 10, 0.8);
    y += 10;
    cyl('trim', x, y + 40, z, 2.2, 80, 12, 0.15);
    const s = new THREE.SphereGeometry(0.9, 8, 6); s.translate(x, y + 80, z); add('red', s);
    occ([x - 18, x + 18, y + 80, z - 18, z + 18]);
  }

  /* ------------------------------------------------------------------ parks */
  const parkMat = new THREE.MeshLambertMaterial({ map: grassTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const pondMat = new THREE.MeshStandardMaterial({ color: col('#3aa6e0'), metalness: 0.5, roughness: 0.05, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const BUBS = [];
  const parkMeshes = [];
  function park(cx, cz, bubbles = true) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(44, 44), parkMat);
    m.rotation.x = -Math.PI / 2; m.position.set(cx, 0.1, cz); m.receiveShadow = true; root.add(m); parkMeshes.push(m);
    const px = cx + R(-6, 6), pz = cz + R(-6, 6);
    const pond = new THREE.Mesh(new THREE.CircleGeometry(7, 40), pondMat);
    pond.rotation.x = -Math.PI / 2; pond.position.set(px, 0.15, pz); root.add(pond);
    cyl('trim', px, 0.25, pz, 7.4, 0.5, 40);
    cyl('trim', px, 0.9, pz, 0.6, 1.6, 12); cyl('trim', px, 1.8, pz, 1.6, 0.3, 16);
    // curved footpath ring
    const ring = new THREE.RingGeometry(12, 13.6, 48); ring.rotateX(-Math.PI / 2); ring.translate(px, 0.2, pz); add('deck', ring);
    for (let i = 0; i < 16; i++) {
      const x = cx + R(-19, 19), z = cz + R(-19, 19), dd = Math.hypot(x - px, z - pz);
      if (dd > 9 && Math.abs(dd - 12.8) > 1.8) tree(x, z, R(1.5, 2.4), pick(['round', 'round', 'conifer', 'poplar']));
    }
    for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + 0.4; box('podium', px + Math.cos(a) * 14.6, 0.45, pz + Math.sin(a) * 14.6, 2.2, 0.15, 0.7, -a); }
    if (bubbles) for (let i = 0; i < 5; i++) BUBS.push({ x: cx + R(-15, 15), y: R(3, 20), z: cz + R(-15, 15), r: R(1, 3), rise: R(1.5, 3), range: 45 });
  }

  /* ----------------------------------------------------------- city blocks */
  const parks = new Set(['-2,1', '1,2', '2,-2', '-1,-2']);
  const landmarks = new Set(['0,0', '1,-1']);
  twistTower(0, 0, 30, 290, Math.PI / 2);
  spireTower(70, -70);
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
    const key = i + ',' + j, cx = i * 70, cz = j * 70;
    if (landmarks.has(key)) continue;
    if (parks.has(key)) { park(cx, cz); continue; }
    const cf = Math.exp(-(cx * cx + cz * cz) / (2 * 130 * 130));
    const H = () => 40 + 175 * cf * R(0.55, 1.15) + R(0, 45);
    const r = rnd();
    if (r < 0.28) tower(cx + R(-2, 2), cz + R(-2, 2), R(26, 35), R(26, 35), H() + 15);
    else if (r < 0.66) {
      const ax = rnd() < 0.5, dims = [], hs = [];
      for (const s of [-1, 1]) {
        const w = ax ? R(13, 17) : R(24, 37), d = ax ? R(24, 37) : R(13, 17), h = H();
        tower(cx + (ax ? s * 11 : 0), cz + (ax ? 0 : s * 11), w, d, h); dims.push([w, d]); hs.push(h);
      }
      // glass sky bridge between the pair
      const gap = ax ? 22 - (dims[0][0] + dims[1][0]) / 2 : 22 - (dims[0][1] + dims[1][1]) / 2;
      if (gap > 1.5) {
        const by = Math.min(...hs) * R(0.35, 0.6), len = gap + 1;
        box('lobby', cx, by, cz, ax ? len : 5, 4, ax ? 5 : len);
        box('trim', cx, by + 2.2, cz, ax ? len : 5.6, 0.4, ax ? 5.6 : len);
        box('trim', cx, by - 2.2, cz, ax ? len : 5.6, 0.4, ax ? 5.6 : len);
      }
    } else for (const sx of [-1, 1]) for (const sz of [-1, 1]) tower(cx + sx * 11 + R(-1, 1), cz + sz * 11 + R(-1, 1), R(11, 16), R(11, 16), H() * R(0.7, 1));
  }
  // The original sparse outer skyline is still generated with the main random stream so
  // everything after it keeps its layout, but its geometry is discarded and replaced by the
  // street-grid districts below.
  sink = true;
  for (const sg of [-1, 1]) for (let gx = 275; gx < 720; gx += 36) for (let gz = -228; gz <= 230; gz += 36) {
    if (rnd() > 0.55) continue;
    const fall = 1 - (gx - 270) / 560;
    tower(sg * (gx + R(-5, 5)), gz + R(-5, 5), R(13, 24), R(13, 24), 35 + R(20, 140) * fall, true);
  }
  for (let gx = -720; gx <= 720; gx += 38) for (let gz = -530; gz >= -820; gz -= 38) {
    if (rnd() > 0.5) continue;
    tower(gx + R(-6, 6), gz + R(-6, 6), R(14, 26), R(14, 26), R(50, 185), true);
  }
  sink = false;

  /* --------------------------------------------- outer districts on a street grid */
  // Grid: blocks are 70 m, centred on multiples of 70, streets on 35 + 70k (same as downtown).
  // East/west districts: |i| 4..9, j -3..3. North district (across the lake): j -8..-10.
  const inDistrict = (x, z) => (Math.abs(x) > 245 && Math.abs(x) < 665 && z > -245 && z < 245) || (z < -525 && z > -735 && Math.abs(x) < 665);
  function maxTowerH(x, z, r) {
    let lim = 1e9;
    for (const p of pathPts) { const dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz < (r + 35) ** 2) lim = Math.min(lim, p.y - 50); }
    return lim;
  }
  function districtBlock(cx, cz) {
    const scale = clamp(1.3 - Math.hypot(cx, cz) / 650, 0.35, 1);
    const r = rnd();
    if (r < 0.1) { park(cx, cz, false); return; }
    const H = () => 32 + R(25, 150) * scale + R(0, 20);
    const place = (x, z, w, d, h0) => {
      const h = Math.min(h0, maxTowerH(x, z, Math.max(w, d) * 0.75));
      if (h < 16) { for (let k = 0; k < 4; k++) tree(x + R(-w / 3, w / 3), z + R(-d / 3, d / 3), R(1.4, 2.2)); return 0; }
      tower(x, z, w, d, h, false);
      return h;
    };
    if (r < 0.32) place(cx + R(-2, 2), cz + R(-2, 2), R(24, 34), R(24, 34), H() + 10);
    else if (r < 0.68) {
      const ax = rnd() < 0.5, dims = [], hs = [];
      for (const sd of [-1, 1]) {
        const w = ax ? R(13, 17) : R(24, 37), d = ax ? R(24, 37) : R(13, 17);
        hs.push(place(cx + (ax ? sd * 11 : 0), cz + (ax ? 0 : sd * 11), w, d, H())); dims.push([w, d]);
      }
      const gap = ax ? 22 - (dims[0][0] + dims[1][0]) / 2 : 22 - (dims[0][1] + dims[1][1]) / 2;
      if (gap > 1.5 && Math.min(...hs) > 40) {
        const by = Math.min(...hs) * R(0.35, 0.6), len = gap + 1;
        box('lobby', cx, by, cz, ax ? len : 5, 4, ax ? 5 : len);
        box('trim', cx, by + 2.2, cz, ax ? len : 5.6, 0.4, ax ? 5.6 : len);
        box('trim', cx, by - 2.2, cz, ax ? len : 5.6, 0.4, ax ? 5.6 : len);
      }
    } else for (const sx of [-1, 1]) for (const sz of [-1, 1]) place(cx + sx * 11 + R(-1, 1), cz + sz * 11 + R(-1, 1), R(11, 16), R(11, 16), H() * R(0.6, 1));
  }
  withRng(424242, () => {
    treeList = DTREES;
    for (let i = -9; i <= 9; i++) for (let j = -10; j <= 3; j++) {
      const east = Math.abs(i) >= 4 && Math.abs(j) <= 3, north = j <= -8;
      if (east || north) districtBlock(i * 70, j * 70);
    }
    treeList = TREES;
  });

  /* -------------------------------------------------------- bridge + lake */
  function waterNormal() {
    const S = 256, c = cv(S, S), g = c.getContext('2d'), im = g.createImageData(S, S), a = TAU / S;
    const H = (x, y) => Math.sin(x * a * 3 + y * a * 2) * 0.5 + Math.sin(x * a * 7 - y * a * 5) * 0.3 + Math.sin(x * a * 13 + y * a * 11) * 0.15 + Math.sin(-x * a * 4 + y * a * 9) * 0.25 + Math.sin(x * a * 21 - y * a * 17) * 0.06;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const nx = -(H(x + 1, y) - H(x - 1, y)) * 5, ny = -(H(x, y + 1) - H(x, y - 1)) * 5, nz = 1, l = Math.hypot(nx, ny, nz), i = (y * S + x) * 4;
      im.data[i] = (nx / l * 0.5 + 0.5) * 255; im.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; im.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    return tex(c, true, false);
  }
  const wNorm = waterNormal(); wNorm.repeat.set(60, 6);
  {
    pondMat.normalMap = wNorm;
    // Quay walls with glass railings along both shores
    for (const qz of [-265, -485]) {
      box('podium', 0, 0.1, qz, 2400, 2.2, 2.6);
      box('trim', 0, 1.25, qz, 2400, 0.1, 3);
      box('lobby', 0, 1.85, qz + (qz > -375 ? 1.1 : -1.1), 2400, 1.1, 0.12);
      for (let x = -1190; x <= 1190; x += 10) box('trim', x, 1.85, qz + (qz > -375 ? 1.1 : -1.1), 0.18, 1.2, 0.18);
    }
    // Ferry piers
    for (const [px, qz, dir] of [[-150, -265, -1], [420, -265, -1], [-330, -485, 1], [60, -485, 1]]) {
      box('deck', px, 0.9, qz + dir * 14, 6, 0.6, 26);
      for (let k = 0; k < 4; k++) for (const sx of [-1, 1]) cyl('dark', px + sx * 2.6, 0.2, qz + dir * (4 + k * 7), 0.25, 2, 6);
      box('lobby', px, 2.6, qz + dir * 24, 5, 2.8, 4);
      box('trim', px, 4.15, qz + dir * 24, 6, 0.3, 5);
    }
    const bx = 200, z0 = -255, z1 = -495, dy = 12;
    box('deck', bx, dy, (z0 + z1) / 2, 14, 1.6, Math.abs(z1 - z0));
    for (let z = z0 - 8; z > z1; z -= 22) box('deck', bx, dy / 2, z, 6, dy, 3);
    for (const sx of [-1, 1]) {
      box('bridge', bx + sx * 6.5, dy + 1.5, (z0 + z1) / 2, 0.5, 1.4, 240);
      const tg = new THREE.TorusGeometry(70, 1.1, 8, 64, Math.PI); tg.scale(1, 0.55, 1); tg.rotateY(Math.PI / 2); tg.translate(bx + sx * 6, dy, -375); add('bridge', tg);
      for (let a = 0.18; a < Math.PI - 0.15; a += Math.PI / 18) { const zz = -375 + Math.cos(a) * 70, top = dy + Math.sin(a) * 70 * 0.55; box('bridge', bx + sx * 6, (dy + top) / 2, zz, 0.35, top - dy, 0.35); }
    }
    for (let a = 0.5; a < Math.PI - 0.45; a += Math.PI / 12) { const zz = -375 + Math.cos(a) * 70, top = dy + Math.sin(a) * 70 * 0.55; box('bridge', bx, top, zz, 12, 0.8, 0.8); }
  }

  /* --------------------------------------------------- merge static geometry */
  for (const k in GEO) {
    const list = GEO[k].map((g) => (g.index ? g.toNonIndexed() : g));
    const g = mergeGeometries(list);
    GEO[k].forEach((x) => x.dispose());
    const m = new THREE.Mesh(g, MAT[k]);
    m.castShadow = m.receiveShadow = k !== 'red';
    root.add(m);
  }

  /* ------------------------------------------------------------------- lake */
  function lakeNormals() {
    // Seamless ripple normal map: a sum of waves with whole-number frequencies so it tiles.
    const S = 512, c = cv(S, S), g = c.getContext('2d'), im = g.createImageData(S, S);
    const waves = withRng(8080, () => Array.from({ length: 48 }, (_, i) => {
      const k = 2 + Math.floor(R(0, 1) ** 2 * 40), a = R(0, TAU);
      return [Math.round(Math.cos(a) * k), Math.round(Math.sin(a) * k), R(0, TAU), 1 / (k ** 1.1)];
    }));
    createLakeNormalPixels(S, waves, im.data);
    g.putImageData(im, 0, 0);
    return tex(c, true, false);
  }
  const lakeGeo = new THREE.PlaneGeometry(2400, 220);
  const water = new Water(lakeGeo, {
    textureWidth: small ? 256 : 512, textureHeight: small ? 256 : 512,
    waterNormals: lakeNormals(), sunDirection: SUN.clone(), sunColor: 0xffffff,
    waterColor: 0x0a5aa8, distortionScale: 1.4, fog: true,
  });
  water.material.uniforms.size.value = 2.2;
  water.rotation.x = -Math.PI / 2; water.position.set(0, 0.4, -375);
  root.add(water);
  // Skip the reflection pass while the drone is down in the meadow, where the lake is hidden.
  const reflect = water.onBeforeRender;
  water.onBeforeRender = (r, sc, cam) => { if (cam.position.z < 280 || cam.position.y > 60) reflect.call(water, r, sc, cam); };

  // Boats: sailboats and small motor launches drifting along the lake, each with a wake
  const BOATS = [];
  withRng(9090, () => {
    const hullShape = new THREE.Shape();
    hullShape.moveTo(0, 4.2); hullShape.quadraticCurveTo(1.5, 2, 1.3, -3.6); hullShape.lineTo(-1.3, -3.6); hullShape.quadraticCurveTo(-1.5, 2, 0, 4.2);
    const hull = new THREE.ExtrudeGeometry(hullShape, { depth: 1.1, bevelEnabled: true, bevelSize: 0.15, bevelThickness: 0.15, bevelSegments: 2, curveSegments: 10 });
    hull.rotateX(-Math.PI / 2); hull.rotateY(Math.PI); hull.translate(0, -0.3, 0);
    const deck = new THREE.ShapeGeometry(hullShape, 10); deck.rotateX(-Math.PI / 2); deck.rotateY(Math.PI); deck.scale(0.9, 1, 0.9); deck.translate(0, 0.98, 0);
    const sail = new THREE.Shape(); sail.moveTo(0, 0); sail.lineTo(0, 9); sail.lineTo(3.4, 0.4); sail.closePath();
    const jib = new THREE.Shape(); jib.moveTo(0, 0); jib.lineTo(0, 7.5); jib.lineTo(-2.6, 0.2); jib.closePath();
    const sailGeo = new THREE.ShapeGeometry(sail); sailGeo.rotateY(Math.PI / 2); sailGeo.translate(0, 1.6, -0.4);
    const jibGeo = new THREE.ShapeGeometry(jib); jibGeo.rotateY(Math.PI / 2); jibGeo.translate(0, 1.4, 0.4);
    const wc = cv(128, 256), wg = wc.getContext('2d');
    for (let i = 0; i < 260; i++) { const t = rnd(), y = t * 256, spread = 6 + t * 54, side = rnd() < 0.5 ? -1 : 1; wg.fillStyle = `rgba(255,255,255,${(0.75 * (1 - t)).toFixed(2)})`; wg.beginPath(); wg.arc(64 + side * spread * R(0.75, 1), y, R(1.5, 3.5) * (1 - t * 0.5), 0, TAU); wg.fill(); }
    const wakeMat = new THREE.MeshBasicMaterial({ map: tex(wc), transparent: true, depthWrite: false, fog: true });
    const wakeGeo = new THREE.PlaneGeometry(7, 26); wakeGeo.rotateX(-Math.PI / 2); wakeGeo.translate(0, 0.08, -16);
    const hullMats = ['#ffffff', '#e8f1fa', '#ffffff', '#1d5ec8'].map((h) => new THREE.MeshStandardMaterial({ color: col(h), roughness: 0.35, metalness: 0.05 }));
    const deckMat = new THREE.MeshLambertMaterial({ color: col('#c89a62') });
    const sailMats = ['#ffffff', '#fff7e6', '#ff6a3d', '#2fb3ff'].map((h) => new THREE.MeshLambertMaterial({ color: col(h), side: THREE.DoubleSide }));
    const mastMat = new THREE.MeshLambertMaterial({ color: col('#d9dee4') }), glassMat = MAT.capglass;
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Group(), sailing = i < 8;
      g.add(new THREE.Mesh(hull, pick(hullMats)), new THREE.Mesh(deck, deckMat));
      if (sailing) {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 10, 6), mastMat); mast.position.y = 6; g.add(mast);
        const sm = pick(sailMats);
        g.add(new THREE.Mesh(sailGeo, sm), new THREE.Mesh(jibGeo, rnd() < 0.5 ? sm : sailMats[0]));
      } else {
        const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1, 2.4), glassMat); cab.position.set(0, 1.5, 0.4); g.add(cab);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(2, 0.15, 2.8), hullMats[0]); roof.position.set(0, 2.05, 0.3); g.add(roof);
      }
      const wake = new THREE.Mesh(wakeGeo, wakeMat); wake.renderOrder = 1; g.add(wake);
      const dir = rnd() < 0.5 ? 1 : -1;
      g.scale.setScalar(sailing ? 1 : 0.85);
      root.add(g);
      BOATS.push({ g, x: R(-600, 600), z: R(-450, -300), dir, v: sailing ? R(1.5, 3) : R(4, 7), ph: R(0, TAU), heel: sailing ? R(0.08, 0.16) : 0 });
    }
  });

  /* ------------------------------------------------------------ street lamps */
  const STREETS = [-175, -105, -35, 35, 105, 175];
  const LAMPS = []; // [x, z, ry]
  {
    const parts = [];
    const paint = (g, hex) => { const c = col(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };
    let g = new THREE.CylinderGeometry(0.08, 0.14, 7, 6); g.translate(0, 3.5, 0); parts.push(paint(g, '#e9eef3'));
    g = new THREE.BoxGeometry(0.1, 0.1, 2.2); g.translate(0, 6.9, 1.0); parts.push(paint(g, '#e9eef3'));
    g = new THREE.BoxGeometry(0.5, 0.18, 0.9); g.translate(0, 6.8, 2.0); parts.push(paint(g, '#ffffff'));
    g = new THREE.CylinderGeometry(0.22, 0.26, 0.4, 8); g.translate(0, 0.2, 0); parts.push(paint(g, '#8a99a8'));
    const lampGeo = mergeGeometries(parts); parts.forEach((p) => p.dispose());
    for (const c of STREETS) for (let s = -238; s <= 238; s += 30) {
      if (STREETS.some((o) => Math.abs(o - s) < 14)) continue;
      LAMPS.push([c + 9.5, s, -Math.PI / 2], [c - 9.5, s, Math.PI / 2], [s, c + 9.5, Math.PI], [s, c - 9.5, 0]);
    }
    // lamps along the district streets
    const nearCross = (v) => { const m = (((v - 35) % 70) + 70) % 70; return m < 13 || m > 57; };
    for (let c = -665; c <= 665; c += 70) for (let s = -735; s <= 245; s += 35) {
      if (nearCross(s)) continue;
      for (const [x, z, ry] of [[c + 9.5, s, -Math.PI / 2], [c - 9.5, s, Math.PI / 2]]) if (inDistrict(x, z)) LAMPS.push([x, z, ry]);
    }
    for (let c = -735; c <= 245; c += 70) for (let s = -665; s <= 665; s += 35) {
      if (nearCross(s)) continue;
      for (const [x, z, ry] of [[s, c + 9.5, Math.PI], [s, c - 9.5, 0]]) if (inDistrict(x, z)) LAMPS.push([x, z, ry]);
    }
    const lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), LAMPS.length);
    const d = new THREE.Object3D();
    LAMPS.forEach(([x, z, ry], i) => { d.position.set(x, 0, z); d.rotation.set(0, ry, 0); d.updateMatrix(); lamps.setMatrixAt(i, d.matrix); });
    lamps.castShadow = true; root.add(lamps);
  }

  /* ------------------------------------------------------------------ trees */
  function leafTex() {
    const S = 256, c = cv(S, S), g = c.getContext('2d');
    for (let i = 0; i < 70; i++) {
      const a = R(0, TAU), r = Math.sqrt(rnd()) * 100, x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
      g.save(); g.translate(x, y); g.rotate(R(0, TAU));
      g.fillStyle = `hsl(${R(70, 105)},${R(35, 60)}%,${R(55, 88)}%)`;
      g.beginPath(); g.ellipse(0, 0, R(10, 16), R(5, 8), 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(60,90,30,.45)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-12, 0); g.lineTo(12, 0); g.stroke();
      g.restore();
    }
    return tex(c);
  }
  const leafMap = leafTex();
  function paintGeo(g, fn) {
    const p = g.attributes.position, a = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) { fn(p.getX(i), p.getY(i), p.getZ(i), c); a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  }
  const detail = small ? 1 : 2;
  function blob(cx, cy, cz, r, sy, seed, det = detail) {
    let g = new THREE.IcosahedronGeometry(1, det);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    g = mergeVertices(g);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + (noise3(x * 2.3 + seed, y * 2.3, z * 2.3) - 0.5) * 0.5 + (noise3(x * 6 + seed, y * 6, z * 6) - 0.5) * 0.14;
      p.setXYZ(i, cx + x * r * k, cy + y * r * k * sy, cz + z * r * k);
    }
    g.computeVertexNormals();
    paintGeo(g, (x, y, z, c) => { const t = clamp((y - (cy - r * sy)) / (2 * r * sy), 0, 1); const v = 0.52 + 0.5 * t + (noise3(x * 3, y * 3, z * 3 + seed) - 0.5) * 0.25; c.setRGB(v * 0.97, v, v * 0.88); });
    return g;
  }
  function leafCards(cx, cy, cz, r, sy, n, size) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const u = R(-0.6, 1), th = R(0, TAU), s = Math.sqrt(1 - u * u);
      const dir = new THREE.Vector3(Math.cos(th) * s, u, Math.sin(th) * s);
      const g = new THREE.PlaneGeometry(size, size);
      g.rotateZ(R(0, TAU)); g.lookAt(dir.clone().add(new THREE.Vector3(R(-0.6, 0.6), R(-0.6, 0.6), R(-0.6, 0.6))));
      g.translate(cx + dir.x * r * 0.92, cy + dir.y * r * sy * 0.92, cz + dir.z * r * 0.92);
      const nrm = g.attributes.normal; for (let k = 0; k < nrm.count; k++) nrm.setXYZ(k, dir.x, dir.y, dir.z);
      out.push(g);
    }
    return out;
  }
  function trunkGeo(h, r0, r1, branches) {
    const parts = [];
    const t = new THREE.CylinderGeometry(r1, r0, h, 7, 3); t.translate(0, h / 2, 0); parts.push(t);
    for (const [bx, by, bz, from] of branches) {
      const v = new THREE.Vector3(bx, by - from, bz), L = v.length();
      const b = new THREE.CylinderGeometry(r1 * 0.35, r1 * 0.7, L, 5); b.translate(0, L / 2, 0);
      b.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()));
      b.translate(0, from, 0); parts.push(b);
    }
    const flat = parts.map((g) => { g.deleteAttribute('uv'); return paintGeo(g.toNonIndexed(), (x, y, z, c) => { const v = 0.75 + 0.25 * noise3(x * 8, y * 3, z * 8); c.copy(col('#7a5534')).multiplyScalar(v); }); });
    const g = mergeGeometries(flat); parts.forEach((p) => p.dispose()); flat.forEach((p) => p.dispose());
    return g;
  }
  function canopyMerge(list) { const flat = list.map((g) => (g.index ? g.toNonIndexed() : g)); const g = mergeGeometries(flat); list.forEach((x) => x.dispose()); return g; }
  function makeRound(seed) {
    const blobs = [], cards = [], br = [];
    blobs.push(blob(0, 3.0, 0, 1.25, 0.88, seed)); cards.push(...leafCards(0, 3.0, 0, 1.25, 0.88, small ? 10 : 18, 0.75));
    const n = RI(6, 8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + R(-0.3, 0.3), rr = R(0.75, 0.95), y = R(2.45, 3.7), r = R(0.62, 0.92);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      blobs.push(blob(x, y, z, r, 0.85, seed + i * 7.1)); cards.push(...leafCards(x, y, z, r, 0.85, small ? 5 : 9, 0.6));
      if (i % 2 === 0) br.push([x * 0.6, y - 0.5, z * 0.6, 1.5]);
    }
    return { trunk: trunkGeo(2.2, 0.2, 0.12, br), canopy: canopyMerge(blobs), cards: canopyMerge(cards), tint: () => hsl(R(0.23, 0.32), R(0.55, 0.75), R(0.32, 0.45)) };
  }
  function makePoplar(seed) {
    const blobs = [], cards = [];
    [[2.0, 0.7], [2.9, 0.78], [3.8, 0.68], [4.6, 0.5], [5.2, 0.3]].forEach(([y, r], i) => {
      blobs.push(blob(R(-0.1, 0.1), y, R(-0.1, 0.1), r, 1.35, seed + i * 3.3));
      cards.push(...leafCards(0, y, 0, r, 1.35, small ? 5 : 9, 0.5));
    });
    return { trunk: trunkGeo(1.6, 0.16, 0.1, []), canopy: canopyMerge(blobs), cards: canopyMerge(cards), tint: () => hsl(R(0.22, 0.28), R(0.6, 0.8), R(0.36, 0.48)) };
  }
  function makeConifer(seed) {
    const tiers = [];
    for (let i = 0; i < 5; i++) {
      let g = new THREE.ConeGeometry(1.55 - i * 0.28, 2.0, 11, 3, false);
      g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g);
      const p = g.attributes.position, yb = 1.0 + i * 1.05;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), y = p.getY(k), z = p.getZ(k), rr = Math.hypot(x, z);
        const j = rr > 0.01 ? 1 + (noise3(x * 3 + seed, y * 3, z * 3) - 0.5) * 0.45 : 1;
        p.setXYZ(k, x * j, y + yb + (rr > 0.5 && y < -0.9 ? -0.18 * noise3(x * 5, 0, z * 5 + seed) : 0), z * j);
      }
      g.computeVertexNormals();
      paintGeo(g, (x, y, z, c) => { const v = 0.6 + 0.4 * clamp((Math.hypot(x, z) + (y - yb) * 0.3) / 1.4, 0, 1) + (noise3(x * 4, y * 4, z * 4) - 0.5) * 0.2; c.setRGB(v * 0.9, v, v * 0.95); });
      tiers.push(g);
    }
    return { trunk: trunkGeo(1.4, 0.2, 0.12, []), canopy: canopyMerge(tiers), cards: null, tint: () => hsl(R(0.36, 0.42), R(0.45, 0.6), R(0.22, 0.32)) };
  }
  const TREE_KINDS = {
    round: [makeRound(1.3), makeRound(5.7), makeRound(9.1)],
    poplar: [makePoplar(2.2), makePoplar(7.4)],
    conifer: [makeConifer(3.1), makeConifer(8.8)],
  };
  const KIND_SCALE = { round: 1, poplar: 0.9, conifer: 0.85 };

  // street trees, park edges, lakeside, meadow groves
  for (const c of STREETS) for (let s = -238; s <= 238; s += 15) {
    if (STREETS.some((o) => Math.abs(o - s) < 17)) continue;
    for (const o of [-11, 11]) { tree(c + o, s, R(1.1, 1.5)); tree(s, c + o, R(1.1, 1.5)); }
  }
  for (let i = 0; i < 240; i++) {
    const a = R(0, TAU), r = R(258, 290);
    const x = clamp(Math.cos(a) * r * 1.2, -300, 300), z = clamp(Math.sin(a) * r * 1.2, -262, 300);
    if (Math.abs(x) < 250 && Math.abs(z) < 250) continue;
    tree(x, z, R(1.7, 3.2), pick(['round', 'round', 'poplar', 'conifer']));
    if (z < 250) TREES[TREES.length - 1].hidden = true; // now covered by the street grid
  }
  for (let x = -600; x < 600; x += R(10, 18)) { tree(x, -258 + R(-3, 3), R(1.7, 2.7), rnd() < 0.4 ? 'poplar' : 'round'); tree(x, -492 + R(-3, 3), R(1.7, 2.7)); }
  for (let i = 0; i < 70; i++) {
    const cx = R(-320, 380), cz = R(320, 1050), n = RI(3, 9), kind = rnd() < 0.3 ? 'conifer' : 'round';
    for (let k = 0; k < n; k++) tree(cx + R(-18, 18), cz + R(-18, 18), R(2.4, 4.8), rnd() < 0.2 ? 'poplar' : kind);
  }
  for (let i = 0; i < 120; i++) tree(rnd() < 0.5 ? R(-320, -230) : R(240, 360), R(300, 1100), R(2.8, 5.2), pick(['round', 'poplar', 'conifer']));
  const trunkMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const canopyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const cardMat = new THREE.MeshLambertMaterial({ map: leafMap, alphaTest: 0.45, side: THREE.DoubleSide });
  function instanceTrees(list) {
    const keep = list.filter((t) => t.y > 0 || clearOfPath(t.x, 2.2 * t.s, t.z, t.s * 2.6 + 9));
    const groups = new Map();
    for (const t of keep) {
      const variants = TREE_KINDS[t.kind], vi = Math.floor(rnd() * variants.length), key = t.kind + vi;
      if (!groups.has(key)) groups.set(key, { v: variants[vi], kind: t.kind, list: [] });
      groups.get(key).list.push(t);
    }
    const d = new THREE.Object3D();
    for (const { v, kind, list: items } of groups.values()) {
      const n = items.length;
      const tm = new THREE.InstancedMesh(v.trunk, trunkMat, n), cm = new THREE.InstancedMesh(v.canopy, canopyMat, n);
      const lm = v.cards ? new THREE.InstancedMesh(v.cards, cardMat, n) : null;
      items.forEach((t, i) => {
        const s = t.hidden ? 0 : t.s * KIND_SCALE[kind];
        d.position.set(t.x, t.y, t.z); d.rotation.set(R(-0.04, 0.04), R(0, TAU), R(-0.04, 0.04)); d.scale.set(s * R(0.9, 1.1), s * R(0.9, 1.15), s * R(0.9, 1.1)); d.updateMatrix();
        tm.setMatrixAt(i, d.matrix); cm.setMatrixAt(i, d.matrix);
        const tint = v.tint(); cm.setColorAt(i, tint);
        if (lm) { lm.setMatrixAt(i, d.matrix); lm.setColorAt(i, tint.clone().multiplyScalar(1.12)); }
      });
      for (const m of [tm, cm, lm]) if (m) { m.castShadow = true; m.receiveShadow = m !== tm; root.add(m); }
    }
  }
  instanceTrees(TREES);
  withRng(515151, () => instanceTrees(DTREES));

  /* --------------------------------------------------- countryside woods */
  // Woods, copses, hedgerows and lone trees across the plain and up the rim hills, so the
  // countryside around the meadow isn't bare grass from altitude. These are only seen from
  // a distance, so they use lighter variants (coarse canopies, no leaf cards).
  function makeRoundFar(seed) {
    const blobs = [blob(0, 3.0, 0, 1.3, 0.88, seed, 1)];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + R(-0.3, 0.3);
      blobs.push(blob(Math.cos(a) * 0.8, R(2.5, 3.4), Math.sin(a) * 0.8, R(0.75, 0.95), 0.85, seed + i * 7.1, 1));
    }
    return { trunk: trunkGeo(2.2, 0.2, 0.12, []), canopy: canopyMerge(blobs), cards: null, tint: () => hsl(R(0.23, 0.32), R(0.55, 0.75), R(0.3, 0.43)) };
  }
  function makePoplarFar(seed) {
    const blobs = [[2.2, 0.75], [3.4, 0.72], [4.5, 0.5]].map(([y, r], i) => blob(0, y, 0, r, 1.4, seed + i * 3.3, 1));
    return { trunk: trunkGeo(1.6, 0.16, 0.1, []), canopy: canopyMerge(blobs), cards: null, tint: () => hsl(R(0.22, 0.28), R(0.6, 0.8), R(0.34, 0.46)) };
  }
  withRng(737373, () => {
    TREE_KINDS.farRound = [makeRoundFar(4.4), makeRoundFar(8.2), makeRoundFar(12.6)];
    TREE_KINDS.farPoplar = [makePoplarFar(6.6)];
    Object.assign(KIND_SCALE, { farRound: 1, farPoplar: 0.9 });
    const FTREES = [];
    const excluded = (x, z) =>
      (Math.abs(x) < 690 && z > -760 && z < 265) || // city and districts
      (Math.abs(x) < 1230 && z > -505 && z < -245) || // lake and quays
      (x > -160 && x < -30 && z > 500 && z < 790) || // tulip field
      (x > -190 && x < -145 && z > 555 && z < 745); // windmills
    const add = (x, z, s, kind) => {
      if (excluded(x, z) || Math.hypot(x, z - 150) > 2400) return;
      const y = groundY(x, z);
      // Keep the low meadow pass open: the detailed groves own the foreground.
      if (y < 30 && !clearOfPath(x, 2.2 * s, z, s * 2.6 + 30)) return;
      FTREES.push({ x, y: y - 0.4, z, s, kind });
    };
    const woodKind = (x, z) => {
      if (noise3(x * 0.003 + 90, 0, z * 0.003) > 0.55) return 'conifer';
      return rnd() < 0.12 ? 'farPoplar' : 'farRound';
    };
    // Hedgerows: broken tree lines along field edges around the meadow.
    const rows = [[[380, 880], [1300, 900]], [[420, 1180], [1250, 1150]], [[-370, 900], [-1300, 930]], [[-360, 1230], [-1200, 1200]], [[820, 300], [800, 1450]], [[-760, 290], [-790, 1400]], [[-300, 1400], [600, 1420]], [[760, -820], [1500, -760]], [[-760, -840], [-1500, -800]]];
    for (const [[x0, z0], [x1, z1]] of rows) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      for (let u = 0; u < len; u += R(8, 13)) {
        if (noise3(u * 0.02, x0 * 0.01, z0 * 0.01) < 0.3) continue; // gaps and gates
        const k = u / len;
        add(x0 + (x1 - x0) * k + R(-2, 2), z0 + (z1 - z0) * k + R(-2, 2), R(2.4, 3.6), rnd() < 0.3 ? 'farPoplar' : 'farRound');
      }
    }
    // Woods where a low-frequency noise field is high, copses on their fringes, lone trees elsewhere.
    const clump = (x, z) => noise3(x * 0.0045, 0, z * 0.0045) * 0.7 + noise3(x * 0.017 + 40, 0, z * 0.017) * 0.3;
    const target = Math.round(5200 * Q);
    for (let i = 0; i < 60000 && FTREES.length < target; i++) {
      const x = R(-2400, 2400), z = 150 + R(-2400, 2400), c = clump(x, z);
      if (c > 0.64) add(x, z, R(3, 5.5), woodKind(x, z));
      else if (c > 0.56 && rnd() < 0.18) add(x, z, R(2.6, 4.6), woodKind(x, z));
      else if (rnd() < 0.012) add(x, z, R(3, 5), rnd() < 0.2 ? 'farPoplar' : 'farRound');
    }
    instanceTrees(FTREES);
  });

  /* ------------------------------------------------------------------- cars */
  const CARN = Math.round(170 * Q);
  const carGeo = (() => {
    const paint = (g, hex) => { g.deleteAttribute('uv'); return paintGeo(g.toNonIndexed(), (x, y, z, c) => c.copy(col(hex))); };
    const a = new THREE.BoxGeometry(1.9, 0.75, 4.4); a.translate(0, 0.62, 0);
    const b = new THREE.BoxGeometry(1.7, 0.6, 2.3); b.translate(0, 1.27, -0.2);
    const wl = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const w = new THREE.CylinderGeometry(0.34, 0.34, 0.3, 10); w.rotateZ(Math.PI / 2); w.translate(sx * 0.9, 0.34, sz * 1.4); wl.push(paint(w, '#22262b')); }
    const g = mergeGeometries([paint(a, '#ffffff'), paint(b, '#3a5470'), ...wl]);
    return g;
  })();
  const cars = new THREE.InstancedMesh(carGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), CARN);
  const CARS = [];
  const carCols = ['#ffffff', '#e8edf2', '#2a7bff', '#ff4040', '#ffd23a', '#28b46a', '#2b3036', '#9aa7b4'];
  for (let i = 0; i < CARN; i++) {
    const dir = rnd() < 0.5 ? 1 : -1;
    CARS.push({ ax: rnd() < 0.5, c: pick(STREETS) + dir * 4, dir, s: R(-245, 245), v: R(7, 12) });
    cars.setColorAt(i, col(pick(carCols)));
  }
  cars.frustumCulled = false; root.add(cars);
  // traffic on the district streets
  const DCARS = [];
  const dcarN = Math.round(260 * Q);
  const dcars = new THREE.InstancedMesh(carGeo, cars.material, dcarN);
  withRng(616161, () => {
    for (let i = 0; i < dcarN; i++) {
      const dir = rnd() < 0.5 ? 1 : -1, east = rnd() < 0.55;
      let car;
      if (east) { // east/west districts: N-S streets x = ±(315..665), or E-W streets z in -175..245 over |x| 245..665
        const sg = rnd() < 0.5 ? -1 : 1;
        car = rnd() < 0.5
          ? { ax: true, c: sg * (315 + 70 * RI(0, 5)) + dir * 4, lo: -245, hi: 245 }
          : { ax: false, c: -175 + 70 * RI(0, 6) + dir * 4, lo: sg > 0 ? 245 : -665, hi: sg > 0 ? 665 : -245 };
      } else { // north district
        car = rnd() < 0.5
          ? { ax: true, c: -665 + 70 * RI(0, 19) + dir * 4, lo: -735, hi: -525 }
          : { ax: false, c: -595 - 70 * RI(0, 2) + dir * 4, lo: -665, hi: 665 };
      }
      DCARS.push({ ...car, dir, s: R(car.lo, car.hi), v: R(7, 12) });
      dcars.setColorAt(i, col(pick(carCols)));
    }
  });
  dcars.frustumCulled = false; root.add(dcars);

  /* ------------------------------------------------------- Flock cameras */
  // Licence-plate camera poles (the World LOD in ./flock) on the kerb a little before
  // about half the intersections, aimed down the nearside lane at traffic heading into the junction.
  {
    const KERB = 12.2; // street centre to the kerb band (the road surface ends at 11.35 m)
    const LANES = [[-245, 245], [-735, -525]]; // z extent of the driven streets, south of and across the lake
    const spots = [], trees = TREES.concat(DTREES).filter((t) => !t.y && !t.hidden && t.z < 260);
    const clear = (x, z) => {
      if (Math.abs(x - 70) < 24.5 && Math.abs(z + 70) < 24.5) return false; // spire tower podium
      if (Math.abs(x - 200) < 10 && z < -250 && z > -500) return false; // under the bridge
      for (const t of trees) if (Math.hypot(t.x - x, t.z - z) < t.s * 2.4 + 1.2) return false;
      for (const [lx, lz] of LAMPS) if (Math.hypot(lx - x, lz - z) < 3.5) return false;
      return spots.every((p) => Math.hypot(p.x - x, p.z - z) > 6);
    };
    withRng(717171, () => {
      for (let X = -595; X <= 595; X += 70) for (const Z of [-245, -175, -105, -35, 35, 105, 175, -525, -595, -665]) {
        const downtown = Math.abs(X) < 250 && Z > -250;
        if (rnd() > (downtown ? 0.6 : 0.4)) continue;
        const [z0, z1] = LANES[Z > -250 ? 0 : 1];
        let n = rnd() < (downtown ? 0.3 : 0.12) ? 2 : 1;
        // Approaches: street axis (true = N-S) and the side the traffic comes from.
        const approaches = [[true, 1], [true, -1], [false, 1], [false, -1]];
        for (let i = 3; i > 0; i--) { const j = RI(0, i); [approaches[i], approaches[j]] = [approaches[j], approaches[i]]; }
        for (const [ns, a] of approaches) {
          if (ns && (Z + a * 30 < z0 || Z + a * 30 > z1)) continue; // dead-end stubs down to the quays
          for (let k = 0; k < 4; k++) {
            // Traffic on the kerb-side lane drives toward the junction (-a along the street).
            const d = R(16, 30), along = (ns ? Z : X) + a * d, across = (ns ? X : Z) - a * KERB;
            const [x, z] = ns ? [across, along] : [along, across];
            if (!clear(x, z)) continue;
            const turn = R(0.12, 0.22), fAlong = -a * Math.cos(turn), fAcross = a * Math.sin(turn);
            spots.push({ x, z, ry: ns ? Math.atan2(fAcross, fAlong) : Math.atan2(fAlong, fAcross), region: downtown ? 'downtown' : Z < -250 ? 'north' : X < 0 ? 'west' : 'east' });
            n--;
            break;
          }
          if (!n) break;
        }
      }
    });
    // Only the low pass over downtown is close enough to see them, so phones skip the districts.
    const keep = spots.filter((p) => !small || p.region === 'downtown');
    new GLTFLoader().load(flockCameraUrl, ({ scene: model }) => {
      if (disposed) return;
      // One batch per district so off-screen districts are culled.
      const regions = {}, q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
      for (const p of keep) (regions[p.region] || (regions[p.region] = [])).push(p);
      for (const list of Object.values(regions)) {
        const group = createFlockInstances(model, list.map((p) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, p.z), q.setFromAxisAngle(up, p.ry), one)));
        for (const m of group.children) m.receiveShadow = true;
        root.add(group);
      }
    }, undefined, (err) => console.warn('Flock cameras failed to load', err));
  }

  /* ------------------------------------------------------- meadow grass */
  {
    const w = 0.07, bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, -w * 0.7, 0.5, 0.02, w * 0.7, 0.5, 0.02, 0, 1, 0.07], 3));
    bg.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    const a = col('#2c7a1a'), b = col('#5ec12d'), c = col('#c8f06a');
    bg.setAttribute('color', new THREE.Float32BufferAttribute([a.r, a.g, a.b, a.r, a.g, a.b, b.r, b.g, b.b, b.r, b.g, b.b, c.r, c.g, c.b], 3));
    bg.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = U.time;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
        vec2 ip=vec2(instanceMatrix[3][0],instanceMatrix[3][2]);
        #else
        vec2 ip=vec2(0.0);
        #endif
        float sw=sin(uTime*1.8+ip.x*.15+ip.y*.11)+.5*sin(uTime*3.1+ip.x*.4);
        transformed.x+=sw*position.y*position.y*.14;transformed.z+=sw*position.y*position.y*.07;`);
    };
    const N = Math.round(120000 * Q), im = new THREE.InstancedMesh(bg, mat, N), d = new THREE.Object3D(), cc = new THREE.Color();
    for (let i = 0; i < N; i++) {
      let x, z; if (rnd() < 0.72) [x, z] = nearMeadow(26); else { x = R(-260, 320); z = R(270, 1000); }
      d.position.set(x, 0, z); d.rotation.set(R(-0.2, 0.2), R(0, TAU), R(-0.2, 0.2)); d.scale.set(R(0.8, 1.7), R(0.45, 1.35), 1); d.updateMatrix(); im.setMatrixAt(i, d.matrix);
      const bb = R(0.75, 1.12); cc.setRGB(bb * R(0.9, 1.05), bb, bb * R(0.82, 1)); im.setColorAt(i, cc);
    }
    root.add(im);
  }

  /* --------------------------------------------------------------- flowers */
  function flowerTex(kind) {
    const S = 128, c = cv(S, S), g = c.getContext('2d'); g.translate(64, 64);
    const petals = kind === 'daisy' ? 18 : 8, fc = kind === 'daisy' ? '#ffffff' : kind === 'cosmos' ? '#ff6fb5' : '#ffd21f', len = kind === 'daisy' ? 52 : 50, wid = kind === 'daisy' ? 7 : 15;
    for (let i = 0; i < petals; i++) {
      g.save(); g.rotate((i / petals) * TAU);
      const gr = g.createLinearGradient(0, 0, len, 0); gr.addColorStop(0, hexMul(fc, kind === 'daisy' ? 0.9 : 0.85)); gr.addColorStop(1, fc);
      g.fillStyle = gr; g.beginPath(); g.ellipse(len / 2 + 6, 0, len / 2, wid, 0, 0, TAU); g.fill();
      if (kind !== 'daisy') { g.globalCompositeOperation = 'destination-out'; g.beginPath(); for (let k = -1; k <= 1; k++) { g.moveTo(len + 6, k * 5); g.lineTo(len - 2, k * 5 + 2.5); g.lineTo(len + 6, k * 5 + 5); } g.fill(); g.globalCompositeOperation = 'source-over'; }
      g.restore();
    }
    const cr = kind === 'daisy' ? 13 : 11, gr = g.createRadialGradient(-3, -3, 1, 0, 0, cr);
    gr.addColorStop(0, kind === 'yellow' ? '#a2541a' : '#ffe46a'); gr.addColorStop(1, kind === 'yellow' ? '#5a2a0c' : '#f0a91a');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, cr, 0, TAU); g.fill();
    g.fillStyle = 'rgba(120,60,0,.35)'; for (let i = 0; i < 30; i++) { const a = R(0, TAU), r = R(0, cr * 0.85); g.fillRect(Math.cos(a) * r, Math.sin(a) * r, 1.5, 1.5); }
    return tex(c);
  }
  {
    const STEMS = [], geo = new THREE.PlaneGeometry(1, 1), d = new THREE.Object3D();
    for (const [kind, size, n] of [['daisy', 0.6, 3000], ['cosmos', 0.8, 2200], ['yellow', 0.75, 2200]]) {
      const N = Math.round(n * Q), im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: flowerTex(kind), alphaTest: 0.5, side: THREE.DoubleSide, color: col('#f4f4f4') }), N);
      for (let i = 0; i < N; i++) {
        let x, z, p;
        if (rnd() < 0.8) { [x, z, p] = nearMeadow(20); const dx = x - p.x, dz = z - p.z; if (dx * dx + dz * dz < 2.5) x += dx < 0 ? -1.6 : 1.6; } else { x = R(-250, 300); z = R(280, 1000); }
        const h = R(0.55, 1.45), s = size * R(0.75, 1.25);
        d.position.set(x, h, z); d.rotation.set(-Math.PI / 2 + R(0.35, 1.0), R(0, TAU), 0, 'YXZ'); d.scale.set(s, s, s); d.updateMatrix(); im.setMatrixAt(i, d.matrix); STEMS.push(x, h, z);
      }
      root.add(im);
    }
    const sg = new THREE.CylinderGeometry(0.022, 0.03, 1, 3); sg.translate(0, 0.5, 0);
    const sm = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: col('#3f9a25') }), STEMS.length / 3);
    for (let i = 0; i < STEMS.length / 3; i++) { d.position.set(STEMS[i * 3], 0, STEMS[i * 3 + 2]); d.rotation.set(0, 0, 0); d.scale.set(1, STEMS[i * 3 + 1], 1); d.updateMatrix(); sm.setMatrixAt(i, d.matrix); }
    root.add(sm);
  }

  /* -------------------------------------------------- tulips + windmills */
  {
    const cup = new THREE.LatheGeometry([[0, 0], [0.12, 0.03], [0.2, 0.12], [0.22, 0.26], [0.19, 0.38], [0.13, 0.45]].map((p) => new THREE.Vector2(p[0], p[1])), 7);
    const stem = new THREE.CylinderGeometry(0.03, 0.035, 1, 3); stem.translate(0, 0.5, 0);
    const pts = [], cols = ['#ff2a2a', '#ffd21a', '#ff5fa2', '#ff8a1a', '#ffffff'].map(col);
    for (let x = -142, row = 0; x < -46; x += 2.0, row++) { const band = Math.floor(row / 6) % cols.length; for (let z = 520; z < 770; z += 1.6) pts.push([x + R(-0.4, 0.4), z + R(-0.5, 0.5), band]); }
    const N = Math.round(pts.length * (small ? 0.6 : 1));
    const cm = new THREE.InstancedMesh(cup, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), N);
    const st = new THREE.InstancedMesh(stem, new THREE.MeshBasicMaterial({ color: col('#3c8f24') }), N);
    const d = new THREE.Object3D(), c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const [x, z, b] = pts[Math.floor((i / N) * pts.length)], h = R(0.7, 1.1), s = R(1.1, 1.5);
      d.position.set(x, 0, z); d.rotation.set(0, 0, 0); d.scale.set(1, h, 1); d.updateMatrix(); st.setMatrixAt(i, d.matrix);
      d.position.y = h; d.rotation.set(R(-0.15, 0.15), R(0, TAU), R(-0.15, 0.15)); d.scale.set(s, s, s); d.updateMatrix(); cm.setMatrixAt(i, d.matrix);
      c.copy(cols[b]).multiplyScalar(R(0.85, 1.1)); cm.setColorAt(i, c);
    }
    root.add(cm, st);
  }
  const MILLS = [];
  {
    const tw = new THREE.MeshLambertMaterial({ color: col('#6b4632') }), cap = new THREE.MeshLambertMaterial({ color: col('#3e2a1e') }), sail = new THREE.MeshLambertMaterial({ color: col('#f3ead8') });
    for (const [x, z] of [[-168, 575], [-175, 650], [-160, 725]]) {
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 4, 18, 8), tw); t.position.y = 9; g.add(t);
      const c = new THREE.Mesh(new THREE.ConeGeometry(3.2, 4.5, 8), cap); c.position.y = 20.2; g.add(c);
      const bl = new THREE.Group(); bl.position.set(3.4, 17, 0);
      for (let k = 0; k < 4; k++) {
        const arm = new THREE.Group(); arm.rotation.x = (k * Math.PI) / 2;
        const a = new THREE.Mesh(new THREE.BoxGeometry(0.3, 13, 0.4), cap); a.position.y = 6.5; arm.add(a);
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.15, 10, 2.4), sail); s.position.set(0, 8, 1.3); arm.add(s);
        bl.add(arm);
      }
      g.add(bl); root.add(g); MILLS.push(bl);
    }
  }

  /* ------------------------------------------------------------ butterflies */
  function wingTex(kind) {
    const S = 128, c = cv(S, S), g = c.getContext('2d');
    const shape = () => { g.beginPath(); g.ellipse(58, 44, 56, 34, -0.35, 0, TAU); g.ellipse(42, 92, 38, 28, 0.45, 0, TAU); };
    g.save(); shape(); g.clip();
    if (kind === 'monarch') { g.fillStyle = '#ff8a1c'; g.fillRect(0, 0, S, S); g.strokeStyle = '#1a120a'; g.lineWidth = 3; for (let i = 0; i < 7; i++) { g.beginPath(); g.moveTo(0, 64); g.lineTo(130 * Math.cos(-1.1 + i * 0.33), 64 + 130 * Math.sin(-1.1 + i * 0.33)); g.stroke(); } }
    else if (kind === 'morpho') { const gr = g.createLinearGradient(0, 64, 128, 20); gr.addColorStop(0, '#0a3fd8'); gr.addColorStop(0.6, '#1f8bff'); gr.addColorStop(1, '#3fe0ff'); g.fillStyle = gr; g.fillRect(0, 0, S, S); }
    else { g.fillStyle = '#ffe14d'; g.fillRect(0, 0, S, S); g.fillStyle = '#14110c'; for (let i = 0; i < 6; i++) { g.save(); g.translate(18 + i * 18, 0); g.rotate(0.35); g.fillRect(0, -20, i % 2 ? 5 : 9, 170); g.restore(); } g.fillStyle = '#2a7bff'; g.beginPath(); g.arc(30, 106, 6, 0, TAU); g.fill(); g.fillStyle = '#ff7a1a'; g.beginPath(); g.arc(48, 112, 4, 0, TAU); g.fill(); }
    g.restore();
    g.save(); shape(); g.lineWidth = 10; g.strokeStyle = '#120d08'; g.stroke(); g.restore();
    g.fillStyle = '#ffffff'; for (let i = 0; i < 14; i++) { const a = -1.4 + i * 0.2; g.beginPath(); g.arc(60 + 54 * Math.cos(a) * 0.95, 44 + 34 * Math.sin(a) * 0.95, 1.8, 0, TAU); g.fill(); }
    return tex(c);
  }
  const BFLY = [];
  {
    const wg = new THREE.PlaneGeometry(1, 1); wg.translate(0.5, 0, 0); wg.rotateX(Math.PI / 2);
    const mats = ['monarch', 'morpho', 'swallow'].map((k) => { const t = wingTex(k); return new THREE.MeshLambertMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.35, alphaTest: 0.5, side: THREE.DoubleSide }); });
    const body = new THREE.CylinderGeometry(0.035, 0.025, 0.5, 5); body.rotateX(Math.PI / 2);
    const bm = new THREE.MeshBasicMaterial({ color: col('#1a120a') });
    for (let i = 0; i < Math.round(80 * Q + 20); i++) {
      const [x, z, p] = nearMeadow(14), m = pick(mats), g = new THREE.Group();
      const r = new THREE.Group(), l = new THREE.Group();
      r.add(new THREE.Mesh(wg, m)); l.add(new THREE.Mesh(wg, m)); l.scale.x = -1; g.add(r, l, new THREE.Mesh(body, bm));
      g.scale.setScalar(R(0.45, 0.75)); root.add(g);
      let ax = x; const az = z, dx = x - p.x, dz = z - p.z; if (dx * dx + dz * dz < 9) ax += dx < 0 ? -3 : 3;
      BFLY.push({ g, r, l, ax, az, ay: R(1.2, 3.2), ph: R(0, TAU), f: R(9, 14), sp: R(0.3, 0.7), rad: R(1.5, 4) });
    }
  }

  /* ------------------------------------------------------------------ birds */
  // Gull: lathe body with head, eyes, beak and fanned tail; two-segment wings with feathered tips.
  function gullAssets() {
    const paint = (g, fn) => { if (g.attributes.uv) g.deleteAttribute('uv'); return paintGeo(g.index ? g.toNonIndexed() : g, fn); };
    const white = col('#ffffff'), back = col('#dfe6ec'), dark = col('#16191c'), beak = col('#f4b81e'), grey = col('#c3ccd5');
    const body = new THREE.LatheGeometry([[0.001, -1.0], [0.1, -0.86], [0.2, -0.55], [0.26, -0.15], [0.26, 0.25], [0.21, 0.55], [0.13, 0.78], [0.001, 0.9]].map((p) => new THREE.Vector2(p[0], p[1])), 16);
    body.rotateX(Math.PI / 2); body.scale(1, 0.85, 1);
    const head = new THREE.SphereGeometry(0.18, 14, 10); head.scale(1, 0.95, 1.15); head.translate(0, 0.12, 0.9);
    const eyes = [-1, 1].map((s) => { const e = new THREE.SphereGeometry(0.035, 6, 4); e.translate(s * 0.13, 0.17, 0.98); return e; });
    const bk = new THREE.ConeGeometry(0.055, 0.3, 6); bk.rotateX(Math.PI / 2); bk.scale(1, 1.2, 1); bk.translate(0, 0.08, 1.18);
    const ts = new THREE.Shape(); ts.moveTo(-0.16, 0); ts.lineTo(0.16, 0); ts.lineTo(0.3, -0.5); ts.lineTo(0.1, -0.44); ts.lineTo(0, -0.52); ts.lineTo(-0.1, -0.44); ts.lineTo(-0.3, -0.5); ts.closePath();
    const tail = new THREE.ShapeGeometry(ts); tail.rotateX(Math.PI / 2); tail.translate(0, 0.06, -0.82);
    const bodyGeo = mergeGeometries([
      paint(body, (x, y, z, c) => c.copy(y > 0.12 ? back : white)),
      paint(head, (x, y, z, c) => c.copy(white)),
      ...eyes.map((e) => paint(e, (x, y, z, c) => c.copy(dark))),
      paint(bk, (x, y, z, c) => c.copy(z > 1.27 ? col('#e2412b') : beak)),
      paint(tail, (x, y, z, c) => c.copy(z < -1.22 ? grey : white)),
    ]);
    function wingShape(pts) {
      const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath();
      const g = new THREE.ShapeGeometry(s), p = g.attributes.position, uv = g.attributes.uv;
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (let i = 0; i < p.count; i++) { x0 = Math.min(x0, p.getX(i)); x1 = Math.max(x1, p.getX(i)); y0 = Math.min(y0, p.getY(i)); y1 = Math.max(y1, p.getY(i)); }
      for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - x0) / (x1 - x0), (p.getY(i) - y0) / (y1 - y0));
      g.rotateX(Math.PI / 2);
      return g;
    }
    const inner = wingShape([[0, 0.3], [1.15, 0.25], [1.15, -0.3], [0.6, -0.4], [0, -0.44]]);
    const outer = wingShape([[0, 0.25], [0.75, 0.16], [1.45, -0.06], [1.35, -0.22], [0.7, -0.33], [0, -0.3]]);
    // inner: grey mantle, white trailing edge with notched secondaries
    const ci = cv(256, 128), gi = ci.getContext('2d');
    gi.fillStyle = '#c9d3dc'; gi.fillRect(0, 0, 256, 128);
    gi.fillStyle = '#e6edf3'; gi.fillRect(0, 0, 256, 14);
    gi.fillStyle = '#ffffff'; gi.fillRect(0, 100, 256, 28);
    gi.strokeStyle = 'rgba(90,105,120,.35)'; gi.lineWidth = 1.5;
    for (let x = 6; x < 256; x += 14) { gi.beginPath(); gi.moveTo(x, 40); gi.lineTo(x - 6, 128); gi.stroke(); }
    gi.strokeStyle = 'rgba(255,255,255,.6)'; for (let x = 0; x < 256; x += 22) { gi.beginPath(); gi.moveTo(x, 18); gi.lineTo(x + 10, 44); gi.stroke(); }
    gi.globalCompositeOperation = 'destination-out';
    for (let x = 0; x < 256; x += 14) { gi.beginPath(); gi.moveTo(x, 128); gi.lineTo(x + 7, 118); gi.lineTo(x + 14, 128); gi.fill(); }
    // outer: grey to black tip, white mirrors, separated primaries
    const co = cv(256, 128), go = co.getContext('2d');
    const gr = go.createLinearGradient(0, 0, 256, 0); gr.addColorStop(0, '#c9d3dc'); gr.addColorStop(0.45, '#aeb9c4'); gr.addColorStop(0.62, '#1b1e22'); gr.addColorStop(1, '#0d0f11');
    go.fillStyle = gr; go.fillRect(0, 0, 256, 128);
    go.fillStyle = '#ffffff'; go.beginPath(); go.arc(222, 62, 9, 0, TAU); go.fill(); go.beginPath(); go.arc(190, 48, 6, 0, TAU); go.fill();
    go.fillStyle = 'rgba(255,255,255,.9)'; go.fillRect(0, 108, 120, 20);
    go.strokeStyle = 'rgba(0,0,0,.35)'; go.lineWidth = 1.5; for (let i = 0; i < 9; i++) { go.beginPath(); go.moveTo(40 + i * 22, 30); go.lineTo(70 + i * 22, 128); go.stroke(); }
    go.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 7; i++) { const x = 130 + i * 18; go.beginPath(); go.moveTo(x, 128); go.lineTo(x + 10, 128); go.lineTo(x + 26, 50 + i * 4); go.closePath(); go.fill(); }
    const mk = (c) => new THREE.MeshLambertMaterial({ map: tex(c), alphaTest: 0.5, side: THREE.DoubleSide });
    return { bodyGeo, inner, outer, bodyMat: new THREE.MeshLambertMaterial({ vertexColors: true }), innerMat: mk(ci), outerMat: mk(co) };
  }
  const GULL = gullAssets();
  function makeGull() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(GULL.bodyGeo, GULL.bodyMat));
    const rigs = [];
    for (const side of [1, -1]) {
      const mirror = new THREE.Group(); mirror.scale.x = side; g.add(mirror);
      const root = new THREE.Group(); root.position.set(0.16, 0.12, 0.18); mirror.add(root);
      root.add(new THREE.Mesh(GULL.inner, GULL.innerMat));
      const outer = new THREE.Group(); outer.position.x = 1.15; root.add(outer);
      outer.add(new THREE.Mesh(GULL.outer, GULL.outerMat));
      rigs.push({ root, outer });
    }
    return { g, rigs };
  }
  const BIRDS = [];
  {
    const flocks = [[[0, 150, 0], [60, 160], 14, 1.5], [[90, 215, -470], [30, 90], 10, 1.5], [[-70, 72, -330], [30, 80], 8, 1.3], [[40, 26, 560], [40, 110], 8, 0.9], [[260, 260, -380], [40, 100], 8, 1.5]];
    for (const [c, [r0, r1], n, sc] of flocks) for (let i = 0; i < n; i++) {
      const b = makeGull(); b.g.scale.setScalar(sc * R(0.85, 1.15)); root.add(b.g);
      BIRDS.push({ ...b, c: new THREE.Vector3(...c).add(new THREE.Vector3(R(-20, 20), R(-15, 15), R(-20, 20))), rad: R(r0, r1), a: R(0, TAU), w: R(0.08, 0.16) * (rnd() < 0.5 ? 1 : -1), hv: R(4, 12), ph: R(0, TAU), fs: R(5.5, 7.5) });
    }
  }
  // V formation above the clouds
  const VFORM = { c: new THREE.Vector3(230, 305, -260), rad: 170, a: 0, w: 0.05, birds: [] };
  for (let k = 0; k < 9; k++) {
    const b = makeGull(); b.g.scale.setScalar(1.6); root.add(b.g);
    const rank = Math.ceil(k / 2), side = k === 0 ? 0 : k % 2 ? 1 : -1;
    VFORM.birds.push({ ...b, off: new THREE.Vector3(side * rank * 5, R(-0.6, 0.6), -rank * 5), ph: k * 0.35, fs: 6 });
  }

  /* ---------------------------------------------------------------- balloons */
  function balloonTex(scheme, alt) {
    const W = 512, H = 256, c = cv(W, H), g = c.getContext('2d'), im = g.createImageData(W, H);
    const S = scheme.map(hexRGB), gores = 12;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = (x / W) * gores, local = u % 1, gi = Math.floor(u), tri = Math.abs(local - 0.5) * 2, vv = 1 - y / H;
      const idx = alt ? (gi + Math.floor(vv * 3)) % S.length : clamp(Math.floor(vv * S.length + (1 - tri) * 0.55 - 0.2), 0, S.length - 1);
      const s = S[idx]; let f = local < 0.03 || local > 0.97 ? 0.78 : 1; f *= 0.9 + 0.1 * Math.sin(local * Math.PI);
      if (Math.abs(vv - 0.32) < 0.008) f *= 0.8; // load tape
      const i = (y * W + x) * 4; im.data[i] = s[0] * f; im.data[i + 1] = s[1] * f; im.data[i + 2] = s[2] * f; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    return tex(c);
  }
  const BAL = [];
  {
    const schemes = [[['#1f6fd6', '#2a9bf0', '#ff7a1a', '#ffb21f', '#ffd92a', '#ff3d2e']], [['#7a3cff', '#2a7bff', '#22c6ff', '#2fd36a', '#ffe02a', '#ff8f1f', '#ff3b3b']], [['#ffffff', '#ff4f8b', '#ffd23f', '#2ab0ff'], true], [['#0f5fd0', '#ffffff', '#ff3b3b', '#ffffff', '#0f5fd0']]];
    const mats = schemes.map(([s, alt]) => new THREE.MeshStandardMaterial({ map: balloonTex(s, alt), roughness: 0.45, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.8 }));
    const prof = [[2.5, 0], [3.5, 2], [5.8, 5], [8.2, 8.5], [9.7, 12], [10.2, 15], [9.9, 18], [8.6, 21], [6.4, 23.5], [3.4, 25.2], [0.01, 25.8]].map((p) => new THREE.Vector2(p[0], p[1]));
    const env = new THREE.LatheGeometry(prof, 48);
    const basket = new THREE.MeshLambertMaterial({ color: col('#9a6a3a') }), rope = new THREE.LineBasicMaterial({ color: col('#5a4a3a') }), flame = new THREE.MeshBasicMaterial({ color: col('#ffb347') });
    const spots = [[140, 250, -560], [300, 265, -520], [330, 240, -360], [470, 300, -210], [520, 250, 40], [370, 270, 110], [200, 320, -330], [0, 190, -120], [-150, 205, 80], [120, 175, 180], [-60, 60, 640], [170, 72, 700], [-210, 95, 520], [270, 115, 430], [-300, 160, -150], [60, 330, -260]];
    for (const [x, y0, z] of spots) {
      let y = y0; while (!clearOfPath(x, y, z, 40)) y += 30;
      const g = new THREE.Group(); g.position.set(x, y, z);
      g.add(new THREE.Mesh(env, pick(mats)));
      const b = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 3), basket); b.position.y = -6.5; g.add(b);
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), flame); f.position.y = -3.6; g.add(f);
      const lp = []; for (const sx of [-1, 1]) for (const sz of [-1, 1]) lp.push(sx * 1.3, -5.3, sz * 1.3, sx * 2.2, 0.2, sz * 2.2);
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); g.add(new THREE.LineSegments(lg, rope));
      g.scale.setScalar(R(0.85, 1.45)); g.rotation.y = R(0, TAU); root.add(g);
      BAL.push({ g, y, ph: R(0, TAU), x, z });
    }
  }

  /* ------------------------------------------------------------------ clouds */
  function cloudTex(seed) {
    const S = 256, c = cv(S, S), g = c.getContext('2d'), rr = mulberry32(seed), r = (a, b) => a + (b - a) * rr();
    for (let i = 0; i < 28; i++) {
      const x = 128 + r(-78, 78) * (1 - i / 40), y = 150 + r(-40, 25) - Math.max(0, 40 - Math.abs(x - 128) * 0.5) * rr(), rad = r(26, 58);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    g.globalCompositeOperation = 'source-atop';
    const sh = g.createLinearGradient(0, 80, 0, 210); sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(150,178,214,.55)'); g.fillStyle = sh; g.fillRect(0, 0, S, S);
    return tex(c);
  }
  const CT = [11, 23, 37, 59].map(cloudTex);
  const CLOUDS = [], CLUSTERS = [];
  function cluster(cx, cy, cz, sx, sy, sz, n, size, fogR) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.SpriteMaterial({ map: pick(CT), transparent: true, depthWrite: false, fog: true, rotation: R(-0.12, 0.12) });
      const s = new THREE.Sprite(m);
      s.position.set(cx + R(-sx, sx), cy + R(-sy, sy), cz + R(-sz, sz));
      const k = size * R(0.6, 1.3); s.scale.set(k, k * 0.72, 1); root.add(s);
      CLOUDS.push({ s, m, base: R(0.82, 1) });
    }
    if (fogR) CLUSTERS.push({ p: new THREE.Vector3(cx, cy, cz), r: fogR });
  }
  {
    const hp = curve.getSpacedPoints(70).filter((p) => p.y > 165 && p.y < 300);
    for (const p of hp) cluster(p.x + R(-60, 60), clamp(p.y + R(-25, 10), 190, 262), p.z + R(-60, 60), 45, 14, 45, 5, 75, 55);
    for (let i = 0; i < Math.round(26 * Q + 8); i++) cluster(R(-450, 800), R(200, 250), R(-1000, 350), 150, 22, 150, 6, 120, 0);
    for (let i = 0; i < Math.round(36 * Q + 10); i++) { const a = R(0, TAU), r = R(900, 2400); cluster(Math.cos(a) * r, R(150, 380), Math.sin(a) * r, 160, 40, 160, 5, R(160, 300), 0); }
    for (let i = 0; i < 10; i++) cluster(R(-200, 250), R(110, 150), R(380, 950), 80, 15, 80, 4, 110, 0);
  }

  /* ----------------------------------------------------------------- bubbles */
  const bubMat = new THREE.ShaderMaterial({
    uniforms: { uLight: { value: new THREE.Vector3() }, uTime: U.time }, transparent: true, depthWrite: false,
    vertexShader: `varying vec3 vN;varying vec3 vV;varying vec3 vWN;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vN=normalize(normalMatrix*normal);vV=-mv.xyz;vWN=normal;gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `uniform vec3 uLight;uniform float uTime;varying vec3 vN;varying vec3 vV;varying vec3 vWN;
    void main(){vec3 n=normalize(vN),v=normalize(vV);float ndv=clamp(dot(n,v),0.0,1.0);float f=pow(1.0-ndv,2.2);
      vec3 ir=0.5+0.5*cos(6.2831*(vec3(0.0,0.33,0.67)+f*1.4+vWN.y*0.3+uTime*0.05));
      vec3 c=mix(vec3(0.86,0.95,1.0),ir,0.5);
      vec3 h=normalize(uLight+v);float sp=pow(max(dot(n,h),0.0),180.0)*1.6+pow(max(dot(n,h),0.0),18.0)*0.12;
      vec3 h2=normalize(vec3(-uLight.x,-uLight.y*0.3,uLight.z)+v);float sp2=pow(max(dot(n,h2),0.0),60.0)*0.35;
      float a=f*0.75+0.05+sp+sp2;gl_FragColor=vec4(c*(0.6+f*0.6)+vec3(sp+sp2),clamp(a,0.0,1.0));}`,
  });
  const BUBBLES = [];
  {
    const bg = new THREE.SphereGeometry(1, 32, 24);
    for (let i = 0; i < 45; i++) { const [x, z] = nearMeadow(18); BUBS.push({ x, y: R(0.8, 7), z, r: R(0.4, 2.4), rise: R(0.4, 1.4), range: 24 }); }
    for (let i = 0; i < 18; i++) { const c = pick(STREETS), s = R(-230, 230), ax = rnd() < 0.5; BUBS.push({ x: ax ? c + R(-8, 8) : s, y: R(15, 70), z: ax ? s : c + R(-8, 8), r: R(1, 4), rise: R(1, 3), range: 60 }); }
    const high = pathPts.filter((p) => p.y > 120);
    for (let i = 0; i < 22; i++) { const p = pick(high); BUBS.push({ x: p.x + R(-60, 60), y: p.y + R(-20, 30), z: p.z + R(-60, 60), r: R(3, 10), rise: R(0.5, 1.5), range: 50 }); }
    BUBS.push({ x: -330, y: 85, z: 700, r: 75, rise: 0, range: 0 }, { x: 620, y: 150, z: -620, r: 130, rise: 0, range: 0 }, { x: -120, y: 42, z: 860, r: 28, rise: 0, range: 0 });
    for (const b of BUBS) { const m = new THREE.Mesh(bg, bubMat); m.scale.setScalar(b.r); m.position.set(b.x, b.y, b.z); m.renderOrder = 2; root.add(m); BUBBLES.push(Object.assign(b, { m, y0: b.y, ph: R(0, TAU) })); }
  }

  /* ---------------------------------------------------------------- sparkles */
  const SPK = [];
  {
    const c = cv(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(220,255,240,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(31, 4, 2, 56); g.fillRect(4, 31, 56, 2);
    const t = tex(c);
    for (let k = 0; k < 2; k++) {
      const n = Math.round(500 * Q), a = [];
      for (let i = 0; i < n; i++) { const [x, z] = nearMeadow(16); a.push(x, R(0.3, 5), z); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
      const m = new THREE.PointsMaterial({ map: t, size: 0.55, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: col(k ? '#d8ffe9' : '#fff7cf') });
      const p = new THREE.Points(geo, m); p.frustumCulled = false; root.add(p); SPK.push(m);
    }
  }

  /* ---------------------------------------------------------- jet + contrail */
  const jet = new THREE.Group();
  {
    const wm = new THREE.MeshStandardMaterial({ color: col('#ffffff'), metalness: 0.3, roughness: 0.3 });
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.6, 14, 10), wm); f.rotation.z = Math.PI / 2; jet.add(f);
    jet.add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, 17), wm));
    const tl = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.2), wm); tl.position.set(-6, 1.5, 0); jet.add(tl);
    const c = cv(256, 8), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 256, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.85, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 8);
    const cm = new THREE.MeshBasicMaterial({ map: tex(c), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, opacity: 0.9 });
    for (const oz of [-3.5, 3.5]) for (const r of [0, Math.PI / 2]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(700, 2.2), cm); p.position.set(-352, 0, oz); p.rotation.x = r; jet.add(p); }
    jet.scale.setScalar(3); root.add(jet);
  }

  /* --------------------------------------------------------------- lens flare */
  const oScene = new THREE.Scene(), oCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  function ringTex(kind) {
    const c = cv(128, 128), g = c.getContext('2d');
    if (kind === 'hex') { g.translate(64, 64); g.beginPath(); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; g.lineTo(Math.cos(a) * 58, Math.sin(a) * 58); } g.closePath(); const gr = g.createRadialGradient(0, 0, 0, 0, 0, 60); gr.addColorStop(0, 'rgba(255,255,255,.25)'); gr.addColorStop(1, 'rgba(255,255,255,.7)'); g.fillStyle = gr; g.fill(); }
    else if (kind === 'ring') { const gr = g.createRadialGradient(64, 64, 40, 64, 64, 62); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.6, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
    else { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
    return tex(c);
  }
  const FT = { disc: ringTex('disc'), ring: ringTex('ring'), hex: ringTex('hex') };
  const FLARES = [[0.25, 0.08, 'disc', '#bff2ff', 0.35], [0.45, 0.14, 'hex', '#9dffcf', 0.2], [0.7, 0.05, 'disc', '#ffe3a8', 0.35], [1.05, 0.24, 'ring', '#a8d8ff', 0.22], [1.35, 0.11, 'hex', '#d7b3ff', 0.2], [1.7, 0.32, 'ring', '#9fe9ff', 0.13]].map(([k, s, t, c, o]) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: FT[t], color: col(c), blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, opacity: 0 }));
    sp.scale.set(s, s, 1); oScene.add(sp); return { sp, k, o };
  });

  /* ------------------------------------------------------------------- loop */
  function zoneName(p) {
    if (p.y > 262) return 'Above the clouds';
    if (p.y > 175) return 'Cloud layer';
    if (Math.abs(p.x) < 250 && Math.abs(p.z) < 250) return 'Downtown';
    if (p.z < -255 && p.z > -500) return 'The lake';
    if (p.z > 280 && p.y < 25) return 'Flower meadow';
    return 'Skyline';
  }
  function sunBlocked(o, dir) { // ray vs tower bounding boxes
    for (const [x0, x1, y1, z0, z1] of OCC_BOXES) {
      let tmin = 0, tmax = 1200;
      for (const [o1, d1, a, b] of [[o.x, dir.x, x0, x1], [o.y, dir.y, -1, y1], [o.z, dir.z, z0, z1]]) {
        if (Math.abs(d1) < 1e-6) { if (o1 < a || o1 > b) { tmin = 1; tmax = 0; break; } continue; }
        let t0 = (a - o1) / d1, t1 = (b - o1) / d1; if (t0 > t1) [t0, t1] = [t1, t0];
        tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1); if (tmin > tmax) break;
      }
      if (tmin <= tmax) return true;
    }
    return false;
  }

  let s = clamp(opts.start, 0, 0.999) * LEN, roll = 0, v = 10, flareVis = 0, cloudAmt = 0, teleT = 0, frameN = 0, occluded = false;
  let speedMul = opts.speed, elapsed = 0, disposed = false;
  const tmp = new THREE.Vector3(), sunNdc = new THREE.Vector3(), fwd = new THREE.Vector3(), dmy = new THREE.Object3D(), heading = new THREE.Vector3();
  renderer.shadowMap.needsUpdate = true;

  function flap(rig, t, f, ph, glide) {
    const a = Math.sin(t * f + ph) * 0.62 * glide + 0.08;
    const b = Math.sin(t * f + ph - 0.9) * 0.5 * glide + 0.06;
    for (const r of rig) { r.root.rotation.z = a; r.outer.rotation.z = b; r.root.rotation.y = Math.sin(t * f + ph + 1.2) * 0.12 * glide; }
  }

  function update(delta) {
    if (disposed) return;
    const dt = clamp(delta || 0, 0, 0.05);
    elapsed += dt; const t = elapsed; U.time.value = t; frameN++;

    const p0 = curve.getPointAt(s / LEN);
    const vt = (9 + 26 * sstep(15, 260, p0.y)) * speedMul * motionMul;
    v += (vt - v) * Math.min(1, dt * 1.2);
    s = (((s + v * dt) % LEN) + LEN) % LEN;
    const u = s / LEN, p = curve.getPointAt(u); p.y = Math.max(p.y, 1.7);
    const look = curve.getPointAt(((s + 22) % LEN) / LEN); look.y = Math.max(look.y, 1.4);
    const sk = 0.35 + 0.65 * sstep(3, 40, p.y);
    camera.position.set(p.x + (Math.sin(t * 1.1) * 0.25 + Math.sin(t * 3.1) * 0.04) * sk, p.y + (Math.sin(t * 1.4) * 0.18 + Math.sin(t * 3.7) * 0.03) * sk, p.z + Math.cos(t * 0.9) * 0.2 * sk);
    camera.lookAt(look);
    const t1 = curve.getTangentAt(u), t2 = curve.getTangentAt(((s + 35) % LEN) / LEN);
    let dy = Math.atan2(t2.x, t2.z) - Math.atan2(t1.x, t1.z); if (dy > Math.PI) dy -= TAU; if (dy < -Math.PI) dy += TAU;
    roll += (clamp(dy * 1.3, -0.5, 0.5) - roll) * Math.min(1, dt * 1.8);
    camera.rotateZ(roll + Math.sin(t * 0.8) * 0.01 * sk);
    camera.updateMatrixWorld();

    sky.position.copy(camera.position);
    sunSprite.position.copy(camera.position).addScaledVector(SUN, 4000);

    let ca = 0; for (const c of CLUSTERS) ca = Math.max(ca, sstep(c.r * 1.25, c.r * 0.35, c.p.distanceTo(camera.position)));
    cloudAmt += (ca - cloudAmt) * Math.min(1, dt * 3);
    for (const c of CLOUDS) c.m.opacity = c.base * sstep(8, 70, c.s.position.distanceTo(camera.position));
    scene.fog.density = 0.00032 + cloudAmt * 0.011; scene.fog.color.copy(FOG_BASE).lerp(FOG_WHITE, cloudAmt);

    wNorm.offset.set(t * 0.004, t * 0.006);
    water.material.uniforms.time.value = t * 0.6;
    water.material.uniforms.eye.value.copy(camera.position);
    for (const b of BOATS) {
      b.x += b.dir * b.v * dt; if (b.x > 640) b.x = -640; if (b.x < -640) b.x = 640;
      b.g.position.set(b.x, 0.45 + Math.sin(t * 1.3 + b.ph) * 0.06, b.z + Math.sin(t * 0.05 + b.ph) * 6);
      b.g.rotation.set(Math.sin(t * 1.1 + b.ph) * 0.02, b.dir > 0 ? Math.PI / 2 : -Math.PI / 2, b.dir * b.heel + Math.sin(t * 0.9 + b.ph) * 0.03);
    }

    for (let i = 0; i < CARN; i++) {
      const c = CARS[i]; c.s += c.dir * c.v * dt; if (c.s > 245) c.s = -245; if (c.s < -245) c.s = 245;
      if (c.ax) dmy.position.set(c.c, 0, c.s); else dmy.position.set(c.s, 0, c.c);
      dmy.rotation.set(0, (c.ax ? 0 : Math.PI / 2) + (c.dir < 0 ? Math.PI : 0), 0); dmy.updateMatrix(); cars.setMatrixAt(i, dmy.matrix);
    }
    cars.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < dcarN; i++) {
      const c = DCARS[i]; c.s += c.dir * c.v * dt; if (c.s > c.hi) c.s = c.lo; if (c.s < c.lo) c.s = c.hi;
      if (c.ax) dmy.position.set(c.c, 0, c.s); else dmy.position.set(c.s, 0, c.c);
      dmy.rotation.set(0, (c.ax ? 0 : Math.PI / 2) + (c.dir < 0 ? Math.PI : 0), 0); dmy.updateMatrix(); dcars.setMatrixAt(i, dmy.matrix);
    }
    dcars.instanceMatrix.needsUpdate = true;

    for (const b of BFLY) {
      const q = t * b.sp + b.ph, y = b.ay + Math.sin(q * 1.7) * 0.6;
      tmp.set(b.ax + Math.sin(q + 0.05) * b.rad, y, b.az + Math.cos((q + 0.05) * 0.8) * b.rad);
      b.g.position.set(b.ax + Math.sin(q) * b.rad, y, b.az + Math.cos(q * 0.8) * b.rad); b.g.lookAt(tmp);
      const a = Math.sin(t * b.f + b.ph) * 1.05 + 0.2; b.r.rotation.z = a; b.l.rotation.z = -a;
    }

    for (const b of BIRDS) {
      b.a += b.w * dt;
      const yAt = (a) => b.c.y + Math.sin(a * 2 + b.ph) * b.hv;
      const a2 = b.a + b.w * 0.2;
      tmp.set(b.c.x + Math.cos(a2) * b.rad, yAt(a2), b.c.z + Math.sin(a2) * b.rad);
      const glide = 0.5 + 0.5 * Math.sin(t * 0.35 + b.ph);
      b.g.position.set(b.c.x + Math.cos(b.a) * b.rad, yAt(b.a) - Math.sin(t * b.fs + b.ph) * 0.12 * glide, b.c.z + Math.sin(b.a) * b.rad);
      b.g.lookAt(tmp); b.g.rotateZ(-Math.sign(b.w) * 0.32);
      flap(b.rigs, t, b.fs, b.ph, glide);
    }
    {
      VFORM.a += VFORM.w * dt;
      const lx = VFORM.c.x + Math.cos(VFORM.a) * VFORM.rad, lz = VFORM.c.z + Math.sin(VFORM.a) * VFORM.rad;
      heading.set(-Math.sin(VFORM.a), 0, Math.cos(VFORM.a));
      const yaw = Math.atan2(heading.x, heading.z);
      for (const b of VFORM.birds) {
        tmp.copy(b.off).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
        b.g.position.set(lx + tmp.x, VFORM.c.y + tmp.y + Math.sin(t * 0.5 + b.ph) * 0.4, lz + tmp.z);
        b.g.rotation.set(0, yaw, 0); b.g.rotateZ(-0.12);
        flap(b.rigs, t, b.fs, b.ph, 0.75);
      }
    }

    for (const b of BAL) { b.g.position.set(b.x + Math.sin(t * 0.04 + b.ph) * 12, b.y + Math.sin(t * 0.25 + b.ph) * 3, b.z + Math.cos(t * 0.03 + b.ph) * 12); b.g.rotation.y += dt * 0.02; }

    bubMat.uniforms.uLight.value.copy(SUN).transformDirection(camera.matrixWorldInverse);
    for (const b of BUBBLES) {
      if (b.range) { b.y += b.rise * dt; if (b.y > b.y0 + b.range) b.y = b.y0; }
      b.m.position.set(b.x + Math.sin(t * 0.5 + b.ph) * b.r * 0.6, b.y + (b.range ? 0 : Math.sin(t * 0.3 + b.ph) * 4), b.z + Math.cos(t * 0.4 + b.ph) * b.r * 0.6);
    }
    SPK[0].opacity = 0.5 + 0.5 * Math.sin(t * 2.3); SPK[1].opacity = 0.5 + 0.5 * Math.sin(t * 2.3 + Math.PI);
    for (const m of MILLS) m.rotation.x += dt * 0.5;
    jet.position.set(((t * 90) % 7000) - 3500, 950, -1900);

    camera.getWorldDirection(fwd);
    sunNdc.copy(camera.position).addScaledVector(SUN, 1000).project(camera);
    const facing = fwd.dot(SUN) > 0;
    if (frameN % 3 === 0) occluded = facing && sunBlocked(camera.position, SUN);
    const onScreen = facing && Math.abs(sunNdc.x) < 1.3 && Math.abs(sunNdc.y) < 1.3;
    const edge = onScreen ? 1 - sstep(0.6, 1.3, Math.max(Math.abs(sunNdc.x), Math.abs(sunNdc.y))) : 0;
    flareVis += ((onScreen && !occluded ? edge * (1 - cloudAmt) : 0) - flareVis) * Math.min(1, dt * 6);
    for (const f of FLARES) { f.sp.position.set(sunNdc.x * camera.aspect * (1 - f.k), sunNdc.y * (1 - f.k), 0); f.sp.material.opacity = f.o * flareVis; }

    if (opts.onTelemetry && (teleT -= dt) <= 0) { teleT = 0.25; opts.onTelemetry({ altitude: Math.round(p.y), speedKmh: Math.round(v * 3.6), zone: zoneName(p), progress: u }); }
  }

  function render() {
    if (disposed) return;
    oCam.left = -camera.aspect; oCam.right = camera.aspect; oCam.updateProjectionMatrix();
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clear(); renderer.render(scene, camera); renderer.clearDepth(); renderer.render(oScene, oCam);
    renderer.autoClear = ac;
  }

  function dispose() {
    if (disposed) return; disposed = true;
    scene.remove(root);
    const seen = new Set();
    const free = (o) => { if (o && !seen.has(o)) { seen.add(o); o.dispose(); } };
    for (const r of [root, oScene]) r.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      free(o.geometry);
      for (const m of [].concat(o.material || [])) { for (const k in m) if (m[k] && m[k].isTexture) free(m[k]); free(m); }
    });
    textures.forEach(free);
    for (const v of Object.values(TREE_KINDS).flat()) { free(v.trunk); free(v.canopy); free(v.cards); }
    free(GULL.bodyGeo); free(GULL.inner); free(GULL.outer);
    if (scene.environment) scene.environment.dispose();
    Object.assign(renderer, { autoClear: prev.autoClear, toneMapping: prev.toneMapping });
    Object.assign(renderer.shadowMap, { enabled: prev.shadow, type: prev.shadowType, autoUpdate: prev.shadowAuto });
    Object.assign(scene, { fog: prev.fog, environment: prev.environment, background: prev.background });
    Object.assign(camera, { fov: prev.fov, near: prev.near, far: prev.far }); camera.updateProjectionMatrix();
  }

  return {
    update,
    render,
    dispose,
    setSpeed(n) { speedMul = Math.max(0, +n || 0); },
    get progress() { return s / LEN; },
  };
}

/* Standalone version: owns its renderer, loop and resizing. */
export function createAeroBackground(canvas, options = {}) {
  const { maxPixelRatio = 1.75, quality = 'auto', ...rest } = options;
  const area = canvas.clientWidth * canvas.clientHeight || innerWidth * innerHeight;
  const q = quality === 'auto' ? (area < 1100000 ? 'low' : 'high') : quality;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q === 'low' ? 1.5 : maxPixelRatio));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(66, 1, 0.3, 6500);
  const world = createAeroWorld({ renderer, scene, camera, quality: q, ...rest });

  let width = 0, height = 0;
  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    if (w === width && h === height) return;
    width = w; height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.fov = w / h < 0.8 ? 78 : 66; camera.updateProjectionMatrix();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(canvas); else addEventListener('resize', resize);
  resize();

  let paused = false, raf = 0, last = performance.now(), frames = 0, destroyed = false;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, (now - last) / 1000); last = now;
    if (paused) return;
    world.update(dt); world.render();
    if (++frames === 2) canvas.style.opacity = '1';
  }
  canvas.style.transition = 'opacity 1.6s ease';
  canvas.style.opacity = '0';
  raf = requestAnimationFrame(frame);

  return {
    destroy() {
      if (destroyed) return; destroyed = true;
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect(); else removeEventListener('resize', resize);
      world.dispose(); renderer.dispose(); renderer.forceContextLoss();
    },
    setPaused(b) { paused = !!b; last = performance.now(); },
    setSpeed: world.setSpeed,
    get progress() { return world.progress; },
  };
}
