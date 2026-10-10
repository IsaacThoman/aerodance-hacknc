import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { beat, setCursor, useDisposable } from '../../shared/hooks.js';
import { clamp, damp } from '../../shared/random.js';
import { drawGlossyWord, useSharedSpin } from '../../ui/Logo.jsx';
import { UIPlane } from '../../ui/UIPlane.jsx';
import { font, glass, icon as drawIcon, linear, orb, radial, roundRect, text as drawText } from '../../ui/draw.js';

const ITEMS = [
  { id: 'songs', label: 'Songs', icon: 'music', x: -440, y: -58, r: 56 },
  { id: 'party', label: 'Dance Party', icon: 'dancer', x: -225, y: -84, r: 63 },
  { id: 'play', label: 'Play', icon: 'play', x: 0, y: -96, r: 80 },
  { id: 'online', label: 'Online', icon: 'globe', x: 225, y: -84, r: 63 },
  { id: 'options', label: 'Options', icon: 'gear', x: 440, y: -58, r: 56 },
];

const LOGO_PALETTE = {
  top: '#ffffff',
  mid: '#62e8ff',
  bottom: '#0786cc',
  outline: '#ffffff',
  shadow: 'rgba(0,70,135,0.55)',
  accent: '#bff6ff',
};

// ---------------------------------------------------------------------------
// Logo: glossy aqua wordmark with a water droplet; clicking spins it for all.
// ---------------------------------------------------------------------------

function drawDroplet(ctx, cx, cy, s, tilt = 0) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.25);
    ctx.bezierCurveTo(s * 0.35, -s * 0.7, s, -s * 0.15, s, s * 0.32);
    ctx.arc(0, s * 0.32, s, 0, Math.PI);
    ctx.bezierCurveTo(-s, -s * 0.15, -s * 0.35, -s * 0.7, 0, -s * 1.25);
    ctx.closePath();
  };
  ctx.save();
  ctx.shadowColor = 'rgba(0,70,135,0.5)';
  ctx.shadowBlur = s * 0.5;
  ctx.shadowOffsetY = s * 0.12;
  path();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  path();
  ctx.fillStyle = radial(ctx, 0, s * 0.6, s * 0.1, 0, s * 0.2, s * 1.4, [
    [0, '#c8fbff'],
    [0.45, '#3fd2f5'],
    [1, '#0670b8'],
  ]);
  ctx.fill();
  ctx.lineWidth = s * 0.14;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-s * 0.36, -s * 0.05, s * 0.2, s * 0.42, 0.35, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(s * 0.4, s * 0.72, s * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fill();
  ctx.restore();
}

function drawMiniBubble(ctx, x, y, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = radial(ctx, x, y, r * 0.4, x, y, r, [
    [0, 'rgba(255,255,255,0.08)'],
    [0.8, 'rgba(190,245,255,0.35)'],
    [1, 'rgba(255,255,255,0.9)'],
  ]);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x - r * 0.35, y - r * 0.4, r * 0.3, r * 0.17, -0.7, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();
  ctx.restore();
}

function LagoonLogo({ position }) {
  const [spin, trigger] = useSharedSpin();
  const outer = useRef();
  useFrame(() => {
    if (outer.current) outer.current.rotation.y = spin.current.angle;
  });
  return (
    <group ref={outer} position={position}>
      <UIPlane
        width={640}
        height={200}
        pad={40}
        appear={0.05}
        bob={[4, 1.1, 0]}
        sheen={0.5}
        hoverScale={1.03}
        onClick={trigger}
        draw={(ctx, w, h) => {
          const size = 108;
          const baseline = h * 0.6;
          // Wave swoosh behind the word.
          ctx.save();
          ctx.lineCap = 'round';
          const wave = (offset, lw, style, blur = 0) => {
            ctx.beginPath();
            ctx.moveTo(w * 0.06, baseline + 18 + offset);
            ctx.bezierCurveTo(w * 0.3, baseline + 52 + offset, w * 0.55, baseline - 6 + offset, w * 0.78, baseline + 22 + offset);
            ctx.bezierCurveTo(w * 0.86, baseline + 32 + offset, w * 0.92, baseline + 26 + offset, w * 0.96, baseline + 14 + offset);
            ctx.strokeStyle = style;
            ctx.lineWidth = lw;
            ctx.shadowColor = 'rgba(0,120,190,0.6)';
            ctx.shadowBlur = blur;
            ctx.stroke();
          };
          wave(0, 12, linear(ctx, w * 0.06, 0, w * 0.96, 0, [[0, 'rgba(60,210,255,0)'], [0.3, 'rgba(60,210,255,0.95)'], [1, 'rgba(20,150,230,0.9)']]), 14);
          wave(-3, 3.5, 'rgba(255,255,255,0.95)');
          ctx.restore();
          const wordW = drawGlossyWord(ctx, 'aerodance', w / 2, baseline, { size, palette: LOGO_PALETTE });
          // Droplet accent + bubbles.
          drawDroplet(ctx, w / 2 + wordW / 2 + 16, baseline - size * 0.62, 17, 0.25);
          drawMiniBubble(ctx, w / 2 + wordW / 2 + 38, baseline - size * 0.98, 7);
          drawMiniBubble(ctx, w / 2 + wordW / 2 + 8, baseline - size * 1.06, 4.5);
          drawMiniBubble(ctx, w / 2 - wordW / 2 - 14, baseline - size * 0.2, 6);
          // Tagline.
          ctx.save();
          ctx.font = font(21, 900, 'round');
          ctx.letterSpacing = '7px';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = 'rgba(0,80,140,0.75)';
          ctx.shadowBlur = 8;
          ctx.shadowOffsetY = 1.5;
          ctx.fillStyle = '#ffffff';
          ctx.fillText('AQUA LAGOON', w / 2 + 4, baseline + 46);
          ctx.restore();
        }}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Bubble buttons: shader air-bubbles that refract the live underwater view.
// ---------------------------------------------------------------------------

const bubbleVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const bubbleFragment = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tIcon;
uniform float uIconIndex;
uniform float uIconCount;
uniform float uTime;
uniform float uHover;
uniform float uPress;
uniform float uPop;
uniform float uForm;
uniform float uWobble;
uniform float uSeed;
uniform float uSpan;
uniform vec2 uRadiusUV;
uniform vec2 uCenterUV;
uniform float uBeat;
uniform float uPrimary;
varying vec2 vUv;

float hash1(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  vec2 p = (vUv - 0.5) * uSpan;
  float r = length(p);
  float ang = atan(p.y, p.x);
  float wamp = 1.0 + uHover * 1.0 + uWobble * 4.5;
  float wob = (0.018 * sin(3.0 * ang + uTime * 1.7 + uSeed * 6.0)
             + 0.012 * sin(5.0 * ang - uTime * 2.3 + uSeed * 3.0)
             + 0.009 * sin(2.0 * ang + uTime * 1.1 + uSeed)) * wamp;
  float R = (1.0 + wob) * (1.0 + uPop * 0.4);
  float d = r / R;
  float aa = fwidth(d) * 1.3;
  float inside = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);

  // Diverging air-bubble lens: upright, fish-eye squeeze toward the rim.
  float z = sqrt(max(0.0, 1.0 - min(d, 1.0) * min(d, 1.0)));
  vec2 offs = p * (0.82 + 1.5 * (1.0 - z));
  offs += vec2(sin(uTime * 1.3 + p.y * 3.0), cos(uTime * 1.1 + p.x * 3.0)) * 0.03;
  vec2 suv = uCenterUV + offs * uRadiusUV;
  vec3 bg = texture2D(tScene, suv).rgb;
  vec3 col = bg * vec3(0.92, 1.02, 1.06) * (1.04 + uHover * 0.12) + vec3(0.03, 0.07, 0.09);
  col = mix(col, col * vec3(0.8, 1.0, 1.08) + vec3(0.02, 0.1, 0.14), uPrimary * 0.5);

  // Light pooling in the bottom of the bubble.
  float pool = exp(-length((p - vec2(0.0, -0.58)) * vec2(1.0, 1.8)) * 3.0);
  col += vec3(0.55, 0.95, 1.0) * pool * (0.35 + uHover * 0.3);

  // Silvery rim + thin-film iridescence.
  float rimT = smoothstep(0.58, 1.0, d);
  float rimP = rimT * rimT;
  float thick = d * 2.2 + sin(ang * 2.0 + uTime * 0.7 + uSeed * 4.0) * 0.35 + uTime * 0.12 + uSeed;
  vec3 film = 0.5 + 0.5 * cos(6.2831 * (thick + vec3(0.0, 0.33, 0.67)));
  vec3 rimCol = mix(vec3(0.86, 0.98, 1.0), film, 0.5) * (0.75 + 0.6 * rimP);
  col = mix(col, rimCol, rimP * 0.78);
  col += vec3(1.0) * exp(-pow((d - 0.975) / 0.022, 2.0)) * (0.55 + uHover * 0.4);

  // Icon.
  vec2 ip = p / 1.22 + vec2(sin(uTime * 1.2 + uSeed) * 0.01, cos(uTime * 0.9 + uSeed) * 0.012);
  vec2 iuv = ip * 0.5 + 0.5;
  float inIcon = step(0.0, iuv.x) * step(iuv.x, 1.0) * step(0.0, iuv.y) * step(iuv.y, 1.0);
  vec4 ic = texture2D(tIcon, vec2((uIconIndex + iuv.x) / uIconCount, iuv.y)) * inIcon;
  col = mix(col, ic.rgb * (1.0 + uHover * 0.25), ic.a * (1.0 - uPop));

  // Specular window highlight + sparkles.
  vec2 hp = p - vec2(-0.36, 0.44);
  float ca = cos(0.65);
  float sa = sin(0.65);
  hp = vec2(ca * hp.x + sa * hp.y, -sa * hp.x + ca * hp.y);
  float hl = 1.0 - smoothstep(0.55, 1.0, length(hp / vec2(0.38, 0.17)));
  col += vec3(1.0) * hl * 0.9;
  col += vec3(1.0) * (1.0 - smoothstep(0.0, 0.1, length(p - vec2(0.5, -0.47)))) * 0.85;
  float cres = (1.0 - smoothstep(0.0, 0.05, abs(d - 0.84))) * smoothstep(-0.15, -0.7, p.y);
  col += vec3(0.75, 1.0, 1.0) * cres * 0.45;

  // Popping: membrane tears into shards that fly out and vanish.
  float tear = step(hash1(floor(ang * 5.0 + uSeed * 10.0) + floor(d * 3.0) * 7.0) * 0.8 + 0.2, 1.0 - uPop * 1.3);
  float alpha = inside * mix(1.0, rimP * tear, smoothstep(0.0, 0.15, uPop));
  alpha *= 1.0 - smoothstep(0.55, 1.0, uPop);
  col += vec3(1.0) * exp(-pow((d - 0.97) / 0.05, 2.0)) * smoothstep(0.0, 0.1, uPop) * (1.0 - uPop) * 2.0 * inside;

  // Soft outer glow (stronger on hover / on the beat).
  float outer = exp(-max(d - 1.0, 0.0) * 9.0) * (1.0 - inside);
  float glowA = outer * (0.07 + uHover * 0.4 + uBeat * (0.04 + uPrimary * 0.1) + uPrimary * 0.08) * (1.0 - uPop);
  vec3 glowC = vec3(0.7, 0.97, 1.0);
  float a = clamp(alpha * smoothstep(0.0, 0.35, uForm), 0.0, 1.0);
  vec3 outc = col * a + glowC * glowA;
  float outa = a + glowA * (1.0 - a);
  gl_FragColor = vec4(outc, outa);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function makeIconAtlas(items) {
  const cell = 160;
  const canvas = document.createElement('canvas');
  canvas.width = cell * items.length;
  canvas.height = cell;
  const ctx = canvas.getContext('2d');
  items.forEach((it, i) => {
    const cx = i * cell + cell / 2;
    const cy = cell / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,70,130,0.75)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
    drawIcon(ctx, it.icon, cx + (it.icon === 'play' ? 6 : 0), cy, cell * 0.5, '#ffffff');
    ctx.restore();
    // Inner gloss on the glyph.
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = linear(ctx, 0, cy - cell * 0.3, 0, cy + cell * 0.3, [
      [0, 'rgba(255,255,255,0)'],
      [0.55, 'rgba(255,255,255,0)'],
      [1, 'rgba(160,235,255,0.55)'],
    ]);
    ctx.fillRect(i * cell, 0, cell, cell);
    ctx.restore();
  });
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const easeOutElastic = (x) => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const c4 = (2 * Math.PI) / 3.2;
  return Math.pow(2, -9 * x) * Math.sin((x * 10 - 0.75) * c4) + 1;
};

function BubbleButton({ item, index, ctx, iconAtlas, burst, hoverRef }) {
  const group = useRef();
  const span = 2.7;
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          tScene: { value: ctx.composite.uniforms.tBelow.value },
          tIcon: { value: iconAtlas },
          uIconIndex: { value: index },
          uIconCount: { value: ITEMS.length },
          uTime: { value: 0 },
          uHover: { value: 0 },
          uPress: { value: 0 },
          uPop: { value: 0 },
          uForm: { value: 0 },
          uWobble: { value: 0 },
          uSeed: { value: index * 1.37 + 0.4 },
          uSpan: { value: span },
          uRadiusUV: { value: new THREE.Vector2(item.r / 1280, item.r / 720) },
          uCenterUV: { value: new THREE.Vector2(0.5, 0.5) },
          uBeat: { value: 0 },
          uPrimary: { value: item.id === 'play' ? 1 : 0 },
        },
        vertexShader: bubbleVertex,
        fragmentShader: bubbleFragment,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
      }),
    [iconAtlas],
  );
  const anim = useRef({ hover: 0, press: 0, wobble: 0, pop: 0, popping: false, popAt: -10, formStart: null, hovered: false, pressed: false, emit: 0 });
  const [hovered, setHovered] = useState(false);
  const label = useRef();

  useEffect(() => () => hovered && setCursor(false), [hovered]);

  useFrame((state, delta) => {
    const a = anim.current;
    const t = state.clock.elapsedTime;
    if (a.formStart === null) a.formStart = t + 0.35 + index * 0.12;
    a.hover = damp(a.hover, a.hovered && !a.popping ? 1 : 0, 10, delta);
    a.press = damp(a.press, a.pressed ? 1 : 0, 22, delta);
    a.wobble = damp(a.wobble, 0, 3.5, delta);
    let pop = 0;
    if (a.popping) {
      pop = clamp((t - a.popAt) / 0.32);
      if (t - a.popAt > 0.62) {
        a.popping = false;
        a.formStart = t;
        a.wobble = 0.6;
      }
    }
    const form = a.popping ? 1 : clamp((t - a.formStart) / 0.9);
    const formScale = a.popping ? 1 : 0.15 + 0.85 * easeOutElastic(form);
    const bobY = Math.sin(t * 0.9 + index * 1.7) * 7 + Math.sin(t * 1.7 + index) * 2.5;
    const bobX = Math.sin(t * 0.55 + index * 2.3) * 4;
    const s = formScale * (1 + a.hover * 0.12 + beat.pulse * 0.012) * (1 - a.press * 0.07);
    const g = group.current;
    g.position.set(item.x + bobX, item.y + bobY, 10);
    g.children[0].scale.setScalar(s);
    g.children[1].scale.setScalar(Math.max(formScale, 0.6));
    if (label.current) label.current.position.y = -item.r * (1 + a.hover * 0.08) - 30 - (1 - Math.min(1, formScale)) * 10;
    const u = material.uniforms;
    u.uTime.value = t;
    u.uHover.value = a.hover;
    u.uPress.value = a.press;
    u.uWobble.value = a.wobble;
    u.uPop.value = a.popping ? pop : 0;
    u.uForm.value = a.popping ? 1 : form;
    u.uBeat.value = beat.pulse;
    u.uCenterUV.value.set((g.position.x + 640) / 1280, (g.position.y + 360) / 720);
    u.uRadiusUV.value.set((item.r * s) / 1280, (item.r * s) / 720);
    // Tiny bubbles stream off the top while hovered.
    if (a.hovered && !a.popping) {
      a.emit += delta * 7;
      while (a.emit > 1) {
        a.emit -= 1;
        burst.spawn(g.position.x + (Math.random() - 0.5) * item.r * 0.9, g.position.y + item.r * s * 0.85, (Math.random() - 0.5) * 20, 40 + Math.random() * 50, 2.5 + Math.random() * 4, 1.2);
      }
    }
  });

  const pop = () => {
    const a = anim.current;
    if (a.popping) return;
    a.popping = true;
    a.popAt = material.uniforms.uTime.value;
    const g = group.current;
    const R = item.r * (1 + a.hover * 0.12);
    for (let i = 0; i < 30; i++) {
      const ang = (i / 30) * Math.PI * 2 + Math.random() * 0.2;
      const sp = 140 + Math.random() * 220;
      burst.spawn(g.position.x + Math.cos(ang) * R * 0.9, g.position.y + Math.sin(ang) * R * 0.9, Math.cos(ang) * sp, Math.sin(ang) * sp + 40, 3 + Math.random() * 8, 1.4 + Math.random() * 0.8);
    }
    for (let i = 0; i < 10; i++) {
      burst.spawn(g.position.x + (Math.random() - 0.5) * R, g.position.y + (Math.random() - 0.5) * R, (Math.random() - 0.5) * 60, 30 + Math.random() * 60, 6 + Math.random() * 10, 1.8);
    }
    ctx.ripple((g.position.x + 640) / 1280, 0.014);
    ctx.scatterAt(g.position.x, g.position.y);
  };

  return (
    <group ref={group} position={[item.x, item.y, 10]}>
      <mesh material={material} renderOrder={10}>
        <planeGeometry args={[item.r * span, item.r * span]} />
      </mesh>
      <mesh
        visible={false}
        onPointerOver={(e) => {
          e.stopPropagation();
          anim.current.hovered = true;
          anim.current.wobble = Math.max(anim.current.wobble, 0.35);
          setHovered(true);
          setCursor(true);
          hoverRef.current = { item, at: group.current.position };
        }}
        onPointerOut={() => {
          anim.current.hovered = false;
          anim.current.pressed = false;
          setHovered(false);
          setCursor(false);
          if (hoverRef.current?.item === item) hoverRef.current = null;
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          anim.current.pressed = true;
        }}
        onPointerUp={() => {
          anim.current.pressed = false;
        }}
        onClick={(e) => {
          e.stopPropagation();
          pop();
        }}
      >
        <circleGeometry args={[item.r * 1.05, 32]} />
      </mesh>
      <group ref={label} position={[0, -item.r - 30, 1]}>
        <UIPlane
          width={item.label.length > 8 ? 190 : 150}
          height={34}
          pad={18}
          appear={0.5 + index * 0.12}
          renderOrder={12}
          selected={hovered}
          hoverScale={1.08}
          redrawOnHover
          deps={[item.label]}
          draw={(c, w, h, { selected }) => {
            if (selected) {
              c.save();
              roundRect(c, 4, 2, w - 8, h - 4, (h - 4) / 2);
              c.fillStyle = 'rgba(255,255,255,0.22)';
              c.fill();
              c.strokeStyle = 'rgba(255,255,255,0.75)';
              c.lineWidth = 1.5;
              c.stroke();
              c.restore();
            }
            drawText(c, item.label, w / 2, h / 2 + 1, {
              size: item.id === 'play' ? 27 : 22,
              weight: 900,
              fill: [[0, '#ffffff'], [1, '#d8f8ff']],
              shadow: { color: 'rgba(0,45,95,0.95)', blur: 7, y: 2 },
              letterSpacing: 0.5,
            });
          }}
        />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Burst particles (tiny HUD bubbles).
// ---------------------------------------------------------------------------

function useBurst(max = 260) {
  return useMemo(() => {
    const parts = Array.from({ length: max }, () => ({ alive: false, x: 0, y: 0, vx: 0, vy: 0, r: 0, life: 0, age: 0 }));
    let next = 0;
    return {
      parts,
      spawn(x, y, vx, vy, r, life) {
        const p = parts[next];
        next = (next + 1) % max;
        Object.assign(p, { alive: true, x, y, vx, vy, r, life, age: 0, wob: Math.random() * 6 });
      },
    };
  }, [max]);
}

function BurstLayer({ burst }) {
  const max = burst.parts.length;
  const geometry = useDisposable(() => {
    const plane = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.setAttribute('position', plane.attributes.position);
    g.setAttribute('uv', plane.attributes.uv);
    g.setAttribute('aP', new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = max;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        premultipliedAlpha: true,
        vertexShader: /* glsl */ `
          attribute vec4 aP;
          varying vec2 vUv;
          varying float vA;
          void main() {
            vUv = uv;
            vA = aP.w;
            vec3 p = vec3(aP.xy + position.xy * aP.z, 0.0);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          varying float vA;
          void main() {
            vec2 p = vUv * 2.0 - 1.0;
            float d = length(p);
            float aa = fwidth(d) * 1.5;
            float disc = 1.0 - smoothstep(1.0 - aa, 1.0, d);
            float rim = smoothstep(0.55, 1.0, d) * disc;
            float hl = 1.0 - smoothstep(0.0, 0.35, length(p - vec2(-0.35, 0.38)));
            vec3 col = vec3(0.85, 0.98, 1.0) * rim + vec3(1.0) * hl;
            float a = clamp(rim * 0.85 + hl + disc * 0.08, 0.0, 1.0) * vA;
            gl_FragColor = vec4(col * a, a);
            #include <colorspace_fragment>
          }
        `,
      }),
  );
  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 30);
    const attr = geometry.attributes.aP;
    const arr = attr.array;
    const t = state.clock.elapsedTime;
    let any = false;
    const wasActive = attr.userData?.active;
    burst.parts.forEach((p, i) => {
      if (p.alive) {
        p.age += dt;
        if (p.age > p.life) p.alive = false;
      }
      if (!p.alive) {
        arr[i * 4 + 2] = 0;
        arr[i * 4 + 3] = 0;
        return;
      }
      any = true;
      p.vx *= Math.exp(-3.2 * dt);
      p.vy = p.vy * Math.exp(-2.4 * dt) + 70 * dt;
      p.x += (p.vx + Math.sin(t * 5 + p.wob) * 14) * dt;
      p.y += p.vy * dt;
      const k = p.age / p.life;
      arr[i * 4] = p.x;
      arr[i * 4 + 1] = p.y;
      arr[i * 4 + 2] = p.r * (0.6 + 0.4 * Math.min(1, p.age * 8));
      arr[i * 4 + 3] = Math.min(1, p.age * 10) * (1 - k * k);
    });
    if (any || wasActive) attr.needsUpdate = true;
    attr.userData = { active: any };
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} position={[0, 0, 30]} renderOrder={30} />;
}

// ---------------------------------------------------------------------------
// Glass info cards.
// ---------------------------------------------------------------------------

function drawAlbumArt(c, x, y, s) {
  c.save();
  roundRect(c, x, y, s, s, 12);
  c.clip();
  c.fillStyle = linear(c, 0, y, 0, y + s, [[0, '#7ff0ff'], [0.5, '#19a8e0'], [1, '#0a4f9e']]);
  c.fillRect(x, y, s, s);
  c.fillStyle = radial(c, x + s * 0.3, y + s * 0.2, 0, x + s * 0.3, y + s * 0.2, s * 0.6, [[0, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]);
  c.fillRect(x, y, s, s);
  // Fish silhouette.
  c.translate(x + s * 0.55, y + s * 0.58);
  c.beginPath();
  c.ellipse(0, 0, s * 0.22, s * 0.13, 0, 0, Math.PI * 2);
  c.moveTo(-s * 0.18, 0);
  c.lineTo(-s * 0.36, -s * 0.12);
  c.lineTo(-s * 0.36, s * 0.12);
  c.closePath();
  c.fillStyle = '#ffd23a';
  c.fill();
  c.beginPath();
  c.arc(s * 0.12, -s * 0.03, s * 0.025, 0, Math.PI * 2);
  c.fillStyle = '#10305a';
  c.fill();
  c.restore();
  drawMiniBubble(c, x + s * 0.22, y + s * 0.62, s * 0.08);
  drawMiniBubble(c, x + s * 0.3, y + s * 0.38, s * 0.05);
  drawMiniBubble(c, x + s * 0.82, y + s * 0.24, s * 0.06);
  c.save();
  roundRect(c, x, y, s, s, 12);
  c.strokeStyle = 'rgba(255,255,255,0.9)';
  c.lineWidth = 2;
  c.stroke();
  c.restore();
}

function PickCard() {
  return (
    <UIPlane
      width={300}
      height={96}
      pad={26}
      position={[-462, -266, 20]}
      appear={1.0}
      bob={[3, 0.8, 1.2]}
      sheen={0.3}
      hoverScale={1.04}
      onClick={() => {}}
      draw={(c, w, h) => {
        glass(c, { w, h, r: 22, tint: '#e8fbff', alpha: 0.42 });
        drawAlbumArt(c, 12, 12, h - 24);
        const tx = h + 2;
        drawText(c, "TODAY'S PICK", tx, 22, { size: 11, weight: 900, fill: '#0a7fc0', align: 'left', letterSpacing: 2 });
        drawText(c, 'Coral Groove', tx, 45, { size: 21, weight: 900, fill: '#0b3a66', align: 'left', maxWidth: w - tx - 50 });
        drawText(c, 'Bubble Pop Collective', tx, 66, { size: 12.5, weight: 800, fill: 'rgba(11,58,102,0.7)', align: 'left', maxWidth: w - tx - 50 });
        drawText(c, '118 BPM  ·  ★★★★☆', tx, 83, { size: 11, weight: 800, fill: 'rgba(10,127,192,0.9)', align: 'left' });
        orb(c, w - 30, h / 2, 17, { color: '#22b8f2', light: '#c8f6ff', dark: '#0a62b0' });
        drawIcon(c, 'play', w - 28, h / 2, 14, '#ffffff');
      }}
    />
  );
}

function ProfileCard() {
  return (
    <UIPlane
      width={260}
      height={96}
      pad={26}
      position={[478, -266, 20]}
      appear={1.1}
      bob={[3, 0.75, 2.6]}
      sheen={0.3}
      hoverScale={1.04}
      onClick={() => {}}
      draw={(c, w, h) => {
        glass(c, { w, h, r: 22, tint: '#e8fbff', alpha: 0.42 });
        const cx = 50;
        const cy = h / 2;
        orb(c, cx, cy, 32, { color: '#3fd0a0', light: '#d8fff0', dark: '#0f8a6a' });
        drawIcon(c, 'person', cx, cy + 3, 34, '#ffffff');
        drawText(c, 'Diver', 96, 30, { size: 21, weight: 900, fill: '#0b3a66', align: 'left' });
        drawText(c, 'LV 12', w - 18, 30, { size: 12, weight: 900, fill: '#0a7fc0', align: 'right', letterSpacing: 1 });
        // XP bar.
        roundRect(c, 96, 46, w - 114, 12, 6);
        c.fillStyle = 'rgba(11,58,102,0.15)';
        c.fill();
        c.save();
        roundRect(c, 96, 46, (w - 114) * 0.68, 12, 6);
        c.clip();
        c.fillStyle = linear(c, 0, 46, 0, 58, [[0, '#8ff7ff'], [0.5, '#1cc0f0'], [1, '#0b86d0']]);
        c.fillRect(96, 46, w, 12);
        c.fillStyle = 'rgba(255,255,255,0.55)';
        c.fillRect(96, 47, w, 4);
        c.restore();
        drawText(c, '★ 2,480 pearls', 96, 76, { size: 12.5, weight: 800, fill: 'rgba(11,58,102,0.7)', align: 'left' });
      }}
    />
  );
}

// ---------------------------------------------------------------------------

export function LagoonMenu({ ctx }) {
  const iconAtlas = useDisposable(() => makeIconAtlas(ITEMS));
  const burst = useBurst();
  const hoverRef = useRef(null);
  const attract = useRef({ w: 0 });

  useFrame((state, delta) => {
    // Fish gather behind the hovered bubble; ease out when nothing is hovered.
    const h = hoverRef.current;
    const a = ctx.shared.uAttract.value;
    if (h) ctx.hudToWorld(h.at.x, h.at.y, 9, a);
    attract.current.w = damp(attract.current.w, h ? 1 : 0, h ? 1.6 : 0.8, delta);
    a.w = attract.current.w;
    const r = ctx.shared.uRepel.value;
    r.w = damp(r.w, 0, 1.2, delta);
  });

  return (
    <>
      <LagoonLogo position={[0, 236, 0]} />
      {ITEMS.map((item, i) => (
        <BubbleButton key={item.id} item={item} index={i} ctx={ctx} iconAtlas={iconAtlas} burst={burst} hoverRef={hoverRef} />
      ))}
      <BurstLayer burst={burst} />
      <PickCard />
      <ProfileCard />
    </>
  );
}
