import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCanvasTexture } from '../../ui/UIPlane.jsx';
import { clamp } from '../../shared/random.js';

// HUD helpers for the Aero menu: a framebuffer grab so glass panels can blur
// the finished city image behind them, the glass panel itself, and a
// lightweight canvas sprite whose opacity/transform we drive per frame.

const GrabContext = createContext(null);

/** Copies the composited world into a texture right before HUD glass draws. */
export function FrameGrab({ children }) {
  const gl = useThree((s) => s.gl);
  const grab = useMemo(() => {
    const size = new THREE.Vector2();
    gl.getDrawingBufferSize(size);
    const texture = new THREE.FramebufferTexture(size.x, size.y);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return { texture, size };
  }, [gl]);
  useEffect(() => () => grab.texture.dispose(), [grab]);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, transparent: true }), []);
  useEffect(() => () => material.dispose(), [material]);
  const onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(grab.size);
    if (grab.size.x !== grab.texture.image.width || grab.size.y !== grab.texture.image.height) return;
    renderer.copyFramebufferToTexture(grab.texture);
  };
  return (
    <GrabContext.Provider value={grab}>
      <mesh material={material} renderOrder={-100} frustumCulled={false} onBeforeRender={onBeforeRender} position={[0, 0, -50]}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      {children}
    </GrabContext.Provider>
  );
}

const glassVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// Everything here stays in display (sRGB) space: the grabbed framebuffer is
// already encoded, and the result is blended straight onto it.
const glassFragment = /* glsl */ `
  uniform sampler2D uScene;
  uniform vec2 uRes;
  uniform vec2 uSize;
  uniform float uRadius;
  uniform float uOpacity;
  uniform float uTime;
  uniform vec4 uPane;      // inner milky pane: x0, y0, x1, y1 (px from panel center, +y up)
  uniform float uPaneAlpha;
  uniform vec3 uTint;
  uniform float uBlur;
  varying vec2 vUv;

  float sdRound(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - (halfSize - r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    vec2 p = (vUv - 0.5) * uSize;
    float d = sdRound(p, uSize * 0.5, uRadius);
    float mask = 1.0 - smoothstep(-1.2, 0.6, d);
    if (mask <= 0.0) discard;

    // Vogel-disk blur of the city behind the glass.
    vec2 suv = gl_FragCoord.xy / uRes;
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 28; i++) {
      float fi = float(i) + 0.5;
      float r = sqrt(fi / 28.0);
      float a = fi * 2.39996;
      vec2 o = vec2(cos(a), sin(a)) * r * uBlur / uRes;
      float w = exp(-r * r * 2.0);
      acc += texture2D(uScene, suv + o).rgb * w;
      wsum += w;
    }
    vec3 bg = acc / wsum;
    // Aero glass: slightly brightened, tinted, a touch more saturated.
    float l = dot(bg, vec3(0.299, 0.587, 0.114));
    bg = mix(vec3(l), bg, 1.15);
    vec3 col = mix(bg, uTint, 0.28) + 0.05;
    // Vertical gloss: brighter top half, soft bottom glow.
    float ty = vUv.y;
    col += vec3(1.0) * smoothstep(0.55, 1.0, ty) * 0.12;
    col += vec3(1.0) * pow(1.0 - abs(ty - 0.5) * 2.0, 6.0) * 0.0;
    // Diagonal specular streaks (Vista frame).
    float diag = (p.x + p.y * 0.55) / uSize.x;
    float streak = smoothstep(0.03, 0.0, abs(fract(diag * 1.3 + 0.12) - 0.5) - 0.12) * 0.05
                 + smoothstep(0.015, 0.0, abs(fract(diag * 2.1 + 0.4) - 0.5) - 0.02) * 0.06;
    col += streak;

    // Milky inner pane for readable text.
    float pd = sdRound(p - vec2((uPane.x + uPane.z) * 0.5, (uPane.y + uPane.w) * 0.5), vec2(uPane.z - uPane.x, uPane.w - uPane.y) * 0.5, 6.0);
    float pane = (1.0 - smoothstep(-0.8, 0.8, pd)) * step(0.5, uPaneAlpha + 0.5) * uPaneAlpha;
    vec3 paneCol = mix(vec3(0.97, 0.985, 1.0), vec3(0.88, 0.94, 0.99), smoothstep(uPane.w, uPane.y, p.y));
    col = mix(col, paneCol, pane);
    // Pane border: dark outer line + white inner highlight.
    float pEdge = smoothstep(1.2, 0.0, abs(pd)) * step(0.001, uPaneAlpha);
    col = mix(col, vec3(0.45, 0.6, 0.75), pEdge * 0.55);
    float pInner = smoothstep(1.0, 0.0, abs(pd + 1.6)) * step(0.001, uPaneAlpha);
    col = mix(col, vec3(1.0), pInner * 0.7);

    // Outer frame highlights: bright inner rim, darker outer edge.
    float rim = smoothstep(2.2, 0.0, abs(d + 1.8));
    col = mix(col, vec3(1.0), rim * 0.75);
    float outer = smoothstep(1.4, 0.0, abs(d + 0.2));
    col = mix(col, vec3(0.12, 0.28, 0.45), outer * 0.55);

    float a = mask * uOpacity;
    gl_FragColor = vec4(col * a, a);
  }
`;

/**
 * Frosted Aero glass rectangle that blurs whatever is behind it.
 * pane: inner milky area [x0, y0, x1, y1] relative to the panel center.
 */
export function GlassPanel({ width, height, position = [0, 0, 0], radius = 10, pane = null, paneAlpha = 0.86, tint = '#dff3ff', blur = 7, appear = 0, renderOrder = -50 }) {
  const grab = useContext(GrabContext);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uScene: { value: null },
          uRes: { value: new THREE.Vector2(640, 480) },
          uSize: { value: new THREE.Vector2() },
          uRadius: { value: radius },
          uOpacity: { value: 0 },
          uTime: { value: 0 },
          uPane: { value: new THREE.Vector4() },
          uPaneAlpha: { value: 0 },
          uTint: { value: new THREE.Color() },
          uBlur: { value: blur },
        },
        vertexShader: glassVertex,
        fragmentShader: glassFragment,
        transparent: true,
        premultipliedAlpha: true,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  u.uScene.value = grab?.texture ?? null;
  u.uSize.value.set(width, height);
  u.uRadius.value = radius;
  u.uBlur.value = blur;
  // Tint is used in display space, so take the raw sRGB components.
  const c = new THREE.Color(tint);
  u.uTint.value.setRGB(...c.convertLinearToSRGB().toArray());
  if (pane) u.uPane.value.set(...pane);
  u.uPaneAlpha.value = pane ? paneAlpha : 0;
  const born = useRef(null);
  const mesh = useRef();
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (born.current === null) born.current = t;
    const p = clamp((t - born.current - appear) / 0.5);
    u.uOpacity.value = p * p * (3 - 2 * p);
    u.uTime.value = t;
    if (grab) u.uRes.value.copy(grab.size);
    mesh.current.position.set(position[0], position[1] - (1 - p) * 16, position[2]);
  });
  return (
    <mesh ref={mesh} material={material} renderOrder={renderOrder}>
      <planeGeometry args={[width, height]} />
    </mesh>
  );
}

const spriteFragment = /* glsl */ `
  uniform sampler2D map;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(map, vUv);
    gl_FragColor = c * uOpacity;
    #include <colorspace_fragment>
  }
`;

/** Canvas-drawn HUD quad with an opacity uniform we can animate imperatively. */
export function CanvasSprite({ width, height, draw, deps = [], pad = 12, spriteRef, renderOrder = 0, position = [0, 0, 0], ...props }) {
  const texture = useCanvasTexture(width, height, draw, deps, { pad });
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { map: { value: null }, uOpacity: { value: 1 } },
        vertexShader: glassVertex,
        fragmentShader: spriteFragment,
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
  useLayoutEffect(() => {
    if (spriteRef) spriteRef.current = material;
  });
  return (
    <mesh material={material} renderOrder={renderOrder} position={position} {...props}>
      <planeGeometry args={[width + pad * 2, height + pad * 2]} />
    </mesh>
  );
}
