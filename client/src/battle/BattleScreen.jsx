import { useCallback, useMemo, useRef } from 'react';
import QRCode from 'qrcode';
import {
  FONT, drawBubble, drawCaps, drawGlassPanel, drawHeader, drawPill, drawQR, drawShadowText, ellipsize, roundRect,
} from '../ui/draw.js';
import { drawSticker, stickerLabel } from '../ui/stickers.js';
import useCanvasUI from '../ui/useCanvasUI.js';
import { joinUrl, useHype } from './api.js';

/**
 * The QR battle lobby over the world and menu dancers. Start opens Song Select;
 * every finished battle uses the shared ResultsScreen on a dance stage.
 * Hype from phones rises as bubbles; stickers rise as themselves.
 */

const BACK = { x: 166, y: 134, r: 30 };
const QR_PANEL = { x: 128, y: 190, w: 452, h: 540 };
const QR_BOX = { x: 164, y: 246, w: 380, h: 380 };
const START = { x: 128, y: 760, w: 452, h: 100 };
// Over the heads of the two menu dancers.
const SEAT_X = [1050, 1325];
const TAG_Y = 286;
const BUBBLE_Y = 640;

const seatX = (seat, count) => (count <= 2 ? SEAT_X[seat] : 960 + (seat * 520) / (count - 1));
const fmtSol = (sol) => `${Number(sol.toFixed(3))} SOL`;
const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
function drawSeatTag(g, x, y, { name, sub, dim }) {
  g.save();
  g.font = `700 34px ${FONT}`;
  const label = ellipsize(g, name, 300);
  const w = Math.max(190, g.measureText(label).width + 64);
  const rect = { x: x - w / 2, y: y - 32, w, h: 64 };
  g.globalAlpha *= dim ? 0.75 : 1;
  drawGlassPanel(g, rect, 32);
  g.restore();
  drawShadowText(g, label, x, y + 1, { size: 34, align: 'center', alpha: dim ? 0.8 : 1 });
  if (sub) drawShadowText(g, sub, x, y + 58, { size: 24, weight: 600, align: 'center' });
}

export default function BattleScreen({ visible, battle, onPlay, onBack }) {
  const props = useRef({});
  props.current = { visible, battle, onPlay, onBack };
  const st = useRef({ alpha: 0, bubbles: [], drawn: null }).current;

  const id = battle?.id;
  const url = id ? joinUrl(id) : null;
  const qr = useMemo(() => (url ? QRCode.create(url, { errorCorrectionLevel: 'M' }).modules : null), [url]);
  const qrRef = useRef(qr);
  qrRef.current = qr;

  const spawn = (x, count, { label, sticker, spread = 70, y = BUBBLE_Y } = {}) => {
    for (let i = 0; i < count; i++) {
      st.bubbles.push({
        x: x + (Math.random() - 0.5) * spread * 2,
        y: y + Math.random() * 40,
        r: i === 0 && sticker ? 58 : 14 + Math.random() * 24,
        sticker: i === 0 ? sticker : undefined,
        vy: -(140 + Math.random() * 120),
        wobble: Math.random() * Math.PI * 2,
        age: -i * 0.07,
        life: 3 + Math.random() * 1.5,
        label: i === 0 ? label : undefined,
      });
    }
  };

  useHype(id, useCallback(({ seat, from, sticker }) => {
    const count = props.current.battle?.players.length ?? 2;
    const label = sticker ? `${from} sent a ${stickerLabel(sticker)} sticker` : `+hype from ${from}`;
    spawn(seatX(seat, count), sticker ? 4 : 6, { label, sticker });
  }, []));

  useCanvasUI({
    priority: 2.5,
    active: () => props.current.visible && !!props.current.battle?.players && st.alpha > 0.3,
    widgets: () => [{ id: 'back', circle: BACK }, { id: 'start', rect: START }],
    onActivate: (wdg) => {
      const p = props.current;
      switch (wdg.id) {
        case 'start': p.onPlay?.(); break;
        case 'back': p.onBack?.(); break;
        default:
      }
    },
    onKey: (e) => {
      const p = props.current;
      if (e.key !== 'Escape' || !p.visible) return;
      p.onBack?.();
    },
    // The phone remote's B button, like Escape.
    onBack: () => {
      const p = props.current;
      p.onBack?.();
    },
    update: (dt, s) => {
      const p = props.current;
      st.alpha = s.ease(st.alpha, p.visible && p.battle?.players ? 1 : 0, p.visible ? 3 : 6);
      // Each push is a new battle object: redraw joins, hype and countdowns.
      if (p.battle !== st.drawn) s.invalidate();
      for (const b of st.bubbles) {
        b.age += dt;
        b.y += b.vy * dt * (b.age > 0 ? 1 : 0);
      }
      st.bubbles = st.bubbles.filter((b) => b.age < b.life && b.y > -60);
      // Bubbles and the result deadline animate; everything else is static.
      if (st.bubbles.length || p.battle?.closesAt) {
        s.invalidate();
      }
    },
    opacity: () => st.alpha,
    draw: (g, s) => {
      const p = props.current;
      const b = p.battle;
      st.drawn = b;
      if (!b?.players) return;
      const h = s.hover;
      const count = b.players.length;

      drawHeader(g, BACK, `BATTLE ${b.id.toUpperCase()}`, h.back ?? 0);
      drawGlassPanel(g, QR_PANEL, 34);
      drawCaps(g, 'SCAN TO JOIN', QR_PANEL.x + QR_PANEL.w / 2, QR_PANEL.y + 32, { size: 24, align: 'center' });
      roundRect(g, QR_BOX.x - 4, QR_BOX.y - 4, QR_BOX.w + 8, QR_BOX.h + 8, 22);
      g.fillStyle = '#ffffff';
      g.fill();
      if (qrRef.current) drawQR(g, qrRef.current, QR_BOX, s);
      const host = url.replace(/^https?:\/\//, '');
      g.font = `700 26px ${FONT}`;
      drawShadowText(g, ellipsize(g, host, QR_PANEL.w - 40), QR_PANEL.x + QR_PANEL.w / 2, QR_BOX.y + QR_BOX.h + 40, { size: 26, align: 'center' });
      // Local dev only: phones can't follow a localhost QR code.
      if (/^(localhost|127\.|\[::1\])/.test(location.hostname)) {
        drawShadowText(g, "Phones can't open localhost: use a LAN IP", QR_PANEL.x + QR_PANEL.w / 2, QR_BOX.y + QR_BOX.h + 80, {
          size: 21, weight: 600, align: 'center', color: '#ffe27a',
        });
      }
      const ready = b.players.filter((pl) => pl.name).length;
      drawPill(g, START, {
        label: 'Start battle',
        sub: ready ? `${ready} of ${count} dancers ready` : 'waiting for dancers',
        icon: 'play',
        hover: h.start ?? 0,
        press: s.press * (h.start ?? 0),
      });

      // Seat tags over the dancers.
      b.players.forEach((pl) => {
        const x = seatX(pl.seat, count);
        const hype = pl.hype.count ? `${pl.hype.count} hype · ${fmtSol(pl.hype.sol)}` : null;
        if (pl.name) {
          drawSeatTag(g, x, TAG_Y, { name: pl.name, sub: pl.result ? 'score in' : hype });
        } else {
          drawSeatTag(g, x, TAG_Y, { name: 'Open seat', sub: 'scan to dance', dim: true });
        }
      });

      // Footer under the stage: crowd size and the results countdown.
      const footer = [];
      if (b.spectators) footer.push(`${b.spectators} in the crowd`);
      if (b.closesAt) footer.push(`scores close in ${fmtClock(Date.parse(b.closesAt) - Date.now())}`);
      if (footer.length) {
        drawCaps(g, footer.join(' · ').toUpperCase(), (SEAT_X[0] + SEAT_X[1]) / 2, 850, { size: 22, align: 'center' });
      }

      for (const bubble of st.bubbles) {
        if (bubble.age < 0) continue;
        const fade = Math.min(1, bubble.age * 4) * Math.min(1, (bubble.life - bubble.age) * 1.5);
        const x = bubble.x + Math.sin(bubble.age * 2.4 + bubble.wobble) * 14;
        if (bubble.sticker) {
          g.save();
          g.globalAlpha *= fade;
          drawSticker(g, bubble.sticker, x, bubble.y, bubble.r * 2, () => s.invalidate());
          g.restore();
        } else {
          drawBubble(g, x, bubble.y, bubble.r, fade);
        }
        if (bubble.label) {
          // Keep the label on screen above dancers near the edge.
          g.font = `800 26px ${FONT}`;
          const half = g.measureText(bubble.label).width / 2 + 24;
          const lx = Math.min(s.w - half, Math.max(half, x));
          drawShadowText(g, bubble.label, lx, bubble.y - bubble.r - 22, { size: 26, weight: 800, align: 'center', alpha: fade });
        }
      }
    },
  });

  return null;
}
