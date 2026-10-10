import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { beat, useDisposable } from '../../shared/hooks.js';
import { damp } from '../../shared/random.js';
import { icon, linear, radial, text, withShadow } from '../../ui/draw.js';
import { AnimPlane } from './hudKit.jsx';
import { show } from './palette.js';

const R = 112;

function drawOrb(ctx, w, h, { hovered }) {
  const cx = w / 2;
  const cy = h / 2;
  // Pearl bezel.
  withShadow(ctx, { color: 'rgba(110,30,120,0.45)', blur: 26, y: 10 }, () => {
    ctx.beginPath();
    ctx.arc(cx, cy, R + 12, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  });
  ctx.beginPath();
  ctx.arc(cx, cy, R + 12, 0, Math.PI * 2);
  ctx.fillStyle = linear(ctx, 0, cy - R, 0, cy + R, [
    [0, '#ffffff'],
    [0.5, '#ffe3f1'],
    [1, '#d9b8ff'],
  ]);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, R + 11, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Gel sphere.
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = radial(ctx, cx, cy + R * 0.55, R * 0.05, cx, cy, R * 1.02, hovered
    ? [[0, '#fff0a0'], [0.32, '#ff86c4'], [0.72, '#e64fd0'], [1, '#8a36d6']]
    : [[0, '#ffd88a'], [0.32, '#ff70b4'], [0.72, '#d443c4'], [1, '#7a2fc0']]);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  // Bottom caustic.
  ctx.fillStyle = radial(ctx, cx, cy + R * 1.05, 0, cx, cy + R * 1.05, R * 0.95, [
    [0, 'rgba(255,236,170,0.95)'],
    [0.55, 'rgba(255,200,170,0.25)'],
    [1, 'rgba(255,200,170,0)'],
  ]);
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  // Swirl of light inside the orb.
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, R * (0.92 - i * 0.12), R * (0.3 - i * 0.05), -0.32, 0.15 * Math.PI, 0.95 * Math.PI);
    ctx.strokeStyle = `rgba(255,220,255,${0.22 - i * 0.05})`;
    ctx.lineWidth = 7 - i * 2;
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
  // Specular cap.
  ctx.beginPath();
  ctx.ellipse(cx, cy - R * 0.5, R * 0.7, R * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = linear(ctx, 0, cy - R * 0.92, 0, cy - R * 0.1, [
    [0, 'rgba(255,255,255,0.92)'],
    [1, 'rgba(255,255,255,0.04)'],
  ]);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + R * 0.55, cy + R * 0.5, R * 0.07, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, R - 1, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(120,20,120,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Label.
  withShadow(ctx, { color: 'rgba(90,10,100,0.6)', blur: 6, y: 2 }, () => icon(ctx, 'dancer', cx, cy - 46, 40, '#ffffff'));
  text(ctx, 'DANCE!', cx, cy + 10, {
    size: 50,
    weight: 900,
    fill: [[0, '#ffffff'], [0.6, '#fff4fb'], [1, '#ffd2ec']],
    stroke: 'rgba(120,20,130,0.85)',
    strokeWidth: 8,
    shadow: { color: 'rgba(80,0,90,0.5)', blur: 8, y: 3 },
    letterSpacing: 1,
  });
  text(ctx, hovered ? "LET'S GO!" : 'PRESS TO PLAY', cx, cy + 52, {
    size: 13,
    weight: 900,
    fill: '#ffffff',
    letterSpacing: 3,
    shadow: { color: 'rgba(90,10,100,0.7)', blur: 4, y: 1 },
  });
}

/** Beat rings, halo and dashed ring drawn behind the orb in one shader. */
function OrbRings({ hover }) {
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        premultipliedAlpha: true,
        uniforms: {
          uTime: { value: 0 },
          uPhase: { value: 0 },
          uPulse: { value: 0 },
          uHover: { value: 0 },
          uBurst: { value: 9 },
          uC0: { value: new THREE.Color() },
          uC1: { value: new THREE.Color() },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime, uPhase, uPulse, uHover, uBurst;
          uniform vec3 uC0, uC1;
          varying vec2 vUv;
          void main() {
            vec2 p = (vUv - 0.5) * 520.0;
            float r = length(p);
            float a = atan(p.y, p.x);
            float halo = exp(-pow(max(r - ${R + 6}.0, 0.0) / (34.0 + 26.0 * uHover), 2.0)) * (0.3 + 0.3 * uPulse + 0.3 * uHover);
            float br = ${R + 14}.0 + uPhase * (66.0 + 30.0 * uHover);
            float ring = exp(-pow((r - br) / (2.5 + uPhase * 5.0), 2.0)) * pow(1.0 - uPhase, 1.6) * (0.75 + 0.25 * uHover);
            float dash = smoothstep(0.35, 0.45, fract(a / 6.2831853 * 48.0 + uTime * (0.04 + 0.2 * uHover))) * smoothstep(0.95, 0.85, fract(a / 6.2831853 * 48.0 + uTime * (0.04 + 0.2 * uHover)));
            float dring = exp(-pow((r - ${R + 30}.0) / 1.5, 2.0)) * (0.55 + 0.45 * uHover) * dash;
            float hring = exp(-pow((r - ${R + 18}.0) / 4.0, 2.0)) * (0.25 + 0.75 * uHover) * (0.7 + 0.3 * uPulse);
            float shock = exp(-pow((r - (${R}.0 + uBurst * 300.0)) / (4.0 + uBurst * 16.0), 2.0)) * (1.0 - smoothstep(0.0, 0.45, uBurst)) * 0.8;
            vec3 glow = mix(uC0, uC1, 0.5 + 0.5 * sin(a * 2.0 + uTime));
            vec3 col = glow * halo + vec3(1.0) * (ring + dring + shock) + mix(glow, vec3(1.0), 0.5) * hring;
            float alpha = clamp(halo * 0.85 + ring + dring + hring + shock, 0.0, 1.0);
            gl_FragColor = vec4(col * alpha / max(alpha, 0.001), 1.0) * alpha;
            #include <colorspace_fragment>
          }
        `,
      }),
  );
  useFrame((state) => {
    const u = material.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uPhase.value = beat.phase;
    u.uPulse.value = beat.pulse;
    u.uHover.value = hover.current;
    u.uBurst.value = show.burst;
    u.uC0.value.set('#ff7ac0');
    u.uC1.value.copy(show.colors[2]).lerp(u.uC0.value, 0.3);
  });
  return (
    <mesh material={material} position={[0, 0, -1]}>
      <planeGeometry args={[520, 520]} />
    </mesh>
  );
}

/** Sparkles orbiting the orb on a tilted ellipse (back half behind the orb). */
function OrbitSparkles({ hover, front, count = 9 }) {
  const geometry = useDisposable(() => {
    const plane = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.attributes.position = plane.attributes.position;
    g.attributes.uv = plane.attributes.uv;
    const d = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      d[i * 4] = (i / count) * Math.PI * 2;
      d[i * 4 + 1] = (i % 3) * 9;
      d[i * 4 + 2] = 12 + (i % 4) * 5;
      d[i * 4 + 3] = 0.85 + (i % 2) * 0.3;
    }
    g.setAttribute('aData', new THREE.InstancedBufferAttribute(d, 4));
    g.instanceCount = count;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        premultipliedAlpha: true,
        uniforms: { uTime: { value: 0 }, uHover: { value: 0 }, uSpin: { value: 0 }, uFront: { value: front ? 1 : 0 }, uPulse: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute vec4 aData;
          uniform float uTime, uHover, uSpin, uFront, uPulse;
          varying vec2 vUv;
          varying float vA;
          void main() {
            float ang = aData.x + uSpin * aData.w;
            vec2 o = vec2(cos(ang) * (${R + 44}.0 + aData.y), sin(ang) * (46.0 + aData.y * 0.4));
            float tilt = -0.38;
            o = mat2(cos(tilt), sin(tilt), -sin(tilt), cos(tilt)) * o;
            float isFront = step(sin(ang), 0.0);
            float vis = uFront > 0.5 ? isFront : 1.0 - isFront;
            float tw = 0.65 + 0.35 * sin(uTime * 6.0 + aData.x * 13.0);
            float size = aData.z * tw * (1.0 + 0.45 * uHover + 0.3 * uPulse) * (0.75 + 0.25 * isFront);
            vA = vis * (0.55 + 0.45 * isFront);
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(o + position.xy * size, 0.0, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          varying float vA;
          void main() {
            vec2 d = abs(vUv - 0.5) * 2.0;
            float star = max(1.0 - (d.x * 5.0 + d.y * 0.7), 0.0) + max(1.0 - (d.y * 5.0 + d.x * 0.7), 0.0);
            float core = exp(-dot(d, d) * 12.0);
            float a = clamp(star + core, 0.0, 1.0) * vA;
            vec3 c = mix(vec3(1.0, 0.85, 0.95), vec3(1.0), core);
            gl_FragColor = vec4(c * a, a);
            #include <colorspace_fragment>
          }
        `,
      }),
  );
  const spin = useRef(0);
  useFrame((state, delta) => {
    spin.current += delta * (0.55 + hover.current * 1.6);
    const u = material.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uHover.value = hover.current;
    u.uSpin.value = spin.current;
    u.uPulse.value = beat.pulse;
  });
  return <mesh geometry={geometry} material={material} position={[0, 0, front ? 3 : -0.5]} frustumCulled={false} />;
}

export function DanceOrb({ position = [440, 20, 0], particles }) {
  const hover = useRef(0);
  const hovered = useRef(false);
  const anim = useDisposable(() => ({ x: 0, y: 0, z: 1, scale: 1, opacity: 0 }));
  const born = useRef(null);
  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (born.current === null) born.current = t;
    const age = t - born.current;
    hover.current = damp(hover.current, hovered.current ? 1 : 0, 10, delta);
    const enter = Math.min(1, Math.max(0, (age - 0.35) / 0.5));
    const e = 1 - Math.pow(1 - enter, 3);
    anim.opacity = enter;
    anim.scale = (0.7 + 0.3 * e) * (1 + 0.035 * beat.pulse * (1 + hover.current));
    anim.y = Math.sin(t * 1.4) * 4;
  });
  return (
    <group position={position}>
      <OrbRings hover={hover} />
      <OrbitSparkles hover={hover} front={false} />
      <AnimPlane
        width={(R + 14) * 2}
        height={(R + 14) * 2}
        pad={30}
        anim={anim}
        sheen={0.3}
        hoverScale={1.07}
        redrawOnHover
        draw={drawOrb}
        onHoverChange={(h) => {
          hovered.current = h;
          show.hypeTarget = h ? 1 : 0;
          if (h) particles.current?.emit(position[0], position[1], { count: 10, kind: 1, colors: ['#ffffff', '#ffe6a8', '#ffc4ec'], speed: 260, gravity: 0, size: 18, jitter: 120 });
        }}
        onClick={() => {
          show.burst = 0;
          particles.current?.emit(position[0], position[1] + 20, { count: 64, colors: ['#ff6fb5', '#ffd166', '#6fe3ff', '#b78bff', '#ffffff', '#8be06b'], speed: 720, gravity: 900, size: 16, jitter: 60 });
          particles.current?.emit(position[0], position[1], { count: 18, kind: 1, colors: ['#ffffff', '#fff2b0'], speed: 420, gravity: 0, size: 26, jitter: 40 });
        }}
      />
      <OrbitSparkles hover={hover} front />
    </group>
  );
}
