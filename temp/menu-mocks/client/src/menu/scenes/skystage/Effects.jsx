import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { beat, useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { show } from './palette.js';
import { icon as drawIcon } from '../../ui/draw.js';

// ---------------------------------------------------------------------------
// Vista-style glowing light ribbons orbiting the stage.

const RIBBONS = [
  { radius: 8.4, height: -0.9, tiltX: 0.1, tiltZ: 0.06, speed: 0.3, arc: 3.6, width: 0.6, offset: 0.0, colors: [0, 1] },
  { radius: 9.6, height: 6.4, tiltX: -0.12, tiltZ: -0.16, speed: -0.22, arc: 3.0, width: 0.7, offset: 2.1, colors: [2, 0] },
  { radius: 7.2, height: 3.2, tiltX: 0.5, tiltZ: -0.25, speed: 0.4, arc: 2.0, width: 0.3, offset: 4.0, colors: [1, 2] },
];

function makeStrip(segments = 160) {
  const g = new THREE.BufferGeometry();
  const count = (segments + 1) * 2;
  const t = new Float32Array(count);
  const side = new Float32Array(count);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i <= segments; i++) {
    t[i * 2] = t[i * 2 + 1] = i / segments;
    side[i * 2] = -1;
    side[i * 2 + 1] = 1;
  }
  const index = [];
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  g.setIndex(index);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.BufferAttribute(t, 1));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  return g;
}

function Ribbon({ cfg, geometry }) {
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uRadius: { value: cfg.radius },
          uHeight: { value: cfg.height },
          uSpeed: { value: cfg.speed },
          uArc: { value: cfg.arc },
          uWidth: { value: cfg.width },
          uOffset: { value: cfg.offset },
          uPulse: { value: 0 },
          uHype: { value: 0 },
          uC0: { value: new THREE.Color() },
          uC1: { value: new THREE.Color() },
        },
        vertexShader: /* glsl */ `
          attribute float aT;
          attribute float aSide;
          uniform float uTime, uRadius, uHeight, uSpeed, uArc, uWidth, uOffset, uHype;
          varying float vT;
          varying float vSide;
          void main() {
            vT = aT;
            vSide = aSide;
            float ang = uOffset + aT * uArc + uTime * uSpeed * (1.0 + uHype * 0.8);
            float wave = sin(ang * 2.0 + uTime * 0.7 + uOffset) * 0.45;
            vec3 p = vec3(cos(ang) * uRadius, uHeight + wave, sin(ang) * uRadius);
            vec3 radial = vec3(cos(ang), 0.0, sin(ang));
            float tw = sin(aT * 3.0 + uTime * 0.9 + uOffset) * 0.9;
            vec3 w = cos(tw) * vec3(0.0, 1.0, 0.0) + sin(tw) * radial;
            float profile = pow(clamp(sin(3.14159 * aT), 0.0, 1.0), 0.6);
            p += w * aSide * uWidth * profile;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uC0, uC1;
          uniform float uPulse;
          varying float vT;
          varying float vSide;
          void main() {
            float s = vSide;
            float core = exp(-s * s * 28.0);
            float glow = exp(-s * s * 3.0);
            float t = clamp(vT, 0.0, 1.0);
            float fade = smoothstep(0.0, 0.55, t) * smoothstep(1.0, 0.85, t);
            vec3 col = mix(uC0, uC1, t);
            vec3 c = (col * glow * 0.55 + vec3(1.0, 0.97, 0.95) * core * 0.9) * fade * (0.9 + uPulse * 0.35);
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      }),
  );
  useFrame((state) => {
    const u = material.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uPulse.value = beat.pulse;
    u.uHype.value = show.hype;
    u.uC0.value.copy(show.colors[cfg.colors[0]]);
    u.uC1.value.copy(show.colors[cfg.colors[1]]);
  });
  return (
    <group rotation={[cfg.tiltX, 0, cfg.tiltZ]}>
      <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />
    </group>
  );
}

export function Ribbons() {
  const geometry = useDisposable(() => makeStrip(180));
  return (
    <group>
      {RIBBONS.map((cfg, i) => (
        <Ribbon key={i} cfg={cfg} geometry={geometry} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Glossy music notes rising off the stage edge.

function eighthNote(ctx, s, fill) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(-s * 0.18, s * 0.55, s * 0.36, s * 0.27, -0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = s * 0.15;
  ctx.beginPath();
  ctx.moveTo(s * 0.12, s * 0.5);
  ctx.lineTo(s * 0.12, -s * 0.85);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s * 0.12, -s * 0.9);
  ctx.bezierCurveTo(s * 0.25, -s * 0.45, s * 0.8, -s * 0.5, s * 0.55, s * 0.05);
  ctx.bezierCurveTo(s * 0.6, -s * 0.3, s * 0.35, -s * 0.4, s * 0.12, -s * 0.45);
  ctx.closePath();
  ctx.fill();
}

function makeNoteAtlas() {
  const cell = 128;
  const canvas = document.createElement('canvas');
  canvas.width = cell * 2;
  canvas.height = cell * 2;
  const ctx = canvas.getContext('2d');
  const s = cell * 0.36;
  const glyphs = [
    (fill) => eighthNote(ctx, s, fill),
    (fill) => drawIcon(ctx, 'music', 0, 0, s * 2, fill),
    (fill) => drawIcon(ctx, 'heart', 0, 0, s * 1.8, fill),
    (fill) => drawIcon(ctx, 'sparkle', 0, 0, s * 2, fill),
  ];
  glyphs.forEach((draw, i) => {
    const ox = (i % 2) * cell;
    const oy = Math.floor(i / 2) * cell;
    ctx.save();
    ctx.translate(ox + cell / 2, oy + cell / 2);
    // Soft white halo, then a glossy grey ramp (R channel = shading).
    ctx.shadowColor = 'rgba(255,255,255,1)';
    ctx.shadowBlur = 16;
    draw('#ffffff');
    ctx.shadowBlur = 0;
    const grad = ctx.createLinearGradient(0, -s, 0, s);
    grad.addColorStop(0, '#f8f8f8');
    grad.addColorStop(0.45, '#b0b0b0');
    grad.addColorStop(1, '#7a7a7a');
    draw(grad);
    ctx.restore();
  });
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function Notes({ count = 26, seed = 5 }) {
  const texture = useDisposable(() => makeNoteAtlas());
  const geometry = useDisposable(() => {
    const rand = makeRandom(seed);
    const plane = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.attributes.position = plane.attributes.position;
    g.attributes.uv = plane.attributes.uv;
    const a = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      a[i * 4] = rand.range(0, Math.PI * 2); // angle
      a[i * 4 + 1] = rand.range(4.2, 7.5); // radius
      a[i * 4 + 2] = rand.next(); // phase
      a[i * 4 + 3] = rand.pick([0, 0, 1, 1, 1, 2, 3]); // glyph
    }
    g.setAttribute('aData', new THREE.InstancedBufferAttribute(a, 4));
    g.instanceCount = count;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uMap: { value: texture },
          uTime: { value: 0 },
          uPulse: { value: 0 },
          uC0: { value: new THREE.Color() },
          uC1: { value: new THREE.Color() },
          uC2: { value: new THREE.Color() },
        },
        vertexShader: /* glsl */ `
          attribute vec4 aData;
          uniform float uTime, uPulse;
          uniform vec3 uC0, uC1, uC2;
          varying vec2 vUv;
          varying float vAlpha;
          varying vec3 vColor;
          void main() {
            float life = 6.5;
            float t = fract(uTime / life + aData.z);
            float ang = aData.x + t * 0.6;
            float r = aData.y + sin(t * 6.0 + aData.z * 20.0) * 0.25;
            vec3 c = vec3(cos(ang) * r, 0.4 + t * 6.5, sin(ang) * r);
            c.x += sin(uTime * 1.3 + aData.z * 30.0) * 0.25;
            float pop = smoothstep(0.0, 0.08, t);
            float size = (0.6 + 0.12 * uPulse) * (0.6 + 0.4 * pop) * (aData.w > 1.5 ? 0.75 : 1.0);
            vAlpha = pop * (1.0 - smoothstep(0.7, 1.0, t));
            float rot = sin(uTime * 2.0 + aData.z * 10.0) * 0.25;
            vec2 q = vec2(cos(rot) * position.x - sin(rot) * position.y, sin(rot) * position.x + cos(rot) * position.y);
            vec4 mv = modelViewMatrix * vec4(c, 1.0);
            mv.xy += q * size;
            gl_Position = projectionMatrix * mv;
            float g = aData.w;
            vec2 cell = vec2(mod(g, 2.0), 1.0 - floor(g / 2.0));
            vUv = (uv + cell) * 0.5;
            float k = fract(aData.z * 7.0);
            vColor = k < 0.33 ? uC0 : (k < 0.66 ? uC1 : uC2);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          varying vec2 vUv;
          varying float vAlpha;
          varying vec3 vColor;
          void main() {
            vec4 t = texture2D(uMap, vUv);
            if (t.a < 0.01) discard;
            float shade = t.r / max(t.a, 0.001);
            vec3 col = mix(vColor * 0.85, vec3(1.0), smoothstep(0.75, 1.0, shade) * 0.8) * (0.9 + shade * 0.6);
            // The halo (white glow) region gets a tinted bloom.
            col = mix(col, vColor * 1.6 + 0.3, smoothstep(0.98, 1.0, shade) * (1.0 - t.a) );
            float a = t.a * vAlpha;
            gl_FragColor = vec4(col, a);
          }
        `,
      }),
  );
  useFrame((state) => {
    const u = material.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uPulse.value = beat.pulse;
    u.uC0.value.copy(show.colors[0]);
    u.uC1.value.copy(show.colors[1]);
    u.uC2.value.copy(show.colors[2]);
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={6} />;
}

// ---------------------------------------------------------------------------
// Twinkling four-point sparkles drifting up around the stage.

export function Sparkles({ count = 160, seed = 9, radius = [2.5, 11], height = [-1, 9] }) {
  const geometry = useDisposable(() => {
    const rand = makeRandom(seed);
    const plane = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.attributes.position = plane.attributes.position;
    g.attributes.uv = plane.attributes.uv;
    const a = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const ang = rand.range(0, Math.PI * 2);
      const r = rand.range(radius[0], radius[1]);
      a[i * 4] = Math.cos(ang) * r;
      a[i * 4 + 1] = rand.range(height[0], height[1]);
      a[i * 4 + 2] = Math.sin(ang) * r;
      a[i * 4 + 3] = rand.next();
    }
    g.setAttribute('aData', new THREE.InstancedBufferAttribute(a, 4));
    g.instanceCount = count;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uBeat: { value: 0 },
          uHype: { value: 0 },
          uC0: { value: new THREE.Color() },
          uC1: { value: new THREE.Color() },
          uRange: { value: new THREE.Vector2(height[0], height[1]) },
        },
        vertexShader: /* glsl */ `
          attribute vec4 aData;
          uniform float uTime, uBeat, uHype;
          uniform vec2 uRange;
          uniform vec3 uC0, uC1;
          varying vec2 vUv;
          varying float vA;
          varying vec3 vC;
          void main() {
            float span = uRange.y - uRange.x;
            vec3 c = aData.xyz;
            c.y = uRange.x + mod(c.y - uRange.x + uTime * (0.25 + aData.w * 0.3), span);
            c.x += sin(uTime * 0.5 + aData.w * 20.0) * 0.3;
            float edge = smoothstep(0.0, 0.1, (c.y - uRange.x) / span) * smoothstep(1.0, 0.85, (c.y - uRange.x) / span);
            float tw = 0.5 + 0.5 * sin(uTime * (2.0 + aData.w * 4.0) + aData.w * 50.0);
            float onb = exp(-fract(uBeat + aData.w) * 4.0);
            vA = edge * (0.25 + 0.75 * tw * tw) * (0.6 + 0.6 * onb + uHype * 0.5);
            float size = 0.16 + 0.22 * aData.w + 0.12 * onb;
            vec4 mv = modelViewMatrix * vec4(c, 1.0);
            mv.xy += position.xy * size;
            gl_Position = projectionMatrix * mv;
            vUv = uv;
            vC = mix(uC0, uC1, fract(aData.w * 3.7)) * 0.5 + 0.6;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          varying float vA;
          varying vec3 vC;
          void main() {
            vec2 d = abs(vUv - 0.5) * 2.0;
            float star = max(1.0 - (d.x * 6.0 + d.y * 0.9), 0.0) + max(1.0 - (d.y * 6.0 + d.x * 0.9), 0.0);
            float core = exp(-dot(d, d) * 18.0);
            float v = clamp(star * 0.8 + core, 0.0, 1.5);
            gl_FragColor = vec4(vC * v * vA * 1.4, 1.0);
          }
        `,
      }),
  );
  useFrame((state) => {
    const u = material.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uBeat.value = beat.beat + beat.phase;
    u.uHype.value = show.hype;
    u.uC0.value.copy(show.colors[0]);
    u.uC1.value.copy(show.colors[1]);
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={7} />;
}
