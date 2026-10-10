import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { damp, clamp } from '../shared/random.js';
import { setCursor } from '../shared/hooks.js';
import { gel, glass, icon as drawIcon, text as drawText } from './draw.js';

// Texture pixels per virtual HUD pixel. The buffer is 0.5 px per virtual px
// horizontally, so this supersamples ~3x and mipmaps resolve it cleanly.
const TEXTURE_RES = 1.5;

/**
 * Canvas-backed texture redrawn whenever `deps` change.
 * draw(ctx, width, height) works in virtual pixels with (0,0) at the top-left
 * of the content box; `pad` adds transparent margin for shadows and glows.
 */
export function useCanvasTexture(width, height, draw, deps = [], { pad = 0, res = TEXTURE_RES } = {}) {
  const canvas = useMemo(() => document.createElement('canvas'), []);
  const texture = useMemo(() => {
    canvas.width = Math.ceil((width + pad * 2) * res);
    canvas.height = Math.ceil((height + pad * 2) * res);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.premultiplyAlpha = true;
    t.anisotropy = 4;
    return t;
  }, [canvas, width, height, pad, res]);

  useLayoutEffect(() => {
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(res, 0, 0, res, pad * res, pad * res);
    draw(ctx, width, height);
    texture.needsUpdate = true;
  }, [texture, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform float uOpacity;
  uniform float uHover;
  uniform float uPress;
  uniform float uTime;
  uniform float uSheen;
  uniform float uPhase;
  uniform vec2 uSize;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(map, vUv);
    // A glossy highlight band that sweeps diagonally across the element.
    float diag = vUv.x * uSize.x + (1.0 - vUv.y) * uSize.y * 0.7;
    float period = uSize.x + uSize.y + 900.0;
    float pos = mod(uTime * 320.0 + uPhase * period, period) - 300.0;
    float band = exp(-pow((diag - pos) / 30.0, 2.0)) + 0.4 * exp(-pow((diag - pos + 55.0) / 10.0, 2.0));
    float sheen = band * (uSheen + uHover * 0.7) * 0.55;
    c.rgb = c.rgb * (1.0 + uHover * 0.14 - uPress * 0.12) + vec3(sheen) * c.a;
    gl_FragColor = c * uOpacity;
    #include <colorspace_fragment>
  }
`;

const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/**
 * A HUD element drawn with Canvas 2D. Handles hover/press animation, a
 * sweeping gloss sheen, an entrance animation and gentle bobbing.
 *
 * width/height: content size in virtual px (also the click target).
 * draw(ctx, w, h, { hovered }): paint the element.
 * deps: values that require a redraw.
 * appear: entrance delay in seconds (null disables the entrance animation).
 * bob: [amplitude px, speed, phase] idle float.
 */
export function UIPlane({
  width,
  height,
  draw,
  deps = [],
  pad = 28,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  onClick,
  onHoverChange,
  hoverScale = 1.06,
  pressScale = 0.94,
  sheen = 0,
  sheenPhase,
  opacity = 1,
  renderOrder = 0,
  appear = 0,
  bob = null,
  redrawOnHover = false,
  selected = false,
  groupRef,
  children,
}) {
  const [hovered, setHovered] = useState(false);
  const [randomPhase] = useState(() => Math.random());
  const interactive = Boolean(onClick);
  const drawHover = redrawOnHover && (hovered || selected);
  const texture = useCanvasTexture(
    width,
    height,
    (ctx, w, h) => draw(ctx, w, h, { hovered: drawHover, selected }),
    [...deps, drawHover, selected],
    { pad },
  );

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
  material.uniforms.map.value = texture;
  material.uniforms.uSize.value.set(width + pad * 2, height + pad * 2);
  material.uniforms.uSheen.value = sheen;
  material.uniforms.uPhase.value = sheenPhase ?? randomPhase;

  const localGroup = useRef();
  const group = groupRef ?? localGroup;
  const anim = useRef({ hover: 0, press: 0, pressed: false, born: null });

  useEffect(() => () => hovered && setCursor(false), [hovered]);

  useFrame((state, delta) => {
    const a = anim.current;
    const t = state.clock.elapsedTime;
    if (a.born === null) a.born = t;
    const active = hovered || selected;
    a.hover = damp(a.hover, active ? 1 : 0, 14, delta);
    a.press = damp(a.press, a.pressed ? 1 : 0, 24, delta);
    const p = appear === null ? 1 : clamp((t - a.born - appear) / 0.55);
    const enter = appear === null ? 1 : easeOutBack(p);
    const s = scale * (1 + (hoverScale - 1) * a.hover) * (1 - (1 - pressScale) * a.press) * (0.9 + 0.1 * enter);
    const bobY = bob ? Math.sin(t * bob[1] + (bob[2] ?? 0)) * bob[0] : 0;
    const g = group.current;
    g.position.set(position[0], position[1] + bobY - (1 - enter) * 24, position[2] ?? 0);
    g.rotation.set(rotation[0], rotation[1], rotation[2]);
    g.scale.setScalar(s);
    material.uniforms.uTime.value = t;
    material.uniforms.uHover.value = interactive ? a.hover : 0;
    material.uniforms.uPress.value = a.press;
    material.uniforms.uOpacity.value = opacity * clamp(p * 1.6);
  });

  const handlers = interactive
    ? {
        onPointerOver: (e) => {
          e.stopPropagation();
          setHovered(true);
          setCursor(true);
          onHoverChange?.(true);
        },
        onPointerOut: () => {
          setHovered(false);
          setCursor(false);
          anim.current.pressed = false;
          onHoverChange?.(false);
        },
        onPointerDown: (e) => {
          e.stopPropagation();
          anim.current.pressed = true;
        },
        onPointerUp: () => {
          anim.current.pressed = false;
        },
        onClick: (e) => {
          e.stopPropagation();
          onClick(e);
        },
      }
    : {};

  return (
    <group ref={group}>
      <mesh material={material} renderOrder={renderOrder}>
        <planeGeometry args={[width + pad * 2, height + pad * 2]} />
      </mesh>
      {interactive && (
        <mesh visible={false} {...handlers}>
          <planeGeometry args={[width, height]} />
        </mesh>
      )}
      {children}
    </group>
  );
}

/** Non-interactive text label. */
export function UIText({ text, width, height, style, deps = [], ...props }) {
  return (
    <UIPlane
      width={width}
      height={height}
      pad={16}
      deps={[text, JSON.stringify(style), ...deps]}
      draw={(ctx, w, h) => drawText(ctx, text, style?.align === 'left' ? 0 : style?.align === 'right' ? w : w / 2, h / 2, { maxWidth: w, ...style })}
      {...props}
    />
  );
}

/**
 * Glossy gel pill button with optional icon. `theme` = { color, light, dark,
 * text, outline } colors; `variant` = 'gel' | 'glass'.
 */
export function UIButton({
  label,
  icon,
  width = 260,
  height = 64,
  theme = {},
  variant = 'gel',
  fontSize,
  radius,
  sublabel,
  ...props
}) {
  const t = { color: '#1e9cf0', light: '#a8e6ff', dark: '#0a5aa8', text: '#ffffff', textShadow: 'rgba(0,40,90,0.6)', ...theme };
  return (
    <UIPlane
      width={width}
      height={height}
      sheen={0.25}
      deps={[label, icon, sublabel, JSON.stringify(t), variant, fontSize, radius]}
      draw={(ctx, w, h) => {
        const r = radius ?? h / 2;
        if (variant === 'glass') glass(ctx, { w, h, r, tint: t.light, dark: t.darkGlass });
        else gel(ctx, { w, h, r, color: t.color, light: t.light, dark: t.dark, outline: t.outline });
        const size = fontSize ?? h * 0.42;
        const iconSize = h * 0.5;
        const tx = icon ? h * 0.42 + iconSize * 0.5 + 10 : w / 2;
        if (icon) {
          ctx.save();
          ctx.shadowColor = t.textShadow;
          ctx.shadowBlur = 4;
          ctx.shadowOffsetY = 1.5;
          drawIcon(ctx, icon, h * 0.42 + iconSize * 0.2, h / 2, iconSize, t.text);
          ctx.restore();
        }
        const shadow = { color: t.textShadow, blur: 4, y: 1.5 };
        if (sublabel) {
          drawText(ctx, label, tx, h * 0.4, { size, align: icon ? 'left' : 'center', fill: t.text, shadow, maxWidth: w - tx - 16 });
          drawText(ctx, sublabel, tx, h * 0.72, { size: size * 0.5, weight: 700, align: icon ? 'left' : 'center', fill: t.text, shadow, maxWidth: w - tx - 16 });
        } else {
          drawText(ctx, label, tx, h / 2 + 1, { size, align: icon ? 'left' : 'center', fill: t.text, shadow, maxWidth: w - tx - 16 });
        }
      }}
      {...props}
    />
  );
}
