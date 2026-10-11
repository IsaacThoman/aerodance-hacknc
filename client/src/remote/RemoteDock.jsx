import { useMemo, useRef } from 'react';
import QRCode from 'qrcode';
import { FONT, ICONS, drawCaps, drawGlassCircle, drawGlassPanel, drawQR, drawShadowText, ellipsize, roundRect } from '../ui/draw.js';
import useCanvasUI from '../ui/useCanvasUI.js';
import { drawWiiCursor } from '../ui/wiiCursor.js';
import useFullscreen from '../menu/useFullscreen.js';
import { useRemoteStatus } from './remoteLink.js';

/**
 * The display's phone-remote corner, drawn in-engine over everything (priority 3.5):
 *   card    QR to /join?remote=<code>, with an X that whooshes it into the button
 *   button  a Wii remote in the bottom-right corner that brings the card out
 *   fullscreen  a matching bubble above the remote button
 *   cursors the Wii hand (ui/wiiCursor.js) for the remote and (with wiiCursor) the mouse, over
 *           every other overlay
 * The card starts tucked into the button and hides while a remote is connected. When the
 * remote drops it comes back for 15 seconds, then whooshes away on its own; opened by hand
 * it stays until closed. Corner controls slide off to the right outside the main menu; the
 * cursors stay available on other screens for navigation.
 *
 * <RemoteDock visible={() => isMainScreen} wiiCursor />
 */

const ICON = { x: 1516, y: 836, r: 42 };
const FULLSCREEN = { x: ICON.x, y: 730, r: ICON.r };
const CARD = { x: 1262, y: 304, w: 300, h: 364 };
const QR_BOX = { x: 1282, y: 336, w: 260, h: 260 };
const CLOSE = { x: 1550, y: 316, r: 22 };
const REOPEN_MS = 15000;
const SLIDE_SECONDS = 0.3;

const smooth = (k) => k * k * (3 - 2 * k);

// The remote's pointer, and the mouse's while the mouse moved last (see useCanvasUI) unless
// Settings keeps the system cursor for the mouse.
function drawCursors(g, s, wiiCursor) {
  if (s.mouse && wiiCursor) drawWiiCursor(g, s.mouse);
  if (s.remote) drawWiiCursor(g, s.remote);
}

// A little white Wii remote, tilted, with its player LED lit while one is connected.
function drawRemoteIcon(g, { x, y, r }, { lit, dim }) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.38);
  g.globalAlpha *= dim ? 0.55 : 1;
  const w = r * 0.5;
  const h = r * 1.2;
  roundRect(g, -w / 2, -h / 2, w, h, w * 0.45);
  g.fillStyle = '#ffffff';
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(12, 47, 82, 0.35)';
  g.stroke();
  // D-pad and A button.
  g.fillStyle = '#8a98a5';
  g.fillRect(-w * 0.09, -h * 0.36, w * 0.18, w * 0.5);
  g.fillRect(-w * 0.25, -h * 0.36 + w * 0.16, w * 0.5, w * 0.18);
  g.beginPath();
  g.arc(0, -h * 0.05, w * 0.2, 0, Math.PI * 2);
  g.fill();
  // Player LED.
  g.beginPath();
  g.arc(0, h * 0.34, w * 0.11, 0, Math.PI * 2);
  g.fillStyle = lit ? '#34b9ff' : '#cdd6dd';
  if (lit) {
    g.shadowColor = '#34b9ff';
    g.shadowBlur = 10;
  }
  g.fill();
  g.restore();
}

function drawClose(g, c, hover) {
  drawGlassCircle(g, c, hover);
  const a = c.r * 0.36;
  g.beginPath();
  g.moveTo(c.x - a, c.y - a);
  g.lineTo(c.x + a, c.y + a);
  g.moveTo(c.x + a, c.y - a);
  g.lineTo(c.x - a, c.y + a);
  g.lineCap = 'round';
  g.lineWidth = 4;
  g.strokeStyle = '#ffffff';
  g.stroke();
}

export default function RemoteDock({ visible = () => true, wiiCursor = true }) {
  const status = useRemoteStatus();
  const fullscreen = useFullscreen();
  const props = useRef({});
  props.current = { status, fullscreen, visible, wiiCursor };
  // open: where the card is heading; k: how far out it is (0 tucked into the button, 1 out).
  const st = useRef({ open: false, k: 0, slide: 0, hideAt: null, holder: null, drawn: null, visible: null, drawnFullscreen: null, drawnWii: null }).current;

  const qr = useMemo(() => (status.joinUrl ? QRCode.create(status.joinUrl, { errorCorrectionLevel: 'M' }).modules : null), [status.joinUrl]);
  const qrRef = useRef(qr);
  qrRef.current = qr;

  useCanvasUI({
    priority: 3.5,
    active: () => props.current.visible() && st.slide === 0,
    widgets: () => {
      const widgets = st.k > 0.9 && st.open ? [{ id: 'close', circle: CLOSE }, { id: 'icon', circle: ICON }] : [{ id: 'icon', circle: ICON }];
      if (props.current.fullscreen.supported) widgets.push({ id: 'fullscreen', circle: FULLSCREEN });
      return widgets;
    },
    onActivate: (wdg, s) => {
      if (wdg.id === 'fullscreen') { props.current.fullscreen.toggle(); s.invalidate(); return; }
      if (wdg.id === 'close') st.open = false;
      else st.open = !st.open;
      st.hideAt = null;
      s.invalidate();
    },
    update: (dt, s) => {
      const { holder } = props.current.status;
      const shown = props.current.visible();
      if (shown !== st.visible) {
        st.visible = shown;
        if (!shown) { st.open = false; st.hideAt = null; st.k = 0; }
        s.invalidate();
      }
      const slide = Math.max(0, Math.min(1, st.slide + (shown ? -1 : 1) * dt / SLIDE_SECONDS));
      if (slide !== st.slide) { st.slide = slide; s.invalidate(); }
      // Connected: tuck the card away. Dropped: show it again for a while.
      if (holder !== st.holder) {
        if (holder) { st.open = false; st.hideAt = null; }
        else if (st.holder && shown) { st.open = true; st.hideAt = s.time + REOPEN_MS / 1000; }
        st.holder = holder;
        s.invalidate();
      }
      if (st.hideAt !== null && s.time >= st.hideAt) { st.open = false; st.hideAt = null; }
      st.k = s.ease(st.k, st.open && qrRef.current ? 1 : 0, st.open ? 7 : 9);
      // The cursors are drawn here, so redraw whenever one moves.
      const at = [s.remote, s.mouse].map((p) => (p ? `${p.x},${p.y}` : '')).join('|');
      if (at !== st.drawn) { st.drawn = at; s.invalidate(); }
      if (props.current.fullscreen !== st.drawnFullscreen) s.invalidate();
      if (props.current.wiiCursor !== st.drawnWii) s.invalidate();
    },
    draw: (g, s) => {
      const { holder, error } = props.current.status;
      const fs = props.current.fullscreen;
      st.drawnFullscreen = fs;
      st.drawnWii = props.current.wiiCursor;
      if (st.slide === 1) {
        drawCursors(g, s, st.drawnWii);
        return;
      }
      const h = s.hover;
      const k = smooth(st.k);

      if (k > 0.01 && qrRef.current) {
        // Whoosh: the card grows out of (and shrinks back into) the button.
        g.save();
        g.globalAlpha *= Math.min(1, k * 1.4);
        g.translate(ICON.x, ICON.y);
        g.scale(k, k);
        g.translate(-ICON.x, -ICON.y);
        drawGlassPanel(g, CARD, 30);
        roundRect(g, QR_BOX.x - 4, QR_BOX.y - 4, QR_BOX.w + 8, QR_BOX.h + 8, 18);
        g.fillStyle = '#ffffff';
        g.fill();
        // drawQR snaps to buffer pixels and ignores the whoosh scale: only draw it settled.
        if (k > 0.98) drawQR(g, qrRef.current, QR_BOX, s);
        const cx = CARD.x + CARD.w / 2;
        g.font = `800 30px ${FONT}`;
        drawShadowText(g, holder ? 'Remote taken' : 'Grab the remote', cx, QR_BOX.y + QR_BOX.h + 40, { size: 30, weight: 800, align: 'center' });
        if (k > 0.9) drawClose(g, CLOSE, h.close ?? 0);
        g.restore();
      }

      // Keep both bubbles opaque while they travel beyond the frame's right edge.
      g.save();
      g.translate(smooth(st.slide) * (s.w - ICON.x + ICON.r + 24), 0);
      drawGlassCircle(g, ICON, h.icon ?? 0);
      drawRemoteIcon(g, ICON, { lit: !!holder, dim: !!error && !holder });
      g.save();
      if (!fs.supported) g.globalAlpha *= 0.5;
      drawGlassCircle(g, FULLSCREEN, h.fullscreen ?? 0);
      g.lineWidth = 4;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = '#ffffff';
      ICONS.fullscreen(g, FULLSCREEN.x, FULLSCREEN.y, FULLSCREEN.r, fs.active);
      g.restore();
      if (st.visible && fs.error) {
        drawShadowText(g, fs.error, FULLSCREEN.x - FULLSCREEN.r - 18, FULLSCREEN.y, { size: 24, align: 'right' });
      }
      if (st.visible && holder && k < 0.5) {
        drawCaps(g, 'REMOTE', ICON.x - ICON.r - 18, ICON.y - 14, { size: 18, align: 'right' });
        g.font = `700 26px ${FONT}`;
        drawShadowText(g, ellipsize(g, holder, 360), ICON.x - ICON.r - 18, ICON.y + 18, { size: 26, align: 'right' });
      }
      g.restore();

      drawCursors(g, s, st.drawnWii);
    },
  });

  return null;
}
