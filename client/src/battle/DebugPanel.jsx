import { useRef } from 'react';
import { FONT, drawCaps, drawGlassPanel, drawPill } from '../ui/draw.js';
import useCanvasUI from '../ui/useCanvasUI.js';
import { reportResult, seatTokens, session } from './api.js';

/**
 * Fakes the end of a battle until the dance itself reports scores: random winner, tie, or
 * one seat reporting so the 90 s grace window settles it. Reports with the seat tokens this
 * display holds. Shown in dev, with ?debug in the URL, or after pressing ` (backquote).
 *
 * <DebugPanel battle={publicBattle} />
 */

// A strip along the top, clear of the header and the seat tags.
const PANEL = { x: 574, y: 26, w: 996, h: 132 };
const BUTTONS = [
  { id: 'random', label: 'Random winner', icon: 'shuffle', w: 300 },
  { id: 'tie', label: 'Tie', icon: 'duo', w: 160 },
  { id: 'noshow', label: 'One no-show', icon: 'play', w: 270 },
];
BUTTONS.reduce((x, b) => {
  b.rect = { x, y: PANEL.y + 52, w: b.w, h: 62 };
  return x + b.w + 18;
}, PANEL.x + 206);

if (new URLSearchParams(location.search).has('debug')) session.set('aerodance.debug', true);
export const debugEnabled = () => import.meta.env.DEV || !!session.get('aerodance.debug');

const rand = (lo, hi) => Math.round(lo + Math.random() * (hi - lo));
const randomResult = () => ({ score: rand(600, 2000), pops: rand(10, 60), sync: Math.round(Math.random() * 100) / 100, flair: rand(0, 10) });

export default function DebugPanel({ battle }) {
  const props = useRef({});
  props.current = { battle };
  const st = useRef({ shown: debugEnabled(), alpha: 0, note: '', busy: false }).current;

  // Seats this display can still report for.
  const openSeats = () => {
    const b = props.current.battle;
    if (b?.status !== 'open') return [];
    const tokens = seatTokens.get(b.id);
    return b.players.filter((p) => !p.result && tokens[p.seat]).map((p) => ({ seat: p.seat, token: tokens[p.seat] }));
  };
  const visible = () => st.shown && openSeats().length > 0;

  const send = async (seats, result) => {
    const b = props.current.battle;
    for (const { seat, token } of seats) {
      try {
        await reportResult(b.id, token, result ?? randomResult());
      } catch (err) {
        st.note = `Seat ${seat + 1}: ${err.message}`;
      }
    }
  };

  useCanvasUI({
    priority: 3,
    active: () => visible() && st.alpha > 0.3 && !st.busy,
    widgets: () => BUTTONS,
    onActivate: async (wdg, s) => {
      const seats = openSeats();
      st.busy = true;
      st.note = '';
      if (wdg.id === 'random') await send(seats);
      if (wdg.id === 'tie') await send(seats, randomResult());
      if (wdg.id === 'noshow') {
        await send(seats.slice(0, 1));
        st.note = 'Other seats stay silent; it settles in ~90 s';
      }
      st.busy = false;
      s.invalidate();
    },
    onKey: (e, s) => {
      if (e.key !== '`') return;
      st.shown = !st.shown;
      session.set('aerodance.debug', st.shown || null);
      s.invalidate();
    },
    update: (_, s) => { st.alpha = s.ease(st.alpha, visible() ? 1 : 0, 6); },
    opacity: () => st.alpha,
    draw: (g, s) => {
      drawGlassPanel(g, PANEL, 26);
      drawCaps(g, 'DEBUG', PANEL.x + 30, PANEL.y + 70, { size: 22 });
      drawCaps(g, 'FAKE RESULTS', PANEL.x + 30, PANEL.y + 100, { size: 14 });
      for (const b of BUTTONS) {
        drawPill(g, b.rect, { label: b.label, icon: b.icon, hover: s.hover[b.id] ?? 0, press: s.press * (s.hover[b.id] ?? 0) });
      }
      if (st.note) {
        g.font = `600 18px ${FONT}`;
        g.fillStyle = '#ffffff';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(st.note, PANEL.x + PANEL.w / 2, PANEL.y + 28, PANEL.w - 64);
      }
    },
  });

  return null;
}
