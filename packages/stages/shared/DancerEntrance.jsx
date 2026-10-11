import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { reducedMotion, useDisposable } from './hooks.js';
import { clamp, mulberry32 } from './random.js';

// The floor wakes up on the last count; the dancer settles exactly at the first beat.
const LEAD_SECONDS = 0.72;
const DURATION = 2.1;
const BUBBLES = 42;

const bubbleVertex = /* glsl */ `
  uniform float uTime;
  attribute vec4 aBubble;
  attribute vec3 aShape;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vUv = uv;
    float age = uTime - aBubble.x;
    float k = clamp(age / aBubble.y, 0.0, 1.0);
    float grow = smoothstep(0.0, 0.12, age);
    float fade = 1.0 - smoothstep(0.6, 1.0, k);
    vAlpha = grow * fade;
    float angle = aBubble.z + k * 0.55;
    float spread = aBubble.w * (0.55 + k * 0.6);
    vec3 centre = vec3(cos(angle) * spread, aShape.x + k * aShape.y, sin(angle) * spread);
    centre.x += sin(k * 7.0 + aShape.z) * k * 0.16;
    // Billboards keep their glass rims round from every stage's camera angle.
    vec4 view = modelViewMatrix * vec4(centre, 1.0);
    float scale = length(modelMatrix[0].xyz);
    view.xy += position.xy * aShape.x * 2.0 * grow * (1.0 + k * 0.3) * scale;
    gl_Position = projectionMatrix * view;
  }
`;

const bubbleFragment = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    if (r > 1.0 || vAlpha < 0.001) discard;
    float edge = 1.0 - smoothstep(0.92, 1.0, r);
    float rim = smoothstep(0.65, 0.94, r);
    float gleam = exp(-pow(length(p - vec2(-0.32, 0.38)) / 0.16, 2.0));
    float arc = exp(-pow((r - 0.81) / 0.06, 2.0)) * smoothstep(-0.1, 0.65, p.y - p.x);
    vec3 pearl = mix(uColor, vec3(0.65, 1.0, 0.94), p.y * 0.5 + 0.5);
    vec3 col = mix(pearl, vec3(1.0), clamp(gleam + arc * 0.75, 0.0, 1.0));
    gl_FragColor = vec4(col * (1.0 + arc * 0.6), edge * vAlpha * (0.09 + rim * 0.6 + gleam * 0.65 + arc * 0.3));
  }
`;

const rippleFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float fade = smoothstep(0.0, 0.16, uTime) * (1.0 - smoothstep(0.6, 1.6, uTime));
    float pool = exp(-r * r * 8.0) * 0.18;
    float ring = exp(-pow((r - (0.14 + uTime * 0.53)) / 0.025, 2.0));
    float echo = exp(-pow((r - max(0.0, uTime - 0.22) * 0.58) / 0.018, 2.0)) * 0.45;
    gl_FragColor = vec4(uColor * 1.4, (pool + ring * 0.55 + echo) * fade * (1.0 - smoothstep(0.8, 1.0, r)));
  }
`;

/** A short, song-clock-driven entrance in the dancer's local floor coordinates. */
export default function DancerEntrance({ children, timeMs, color, seed }) {
  const dancer = useRef();
  const effects = useRef();
  const resources = useDisposable(() => {
    const rand = mulberry32(seed * 107);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const bubbles = new Float32Array(BUBBLES * 4);
    const shapes = new Float32Array(BUBBLES * 3);
    for (let i = 0; i < BUBBLES; i++) {
      bubbles.set([rand() * 0.42, 0.85 + rand() * 0.8, rand() * Math.PI * 2, 0.35 + rand() * 0.95], i * 4);
      shapes.set([0.07 + rand() ** 2 * 0.22, 1.6 + rand() * 2.2, rand() * Math.PI * 2], i * 3);
    }
    geometry.setAttribute('aBubble', new THREE.InstancedBufferAttribute(bubbles, 4));
    geometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(shapes, 3));
    const material = (vertexShader, fragmentShader) => new THREE.ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color).lerp(new THREE.Color('#d2fcff'), 0.35) } },
      transparent: true, depthWrite: false,
    });
    return {
      geometry,
      bubble: material(bubbleVertex, bubbleFragment),
      ripple: material('varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', rippleFragment),
    };
  }, [color, seed]);

  useFrame(() => {
    // Previews and the captured demo do not have an entrance clock.
    const t = timeMs ? timeMs() / 1000 + LEAD_SECONDS : Infinity;
    const k = clamp((t - 0.18) / (LEAD_SECONDS - 0.18));
    dancer.current.visible = reducedMotion ? t >= LEAD_SECONDS : k > 0;
    // A small squash-and-stretch with one overshoot, fully settled at song zero.
    const pop = Math.max(0.001, 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2);
    dancer.current.scale.set(reducedMotion ? 1 : pop, reducedMotion ? 1 : pop * (1 + Math.sin(k * Math.PI) * 0.12), reducedMotion ? 1 : pop);
    dancer.current.position.y = reducedMotion ? 0 : Math.sin(k * Math.PI) * 0.12;
    effects.current.visible = !reducedMotion && t > 0 && t < DURATION;
    if (!effects.current.visible) return;
    resources.bubble.uniforms.uTime.value = t;
    resources.ripple.uniforms.uTime.value = t;
  });

  return (
    <group name="dancer-entrance">
      <group name="entrance-character" ref={dancer} visible={!timeMs}>{children}</group>
      <group name="entrance-bubbles" ref={effects} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} material={resources.ripple}>
          <planeGeometry args={[4.2, 4.2]} />
        </mesh>
        {/* One draw call for the whole burst; no lights, textures or per-frame allocations. */}
        <instancedMesh args={[resources.geometry, resources.bubble, BUBBLES]} frustumCulled={false} />
      </group>
    </group>
  );
}
