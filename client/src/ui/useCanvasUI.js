import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { loadFonts } from './draw.js';
import { remote as sharedRemote } from '../remote/remoteLink.js';
import { getMixer } from '../audio/mixer.js';
import { playUISound } from '../audio/uiSounds.js';

/**
 * An in-engine 2D overlay: a canvas the size of the render buffer, laid out in design
 * units, uploaded as a texture and drawn on a full-screen quad after the world. It shares
 * the world's pixels and stretch, so UI and world always match in resolution and aspect.
 *
 * const ui = useCanvasUI({
 *   priority: 2,                          // useFrame priority (the world renders at 1)
 *   design: (cssW, cssH) => ({ w, h }),   // design units for the displayed size (default 1600x900)
 *   widgets: (ui) => [{ id, rect | circle, drag?, sound? }],  // current hit areas, in content units
 *   active: (ui) => bool,                 // input and hover go to widgets only while true
 *   onActivate: (wdg, ui) => {},          // press and release on the same widget
 *   onDrag: (wdg, point, ui) => {},       // widgets with drag: true (sliders)
 *   onKey: (event, ui) => {},
 *   keyNav: bool,                         // arrow keys step through the widgets, Enter/Space presses
 *   onBack: (ui) => {},                   // the phone remote's B button
 *   remote: EventTarget | null,           // phone remote input (default: remote/remoteLink.js):
 *                                         // move / down / up / back / leave, in design units
 *   update: (dt, ui) => {},               // per-frame animation; ui.ease() marks the overlay dirty
 *   draw: (g, ui) => {},                  // redraw in design units, only when dirty
 *   opacity: (ui) => 1,                   // the overlay isn't drawn below 0.005
 * });
 *
 * Buttons click with the Wii-style UI sounds (audio/uiSounds.js): a tick when a mouse or remote
 * cursor moves onto one, a pop when pressed ('back' widgets pop downwards), a tick when a slider
 * is grabbed. A widget's sound (a name, a function of the widget returning one, or false)
 * overrides the press sound.
 *
 * With keyNav, Up/Down move a keyboard cursor (ui.pointer, pointerKind 'key') to the next
 * widget while the overlay is active, skipping sliders and widgets with nav: false.
 * Content taller than the design height scrolls by drag or wheel: draw sets ui.contentHeight.
 * Works with <Canvas frameloop="demand">: input, ui.invalidate() and running animations
 * (anything that marks the overlay dirty) request the next frame.
 * While a remote is pointing, ui.remote is its cursor (content units); remote/RemoteDock.jsx
 * draws it over everything.
 */

// Hit areas are padded a little so a bubble's rim and edge count as part of it.
const PAD = 8;
export const inRect = (p, r) => p && p.x >= r.x - PAD && p.x <= r.x + r.w + PAD && p.y >= r.y - PAD && p.y <= r.y + r.h + PAD;
export const inCircle = (p, c) => p && Math.hypot(p.x - c.x, p.y - c.y) <= c.r + 6;
export const hit = (p, wdg) => (wdg.rect ? inRect(p, wdg.rect) : inCircle(p, wdg.circle));

// Overlays share the canvas element, so the cursor is a pointer while any of them wants one.
const cursorWants = new WeakMap();
function wantCursor(el, key, want) {
  const wants = cursorWants.get(el) ?? new Set();
  cursorWants.set(el, wants);
  if (want) wants.add(key);
  else wants.delete(key);
  el.style.cursor = wants.size ? 'pointer' : '';
}

const DEFAULT_DESIGN = () => ({ w: 1600, h: 900 });
// A press that travels this far (design units) turns into a scroll.
const SCROLL_SLOP = 14;

function createState() {
  return {
    w: 1600,
    h: 900,
    pointer: null,
    remote: null,
    hover: {},
    press: 0,
    pressed: null,
    lastHover: null,
    pointerKind: null,
    pointerMoved: false,
    drag: null,
    scroll: 0,
    contentHeight: 0,
    dirty: true,
    dt: 0,
    time: 0,
    requestFrame: () => {},
    invalidate() { this.dirty = true; this.requestFrame(); },
    get maxScroll() { return Math.max(0, this.contentHeight - this.h); },
    // Eases v towards `to`, marking the overlay dirty while it moves.
    ease(v, to, rate) {
      const n = v + (to - v) * Math.min(1, this.dt * rate);
      if (Math.abs(n - to) > 1e-3) { this.dirty = true; return n; }
      if (n !== v) this.dirty = true;
      return to;
    },
  };
}

export default function useCanvasUI(options) {
  const gl = useThree((state) => state.gl);
  const requestFrame = useThree((state) => state.invalidate);
  const opts = useRef(options);
  opts.current = options;

  const overlay = useMemo(() => {
    const canvas = document.createElement('canvas');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    const material = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    return { canvas, texture, material, quad, scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1) };
  }, []);

  const ref = useRef(null);
  ref.current ??= createState();
  const ui = ref.current;
  ui.requestFrame = requestFrame;

  useEffect(() => {
    const el = gl.domElement;
    const s = ui;
    const key = {};
    const toDesign = (e) => {
      const rect = el.getBoundingClientRect();
      return { x: ((e.clientX - rect.left) / rect.width) * s.w, y: ((e.clientY - rect.top) / rect.height) * s.h + s.scroll };
    };
    const active = () => opts.current.active?.(s) ?? true;
    const widgetAt = (p) => (active() ? opts.current.widgets?.(s).find((wdg) => hit(p, wdg)) : undefined);
    let down = null; // { y, scroll } for drag-to-scroll

    const onMove = (e) => {
      s.pointer = toDesign(e);
      s.pointerKind = e.pointerType;
      s.pointerMoved = true;
      if (s.drag) opts.current.onDrag?.(s.drag, s.pointer, s);
      if (down && s.maxScroll > 0) {
        const dy = s.pointer.y - s.scroll - down.y;
        if (s.pressed && Math.abs(dy) > SCROLL_SLOP) s.pressed = null;
        if (!s.pressed) {
          s.scroll = Math.min(s.maxScroll, Math.max(0, down.scroll - dy));
          s.dirty = true;
        }
      }
      wantCursor(el, key, !!(s.drag || widgetAt(s.pointer)));
    };
    const onLeave = () => { s.pointer = null; wantCursor(el, key, false); };
    // Buttons fire on release when the press started on the same button, so a
    // press anywhere on the bubble counts even if the pointer wobbles a little.
    // Shared by the mouse and the phone remote; returns the widget pressed.
    const pressAt = (p) => {
      s.pointer = p;
      const wdg = widgetAt(p);
      if (!wdg) return undefined;
      if (wdg.drag) {
        s.drag = wdg;
        playUISound('tick');
        opts.current.onDrag?.(wdg, p, s);
      } else {
        s.pressed = wdg.id;
      }
      return wdg;
    };
    const activate = (wdg) => {
      s.press = 1;
      const sound = typeof wdg.sound === 'function' ? wdg.sound(wdg) : wdg.sound;
      if (sound !== false) playUISound(sound ?? (wdg.id === 'back' ? 'back' : 'select'));
      opts.current.onActivate?.(wdg, s);
    };
    const releaseAt = (p) => {
      if (s.drag) { s.drag = null; return; }
      const id = s.pressed;
      s.pressed = null;
      if (!id) return;
      const wdg = widgetAt(p);
      if (wdg?.id === id) activate(wdg);
    };
    const onDown = (e) => {
      if (e.button !== 0) return;
      const p = toDesign(e);
      if (!widgetAt(p) && !(s.maxScroll > 0 && active())) return;
      el.setPointerCapture(e.pointerId);
      const wdg = pressAt(p);
      down = wdg?.drag ? null : { y: p.y - s.scroll, scroll: s.scroll };
    };
    const onUp = (e) => {
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      down = null;
      // A lifted finger isn't hovering anything.
      if (e.pointerType === 'touch') setTimeout(() => { s.pointer = null; }, 0);
      releaseAt(toDesign(e));
    };
    const onCancel = (e) => {
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      down = null;
      s.drag = null;
      s.pressed = null;
    };
    const onWheel = (e) => {
      if (!(s.maxScroll > 0) || !active()) return;
      const rect = el.getBoundingClientRect();
      s.scroll = Math.min(s.maxScroll, Math.max(0, s.scroll + (e.deltaY / rect.height) * s.h));
      s.dirty = true;
    };
    const center = (wdg) => (wdg.rect ? { x: wdg.rect.x + wdg.rect.w / 2, y: wdg.rect.y + wdg.rect.h / 2 } : { x: wdg.circle.x, y: wdg.circle.y });
    const onKey = (e) => {
      opts.current.onKey?.(e, s);
      if (e.defaultPrevented || !opts.current.keyNav || !active() || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const list = (opts.current.widgets?.(s) ?? []).filter((wdg) => !wdg.drag && wdg.nav !== false);
        if (!list.length) return;
        e.preventDefault();
        const at = list.findIndex((wdg) => hit(s.pointer, wdg));
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const next = at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length;
        s.pointer = center(list[next]);
        s.pointerKind = 'key';
        s.pointerMoved = true;
        s.dirty = true;
      } else if ((e.key === 'Enter' || e.key === ' ') && s.pointerKind === 'key') {
        const wdg = widgetAt(s.pointer);
        if (!wdg || wdg.drag) return;
        e.preventDefault();
        activate(wdg);
      }
    };

    // Each input asks for a frame (frameloop="demand" renders nothing otherwise).
    const framed = (fn) => (e) => { fn(e); s.requestFrame(); };

    // Phone remote: its cursor stands in for the mouse while it moves.
    const fromRemote = (e) => ({ x: e.detail.x, y: e.detail.y + s.scroll });
    const remoteHandlers = {
      // Hover easing redraws when the hovered widget changes; RemoteDock draws the cursor.
      move: (e) => {
        s.remote = s.pointer = fromRemote(e);
        s.pointerKind = 'remote';
        s.pointerMoved = true;
        if (s.drag) opts.current.onDrag?.(s.drag, s.pointer, s);
      },
      down: (e) => { s.remote = fromRemote(e); pressAt(s.remote); s.dirty = true; },
      up: (e) => { releaseAt(fromRemote(e)); s.dirty = true; },
      back: () => {
        if (!active() || !opts.current.onBack) return;
        playUISound('back');
        opts.current.onBack(s);
      },
      leave: () => { s.remote = s.pointer = s.drag = s.pressed = null; s.dirty = true; },
    };
    const remote = opts.current.remote === undefined ? sharedRemote : opts.current.remote;
    for (const [type, fn] of Object.entries(remoteHandlers)) remoteHandlers[type] = framed(fn);
    for (const [type, fn] of Object.entries(remoteHandlers)) remote?.addEventListener(type, fn);

    const handlers = [
      [el, 'pointermove', framed(onMove)],
      [el, 'pointerleave', framed(onLeave)],
      [el, 'pointerdown', framed(onDown)],
      [el, 'pointerup', framed(onUp)],
      [el, 'pointercancel', framed(onCancel)],
      [el, 'wheel', framed(onWheel), { passive: true }],
      [window, 'keydown', framed(onKey)],
    ];
    for (const [target, type, fn, o] of handlers) target.addEventListener(type, fn, o);

    // Create the audio context now so it unlocks on the first gesture, before any button sound.
    getMixer();

    let cancelled = false;
    loadFonts().then(() => { if (!cancelled) s.invalidate(); });

    return () => {
      cancelled = true;
      for (const [target, type, fn] of handlers) target.removeEventListener(type, fn);
      for (const [type, fn] of Object.entries(remoteHandlers)) remote?.removeEventListener(type, fn);
      wantCursor(el, key, false);
    };
  }, [gl, ui]);

  useEffect(() => () => {
    overlay.texture.dispose();
    overlay.material.dispose();
    overlay.quad.geometry.dispose();
  }, [overlay]);

  useFrame((_, delta) => {
    const s = ui;
    const o = opts.current;
    s.dt = Math.min(delta, 0.1);
    s.time += s.dt;

    // Match the render buffer exactly so overlay pixels line up with world pixels.
    const buf = gl.getDrawingBufferSize(new THREE.Vector2());
    if (overlay.canvas.width !== buf.x || overlay.canvas.height !== buf.y) {
      overlay.canvas.width = buf.x;
      overlay.canvas.height = buf.y;
      overlay.texture.dispose();
      s.dirty = true;
    }
    const el = gl.domElement;
    const d = (o.design ?? DEFAULT_DESIGN)(el.clientWidth || 1, el.clientHeight || 1);
    if (d.w !== s.w || d.h !== s.h) {
      s.w = d.w;
      s.h = d.h;
      s.dirty = true;
    }

    const live = o.active?.(s) ?? true;
    const widgets = o.widgets?.(s) ?? [];
    const hovered = live && (s.drag?.id ?? widgets.find((wdg) => hit(s.pointer, wdg))?.id);
    // Tick when a moving mouse or remote cursor reaches a new button (not on touch, and not
    // when a screen change puts a button under a cursor that is standing still).
    if (hovered && hovered !== s.lastHover && s.pointerMoved && s.pointerKind !== 'touch' && !s.drag) playUISound('hover');
    s.lastHover = hovered || null;
    s.pointerMoved = false;
    for (const id of new Set([...Object.keys(s.hover), ...widgets.map((wdg) => wdg.id)])) {
      s.hover[id] = s.ease(s.hover[id] ?? 0, id === hovered ? 1 : 0, 12);
    }
    s.press = s.ease(s.press, 0, 10);
    o.update?.(s.dt, s);
    if (s.scroll > s.maxScroll) { s.scroll = s.maxScroll; s.dirty = true; }

    const alpha = o.opacity?.(s) ?? 1;
    if (alpha < 0.005) return;

    if (s.dirty) {
      s.dirty = false;
      const g = overlay.canvas.getContext('2d');
      const sx = overlay.canvas.width / s.w;
      const sy = overlay.canvas.height / s.h;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, overlay.canvas.width, overlay.canvas.height);
      // The context outlives each draw: start every redraw from the same state.
      Object.assign(g, {
        globalAlpha: 1, textAlign: 'start', textBaseline: 'alphabetic', shadowColor: 'transparent',
        shadowBlur: 0, shadowOffsetY: 0, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
      });
      if ('letterSpacing' in g) g.letterSpacing = '0px';
      g.setTransform(sx, 0, 0, sy, 0, -s.scroll * sy);
      o.draw(g, s);
      overlay.texture.needsUpdate = true;
      // Still animating (easing, particles): keep frames coming until it settles.
      s.requestFrame();
    }

    overlay.material.opacity = alpha;
    const ac = gl.autoClear;
    gl.autoClear = false;
    gl.clearDepth();
    gl.render(overlay.scene, overlay.camera);
    gl.autoClear = ac;
  }, options.priority ?? 2);

  return ui;
}
