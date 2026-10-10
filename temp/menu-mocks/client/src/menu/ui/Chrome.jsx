import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { socket } from '../../socket.js';
import { HUD_BOTTOM, HUD_HEIGHT, HUD_RIGHT, HUD_TOP, HUD_WIDTH } from '../hud.jsx';
import { UIPlane } from './UIPlane.jsx';
import { glass, icon, orb, text } from './draw.js';

// Shared menu chrome: the variation switcher, the online badge and the
// transition veil. `tone` is 'light' (frosted white glass) or 'dark'.

const TONES = {
  light: { text: '#0d3b66', sub: 'rgba(13,59,102,0.65)', dark: false, tint: '#f2fbff', dot: '#1e9cf0', dotOff: 'rgba(13,59,102,0.25)' },
  dark: { text: '#ffffff', sub: 'rgba(255,255,255,0.7)', dark: true, tint: '#0b1f3a', dot: '#7fe3ff', dotOff: 'rgba(255,255,255,0.3)' },
};

export function SceneSwitcher({ scenes, index, onSelect, tone = 'light' }) {
  const t = TONES[tone];
  const y = HUD_BOTTOM + 40;
  const scene = scenes[index];
  const count = scenes.length;
  const prev = () => onSelect((index - 1 + count) % count);
  const next = () => onSelect((index + 1) % count);
  return (
    <group position={[0, 0, 50]}>
      <UIPlane
        width={400}
        height={50}
        position={[0, y, 0]}
        appear={null}
        deps={[scene.name, index, tone]}
        draw={(ctx, w, h) => {
          glass(ctx, { w, h, r: h / 2, dark: t.dark, tint: t.tint, alpha: t.dark ? 0.2 : 0.5 });
          text(ctx, scene.name, w / 2, h * 0.4, { size: 19, weight: 900, fill: t.text, letterSpacing: 0.5, maxWidth: 220 });
          text(ctx, `${index + 1} / ${count}  ·  ← →  or  1–${count}`, w / 2, h * 0.78, { size: 10, weight: 800, fill: t.sub, letterSpacing: 1 });
        }}
      />
      {[
        ['chevronLeft', -176, prev],
        ['chevronRight', 176, next],
      ].map(([name, x, handler]) => (
        <UIPlane
          key={name}
          width={40}
          height={40}
          pad={14}
          position={[x, y, 1]}
          appear={null}
          hoverScale={1.15}
          onClick={handler}
          deps={[tone]}
          draw={(ctx, w, h) => {
            orb(ctx, w / 2, h / 2, w / 2 - 1, t.dark
              ? { color: '#2a6fb3', light: '#8fd8ff', dark: '#0b2a55' }
              : { color: '#2aa4f4', light: '#c9f1ff', dark: '#0a5aa8' });
            icon(ctx, name, w / 2 + (name === 'chevronLeft' ? -1 : 1), h / 2 + 1, 16, '#ffffff');
          }}
        />
      ))}
    </group>
  );
}

export function OnlineBadge({ tone = 'light' }) {
  const t = TONES[tone];
  const [connected, setConnected] = useState(socket.connected);
  const [online, setOnline] = useState(0);
  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onStats = (stats) => setOnline(stats.online);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('stats', onStats);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('stats', onStats);
    };
  }, []);
  const label = connected ? `${online} online` : 'offline';
  return (
    <UIPlane
      width={132}
      height={32}
      pad={16}
      position={[HUD_RIGHT - 86, HUD_TOP - 30, 50]}
      appear={null}
      deps={[label, connected, tone]}
      draw={(ctx, w, h) => {
        glass(ctx, { w, h, r: h / 2, dark: t.dark, tint: t.tint, alpha: t.dark ? 0.15 : 0.45, streaks: false });
        orb(ctx, 20, h / 2, 6.5, connected
          ? { color: '#3fd14a', light: '#d4ffc4', dark: '#16801f', shadow: false }
          : { color: '#e5484d', light: '#ffd0d0', dark: '#8a1c20', shadow: false });
        text(ctx, label, 34, h / 2 + 1, { size: 14, weight: 800, fill: t.text, align: 'left' });
      }}
    />
  );
}

/** Full-screen veil used to hide scene swaps. `fade` is a ref with .value in 0..1. */
export function TransitionVeil({ fade }) {
  const mesh = useRef();
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uOpacity: { value: 1 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          uniform float uOpacity;
          varying vec2 vUv;
          void main() {
            vec2 d = (vUv - vec2(0.5, 0.55)) * vec2(16.0 / 9.0, 1.0);
            float r = length(d);
            vec3 col = mix(vec3(1.0), vec3(0.55, 0.82, 0.98), smoothstep(0.1, 1.1, r));
            // A soft glossy ring expands as the veil closes.
            col += vec3(0.25) * exp(-pow((r - (1.0 - uOpacity) * 1.2) * 9.0, 2.0));
            gl_FragColor = vec4(col, uOpacity);
            #include <colorspace_fragment>
          }
        `,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    const v = fade.current.value;
    mesh.current.visible = v > 0.001;
    material.uniforms.uOpacity.value = v;
  });
  return (
    <mesh ref={mesh} position={[0, 0, 90]} material={material} renderOrder={1000}>
      <planeGeometry args={[HUD_WIDTH, HUD_HEIGHT]} />
    </mesh>
  );
}
