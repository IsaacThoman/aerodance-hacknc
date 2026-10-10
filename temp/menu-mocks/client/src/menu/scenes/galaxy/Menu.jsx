import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { HUD_BOTTOM, HUD_LEFT } from '../../hud.jsx';
import { UIPlane } from '../../ui/UIPlane.jsx';
import { useSharedSpin } from '../../ui/Logo.jsx';
import { text } from '../../ui/draw.js';
import { clamp, damp } from '../../shared/random.js';
import { useDisposable } from '../../shared/hooks.js';
import { TARGETS, targetPosition } from './layout.js';
import { drawEntry, drawGalaxyLogo, glossyStar, lighten, starBitIcon, starGlass, starPath, twinkle } from './menuDraw.js';

// Galaxy-map menu: a curved column of star entries on the left, each linked
// to a planet. Hovering glides the camera to it; clicking locks it in.

const ARC = [0, 12, 20, 24, 22, 14];

function entryBox(i) {
  const primary = i === 0;
  const w = primary ? 318 : 292;
  const h = primary ? 66 : 54;
  const y = primary ? 122 : 52 - (i - 1) * 62;
  const left = HUD_LEFT + 34 + ARC[i];
  return { x: left + w / 2, y, w, h, primary, right: left + w };
}

function GalaxyLogo() {
  const [spin, trigger] = useSharedSpin();
  const outer = useRef();
  useFrame(() => {
    outer.current.rotation.y = spin.current.angle;
  });
  return (
    <group ref={outer} position={[-384, 262, 0]}>
      <UIPlane
        width={440}
        height={140}
        pad={40}
        appear={0.05}
        bob={[3, 1.1, 0]}
        sheen={0.5}
        hoverScale={1.03}
        onClick={trigger}
        draw={(ctx, w, h) => drawGalaxyLogo(ctx, w, h, 74)}
      />
      <Twinkle position={[-176, 30, 2]} size={16} speed={1.3} phase={0} />
      <Twinkle position={[140, -34, 2]} size={13} speed={1.1} phase={2} />
      <Twinkle position={[40, 62, 2]} size={12} speed={1.7} phase={4} />
    </group>
  );
}

function Twinkle({ position, size, speed, phase, color = '#ffffff' }) {
  const ref = useRef();
  useFrame((s) => {
    const t = s.clock.elapsedTime * speed + phase;
    const k = Math.pow(Math.max(0, Math.sin(t)), 6);
    ref.current.scale.setScalar(0.001 + k);
    ref.current.rotation.z = t * 0.4;
  });
  return (
    <group position={position}>
      <group ref={ref}>
        <UIPlane width={size * 2} height={size * 2} pad={8} appear={null} deps={[size, color]} draw={(ctx, w, h) => twinkle(ctx, w / 2, h / 2, w / 2, color)} />
      </group>
    </group>
  );
}

function Entry({ index, target, selected, onHover, onClick }) {
  const box = entryBox(index);
  return (
    <UIPlane
      width={box.w}
      height={box.h}
      pad={30}
      position={[box.x, box.y, 1]}
      appear={0.25 + index * 0.07}
      bob={[1.6, 0.9, index * 0.8]}
      sheen={box.primary ? 0.45 : 0.18}
      sheenPhase={index * 0.13}
      hoverScale={1.05}
      redrawOnHover
      selected={selected}
      deps={[index]}
      onHoverChange={(on) => onHover(index, on)}
      onClick={() => onClick(index)}
      draw={(ctx, w, h, { hovered }) => drawEntry(ctx, w, h, target, { hovered, primary: box.primary })}
    />
  );
}

/** Glossy pointer star that glides to the active entry and spins (Wii star pointer homage). */
function SelectorStar({ active }) {
  const outer = useRef();
  const inner = useRef();
  const anim = useRef({ y: 0, x: 0, s: 0, spin: 0, last: 0 });
  useFrame((s, delta) => {
    const a = anim.current;
    const show = active >= 0;
    if (show) a.last = active;
    const box = entryBox(a.last);
    a.y = damp(a.y, box.y, 14, delta);
    a.x = damp(a.x, box.right + 6, 14, delta);
    a.s = damp(a.s, show ? 1 : 0, 10, delta);
    a.spin += delta * (1.5 + a.s * 2.5);
    outer.current.position.set(a.x, a.y + Math.sin(s.clock.elapsedTime * 3) * 2, 6);
    inner.current.scale.setScalar(0.001 + a.s * (1 + Math.sin(s.clock.elapsedTime * 6) * 0.05));
    inner.current.rotation.z = -a.spin;
  });
  return (
    <group ref={outer}>
      <group ref={inner}>
        <UIPlane
          width={40}
          height={40}
          pad={16}
          appear={null}
          draw={(ctx, w, h) => glossyStar(ctx, w / 2, h / 2 + 1, w / 2 - 1, { color: '#ffd84a', light: '#fffbe0', deep: '#f08a00', glow: 'rgba(255,230,140,0.95)' })}
        />
      </group>
    </group>
  );
}

const _v = new THREE.Vector3();
const _up = new THREE.Vector3();

/** Glass card floating above the focused planet with its name and progress. */
function Tooltip({ focus }) {
  const group = useRef();
  const pos = useRef({ x: 200, y: 100, init: false });
  const target = TARGETS[focus];
  useFrame((s, delta) => {
    const t = s.clock.elapsedTime;
    targetPosition(focus, t, _v);
    _up.setFromMatrixColumn(s.camera.matrixWorld, 1);
    _v.addScaledVector(_up, target.radius * (target.id === 'online' ? 0.95 : 1.0));
    _v.project(s.camera);
    const hx = clamp(_v.x * 640, -170, 470);
    const hy = clamp(_v.y * 360 + 58, -230, 262);
    const p = pos.current;
    if (!p.init) {
      p.x = hx;
      p.y = hy;
      p.init = true;
    }
    p.x = damp(p.x, hx, 12, delta);
    p.y = damp(p.y, hy, 12, delta);
    group.current.position.set(p.x, p.y + Math.sin(t * 1.6) * 3, 20);
  });
  const w = 276;
  const h = 84;
  return (
    <group ref={group}>
      <UIPlane
        width={w}
        height={h + 14}
        pad={26}
        appear={0}
        sheen={0.35}
        deps={[focus]}
        draw={(ctx) => {
          ctx.save();
          starGlass(ctx, { w, h, r: 20, color: target.color, active: false });
          ctx.restore();
          // Pointer nub.
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(w / 2 - 12, h - 1);
          ctx.lineTo(w / 2, h + 12);
          ctx.lineTo(w / 2 + 12, h - 1);
          ctx.closePath();
          ctx.fillStyle = 'rgba(30,16,90,0.85)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(210,200,255,0.6)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.restore();
          // Colored accent bar.
          ctx.fillStyle = target.color;
          ctx.shadowColor = target.color;
          ctx.shadowBlur = 8;
          ctx.fillRect(18, 14, 4, h - 28);
          ctx.shadowBlur = 0;
          text(ctx, target.planet, 34, 24, { size: 19, weight: 900, align: 'left', fill: '#ffffff', shadow: { color: 'rgba(20,0,60,0.9)', blur: 5, y: 1.5 }, maxWidth: w - 50 });
          text(ctx, target.sub, 34, 46, { size: 12, weight: 700, align: 'left', fill: lighten(target.color, 0.55), maxWidth: w - 50 });
          if (target.stars) {
            const [got, total] = target.stars;
            for (let i = 0; i < total; i++) {
              const cx = 42 + i * 21;
              if (i < got) glossyStar(ctx, cx, 66, 8, { color: '#ffd84a', light: '#fffbe0', deep: '#f08a00', outline: 'rgba(255,255,255,0.9)' });
              else {
                starPath(ctx, cx, 66, 8, 0.5);
                ctx.strokeStyle = 'rgba(255,255,255,0.4)';
                ctx.lineWidth = 1.4;
                ctx.stroke();
              }
            }
            text(ctx, `${got} / ${total}  POWER STARS`, 42 + total * 21, 66, { size: 10.5, weight: 900, align: 'left', letterSpacing: 1.2, fill: 'rgba(255,240,200,0.85)' });
          } else {
            twinkle(ctx, 40, 66, 7, '#fff3b0');
            text(ctx, 'READY FOR LAUNCH · CLICK TO BLAST OFF', 54, 66, { size: 10.5, weight: 900, align: 'left', letterSpacing: 1.1, fill: '#ffe9a0', maxWidth: w - 70 });
          }
        }}
      />
    </group>
  );
}

/** Star bit + power star counters (bottom-left HUD gadget). */
function Counters({ state }) {
  const [count, setCount] = useState(state.starBits);
  useEffect(() => {
    const fn = () => setCount(state.starBits);
    state.listeners.add(fn);
    return () => state.listeners.delete(fn);
  }, [state]);
  const bump = useRef();
  useFrame(() => {
    const since = performance.now() / 1000 - (state.collectedAt ?? -10);
    const k = since < 0.6 ? Math.exp(-since * 7) * Math.sin(since * 30) * 0.12 : 0;
    bump.current.scale.setScalar(1 + Math.abs(k));
  });
  const w = 236;
  const h = 50;
  return (
    <group position={[HUD_LEFT + 34 + w / 2, HUD_BOTTOM + 46, 5]}>
      <CollectHint />
      <group ref={bump}>
        <UIPlane
          width={w}
          height={h}
          pad={24}
          appear={0.7}
          deps={[count]}
          draw={(ctx) => {
            starGlass(ctx, { w, h, color: '#b98cff', active: false });
            starBitIcon(ctx, 30, h / 2, 14, '#ff5fae', '#ffd3ec');
            text(ctx, '×', 52, h / 2 + 1, { size: 16, weight: 900, align: 'left', fill: 'rgba(255,255,255,0.7)' });
            text(ctx, String(count).padStart(4, '0'), 66, h / 2 + 1, { size: 22, weight: 900, family: 'tech', align: 'left', fill: [[0, '#ffffff'], [1, '#ffd6f0']], shadow: { color: 'rgba(255,80,180,0.7)', blur: 6, y: 0 } });
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.fillRect(w * 0.56, 11, 1.5, h - 22);
            glossyStar(ctx, w * 0.56 + 28, h / 2 + 1, 13, { color: '#ffd84a', light: '#fffbe0', deep: '#f08a00', glow: 'rgba(255,220,120,0.8)' });
            text(ctx, '×', w * 0.56 + 48, h / 2 + 1, { size: 16, weight: 900, align: 'left', fill: 'rgba(255,255,255,0.7)' });
            text(ctx, '42', w * 0.56 + 62, h / 2 + 1, { size: 22, weight: 900, family: 'tech', align: 'left', fill: [[0, '#ffffff'], [1, '#fff0b0']], shadow: { color: 'rgba(255,190,60,0.7)', blur: 6, y: 0 } });
          }}
        />
      </group>
    </group>
  );
}

function CollectHint() {
  return (
    <UIPlane
      width={260}
      height={18}
      pad={10}
      position={[12, 40, 0]}
      appear={0.9}
      draw={(ctx, w, h) => {
        twinkle(ctx, 6, h / 2, 5, '#ffd6f4');
        text(ctx, 'Point at star bits to collect them!', 16, h / 2 + 1, { size: 11.5, weight: 800, align: 'left', fill: 'rgba(235,225,255,0.75)', letterSpacing: 0.3 });
      }}
    />
  );
}

const TRAIL = 32;

/** Wii-style star pointer trail: little sparkles shed behind the cursor. */
function PointerTrail() {
  const gl = useThree((s) => s.gl);
  const geometry = useDisposable(() => {
    const g = new THREE.BufferGeometry();
    const seed = new Float32Array(TRAIL);
    for (let i = 0; i < TRAIL; i++) seed[i] = (i * 0.618) % 1;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3).fill(-5000), 3));
    g.setAttribute('aBorn', new THREE.BufferAttribute(new Float32Array(TRAIL).fill(-10), 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uNow: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute float aBorn;
          attribute float aSeed;
          uniform float uNow;
          varying float vA;
          varying vec3 vColor;
          varying float vRot;
          void main() {
            float age = uNow - aBorn;
            float k = clamp(age / 0.8, 0.0, 1.0);
            vec3 p = position + vec3(sin(aSeed * 40.0) * 10.0 * k, -26.0 * k * k, 0.0);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
            vA = (1.0 - k) * step(0.0, age);
            vRot = aSeed * 6.28 + age * 3.0;
            vColor = aSeed < 0.33 ? vec3(1.0, 0.9, 0.45) : aSeed < 0.66 ? vec3(1.0, 0.6, 0.9) : vec3(0.6, 0.9, 1.0);
            gl_PointSize = mix(20.0, 6.0, k) * (0.7 + 0.6 * fract(aSeed * 7.0));
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vA;
          varying vec3 vColor;
          varying float vRot;
          void main() {
            vec2 p = (gl_PointCoord * 2.0 - 1.0) * vec2(1.3333, 1.0);
            float c = cos(vRot), s = sin(vRot);
            p = mat2(c, -s, s, c) * p;
            vec2 a = abs(p);
            float star = exp(-a.x * 7.0) * exp(-a.y * 2.0) + exp(-a.y * 7.0) * exp(-a.x * 2.0);
            star = star * (1.0 - smoothstep(0.75, 1.0, length(p))) + exp(-dot(p, p) * 6.0) * 0.8;
            float alpha = clamp(star * vA * 1.4, 0.0, 1.0);
            gl_FragColor = vec4(mix(vColor, vec3(1.0), 0.4) * alpha, alpha);
          }
        `,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
  );
  const trail = useRef({ x: 0, y: 0, has: false, idx: 0, moved: false });
  useEffect(() => {
    const onMove = (e) => {
      const r = gl.domElement.getBoundingClientRect();
      const t = trail.current;
      t.x = ((e.clientX - r.left) / r.width) * 1280 - 640;
      t.y = 360 - ((e.clientY - r.top) / r.height) * 720;
      t.moved = true;
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [gl]);
  const last = useRef({ x: 0, y: 0, init: false });
  useFrame((s) => {
    const now = s.clock.elapsedTime;
    material.uniforms.uNow.value = now;
    const t = trail.current;
    if (!t.moved) return;
    t.moved = false;
    const l = last.current;
    if (!l.init) {
      l.x = t.x;
      l.y = t.y;
      l.init = true;
      return;
    }
    const dx = t.x - l.x;
    const dy = t.y - l.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 16) return;
    // Emit along the segment so fast swipes still leave an even trail.
    const steps = Math.min(4, Math.floor(dist / 16));
    const pos = geometry.attributes.position;
    const born = geometry.attributes.aBorn;
    for (let k = 1; k <= steps; k++) {
      const i = t.idx++ % TRAIL;
      pos.setXYZ(i, l.x + (dx * k) / steps, l.y + (dy * k) / steps, 0);
      born.setX(i, now - (steps - k) * 0.012);
    }
    pos.needsUpdate = true;
    born.needsUpdate = true;
    l.x = t.x;
    l.y = t.y;
  });
  return <points geometry={geometry} material={material} position={[0, 0, 70]} renderOrder={900} frustumCulled={false} />;
}

export function GalaxyMenu({ state }) {
  const clock = useThree((s) => s.clock);
  const [focus, setFocus] = useState(-1);
  const [locked, setLocked] = useState(-1);
  const timer = useRef();

  const sync = () => {
    const f = state.hover >= 0 ? state.hover : state.locked;
    state.focus = f;
    setFocus(f);
    setLocked(state.locked);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const onHover = (i, on) => {
    if (on) {
      clearTimeout(timer.current);
      state.hover = i;
      sync();
    } else if (state.hover === i) {
      // Linger briefly so gliding between entries doesn't bounce the camera home.
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (state.hover !== i) return;
        state.hover = -1;
        sync();
      }, 380);
    }
  };
  const onClick = (i) => {
    state.locked = state.locked === i ? -1 : i;
    state.punch[i] = clock.elapsedTime;
    sync();
  };

  return (
    <group>
      <GalaxyLogo />
      <UIPlane
        width={220}
        height={20}
        pad={10}
        position={[HUD_LEFT + 34 + 110, 176, 0]}
        appear={0.2}
        draw={(ctx, w, h) => {
          ctx.fillStyle = 'rgba(220,200,255,0.5)';
          ctx.fillRect(98, h / 2, w - 98, 1.2);
          text(ctx, 'GALAXY MAP', 0, h / 2 + 1, { size: 12, weight: 900, align: 'left', letterSpacing: 3, fill: 'rgba(240,230,255,0.85)' });
        }}
      />
      {TARGETS.map((t, i) => (
        <Entry key={t.id} index={i} target={t} selected={locked === i} onHover={onHover} onClick={onClick} />
      ))}
      <SelectorStar active={focus} />
      {focus >= 0 && <Tooltip key={focus} focus={focus} />}
      <Counters state={state} />
      <PointerTrail />
    </group>
  );
}

