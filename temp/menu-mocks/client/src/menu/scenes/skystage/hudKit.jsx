import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCanvasTexture } from '../../ui/UIPlane.jsx';
import { bubble, icon, linear, radial, roundRect } from '../../ui/draw.js';
import { damp } from '../../shared/random.js';
import { setCursor } from '../../shared/hooks.js';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform float uOpacity, uHover, uPress, uTime, uSheen, uPhase, uDim;
  uniform vec2 uSize;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(map, vUv);
    float diag = vUv.x * uSize.x + (1.0 - vUv.y) * uSize.y * 0.7;
    float period = uSize.x + uSize.y + 900.0;
    float pos = mod(uTime * 320.0 + uPhase * period, period) - 300.0;
    float band = exp(-pow((diag - pos) / 30.0, 2.0)) + 0.4 * exp(-pow((diag - pos + 55.0) / 10.0, 2.0));
    float sheen = band * (uSheen + uHover * 0.7) * 0.55;
    c.rgb = c.rgb * (1.0 + uHover * 0.14 - uPress * 0.12) * (1.0 - uDim) + vec3(sheen) * c.a;
    gl_FragColor = c * uOpacity;
    #include <colorspace_fragment>
  }
`;

/**
 * Canvas-drawn HUD element whose transform/opacity are driven every frame
 * through `anim` (a mutable object: x, y, z, scale, opacity, rot, dim), so
 * carousels and orbits can animate without React re-renders.
 */
export function AnimPlane({
  width,
  height,
  draw,
  deps = [],
  pad = 24,
  anim,
  onClick,
  onHoverChange,
  hoverScale = 1.05,
  pressScale = 0.94,
  sheen = 0,
  redrawOnHover = false,
  interactive = true,
  children,
}) {
  const [hovered, setHovered] = useState(false);
  const [phase] = useState(() => Math.random());
  const texture = useCanvasTexture(width, height, (ctx, w, h) => draw(ctx, w, h, { hovered: redrawOnHover && hovered }), [...deps, redrawOnHover && hovered], { pad });
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: null },
          uOpacity: { value: 0 },
          uHover: { value: 0 },
          uPress: { value: 0 },
          uTime: { value: 0 },
          uSheen: { value: 0 },
          uPhase: { value: 0 },
          uDim: { value: 0 },
          uSize: { value: new THREE.Vector2() },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  u.map.value = texture;
  u.uSize.value.set(width + pad * 2, height + pad * 2);
  u.uSheen.value = sheen;
  u.uPhase.value = phase;

  const group = useRef();
  const st = useRef({ hover: 0, press: 0, pressed: false });
  const clickable = Boolean(onClick) && interactive;
  useEffect(() => () => hovered && setCursor(false), [hovered]);

  useFrame((state, delta) => {
    const a = st.current;
    const live = clickable && (anim.opacity ?? 1) > 0.5;
    a.hover = damp(a.hover, hovered && live ? 1 : 0, 14, delta);
    a.press = damp(a.press, a.pressed ? 1 : 0, 24, delta);
    const s = (anim.scale ?? 1) * (1 + (hoverScale - 1) * a.hover) * (1 - (1 - pressScale) * a.press);
    const g = group.current;
    g.position.set(anim.x ?? 0, anim.y ?? 0, anim.z ?? 0);
    g.rotation.set(0, anim.ry ?? 0, anim.rot ?? 0);
    g.scale.setScalar(s);
    g.visible = (anim.opacity ?? 1) > 0.003;
    u.uTime.value = state.clock.elapsedTime;
    u.uHover.value = a.hover;
    u.uPress.value = a.press;
    u.uOpacity.value = anim.opacity ?? 1;
    u.uDim.value = anim.dim ?? 0;
  });

  const handlers = clickable
    ? {
        onPointerOver: (e) => {
          if ((anim.opacity ?? 1) < 0.5) return;
          e.stopPropagation();
          setHovered(true);
          setCursor(true);
          onHoverChange?.(true);
        },
        onPointerOut: () => {
          setHovered(false);
          setCursor(false);
          st.current.pressed = false;
          onHoverChange?.(false);
        },
        onPointerDown: (e) => {
          if ((anim.opacity ?? 1) < 0.5) return;
          e.stopPropagation();
          st.current.pressed = true;
        },
        onPointerUp: () => {
          st.current.pressed = false;
        },
        onClick: (e) => {
          if ((anim.opacity ?? 1) < 0.5) return;
          e.stopPropagation();
          onClick(e);
        },
      }
    : {};

  return (
    <group ref={group}>
      <mesh material={material}>
        <planeGeometry args={[width + pad * 2, height + pad * 2]} />
      </mesh>
      {clickable && (
        <mesh visible={false} {...handlers}>
          <planeGeometry args={[width, height]} />
        </mesh>
      )}
      {children}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Procedural "album art" for the featured song cards.

export function drawAlbumArt(ctx, x, y, size, song) {
  const [c0, c1, c2] = song.colors;
  const r = size * 0.16;
  ctx.save();
  ctx.shadowColor = 'rgba(90,30,110,0.35)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  roundRect(ctx, x, y, size, size, r);
  ctx.fillStyle = c0;
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, x, y, size, size, r);
  ctx.clip();
  ctx.fillStyle = linear(ctx, x, y, x + size, y + size, [
    [0, c1],
    [0.55, c0],
    [1, c2],
  ]);
  ctx.fillRect(x, y, size, size);
  const cx = x + size / 2;
  const cy = y + size / 2;
  const s = size;
  switch (song.art) {
    case 'sun': {
      // Retro striped sunset over a glossy sea.
      ctx.fillStyle = linear(ctx, 0, cy - s * 0.3, 0, cy + s * 0.15, [
        [0, '#fff6c8'],
        [1, '#ff8fb8'],
      ]);
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.08, s * 0.3, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = c0;
      for (let i = 0; i < 4; i++) ctx.fillRect(x, cy - s * 0.02 + i * s * 0.035, s, s * (0.008 + i * 0.006));
      ctx.fillStyle = linear(ctx, 0, cy + s * 0.08, 0, y + s, [
        [0, 'rgba(120,220,255,0.9)'],
        [1, 'rgba(60,120,220,0.9)'],
      ]);
      ctx.fillRect(x, cy + s * 0.08, s, s);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = s * 0.012;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - s * (0.25 - i * 0.04), cy + s * (0.14 + i * 0.07));
        ctx.lineTo(cx + s * (0.25 - i * 0.04), cy + s * (0.14 + i * 0.07));
        ctx.stroke();
      }
      break;
    }
    case 'bubbles':
      [[0.3, 0.35, 0.2], [0.68, 0.28, 0.13], [0.62, 0.68, 0.22], [0.25, 0.75, 0.1], [0.85, 0.55, 0.07]].forEach(([bx, by, br]) =>
        bubble(ctx, x + bx * s, y + by * s, br * s),
      );
      break;
    case 'waves':
      ctx.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const yy = y + s * (0.3 + i * 0.12);
        ctx.strokeStyle = `rgba(255,255,255,${0.85 - i * 0.12})`;
        ctx.lineWidth = s * 0.045;
        ctx.beginPath();
        for (let k = 0; k <= 24; k++) {
          const xx = x + (k / 24) * s;
          ctx.lineTo(xx, yy + Math.sin(k * 0.6 + i * 1.3) * s * 0.04);
        }
        ctx.stroke();
      }
      icon(ctx, 'leaf', x + s * 0.76, y + s * 0.18, s * 0.2, 'rgba(255,255,255,0.9)');
      break;
    case 'stars':
      ctx.fillStyle = radial(ctx, cx, cy, 0, cx, cy, s * 0.5, [
        [0, 'rgba(255,255,255,0.55)'],
        [1, 'rgba(255,255,255,0)'],
      ]);
      ctx.fillRect(x, y, s, s);
      [[0.5, 0.48, 0.42], [0.22, 0.25, 0.16], [0.78, 0.3, 0.12], [0.3, 0.78, 0.1], [0.8, 0.78, 0.18]].forEach(([sx, sy, ss]) =>
        icon(ctx, 'sparkle', x + sx * s, y + sy * s, ss * s, '#ffffff'),
      );
      break;
    case 'hearts':
    default:
      icon(ctx, 'heart', cx, cy + s * 0.04, s * 0.55, 'rgba(255,255,255,0.95)');
      icon(ctx, 'heart', x + s * 0.2, y + s * 0.24, s * 0.18, 'rgba(255,255,255,0.7)');
      icon(ctx, 'heart', x + s * 0.82, y + s * 0.78, s * 0.14, 'rgba(255,255,255,0.7)');
      break;
  }
  // Vinyl-glass gloss.
  ctx.beginPath();
  ctx.ellipse(cx, y + s * 0.08, s * 0.75, s * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = linear(ctx, 0, y, 0, y + s * 0.5, [
    [0, 'rgba(255,255,255,0.55)'],
    [1, 'rgba(255,255,255,0.03)'],
  ]);
  ctx.fill();
  ctx.restore();
  roundRect(ctx, x + 1, y + 1, size - 2, size - 2, r - 1);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  ctx.stroke();
}
