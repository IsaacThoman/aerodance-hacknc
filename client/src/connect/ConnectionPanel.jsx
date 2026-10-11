import { useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  FONT, ICONS, NAVY, drawCaps, drawField, drawGlassCircle, drawGlassPanel, drawPill, drawStatusDot, ellipsize, paragraph,
  pill, roundRect, text,
} from '../ui/draw.js';
import useCanvasUI from '../ui/useCanvasUI.js';
import { playUISound } from '../audio/uiSounds.js';
import { CARD, CLOSE, COLUMN, FIELD, KEYS, MODES, PILL, PRIMARY, STATUS } from './layout.js';

/**
 * Connect Client, drawn in-engine: a status pill in the top-right corner of Settings and,
 * when it's pressed (or a Song Select player slot is), a card for choosing the pose input.
 * Android needs its IP address, typed on the card's keypad (so the phone remote and touch
 * screens can enter it) or the keyboard; the webcam dummy just lets the menus be tested without a device. The source is
 * pose/AndroidPoseSource.js; it remembers the last address that connected.
 *
 * While the card is open the rest of the menus are held (App passes them `blocked`).
 * The canvas reports data-connect-open / -ready / -status / -mode / -message / -address for tests.
 *
 * <ConnectionPanel visible open onOpenChange={setOpen} source={source} connection={view}
 *   inputMode="android" onInputModeChange={setMode} />
 */

const DEFAULT_ADDRESS = '192.168.43.1';
const savedAddress = () => {
  try { return localStorage.getItem('aerodance-client-ip') || DEFAULT_ADDRESS; } catch { return DEFAULT_ADDRESS; }
};
const ACTIVE = ['connecting', 'initializing', 'connected', 'reconnecting'];
const LABELS = {
  dummy: 'Webcam · Dummy',
  connected: 'Client Connected',
  connecting: 'Connecting…',
  initializing: 'Camera starting…',
  reconnecting: 'Reconnecting…',
};
const smooth = (k) => k * k * (3 - 2 * k);

function drawModes(g, mode, hover, press) {
  const [a, b] = MODES.map((m) => m.rect);
  pill(g, a.x, a.y, b.x + b.w - a.x, a.h);
  g.fillStyle = 'rgba(0, 30, 70, 0.4)';
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.stroke();
  for (const m of MODES) {
    const { x, y, w, h } = m.rect;
    const on = m.id === mode;
    const hv = hover[`mode-${m.id}`] ?? 0;
    const dy = (on ? 0 : -hv * 2) + press(`mode-${m.id}`) * 2;
    pill(g, x + 5, y + 5 + dy, w - 10, h - 10);
    if (on) {
      const body = g.createLinearGradient(0, y, 0, y + h);
      body.addColorStop(0, '#f4feff');
      body.addColorStop(0.5, '#c8f4ff');
      body.addColorStop(0.52, '#a9ecf6');
      body.addColorStop(1, '#7fdcef');
      g.fillStyle = body;
    } else {
      g.fillStyle = `rgba(255,255,255,${hv * 0.16})`;
    }
    g.fill();
    text(g, m.label, x + w / 2, y + h / 2 + 1 + dy, { size: 24, weight: 700, color: on ? NAVY : '#ffffff', align: 'center' });
  }
}

function drawKey(g, { key, rect }, hover, press, enabled) {
  const { x, w, h } = rect;
  const y = rect.y - hover * 2 + press * 2;
  g.save();
  if (!enabled) g.globalAlpha *= 0.35;
  roundRect(g, x, y, w, h, 18);
  g.fillStyle = `rgba(255,255,255,${0.14 + hover * 0.2})`;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = `rgba(255,255,255,${0.55 + hover * 0.4})`;
  g.stroke();
  if (key === 'Backspace') {
    g.lineWidth = 4;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#ffffff';
    ICONS.backspace(g, x + w / 2, y + h / 2, 40);
  } else {
    text(g, key, x + w / 2, y + h / 2 + 2, { size: 34, weight: 800, align: 'center' });
  }
  g.restore();
}

export default function ConnectionPanel({ visible = true, open = false, onOpenChange, source, connection, inputMode, onInputModeChange }) {
  const gl = useThree((state) => state.gl);
  const props = useRef({});
  props.current = { visible, open, onOpenChange, source, connection, inputMode, onInputModeChange };
  // alpha: the whole overlay; k: how far the card is out (it grows from the pill).
  const st = useRef({ alpha: 0, k: 0, address: savedAddress(), error: '', drawn: null, blink: true }).current;

  const connecting = () => ACTIVE.includes(props.current.connection.status);
  const typing = () => props.current.inputMode === 'android' && !connecting();
  const message = () => st.error || props.current.connection.message || 'Ready to connect on port 1337.';
  const close = () => props.current.onOpenChange?.(false);
  const submit = () => {
    const p = props.current;
    if (p.inputMode === 'webcam') { close(); return; }
    if (connecting()) { p.source.disconnect(); return; }
    // An invalid address throws before anything is disconnected.
    try { p.source.connect(st.address); st.error = ''; } catch (err) { st.error = err.message; }
  };
  const edit = (key) => {
    if (!typing()) return;
    st.error = '';
    if (key === 'Backspace') st.address = st.address.slice(0, -1);
    else if (st.address.length < 15) st.address += key;
  };

  useCanvasUI({
    priority: 3.2,
    active: () => props.current.visible && st.alpha > 0.3,
    keyNav: () => props.current.open,
    widgets: () => {
      // The card takes input once it's mostly out (not while it whooshes from the pill).
      if (!props.current.open || st.k < 0.5) return [{ id: 'pill', rect: PILL }];
      return [
        { id: 'close', circle: CLOSE, sound: 'back' },
        ...MODES.map((m) => ({ id: `mode-${m.id}`, mode: m.id, rect: m.rect })),
        ...(typing() ? KEYS.map((k) => ({ id: `key-${k.key}`, key: k.key, rect: k.rect })) : []),
        { id: 'primary', rect: PRIMARY },
        { id: 'pill', rect: PILL, nav: false, sound: 'back' },
      ];
    },
    onActivate: (wdg, s) => {
      const p = props.current;
      if (wdg.id === 'pill') p.onOpenChange?.(!p.open);
      else if (wdg.id === 'close') close();
      else if (wdg.mode && wdg.mode !== p.inputMode) { st.error = ''; p.onInputModeChange?.(wdg.mode); }
      else if (wdg.key) edit(wdg.key);
      else if (wdg.id === 'primary') submit();
      s.invalidate();
    },
    onKey: (e, s) => {
      const p = props.current;
      if (!p.visible || !p.open || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') { if (!e.repeat) { playUISound('back'); close(); } }
      else if (/^[0-9.]$/.test(e.key) || e.key === 'Backspace') edit(e.key);
      // With the keyboard cursor on a widget, Enter presses that widget instead (keyNav).
      else if (e.key === 'Enter' && s.pointerKind !== 'key') { playUISound('select'); submit(); }
      else return;
      e.preventDefault();
      s.invalidate();
    },
    onBack: () => {
      if (!props.current.open) return false;
      close();
      return true;
    },
    update: (_dt, s) => {
      const p = props.current;
      st.alpha = s.ease(st.alpha, p.visible ? 1 : 0, p.visible ? 3 : 6);
      if (!p.visible && p.open) close();
      st.k = s.ease(st.k, p.open && p.visible ? 1 : 0, p.open ? 8 : 10);
      const blink = Math.floor(s.time * 1.9) % 2 === 0;
      if (blink !== st.blink && p.open && typing()) { st.blink = blink; s.invalidate(); }
      const { status } = p.connection;
      const ready = p.open && st.k >= 0.5 && st.alpha > 0.3;
      const key = `${status}|${message()}|${p.inputMode}|${p.open}|${st.address}|${ready}`;
      if (key !== st.drawn) {
        st.drawn = key;
        s.invalidate();
        Object.assign(gl.domElement.dataset, {
          connectOpen: String(p.open), connectReady: String(ready), connectStatus: status, connectMode: p.inputMode,
          connectMessage: message(), connectAddress: st.address,
        });
      }
    },
    opacity: () => st.alpha,
    draw: (g, s) => {
      const p = props.current;
      const h = s.hover;
      const press = (id) => s.press * (h[id] ?? 0);
      const { status } = p.connection;
      const k = smooth(st.k);

      if (k > 0.01) {
        // Dim the menus behind; they're on hold while the card is out.
        g.fillStyle = `rgba(0, 18, 48, ${0.35 * k})`;
        g.fillRect(0, 0, s.w, s.h);
        g.save();
        g.globalAlpha *= Math.min(1, k * 1.4);
        const ox = PILL.x + PILL.w / 2;
        const oy = PILL.y + PILL.h;
        g.translate(ox, oy);
        g.scale(k, k);
        g.translate(-ox, -oy);
        drawGlassPanel(g, CARD, 30);
        drawCaps(g, 'CONNECT CLIENT', CARD.x + 36, CARD.y + 46, { size: 24 });
        drawGlassCircle(g, CLOSE, h.close ?? 0);
        g.lineWidth = 4;
        g.lineCap = 'round';
        g.strokeStyle = '#ffffff';
        ICONS.close(g, CLOSE.x, CLOSE.y, CLOSE.r * 1.1);
        drawModes(g, p.inputMode, h, press);

        if (p.inputMode === 'android') {
          const active = connecting();
          text(g, 'Android IP address', COLUMN.x + 4, FIELD.y - 26, { size: 22, weight: 700, color: '#bff4ff' });
          drawField(g, FIELD, { value: st.address, placeholder: DEFAULT_ADDRESS, focused: !active, blink: st.blink, disabled: active });
          let y = FIELD.y + FIELD.h + 34;
          y += paragraph(g, `Use the same Wi-Fi network. Set the Android allowed origin to ${window.location.origin} and allow local-network access in your browser.`,
            COLUMN.x + 4, y, COLUMN.w - 8, { size: 21, lineH: 28 }) + 10;
          if (window.location.protocol === 'https:') {
            paragraph(g, 'This page is https, so the browser blocks the Android stream (plain http on port 1337). Pair from a local http deploy.',
              COLUMN.x + 4, y, COLUMN.w - 8, { size: 21, lineH: 28, color: '#ffe27a' });
          }
          for (const k2 of KEYS) drawKey(g, k2, h[`key-${k2.key}`] ?? 0, press(`key-${k2.key}`), !active);
        } else {
          paragraph(g, 'Webcam capture and tracking are not implemented yet. This dummy option lets you continue through the menus without connecting Android.',
            COLUMN.x + 4, FIELD.y - 10, CARD.w - 72, { size: 26, lineH: 36 });
        }

        paragraph(g, message(), STATUS.x + 4, STATUS.y, STATUS.w - 8, { size: 21, lineH: 28, color: st.error || status === 'error' ? '#ffb38a' : '#ffffff' });

        const active = p.inputMode === 'android' && connecting();
        const label = p.inputMode === 'webcam' ? 'Ok' : active ? (status === 'connected' ? 'Disconnect' : 'Cancel connection') : 'Connect';
        drawPill(g, PRIMARY, { label, icon: active ? 'close' : p.inputMode === 'webcam' ? 'play' : 'camera', hover: h.primary ?? 0, press: press('primary') });
        g.restore();
      }

      // The pill: status light and what the pose input is doing.
      const hv = h.pill ?? 0;
      g.save();
      g.globalAlpha *= 0.88 + hv * 0.12;
      drawGlassPanel(g, PILL, PILL.h / 2);
      g.restore();
      const cy = PILL.y + PILL.h / 2;
      drawStatusDot(g, PILL.x + 40, cy, status, 11);
      g.font = `700 28px ${FONT}`;
      text(g, ellipsize(g, LABELS[status] ?? 'Connect Client', PILL.w - 130), PILL.x + 68, cy + 1, { size: 28, weight: 700 });
      g.lineWidth = 4;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = '#ffffff';
      (p.open ? ICONS.up : ICONS.down)(g, PILL.x + PILL.w - 38, cy, 40);
    },
  });

  return null;
}
